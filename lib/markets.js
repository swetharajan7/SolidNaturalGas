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
  async (query, timeRange = "month") => {
  const params = { search_depth: "basic", topic: "finance", time_range: timeRange };
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
        max_results: 5,
        time_range: params.time_range,
        include_answer: "basic",
        include_raw_content: false
      })
  });

  const data = await response.json();
  if (!response.ok) {
      throw new Error(`Tavily failed for "${query}": ${JSON.stringify(data)}`);
  }
  const results = { answer: data.answer || null, results: data.results || [] };

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
  queries: ["Henry Hub natural gas spot price today $/MMBtu"],
  label: "HENRYHUB",
  unit: "US dollars per MMBtu",
  min: 0.5,
  max: 30,
  note: "A spot price, NOT working gas in storage (which is ~3,000 Bcf) and NOT a futures index level."
  },
  waha: {
  queries: [
      "Waha hub natural gas spot price today",
      "Permian Waha natural gas price $/MMBtu this week"
  ],
  label: "WAHA",
  unit: "US dollars per MMBtu",
  min: -15,
  max: 25,
  note: "West Texas/Permian hub. Can legitimately trade NEGATIVE when takeaway capacity is constrained, so a negative value here is valid."
  },
  houstonShipChannel: {
  queries: [
      "Houston Ship Channel natural gas spot price today",
      "Houston Ship Channel gas price $/MMBtu Gulf Coast this week"
  ],
  label: "HOUSTONSHIPCHANNEL",
  unit: "US dollars per MMBtu",
  min: 0.5,
  max: 30,
  note: "Gulf Coast hub near the LNG export terminals. Usually trades close to Henry Hub."
  },
  aeco: {
  queries: [
      "AECO natural gas price today Alberta",
      "Alberta NIT AECO C spot gas price C$/GJ latest"
  ],
  timeRange: "month",
  label: "AECO",
  unit: "Canadian dollars per GJ",
  min: -5,
  max: 30,
  note: "Western Canadian benchmark, also called Alberta NIT. Usually quoted in C$/GJ; if the source quotes US$/MMBtu, still report the number as stated."
  },
  ttf: {
  queries: ["Dutch TTF natural gas price today euros per MWh"],
  label: "TTF",
  unit: "euros per MWh",
  min: 2,
  max: 200,
  note: "Quoted in EUR/MWh, not in dollars and not per MMBtu."
  },
  jkm: {
  queries: [
      "JKM LNG spot price this week $/MMBtu",
      "Platts JKM Northeast Asia LNG spot assessment latest price"
  ],
  label: "JKM",
  unit: "US dollars per MMBtu",
  min: 2,
  max: 100,
  note: "An LNG spot assessment, not a cargo volume or a shipping rate."
  },
  wallumbilla: {
  queries: [
      "ACCC LNG netback price Wallumbilla latest A$/GJ",
      "Wallumbilla gas price per GJ Australia latest"
  ],
  timeRange: "month",
  label: "WALLUMBILLA",
  unit: "Australian dollars per GJ",
  min: 1,
  max: 60,
  note: "The ACCC LNG netback series at Wallumbilla, quoted in A$/GJ. This is a netback, not a spot cargo price."
  },
  brent: {
  queries: ["Brent crude oil price today $ per barrel"],
  label: "BRENT",
  unit: "US dollars per barrel",
  min: 20,
  max: 200,
  note: "A per-barrel price, not a production volume."
  },
  wti: {
  queries: ["WTI crude oil price today $ per barrel"],
  label: "WTI",
  unit: "US dollars per barrel",
  min: 15,
  max: 200,
  note: "A per-barrel price. WTI normally trades a few dollars BELOW Brent."
  }
};

function formatEvidence(label, payload) {
  const results = payload?.results || [];
  const answer = payload?.answer;
  if (!results.length && !answer) return `${label}: No live sources were returned.`;
  const parts = [];
  if (answer) parts.push(`${label} SUMMARY: ${answer}`);
  parts.push(
  ...results.map((r) => `${label} SOURCE: "${r.title}"\n${r.content}`)
  );
  return parts.join("\n\n");
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
          max_tokens: 1600,
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
 * Persist each validated price so the app builds its own history.
 * One list per benchmark, newest first, capped at ~6 months of daily points.
 * A reading is skipped when the newest stored point already has the same
 * date and value, so the 4x-daily refresh doesn't create duplicates.
 */
const HISTORY_CAP = 200;
export const SNAPSHOT_KEY = "markets:latest";

async function recordHistory(markets) {
  const stamped = new Date().toISOString();

  await Promise.all(
  Object.entries(markets).map(async ([key, entry]) => {
      if (entry.value === null) return;
      const historyKey = `price:history:${key}`;
      try {
        const [newest] = await kv.lrange(historyKey, 0, 0);
        if (newest) {
          const previous = typeof newest === "string" ? JSON.parse(newest) : newest;
          if (previous.value === entry.value && previous.date === entry.date) return;
        }
        await kv.lpush(
          historyKey,
          JSON.stringify({ value: entry.value, date: entry.date, recordedAt: stamped })
        );
        await kv.ltrim(historyKey, 0, HISTORY_CAP - 1);
      } catch (error) {
        console.error(`History write failed for ${key}:`, error);
      }
  })
  );
}

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

export async function refreshMarkets() {
  /*
     * STEP 1
     * One targeted Tavily search per benchmark, run in parallel.
     */

  const entries = Object.entries(BENCHMARKS);
  const resultsByBenchmark = await Promise.all(
      entries.map(async ([, spec]) => {
        const payloads = await Promise.all(
          spec.queries.map((q) =>
            searchTavily(q, spec.timeRange || "month").catch((err) => {
              console.error(`Market search failed for "${q}":`, err);
              return { answer: null, results: [] };
            })
          )
        );
        // merge the query results into one block, dropping duplicate URLs
        const seen = new Set();
        return {
          answer: payloads.map((p) => p.answer).filter(Boolean).join(" "),
          results: payloads
            .flatMap((p) => p.results)
            .filter((r) => (seen.has(r.url) ? false : seen.add(r.url)))
        };
      })
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
Report the most recent price you can find in each block. Prefer a price whose
date is stated; if no date is given but the source is clearly reporting a
current price, still report the value and set "date" to null. Use null for
BOTH value and date only when the block contains no usable current price at
all, or when the only numbers present are clearly a different quantity.
Never invent a number.`;

  const userPrompt = `Evidence:\n\n${evidenceBlocks}\n\nExtract all five prices.`;

  const { response: nemotronResponse, data: nemotronData } = await callNemotron(
      systemPrompt,
      userPrompt
  );

  if (!nemotronResponse.ok) {
  console.error("Nebius error:", nemotronData);
  throw new Error(`Price extraction failed: ${JSON.stringify(nemotronData)}`);
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
  throw new Error("Unable to parse prices from evidence.");
  }

  /*
     * STEP 3
     * Validate before anything reaches the page.
     */

  const { markets, rejected } = validate(parsed);

  if (rejected.length) {
    console.error("Rejected implausible market values:", rejected.join("; "));
  }

  await recordHistory(markets);

  const found = Object.values(markets).filter((m) => m.value !== null).length;
  if (found === 0) {
    console.error("No prices extracted. Raw model output:", raw.slice(0, 2000));
  }

  await logActivity(`Markets updated: ${Object.keys(BENCHMARKS).length} benchmarks`);

  const snapshot = {
    markets,
    rejected,
    extracted: found,
    updatedAt: new Date().toISOString()
  };

  // The page reads this snapshot, so a visitor never waits on the searches.
  await kv.set(SNAPSHOT_KEY, snapshot);

  return snapshot;
}
