import { kv } from "@vercel/kv";
import { traceable } from "langsmith/traceable";

function keyFor(hypothesis) {
  const normalized = hypothesis.trim().toLowerCase().replace(/\s+/g, " ");
  return `confidence:${normalized}`;
}

export async function POST(request) {
  try {
    const { hypothesis } = await request.json();

    if (!hypothesis) {
      return Response.json(
        { error: "Please enter a market hypothesis." },
        { status: 400 }
      );
    }

    /*
     * STEP 0
     * Look up this hypothesis's last known confidence in KV.
     * Falls back to 50 (no lean) the first time it's ever run,
     * or if KV isn't reachable for some reason.
     */

    const kvKey = keyFor(hypothesis);
    const historyKey = kvKey.replace(/^confidence:/, "history:");
    let startingConfidence = 50;

    try {
      const stored = await kv.get(kvKey);
      if (stored && typeof stored.confidence === "number") {
        startingConfidence = stored.confidence;
      }
    } catch (kvError) {
      console.error("KV read failed, defaulting to 50:", kvError);
    }

      const TRACKED_CAP = 8;

    try {
      await kv.zadd("tracked:hypotheses", { score: Date.now(), member: hypothesis });
      const count = await kv.zcard("tracked:hypotheses");
      if (count > TRACKED_CAP) {
        await kv.zremrangebyrank("tracked:hypotheses", 0, count - TRACKED_CAP - 1);
      }
    } catch (kvError) {
      console.error("KV tracked-list update failed:", kvError);
    }

    /*
     * STEP 1
     * Search the live web with Tavily.
     */

    const searchQuery = `
      Latest natural gas and LNG market evidence relevant to this hypothesis:
      "${hypothesis}"

      Focus on LNG spot prices, TTF, JKM, Henry Hub where relevant,
      European gas storage, LNG supply and demand, shipping,
      weather, outages and geopolitical developments.
    `;

       const searchTavily = traceable(
      async (query) => {
        const response = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            query,
            search_depth: "basic",
            max_results: 5,
            include_answer: false,
            include_raw_content: false
          })
        });
        return { response, data: await response.json() };
      },
      { name: "tavily_search", run_type: "retriever" }
    );

    const { response: tavilyResponse, data: tavilyData } = await searchTavily(searchQuery);

    if (!tavilyResponse.ok) {
      console.error("Tavily error:", tavilyData);

      return Response.json(
        {
          error: "Live market search failed.",
          details: tavilyData
        },
        { status: tavilyResponse.status }
      );
    }

    /*
     * STEP 2
     * Convert Tavily results into evidence for Nemotron.
     */

    const sources = (tavilyData.results || []).map(
      (source, index) => ({
        id: index + 1,
        title: source.title,
        url: source.url,
        content: source.content,
        score: source.score
      })
    );

    const evidenceText = sources.length
      ? sources
          .map(
            (source) => `
SOURCE ${source.id}
Title: ${source.title}
URL: ${source.url}
Evidence:
${source.content}
`
          )
          .join("\n")
      : "No live sources were returned.";

    /*
     * STEP 3
     * Ask Nemotron to reason over the hypothesis AND live evidence.
     */

    const nemotronResponse = await fetch(
      `${process.env.NEBIUS_BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.NEBIUS_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: process.env.NEBIUS_MODEL,

          messages: [
            {
              role: "system",
              content: `
You are the reasoning engine for Solid Natural Gas,
an agentic LNG market intelligence application.

Evaluate market hypotheses using ONLY the supplied live evidence
plus clearly identified general analytical reasoning.

Do not invent current market facts.

Clearly distinguish:
1. evidence contained in the supplied sources,
2. analytical inference,
3. uncertainty or missing evidence.

When relying on supplied evidence, cite the relevant source
using [Source 1], [Source 2], etc.

The hypothesis currently has a confidence score of ${startingConfidence}/100
(0 = very likely false, 50 = no lean, 100 = very likely true), based on
prior analysis. Weigh the NEW evidence against that starting point --
don't swing the score wildly on weak or tangential evidence.

Keep PRIMARY THESIS, COUNTER-THESIS, and KEY VARIABLES TO MONITOR concise
(3-4 sentences or bullet points each). Spend more of your output budget on
LIVE EVIDENCE and CONFIDENCE ASSESSMENT, since those carry the most weight.

Return the analysis using these headings:

PRIMARY THESIS
COUNTER-THESIS
LIVE EVIDENCE
KEY VARIABLES TO MONITOR
RISKS / MISSING INFORMATION
CONFIDENCE ASSESSMENT

The confidence assessment must explain why the available
evidence strengthens, weakens or leaves the hypothesis unresolved.

After CONFIDENCE ASSESSMENT, on its own line, output exactly:
CONFIDENCE_SCORE: <integer 0-100>
with nothing else on that line. This is parsed by code, so the
format must be exact.
`
            },

            {
              role: "user",
              content: `
MARKET HYPOTHESIS:

${hypothesis}

LIVE MARKET EVIDENCE:

${evidenceText}

Evaluate the hypothesis using the evidence above.
`
            }
          ],

          max_tokens: 2200,
          reasoning_effort: "medium"
        })
      }
    );

    const nemotronData = await nemotronResponse.json();

    if (!nemotronResponse.ok) {
      console.error("Nebius error:", nemotronData);

      return Response.json(
        {
          error: "Nemotron analysis failed.",
          details: nemotronData
        },
        { status: nemotronResponse.status }
      );
    }

    /*
     * STEP 4
     * Extract the Nemotron response, strip the CONFIDENCE_SCORE line
     * out of the displayed text, and parse the score.
     */

    const message = nemotronData.choices?.[0]?.message;

    const rawResult =
      message?.content ||
      message?.reasoning_content ||
      nemotronData.choices?.[0]?.text ||
      "";

    let newConfidence = startingConfidence;
    const match = rawResult.match(/CONFIDENCE_SCORE:\s*(\d{1,3})/i);
    if (match) {
      newConfidence = Math.max(0, Math.min(100, parseInt(match[1], 10)));
    }

    // Strip the machine-readable line so it doesn't show up in the UI
    const result = rawResult
      .replace(/^\s*\*{0,2}\s*CONFIDENCE_SCORE:\s*\d{1,3}\s*\*{0,2}\s*$/gim, "")
      .trim();

    /*
     * STEP 5
     * Persist the new confidence + append to history in KV, keyed by
     * this hypothesis, so the next run (from this page, the dashboard,
     * OR the cron job) continues from here instead of resetting to 50.
     */

      const lastRun = new Date().toISOString();

    const reasoningMatch = result.match(/CONFIDENCE ASSESSMENT\s*\n+([\s\S]*)/i);
    const reasoning = reasoningMatch ? reasoningMatch[1].trim() : "";

    try {
      await kv.set(kvKey, { confidence: newConfidence, hypothesis, lastRun });
      await kv.lpush(
        historyKey,
        JSON.stringify({
          confidence: newConfidence,
          delta: newConfidence - startingConfidence,
          timestamp: lastRun,
          evidenceCount: sources.length,
          reasoning
        })
      );
      await kv.ltrim(historyKey, 0, 49);
    } catch (kvError) {
      console.error("KV write failed (result still returned):", kvError);
    }

    console.log(
      "Solid Natural Gas analysis:",
      JSON.stringify(
        {
          tavilyUsage: tavilyData.usage,
          nemotronUsage: nemotronData.usage,
          finishReason: nemotronData.choices?.[0]?.finish_reason,
          confidenceDelta: newConfidence - startingConfidence
        },
        null,
        2
      )
    );

    /*
     * STEP 6
     * Return analysis + source list + confidence to the website.
     */

    return Response.json({
      result,

      confidence: newConfidence,
      previousConfidence: startingConfidence,
      confidenceDelta: newConfidence - startingConfidence,

      sources: sources.map((source) => ({
        id: source.id,
        title: source.title,
        url: source.url,
        score: source.score
      })),

      usage: {
        tavily: tavilyData.usage || null,
        nemotron: nemotronData.usage || null
      },

      finish_reason: nemotronData.choices?.[0]?.finish_reason || null
    });

  } catch (error) {
    console.error("Solid Natural Gas route error:", error);

    return Response.json(
      {
        error: "Unable to analyze the market hypothesis.",
        details: error.message
      },
      { status: 500 }
    );
  }
}
