// lib/hypothesisEngine.ts
// The core agent loop: fetch live evidence (Tavily) -> reason about it
// (Nemotron on Nebius Token Factory) -> return a structured, confidence-scored verdict.

import { fetchEvidence, buildEvidenceQuery } from "./tavily";
import { callNemotronJSON, MODELS } from "./tokenFactory";
import type { Evidence, Hypothesis, Verdict } from "./types";

interface RawVerdict {
  newConfidence: number;
  reasoning: string;
  supportingEvidenceIds: string[];
  challengingEvidenceIds: string[];
}

const SYSTEM_PROMPT = `You are a rigorous LNG and natural-gas market analyst. \
You are given a pricing hypothesis, its current confidence score (0-100, where \
50 means no lean, 100 means very likely true, 0 means very likely false), and a \
list of recent evidence snippets. Your job is to decide whether the new evidence \
supports, challenges, or is neutral toward the hypothesis, and output an updated \
confidence score. Be skeptical: don't move the score much on weak or tangential \
evidence, and cite which evidence IDs drove your decision. Never invent evidence \
that isn't in the provided list. Respond with ONLY a JSON object, no markdown, \
matching this shape exactly:
{
  "newConfidence": <integer 0-100>,
  "reasoning": "<2-4 sentences, plain language, reference specific evidence>",
  "supportingEvidenceIds": ["<evidence id>", ...],
  "challengingEvidenceIds": ["<evidence id>", ...]
}`;

function buildUserPrompt(statement: string, currentConfidence: number, evidence: Evidence[]): string {
  const evidenceBlock = evidence
    .map((e) => `[${e.id}] "${e.title}" (${e.publishedDate ?? "date unknown"})\n${e.snippet}\nSource: ${e.url}`)
    .join("\n\n");

  return `Hypothesis: "${statement}"
Current confidence: ${currentConfidence}/100

Evidence gathered this cycle:
${evidenceBlock || "(no evidence found this cycle)"}

Evaluate the hypothesis against this evidence and return the updated confidence JSON.`;
}

/**
 * Runs one full evaluation cycle for a single hypothesis:
 *   1. Pull fresh evidence from Tavily.
 *   2. Ask a Nemotron model (via Nebius Token Factory) to weigh it and
 *      output an updated confidence score + reasoning.
 * Returns a Verdict you can append to the hypothesis's history.
 */
export async function evaluateHypothesis(hypothesis: Hypothesis): Promise<Verdict> {
  const query = buildEvidenceQuery(hypothesis.statement);
  const evidence = await fetchEvidence(query, { maxResults: 6, searchDepth: "advanced" });

  // Uses whatever NEBIUS_MODEL is set to in Vercel (Nemotron-3-Super by
  // default here); swap to MODELS.nano if you want to cut costs further.
  const raw = await callNemotronJSON<RawVerdict>({
    model: MODELS.main,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(hypothesis.statement, hypothesis.currentConfidence, evidence),
    temperature: 0.2,
    maxTokens: 500,
  });

  const newConfidence = Math.max(0, Math.min(100, Math.round(raw.newConfidence)));

  const verdict: Verdict = {
    hypothesisId: hypothesis.id,
    timestamp: new Date().toISOString(),
    previousConfidence: hypothesis.currentConfidence,
    newConfidence,
    confidenceDelta: newConfidence - hypothesis.currentConfidence,
    reasoning: raw.reasoning,
    supportingEvidenceIds: raw.supportingEvidenceIds ?? [],
    challengingEvidenceIds: raw.challengingEvidenceIds ?? [],
    evidence,
  };

  return verdict;
}
