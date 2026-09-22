import { kv } from "@vercel/kv";
import { traceable } from "langsmith/traceable";

const ULTRA_MODEL = process.env.NEBIUS_MODEL_ULTRA || "nvidia/Nemotron-3-Ultra-550b-a55b";

function keyFor(hypothesis) {
  const normalized = hypothesis.trim().toLowerCase().replace(/\s+/g, " ");
  return `confidence:${normalized}`;
}

async function logActivity(message) {
  try {
    await kv.lpush(
      "activity:log",
      JSON.stringify({ message, timestamp: new Date().toISOString() })
    );
    await kv.ltrim("activity:log", 0, 99);
  } catch (error) {
    console.error("Activity log write failed:", error);
  }
}

const TAVILY_CACHE_TTL_SECONDS = 300;

function tavilyCacheKey(query, params) {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 150);
  return `tavily:cache:${params.search_depth}:${params.time_range || "none"}:${normalized}`;
}

const searchTavily = traceable(
  async (query) => {
    const params = { search_depth: "advanced", time_range: "month" };
    const cacheKey = tavilyCacheKey(query, params);

    try {
      const cached = await kv.get(cacheKey);
      if (cached) return cached;
    } catch (error) {
      console.error("Tavily cache read failed:", error);
    }

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query,
        search_depth: params.search_depth,
        max_results: 4,
        time_range: params.time_range,
        include_answer: false,
        include_raw_content: "markdown",
        exclude_domains: [
          "cotinsight.com",
          "brentchart.com",
          "globaloilshock.com",
          "investopedia.com",
          "wikipedia.org"
        ]
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Tavily failed for "${query}": ${JSON.stringify(data)}`);
    }
    const results = data.results || [];

    try {
      await kv.set(cacheKey, results, { ex: TAVILY_CACHE_TTL_SECONDS });
    } catch (error) {
      console.error("Tavily cache write failed:", error);
    }

    return results;
  },
  { name: "tavily_search", run_type: "retriever" }
);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Tavily failed for "${query}": ${JSON.stringify(data)}`);
    }
    return data.results || [];
  },
  { name: "tavily_search", run_type: "retriever" }
);

const callUltraJSON = traceable(
  async (systemPrompt, userPrompt, maxTokens) => {
    const response = await fetch(`${process.env.NEBIUS_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NEBIUS_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: ULTRA_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: maxTokens,
        reasoning_effort: "medium"
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Ultra call failed: ${JSON.stringify(data)}`);
    }
    const message = data.choices?.[0]?.message;
    const raw = message?.content || message?.reasoning_content || "";
    const clean = raw.replace(/```json|```/g, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : clean);
  },
  { name: "nemotron_ultra_planning", run_type: "llm" }
);

const callUltraReport = traceable(
  async (systemPrompt, userPrompt) => {
    const response = await fetch(`${process.env.NEBIUS_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NEBIUS_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: ULTRA_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 2200,
        reasoning_effort: "medium"
      })
    });
    return { response, data: await response.json() };
  },
  { name: "nemotron_ultra_synthesis", run_type: "llm" }
);

function formatEvidence(sources) {
  const MAX_RAW_CONTENT_CHARS = 2500;
  if (!sources.length) return "No live sources were returned.";
  return sources
    .map((source) => {
      const raw = source.raw_content
        ? source.raw_content.slice(0, MAX_RAW_CONTENT_CHARS)
        : null;
      return `
SOURCE ${source.id}
Title: ${source.title}
URL: ${source.url}
Evidence:
${raw || source.content}
`;
    })
    .join("\n");
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
     * PHASE A — PLANNING
     * The agent (not hardcoded logic) decides what to search for.
     */

    let plannedQueries = [
      `Latest natural gas and LNG market evidence relevant to: "${hypothesis}"`
    ];

    try {
      const plan = await callUltraJSON(
        `You are a research planner for an LNG/natural gas market intelligence
agent. Given a hypothesis and its current confidence score, propose 1 to 3
specific, targeted web search queries that would gather the best evidence to
evaluate it. Prefer distinct angles (e.g. price data, supply/shipping
disruptions, policy) over near-duplicate queries. Respond with ONLY a JSON
object: {"queries": ["...", "..."]}`,
        `Hypothesis: "${hypothesis}"\nCurrent confidence: ${startingConfidence}/100`,
        300
      );
      if (Array.isArray(plan.queries) && plan.queries.length > 0) {
        plannedQueries = plan.queries.slice(0, 3);
      }
    } catch (error) {
      console.error("Planning phase failed, using fallback query:", error);
    }

    await logActivity(
      `Agent planned ${plannedQueries.length} search${plannedQueries.length > 1 ? "es" : ""} for "${hypothesis}": ${plannedQueries.join(" | ")}`
    );

    /*
     * PHASE B — INITIAL EVIDENCE GATHERING
     */

    const initialResultSets = await Promise.all(
      plannedQueries.map((q) => searchTavily(q).catch((err) => {
        console.error("A planned search failed:", err);
        return [];
      }))
    );

    let sources = initialResultSets.flat().map((source, index) => ({
      id: index + 1,
      title: source.title,
      url: source.url,
      content: source.content,
      score: source.score,
      favicon: source.favicon || null,
      raw_content: source.raw_content || null
    }));

    await logActivity(
      `Queried live evidence for "${hypothesis}" (${sources.length} sources)`
    );

    /*
     * PHASE C — GAP CHECK
     * The agent judges whether its own evidence is sufficient, or
     * requests one targeted follow-up search before finalizing.
     */

    let followUpQuery = null;
    try {
      const gapCheck = await callUltraJSON(
        `You are evaluating whether gathered evidence is sufficient to assess
a market hypothesis, or whether one more targeted search is needed. Only
request a follow-up if evidence is clearly thin, one-sided, or missing a key
angle. Respond with ONLY a JSON object:
{"needsMoreEvidence": true|false, "followUpQuery": "<specific query>" or null}`,
        `Hypothesis: "${hypothesis}"\n\nEvidence gathered:\n${formatEvidence(sources)}`,
        250
      );
      if (gapCheck.needsMoreEvidence && gapCheck.followUpQuery) {
        followUpQuery = gapCheck.followUpQuery;
      }
    } catch (error) {
      console.error("Gap-check phase failed, proceeding with current evidence:", error);
    }

    /*
     * PHASE D — CONDITIONAL FOLLOW-UP (at most one round)
     */

    if (followUpQuery) {
      await logActivity(`Agent requested additional evidence: "${followUpQuery}"`);
      try {
        const followUpResults = await searchTavily(followUpQuery);
        const nextId = sources.length + 1;
        const newSources = followUpResults.map((source, index) => ({
          id: nextId + index,
          title: source.title,
          url: source.url,
          content: source.content,
          score: source.score,
          favicon: source.favicon || null,
          raw_content: source.raw_content || null
        }));
        sources = sources.concat(newSources);
      } catch (error) {
        console.error("Follow-up search failed:", error);
      }
    }

    /*
     * PHASE E — FINAL SYNTHESIS
     * Same report format as before, so the frontend needs no changes.
     */

    const systemPrompt = `
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
`;

    const userPrompt = `
MARKET HYPOTHESIS:

${hypothesis}

LIVE MARKET EVIDENCE (gathered by the agent's own research plan):

${formatEvidence(sources)}

Evaluate the hypothesis using the evidence above.
`;

    const { response: nemotronResponse, data: nemotronData } = await callUltraReport(
      systemPrompt,
      userPrompt
    );

    if (!nemotronResponse.ok) {
      console.error("Nebius error:", nemotronData);
      return Response.json(
        { error: "Nemotron analysis failed.", details: nemotronData },
        { status: nemotronResponse.status }
      );
    }

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

    const result = rawResult
      .replace(/^\s*\*{0,2}\s*CONFIDENCE_SCORE:\s*\d{1,3}\s*\*{0,2}\s*$/gim, "")
      .trim();

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

    await logActivity(
      `Hypothesis updated: "${hypothesis}" ${startingConfidence}% → ${newConfidence}%`
    );

    console.log(
      "Solid Natural Gas analysis (self-directed):",
      JSON.stringify(
        {
          plannedQueries,
          followUpQuery,
          totalSources: sources.length,
          confidenceDelta: newConfidence - startingConfidence
        },
        null,
        2
      )
    );

    return Response.json({
      result,
      confidence: newConfidence,
      previousConfidence: startingConfidence,
      confidenceDelta: newConfidence - startingConfidence,
      sources: sources.map((source) => ({
        id: source.id,
        title: source.title,
        url: source.url,
        score: source.score,
        favicon: source.favicon
      })),
      plannedQueries,
      followUpQuery
    });

  } catch (error) {
    console.error("Solid Natural Gas route error:", error);
    return Response.json(
      { error: "Unable to analyze the market hypothesis.", details: error.message },
      { status: 500 }
    );
  }
}

export const maxDuration = 90;
