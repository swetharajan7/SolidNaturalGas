// lib/types.ts
// Shared types for the hypothesis engine.

export interface Evidence {
  id: string;
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
  score?: number; // Tavily relevance score, 0-1
}

export interface Verdict {
  hypothesisId: string;
  timestamp: string; // ISO 8601
  previousConfidence: number; // 0-100
  newConfidence: number; // 0-100
  confidenceDelta: number; // newConfidence - previousConfidence
  reasoning: string; // short natural-language explanation
  supportingEvidenceIds: string[];
  challengingEvidenceIds: string[];
  evidence: Evidence[]; // full evidence set considered this cycle
}

export interface Hypothesis {
  id: string;
  statement: string;
  createdAt: string;
  currentConfidence: number; // 0-100, 50 = no lean either way
  history: Verdict[];
}
