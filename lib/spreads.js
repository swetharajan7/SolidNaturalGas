import { kv } from "@vercel/kv";
import { SNAPSHOT_KEY } from "./markets";

/*
 * SPREAD ENGINE
 *
 * Turns nine raw benchmarks into the numbers a trader actually looks at:
 * arbitrage margins, basis differentials, and routing signals.
 *
 * Everything here is deterministic arithmetic with stated assumptions.
 * No model is involved in producing a number — Nemotron's job is to
 * explain what the numbers mean, not to invent them.
 */

// --- Unit conversion constants -------------------------------------------
// 1 MWh of gas = 3.412 MMBtu (thermal equivalence)
const MMBTU_PER_MWH = 3.412;
// 1 GJ = 0.947817 MMBtu
const MMBTU_PER_GJ = 0.947817;

// --- Cost assumptions, all in $/MMBtu unless noted -----------------------
// These are the standard rules of thumb for a US Gulf Coast cargo.
// Every one is overridable so the numbers can be tuned without a redeploy.
export const ASSUMPTIONS = {
  // Feedgas is bought at a premium to Henry Hub (the "115% of HH" convention)
  feedgasMultiplier: Number(process.env.SPREAD_FEEDGAS_MULTIPLIER || 1.15),
  // Liquefaction tolling fee
  liquefaction: Number(process.env.SPREAD_LIQUEFACTION || 2.5),
  // Shipping, US Gulf -> NW Europe
  freightToEurope: Number(process.env.SPREAD_FREIGHT_EUROPE || 0.6),
  // Shipping, US Gulf -> Northeast Asia (longer voyage, Panama exposure)
  freightToAsia: Number(process.env.SPREAD_FREIGHT_ASIA || 1.35),
  // Regasification at the destination terminal
  regas: Number(process.env.SPREAD_REGAS || 0.45),
  // Typical oil-indexed LNG contract slope (% of Brent)
  brentSlope: Number(process.env.SPREAD_BRENT_SLOPE || 0.135)
};

const FX_CACHE_KEY = "fx:latest";
const FX_TTL_SECONDS = 6 * 60 * 60;

/*
 * FX rates, expressed as US dollars per unit of foreign currency.
 * Falls back to the last cached set, then to env-configured defaults,
 * so a provider outage degrades the output rather than breaking it.
 */
export async function getFxRates() {
  try {
    const cached = await kv.get(FX_CACHE_KEY);
    if (cached) return cached;
  } catch (error) {
    console.error("FX cache read failed:", error);
  }

  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD");
    const data = await response.json();
    if (response.ok && data?.rates?.EUR && data?.rates?.CAD && data?.rates?.AUD) {
      // Provider gives units per USD; invert to USD per unit.
      const rates = {
        EUR: 1 / data.rates.EUR,
        CAD: 1 / data.rates.CAD,
        AUD: 1 / data.rates.AUD,
        source: "open.er-api.com",
        fetchedAt: new Date().toISOString()
      };
      try {
        await kv.set(FX_CACHE_KEY, rates, { ex: FX_TTL_SECONDS });
      } catch (error) {
        console.error("FX cache write failed:", error);
      }
      return rates;
    }
    console.error("FX response unusable:", data);
  } catch (error) {
    console.error("FX fetch failed:", error);
  }

  return {
    EUR: Number(process.env.FX_EUR_USD || 1.08),
    CAD: Number(process.env.FX_CAD_USD || 0.73),
    AUD: Number(process.env.FX_AUD_USD || 0.66),
    source: "fallback",
    fetchedAt: null
  };
}

const num = (entry) =>
  entry && typeof entry.value === "number" && Number.isFinite(entry.value)
    ? entry.value
    : null;

const round = (value, places = 2) =>
  value === null ? null : Number(value.toFixed(places));

/*
 * Every benchmark restated in $/MMBtu so they can be compared directly.
 * This is the step a raw price page never does for you.
 */
export function normalize(markets, fx) {
  const ttf = num(markets?.ttf);
  const aeco = num(markets?.aeco);
  const wallumbilla = num(markets?.wallumbilla);

  return {
    henryHub: round(num(markets?.henryHub)),
    waha: round(num(markets?.waha)),
    houstonShipChannel: round(num(markets?.houstonShipChannel)),
    // C$/GJ -> $/MMBtu
    aeco: round(aeco === null ? null : (aeco * fx.CAD) / MMBTU_PER_GJ),
    // EUR/MWh -> $/MMBtu
    ttf: round(ttf === null ? null : (ttf * fx.EUR) / MMBTU_PER_MWH),
    jkm: round(num(markets?.jkm)),
    // A$/GJ -> $/MMBtu
    wallumbilla: round(
      wallumbilla === null ? null : (wallumbilla * fx.AUD) / MMBTU_PER_GJ
    )
  };
}

function signal(value, { openAbove = 0, closedBelow = 0 } = {}) {
  if (value === null) return "unknown";
  if (value > openAbove) return "open";
  if (value < closedBelow) return "closed";
  return "marginal";
}

/*
 * The headline numbers.
 * Each carries its inputs and its formula so the UI (and the model)
 * can show exactly how it was derived.
 */
export function computeSpreads(normalized, markets, fx) {
  const { henryHub, waha, houstonShipChannel, aeco, ttf, jkm } = normalized;
  const a = ASSUMPTIONS;

  const feedgas = henryHub === null ? null : henryHub * a.feedgasMultiplier;

  const costToEurope =
    feedgas === null ? null : feedgas + a.liquefaction + a.freightToEurope + a.regas;
  const costToAsia =
    feedgas === null ? null : feedgas + a.liquefaction + a.freightToAsia + a.regas;

  const europeMargin =
    ttf === null || costToEurope === null ? null : ttf - costToEurope;
  const asiaMargin = jkm === null || costToAsia === null ? null : jkm - costToAsia;

  const jkmTtf = jkm === null || ttf === null ? null : jkm - ttf;
  const freightDiff = a.freightToAsia - a.freightToEurope;

  const brent = num(markets?.brent);
  const oilIndexed = brent === null ? null : brent * a.brentSlope;

  return {
    exportEconomics: [
      {
        key: "usGulfToEurope",
        name: "US Gulf → Europe margin",
        value: round(europeMargin),
        unit: "$/MMBtu",
        status: signal(europeMargin, { openAbove: 0.25, closedBelow: 0 }),
        formula: "TTF − (115% × Henry Hub + liquefaction + freight + regas)",
        inputs: { ttf, henryHub, feedgas: round(feedgas), cost: round(costToEurope) },
        reading:
          europeMargin === null
            ? "Needs both TTF and Henry Hub."
            : europeMargin > 0
              ? "US cargoes clear into Europe at current prices."
              : "Europe does not cover the full cost of a US cargo — cancellation risk."
      },
      {
        key: "usGulfToAsia",
        name: "US Gulf → Asia margin",
        value: round(asiaMargin),
        unit: "$/MMBtu",
        status: signal(asiaMargin, { openAbove: 0.25, closedBelow: 0 }),
        formula: "JKM − (115% × Henry Hub + liquefaction + freight + regas)",
        inputs: { jkm, henryHub, feedgas: round(feedgas), cost: round(costToAsia) },
        reading:
          asiaMargin === null
            ? "Needs both JKM and Henry Hub."
            : asiaMargin > 0
              ? "US cargoes clear into Asia at current prices."
              : "Asia does not cover the full cost of a US cargo."
      }
    ],

    routing: [
      {
        key: "jkmTtf",
        name: "JKM − TTF",
        value: round(jkmTtf),
        unit: "$/MMBtu",
        status:
          jkmTtf === null
            ? "unknown"
            : jkmTtf > freightDiff
              ? "asia"
              : jkmTtf < 0
                ? "europe"
                : "balanced",
        formula: "JKM − TTF, compared with the extra freight to Asia",
        inputs: { jkm, ttf, extraFreightToAsia: round(freightDiff) },
        reading:
          jkmTtf === null
            ? "Needs both JKM and TTF."
            : jkmTtf > freightDiff
              ? `Asia pays more than the extra $${round(freightDiff)} of freight — flexible cargoes head east.`
              : "Europe holds the marginal cargo; the Asian premium does not cover the longer voyage."
      },
      {
        key: "oilVsSpot",
        name: "Spot vs oil-indexed",
        value: jkm === null || oilIndexed === null ? null : round(jkm - oilIndexed),
        unit: "$/MMBtu",
        status:
          jkm === null || oilIndexed === null
            ? "unknown"
            : jkm > oilIndexed
              ? "spot-expensive"
              : "spot-cheap",
        formula: `JKM − (${(a.brentSlope * 100).toFixed(1)}% × Brent)`,
        inputs: { jkm, brent, oilIndexedEquivalent: round(oilIndexed) },
        reading:
          jkm === null || oilIndexed === null
            ? "Needs JKM and Brent."
            : jkm > oilIndexed
              ? "Spot trades above oil-indexed term supply — term buyers are in the money."
              : "Spot is cheaper than oil-indexed term supply — buyers favour spot cargoes."
      }
    ],

    basis: [
      {
        key: "wahaBasis",
        name: "Waha basis",
        value: waha === null || henryHub === null ? null : round(waha - henryHub),
        unit: "$/MMBtu",
        status:
          waha === null || henryHub === null
            ? "unknown"
            : waha - henryHub < -1
              ? "stressed"
              : "normal",
        formula: "Waha − Henry Hub",
        inputs: { waha, henryHub },
        reading:
          waha === null || henryHub === null
            ? "Needs Waha and Henry Hub."
            : waha < 0
              ? "Waha is negative — Permian producers are paying to move gas."
              : "Permian takeaway is coping with current volumes."
      },
      {
        key: "hscBasis",
        name: "Houston Ship Channel basis",
        value:
          houstonShipChannel === null || henryHub === null
            ? null
            : round(houstonShipChannel - henryHub),
        unit: "$/MMBtu",
        status:
          houstonShipChannel === null || henryHub === null
            ? "unknown"
            : houstonShipChannel - henryHub > 0.15
              ? "export-pull"
              : "normal",
        formula: "Houston Ship Channel − Henry Hub",
        inputs: { houstonShipChannel, henryHub },
        reading:
          houstonShipChannel === null || henryHub === null
            ? "Needs Houston Ship Channel and Henry Hub."
            : houstonShipChannel > henryHub
              ? "Gulf Coast trades over Henry Hub — LNG feedgas demand is pulling gas south."
              : "No export premium at the Gulf Coast right now."
      },
      {
        key: "aecoBasis",
        name: "AECO basis",
        value: aeco === null || henryHub === null ? null : round(aeco - henryHub),
        unit: "$/MMBtu",
        status: aeco === null || henryHub === null ? "unknown" : "normal",
        formula: "AECO (converted to $/MMBtu) − Henry Hub",
        inputs: { aeco, henryHub },
        reading:
          aeco === null || henryHub === null
            ? "Needs AECO and Henry Hub."
            : `Western Canadian gas trades $${Math.abs(round(aeco - henryHub))} ${aeco < henryHub ? "below" : "above"} Henry Hub.`
      }
    ]
  };
}

export async function getSpreads() {
  const snapshot = await kv.get(SNAPSHOT_KEY);

  if (!snapshot?.markets) {
    return {
      pending: true,
      message: "No price snapshot yet — spreads appear after the next markets refresh."
    };
  }

  const fx = await getFxRates();
  const normalized = normalize(snapshot.markets, fx);
  const spreads = computeSpreads(normalized, snapshot.markets, fx);

  return {
    spreads,
    normalized,
    raw: snapshot.markets,
    fx,
    assumptions: ASSUMPTIONS,
    pricesUpdatedAt: snapshot.updatedAt,
    generatedAt: new Date().toISOString()
  };
}
