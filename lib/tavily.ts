// lib/tavily.ts
// Thin wrapper around the Tavily Search API for evidence retrieval.
// Docs: https://docs.tavily.com/documentation/api-reference/endpoint/search

import type { Evidence } from "./types";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

interface TavilyRawResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
}

interface TavilyResponse {
  answer?: string;
  results: TavilyRawResult[];
}

/**
 * Fetches live evidence for a given query from Tavily.
 * Throws if TAVILY_API_KEY is missing or the request fails.
 */
export async function fetchEvidence(
  query: string,
  opts: { maxResults?: number; searchDepth?: "basic" | "advanced" } = {}
): Promise<Evidence[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is not set");
  }

  const res = await fetch(TAVILY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      search_depth: opts.searchDepth ?? "advanced",
      max_results: opts.maxResults ?? 6,
      include_answer: false,
      include_raw_content: false,
    }),
    // Keep this fast enough for a serverless function timeout.
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tavily request failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as TavilyResponse;

  return data.results.map((r, i) => ({
    id: `ev_${Date.now()}_${i}`,
    title: r.title,
    url: r.url,
    snippet: r.content.slice(0, 600),
    publishedDate: r.published_date,
    score: r.score,
  }));
}

/**
 * Builds a focused query for a given LNG/gas pricing hypothesis.
 * Keeping queries specific (a hypothesis + "latest news") gets much
 * better recall than passing the raw hypothesis text alone.
 */
export function buildEvidenceQuery(hypothesisStatement: string): string {
  return `${hypothesisStatement} latest news natural gas LNG market`;
}
