import { kv } from "@vercel/kv";

/*
 * Reads the stored price history and computes a simple, explainable
 * forward range for each benchmark.
 *
 * The band is arithmetic, not a model prediction: it is the latest price
 * projected forward by the standard deviation of recent daily percentage
 * changes, scaled by the square root of the horizon (the usual random-walk
 * assumption). It says "given how much this has been moving, here is where
 * it plausibly sits in a week" — not "this is where it will go".
 */

const BENCHMARK_KEYS = [
  "henryHub",
  "waha",
  "houstonShipChannel",
  "aeco",
  "ttf",
  "jkm",
  "wallumbilla",
  "brent",
  "wti"
];

// Minimum points before a band is meaningful.
const MIN_POINTS = 8;

function parseEntry(raw) {
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

function dailyReturns(series) {
  const returns = [];
  for (let i = 1; i < series.length; i += 1) {
    const previous = series[i - 1].value;
    const current = series[i].value;
    // Percentage returns break down around zero, and Waha can trade negative.
    if (!Number.isFinite(previous) || !Number.isFinite(current)) continue;
    if (Math.abs(previous) < 0.01) continue;
    returns.push((current - previous) / Math.abs(previous));
  }
  return returns;
}

function standardDeviation(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function band(latest, sigma, horizonDays) {
  if (sigma === null || !Number.isFinite(latest)) return null;
  const move = Math.abs(latest) * sigma * Math.sqrt(horizonDays);
  return {
    low: Number((latest - move).toFixed(2)),
    high: Number((latest + move).toFixed(2))
  };
}

export async function GET() {
  try {
    const out = {};

    await Promise.all(
      BENCHMARK_KEYS.map(async (key) => {
        let rows = [];
        try {
          rows = await kv.lrange(`price:history:${key}`, 0, -1);
        } catch (error) {
          console.error(`History read failed for ${key}:`, error);
        }

        // Stored newest-first; reverse to chronological order.
        const series = (rows || [])
          .map(parseEntry)
          .filter((entry) => entry && Number.isFinite(entry.value))
          .reverse();

        if (!series.length) {
          out[key] = { points: 0, series: [], latest: null, weekRange: null, monthRange: null };
          return;
        }

        const latest = series[series.length - 1].value;

        if (series.length < MIN_POINTS) {
          out[key] = {
            points: series.length,
            series,
            latest,
            weekRange: null,
            monthRange: null,
            note: `Collecting data — ${MIN_POINTS - series.length} more reading(s) needed for a range.`
          };
          return;
        }

        // Use at most the last 30 points so the band reflects current conditions.
        const recent = series.slice(-30);
        const sigma = standardDeviation(dailyReturns(recent));

        out[key] = {
          points: series.length,
          series,
          latest,
          dailyVolatility: sigma === null ? null : Number((sigma * 100).toFixed(2)),
          weekRange: band(latest, sigma, 7),
          monthRange: band(latest, sigma, 30),
          basis: `1 standard deviation of daily moves over the last ${recent.length} readings`
        };
      })
    );

    return Response.json({ benchmarks: out, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Price history route error:", error);
    return Response.json(
      { error: "Unable to load price history.", details: error.message },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
