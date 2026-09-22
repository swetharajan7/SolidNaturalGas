import { kv } from "@vercel/kv";
import { traceable } from "langsmith/traceable";

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
    const params = { search_depth: "basic", time_range: "month" };
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
        include_raw_content: false
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

function formatEvidence(label, results) {
  if (!results.length) return `${label}: No live sources were returned.`;
  return results.map((r) => `${label} SOURCE: "${r.title}"\n${r.content}`).join("\n\n");
}

const callNemotron = traceable(
  async (systemPrompt, userPrompt) => {
    const response = await fetch(`${process.env.NEBIUS_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NEBIUS_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.NEBIUS_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 1500,
        temperature: 0,
        reasoning_effort: "low"
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`Nemotron failed: ${JSON.stringify(data)}`);
    const message = data.choices?.[0]?.message;
    const raw = message?.content || message?.reasoning_content || "";
    const clean = raw.replace(/```json|```/g, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : clean);
  },
  { name: "nemotron_flows_classification", run_type: "llm" }
);

export async function GET() {
  try {
    /*
     * CHOKEPOINTS — 6 targeted searches
     */
    const chokepointQueries = {
      panama: "Panama Canal LNG tanker transit congestion delays today",
      suez: "Suez Canal LNG tanker transit disruption today",
      hormuz: "Strait of Hormuz LNG shipping tension risk today",
      malacca: "Strait of Malacca LNG tanker traffic today",
      capeOfGoodHope: "Cape of Good Hope LNG tanker rerouting today",
      bosporus: "Bosporus Strait LNG tanker transit today"
    };
    const chokepointEntries = Object.entries(chokepointQueries);
    const chokepointResults = await Promise.all(
      chokepointEntries.map(([, q]) => searchTavily(q))
    );
    const chokepointEvidence = chokepointEntries
      .map(([key], i) => formatEvidence(key.toUpperCase(), chokepointResults[i]))
      .join("\n\n---\n\n");

    const chokepoints = await callNemotron(
      `You extract LNG shipping chokepoint status from search evidence. Evidence is
grouped into blocks labeled PANAMA, SUEZ, HORMUZ, MALACCA, CAPEOFGOODHOPE, BOSPORUS.
Respond with ONLY a JSON object:
{
  "panama": {"status": "normal"|"elevated"|"disrupted", "note": "<one sentence, or null if no evidence>"},
  "suez": {"status": "...", "note": "..."},
  "hormuz": {"status": "...", "note": "..."},
  "malacca": {"status": "...", "note": "..."},
  "capeOfGoodHope": {"status": "...", "note": "..."},
  "bosporus": {"status": "...", "note": "..."}
}
Use "normal" when evidence shows routine operation or there's no notable disruption
reported. Never invent an incident not present in the evidence.`,
      `Evidence:\n\n${chokepointEvidence}\n\nClassify each chokepoint.`
    );

    /*
     * ROUTE TRENDS — 5 consolidated searches covering 8 named corridors
     */
    const routeQueries = {
      usGulf: "US Gulf Coast LNG exports Europe Asia trend September 2026",
      qatar: "Qatar LNG exports Europe Asia trend",
      australia: "Australia LNG exports North Asia trend",
      russiaArctic: "Russia Arctic LNG exports Europe Asia trend",
      eastAfricaAtlantic: "East Africa LNG exports Asia Atlantic Basin LNG trade flow Europe"
    };
    const routeEntries = Object.entries(routeQueries);
    const routeResults = await Promise.all(routeEntries.map(([, q]) => searchTavily(q)));
    const routeEvidence = routeEntries
      .map(([key], i) => formatEvidence(key.toUpperCase(), routeResults[i]))
      .join("\n\n---\n\n");

    const corridors = await callNemotron(
      `You classify LNG trade corridor trends from search evidence. Evidence blocks
are labeled USGULF, QATAR, AUSTRALIA, RUSSIAARCTIC, EASTAFRICAATLANTIC — use the
relevant block(s) for each named corridor below. Respond with ONLY a JSON object:
{
  "usGulfEurope": {"trend": "up"|"down"|"stable", "note": "<one sentence, or null>"},
  "usGulfAsia": {"trend": "...", "note": "..."},
  "qatarEurope": {"trend": "...", "note": "..."},
  "qatarAsia": {"trend": "...", "note": "..."},
  "australiaNorthAsia": {"trend": "...", "note": "..."},
  "eastAfricaAsia": {"trend": "...", "note": "..."},
  "russiaArcticEuropeAsia": {"trend": "...", "note": "..."},
  "atlanticBasinEurope": {"trend": "...", "note": "..."}
}
Use "stable" when evidence doesn't clearly indicate a direction. Never invent a
trend not supported by the evidence.`,
      `Evidence:\n\n${routeEvidence}\n\nClassify each corridor.`
    );

    await logActivity("Checked 6 LNG chokepoints: Panama, Suez, Hormuz, Malacca, Cape of Good Hope, Bosporus");
    await logActivity("Checked 8 LNG trade corridors");

    return Response.json({
      chokepoints,
      corridors,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Flows route error:", error);
    return Response.json(
      { error: "Unable to load LNG flow intelligence.", details: error.message },
      { status: 500 }
    );
  }
}

export const revalidate = 21600; // 6 hours
