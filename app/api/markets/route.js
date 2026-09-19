async function searchTavily(query) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: 4,
      include_answer: false,
      include_raw_content: false
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Tavily failed for "${query}": ${JSON.stringify(data)}`);
  }
  return data.results || [];
}

function formatEvidence(label, results) {
  if (!results.length) return `${label}: No live sources were returned.`;
  return results
    .map((r) => `${label} SOURCE: "${r.title}"\n${r.content}`)
    .join("\n\n");
}

export async function GET() {
  try {
    /*
     * STEP 1
     * Five targeted Tavily searches, one per benchmark, run in parallel.
     * Targeted queries beat one broad query for accuracy — a single
     * "latest energy prices" search risks the model mixing up which
     * number belongs to which benchmark.
     */

    const queries = {
      henryHub: "Henry Hub natural gas spot price today $/MMBtu",
      ttf: "Dutch TTF natural gas price today euros per MWh",
      jkm: "JKM LNG spot price today Asia $/MMBtu",
      brent: "Brent crude oil price today $ per barrel",
      wti: "WTI crude oil price today $ per barrel"
    };

    const entries = Object.entries(queries);
    const resultsByBenchmark = await Promise.all(
      entries.map(([key, query]) => searchTavily(query))
    );

    const evidenceBlocks = entries
      .map(([key], i) => formatEvidence(key.toUpperCase(), resultsByBenchmark[i]))
      .join("\n\n---\n\n");

    /*
     * STEP 2
     * One Nemotron call extracts all five prices as structured JSON,
     * each labeled with which evidence block it came from.
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
              content: `You extract current energy benchmark prices from search
evidence. Evidence is grouped into blocks labeled HENRYHUB, TTF, JKM, BRENT,
and WTI — use only the block matching each benchmark, never cross-contaminate.
Respond with ONLY a JSON object, no markdown, no preamble, in exactly this shape:
{
  "henryHub": {"value": <number or null>, "date": "<date as stated, or null>"},
  "ttf": {"value": <number or null>, "date": "<date as stated, or null>"},
  "jkm": {"value": <number or null>, "date": "<date as stated, or null>"},
  "brent": {"value": <number or null>, "date": "<date as stated, or null>"},
  "wti": {"value": <number or null>, "date": "<date as stated, or null>"}
}
If a benchmark's evidence block has no reliable price, use null for that
benchmark's value and date. Never invent a number.`
            },
            {
              role: "user",
              content: `Evidence:\n\n${evidenceBlocks}\n\nExtract all five prices.`
            }
          ],
          max_tokens: 600,
          temperature: 0,
          reasoning_effort: "low"
        })
      }
    );

    const nemotronData = await nemotronResponse.json();
    if (!nemotronResponse.ok) {
      console.error("Nebius error:", nemotronData);
      return Response.json(
        { error: "Price extraction failed.", details: nemotronData },
        { status: nemotronResponse.status }
      );
    }

    const message = nemotronData.choices?.[0]?.message;
    const raw = message?.content || message?.reasoning_content || "";
    const clean = raw.replace(/```json|```/g, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    const jsonText = match ? match[0] : clean;

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      console.error("Markets JSON parse failed. Raw output:", raw);
      return Response.json(
        { error: "Unable to parse prices from evidence.", details: raw },
        { status: 502 }
      );
    }

    return Response.json({
      markets: parsed,
      updatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error("Markets route error:", error);
    return Response.json(
      { error: "Unable to load market prices.", details: error.message },
      { status: 500 }
    );
  }
}

export const revalidate = 21600; // 6 hours
