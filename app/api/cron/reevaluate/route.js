import { kv } from "@vercel/kv";
import { analyzeHypothesis, keyFor, logActivity } from "../../../../lib/analyze";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Re-run a hypothesis if its last analysis is older than this.
const STALE_AFTER_MS = 20 * 60 * 60 * 1000; // 20 hours
// Stop starting new analyses once this much time has been used...
const TIME_BUDGET_MS = 240 * 1000;
// ...assuming a single analysis can take up to this long.
const PER_ANALYSIS_ESTIMATE_MS = 75 * 1000;

const LOCK_KEY = "cron:reevaluate:lock";

// Fallback only — used on a fresh deploy before anyone has run a
// hypothesis yet. Once someone uses the site, the tracked set takes over.
const DEFAULT_HYPOTHESES = [
  "European LNG spot prices will strengthen over the next 30 days."
];

export async function GET(request) {
  // Vercel sends "Authorization: Bearer <CRON_SECRET>" on cron invocations.
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Prevent overlapping runs if a previous invocation is still going.
  const gotLock = await kv.set(LOCK_KEY, Date.now(), { nx: true, ex: 300 });
  if (!gotLock) {
    return Response.json({ skipped: "A re-evaluation run is already in progress." });
  }

  const startedAt = Date.now();
  const processed = [];
  const failed = [];
  let due = [];

  try {
    let hypotheses = [];
    try {
      hypotheses = await kv.zrange("tracked:hypotheses", 0, -1);
    } catch (kvError) {
      console.error("KV zrange failed:", kvError);
    }
    if (!hypotheses || hypotheses.length === 0) {
      hypotheses = DEFAULT_HYPOTHESES;
    }

    const withLastRun = await Promise.all(
      hypotheses.map(async (hypothesis) => {
        const stored = await kv.get(keyFor(hypothesis));
        const lastRun = stored?.lastRun ? Date.parse(stored.lastRun) : 0;
        return { hypothesis, lastRun };
      })
    );

    // Oldest first, so nothing gets starved if a run can't finish them all.
    due = withLastRun
      .filter(({ lastRun }) => startedAt - lastRun >= STALE_AFTER_MS)
      .sort((a, b) => a.lastRun - b.lastRun);

    // Sequential on purpose: gentler on Tavily/Nebius rate limits.
    for (const { hypothesis } of due) {
      const elapsed = Date.now() - startedAt;
      if (elapsed + PER_ANALYSIS_ESTIMATE_MS > TIME_BUDGET_MS) break;

      try {
        const analysis = await analyzeHypothesis(hypothesis, { trigger: "cron" });
        processed.push({
          hypothesis,
          from: analysis.previousConfidence,
          to: analysis.confidence
        });
      } catch (error) {
        console.error(`Scheduled re-evaluation failed for "${hypothesis}":`, error);
        failed.push({ hypothesis, error: error.message });
      }
    }

    if (processed.length || failed.length) {
      await logActivity(
        `[Scheduled] Re-evaluated ${processed.length} hypothesis(es)` +
          (failed.length ? `, ${failed.length} failed` : "")
      );
    }
  } finally {
    await kv.del(LOCK_KEY);
  }

  return Response.json({
    due: due.length,
    processed,
    failed,
    remaining: due.length - processed.length - failed.length,
    durationMs: Date.now() - startedAt
  });
}
