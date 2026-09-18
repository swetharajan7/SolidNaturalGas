export async function POST(request) {
  try {
    const { hypothesis, previousConfidence } = await request.json();
    const startingConfidence =
      typeof previousConfidence === "number" ? previousConfidence : 50;

    if (!hypothesis) {
      return Response.json(
        { error: "Please enter a market hypothesis." },
        { status: 400 }
      );
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

    const tavilyResponse = await fetch(
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: searchQuery,
          search_depth: "basic",
          max_results: 5,
          include_answer: false,
          include_raw_content: false
        })
      }
    );

    const tavilyData = await tavilyResponse.json();

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

          max_tokens: 1200,
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
     * Extract the Nemotron response, and pull out the confidence score.
     */

    const message =
      nemotronData.choices?.[0]?.message;

    const result =
      message?.content ||
      message?.reasoning_content ||
      nemotronData.choices?.[0]?.text ||
      null;

    let newConfidence = startingConfidence;
    if (result) {
      const match = result.match(/CONFIDENCE_SCORE:\s*(\d{1,3})/i);
      if (match) {
        newConfidence = Math.max(0, Math.min(100, parseInt(match[1], 10)));
      }
    }

    console.log(
      "Solid Natural Gas analysis:",
      JSON.stringify(
        {
          tavilyUsage: tavilyData.usage,
          nemotronUsage: nemotronData.usage,
          finishReason:
            nemotronData.choices?.[0]?.finish_reason,
          confidenceDelta: newConfidence - startingConfidence
        },
        null,
        2
      )
    );

    /*
     * STEP 5
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

      finish_reason:
        nemotronData.choices?.[0]?.finish_reason ||
        null
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
