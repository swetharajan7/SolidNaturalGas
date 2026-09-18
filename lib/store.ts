// lib/store.ts
// Minimal persistence layer for hypotheses + their verdict history.
//
// For the hackathon demo, this defaults to an in-memory store, which is
// fine for local dev but resets on every serverless cold start on Vercel.
// To make the confidence history actually persist in production, add
// Vercel KV (free tier is enough for this) and set KV_REST_API_URL /
// KV_REST_API_TOKEN — this file will automatically use it when present.
//
//   npm install @vercel/kv
//
// If you don't want to add KV right now, the in-memory fallback still
// works great for a live demo/video where you trigger a few cycles in
// one session.

import type { Hypothesis } from "./types";

const KEY_PREFIX = "hypothesis:";

// In-memory fallback (module-level, survives across requests within the
// same warm serverless instance, but not across deploys/cold starts).
const memoryStore = new Map<string, Hypothesis>();

let kv: { get: (k: string) => Promise<any>; set: (k: string, v: any) => Promise<any>; keys: (p: string) => Promise<string[]> } | null = null;

async function getKv() {
  if (kv) return kv;
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    // Lazy import so this dependency is optional until you install it.
    const mod = await import("@vercel/kv").catch(() => null);
    if (mod) {
      kv = mod.kv as any;
      return kv;
    }
  }
  return null;
}

export async function getHypothesis(id: string): Promise<Hypothesis | null> {
  const store = await getKv();
  if (store) return (await store.get(KEY_PREFIX + id)) ?? null;
  return memoryStore.get(id) ?? null;
}

export async function saveHypothesis(hypothesis: Hypothesis): Promise<void> {
  const store = await getKv();
  if (store) {
    await store.set(KEY_PREFIX + hypothesis.id, hypothesis);
    return;
  }
  memoryStore.set(hypothesis.id, hypothesis);
}

export async function listHypotheses(): Promise<Hypothesis[]> {
  const store = await getKv();
  if (store) {
    const keys = await store.keys(`${KEY_PREFIX}*`);
    const results = await Promise.all(keys.map((k) => store!.get(k)));
    return results.filter(Boolean) as Hypothesis[];
  }
  return Array.from(memoryStore.values());
}

// Seed hypotheses used by the cron re-evaluation job if the store is
// empty. Edit these to match the ones you want tracked live.
export const SEED_HYPOTHESES: Hypothesis[] = [
  {
    id: "eu-lng-spot-30d",
    statement: "European LNG spot prices will strengthen over the next 30 days.",
    createdAt: new Date().toISOString(),
    currentConfidence: 50,
    history: [],
  },
];
