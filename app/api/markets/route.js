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
  return `tavily:cache:${params.search_depth}:${params.topic}:${params.time_range || "none"}:${normalized}`;
}

const searchTavily = traceable(
  async (query) => {
    const params = { search_depth: "basic", topic: "finance", time_range: "week" };
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
        topic: params.topic,
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

/*
 * Each benchmark's unit and a plausible trading range.
 * The range is deliberately wide — it exists to catch category errors
 * (a storage figure in Bcf, an index level, a percentage), not to
 * second-guess a real market move.
 */
const BENCHMARKS = {
  henryHub: {
    query: "Henry Hub natural gas spot price today $/MMBtu",
    label: "HENRYHUB",
    unit: "US dollars per MMBtu",
    min: 0.5,
    max: 30,
    note: "A spot price, NOT working gas in storage (which is ~3,000 Bcf) and NOT a futures index level."
  },
  waha: {
    query: "Waha hub natural gas spot price Permian today $/MMBtu",
    label: "WAHA",
    unit: "US dollars per MMBtu",
    min: -15,
    max: 25,
    note: "West Texas/Permian hub. Can legitimately trade NEGATIVE when takeaway capacity is constrained, so a negative value here is valid."
  },
  houstonShipChannel: {
    query: "Houston Ship Channel natural gas spot price today $/MMBtu",
    label: "HOUSTONSHIPCHANNEL",
    unit: "US dollars per MMBtu",
    min: 0.5,
    max: 30,
    note: "Gulf Coast hub near the LNG export terminals. Usually trades close to Henry Hub."
  },
  aeco: {
    query: "AECO NIT Alberta natural gas spot price today C$/GJ",
    label: "AECO",
    unit: "Canadian dollars per GJ",
    min: -5,
    max: 30,
    note: "Western Canadian benchmark, also called Alberta NIT. Usually quoted in C$/GJ; if the source quotes US$/MMBtu, still report the number as stated."
  },
  ttf: {
    query: "Dutch TTF natural gas price today euros per MWh",
    label: "TTF",
    unit: "euros per MWh",
    min: 2,
    max: 200,
    note: "Quoted in EUR/MWh, not in dollars and not per MMBtu."
  },
  jkm: {
    query: "JKM LNG spot price today Asia $/MMBtu",
    label: "JKM",
    unit: "US dollars per MMBtu",
    min: 2,
    max: 100,
    note: "An LNG spot assessment, not a cargo volume or a shipping rate."
  },
  wallumbilla: {
    query: "Wallumbilla LNG netback price Australia A$/GJ latest",
    label: "WALLUMBILLA",
    unit: "Australian dollars per GJ",
    min: 1,
    max: 60,
    note: "The ACCC LNG netback series at Wallumbilla, quoted in A$/GJ. This is a netback, not a spot cargo price."
  },
  brent: {
    query: "Brent crude oil price today $ per barrel",
    label: "BRENT",
    unit: "US dollars per barrel",
    min: 20,
    max: 200,
    note: "A per-barrel price, not a production volume."
  },
  wti: {
    query: "WTI crude oil price today $ per barrel",
    label: "WTI",
    unit: "US dollars per barrel",
    min: 15,
    max: 200,
    note: "A per-barrel price. WTI normally trades a few dollars BELOW Brent."
  }
};

function formatEvidence(label, results) {
  if (!results.length) return `${label}: No live sources were returned.`;
  return results
    .map((r) => `${label} SOURCE: "${r.title}"\n${r.content}`)
    .join("\n\n");
}

const callNemotron = traceable(
  async (systemPrompt, userPrompt) => {
    const response = await fetch(
      `${process.env.NEBIUS_BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.NEBIUS_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: process.env.NEBIUS_MODEL_FAST || process.env.NEBIUS_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          max_tokens: 1200,
          temperature: 0,
          reasoning_effort: "low"
        })
      }
    );
    return { response, data: await response.json() };
  },
  { name: "nemotron_markets_extraction", run_type: "llm" }
);

/*
 * Last line of defence: a number outside its benchmark's plausible range
 * is dropped rather than shown. A wrong price is worse than no price.
 */
function validate(parsed) {
  const markets = {};
  const rejected = [];

  for (const [key, spec] of Object.entries(BENCHMARKS)) {
    const entry = parsed?.[key];
    const value = typeof entry?.value === "number" ? entry.value : null;

    if (value === null || Number.isNaN(value)) {
      markets[key] = { value: null, date: null };
      continue;
    }

    if (!Number.isFinite(value) || value < spec.min || value > spec.max) {
      rejected.push(`${key}=${value} (expected ${spec.min}-${spec.max} ${spec.unit})`);
      markets[key] = { value: null, date: null };
      continue;
    }

    markets[key] = { value, date: entry.date ?? null };
  }

  return { markets, rejected };
}

export async function GET() {
  try {
    /*
     * STEP 1
     * One targeted Tavily search per benchmark, run in parallel.
     */

    const entries = Object.entries(BENCHMARKS);
    const resultsByBenchmark = await Promise.all(
      entries.map(([, spec]) => searchTavily(spec.query))
    );

    const evidenceBlocks = entries
      .map(([, spec], i) => formatEvidence(spec.label, resultsByBenchmark[i]))
      .join("\n\n---\n\n");

    /*
     * STEP 2
     * One Nemotron call extracts all five prices as structured JSON.
     */

    const unitGuide = entries
      .map(([key, spec]) =>
        `- ${key} (block ${spec.label}): ${spec.unit}, normally between ${spec.min} and ${spec.max}. ${spec.note}`
      )
      .join("\n");

    const systemPrompt = `You extract current energy benchmark prices from search
evidence. Evidence is grouped into blocks labeled HENRYHUB, TTF, JKM, BRENT,
and WTI — use only the block matching each benchmark, never cross-contaminate.

Each benchmark has an expected unit and range:
${unitGuide}

A number outside its expected range is almost certainly a different quantity
(storage volumes, index levels, production figures, percentages, annual
averages). Never report such a number as a price — return null instead.

Respond with ONLY a JSON object, no markdown, no preamble, in exactly this shape:
{
  "henryHub": {"value": <number or null>, "date": "<date as stated, or null>"},
  "ttf": {"value": <number or null>, "date": "<date as stated, or null>"},
  "jkm": {"value": <number or null>, "date": "<date as stated, or null>"},
  "brent": {"value": <number or null>, "date": "<date as stated, or null>"},
  "wti": {"value": <number or null>, "date": "<date as stated, or null>"}
}
Only extract a price if its date is clearly stated as being within the last
10 days. If a benchmark's evidence block has no price meeting that freshness
bar, use null for that benchmark's value and date rather than reporting an
older reference price. Never invent a number.`;

    const userPrompt = `Evidence:\n\n${evidenceBlocks}\n\nExtract all five prices.`;

    const { response: nemotronResponse, data: nemotronData } = await callNemotron(
      systemPrompt,
      userPrompt
    );

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

    /*
     * STEP 3
     * Validate before anything reaches the page.
     */

    const { markets, rejected } = validate(parsed);

    if (rejected.length) {
      console.error("Rejected implausible market values:", rejected.join("; "));
    }

    await logActivity(`Markets updated: ${Object.keys(BENCHMARKS).length} benchmarks`);

    return Response.json({
      markets,
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
