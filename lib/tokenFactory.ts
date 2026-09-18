// lib/tokenFactory.ts
// Thin wrapper around Nebius Token Factory's OpenAI-compatible chat completions API.
// Docs: https://docs.tokenfactory.nebius.com/api-reference

// Reads from your existing Vercel env vars (NEBIUS_BASE_URL, NEBIUS_MODEL)
// so this matches what's already configured in the project, with sane
// fallbacks for local dev if those aren't set yet.
const TOKEN_FACTORY_BASE_URL = process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1";

// Model IDs as exposed by Nebius Token Factory.
// - MODELS.main reads NEBIUS_MODEL directly (per your Vercel setup) —
//   set to Nemotron-3-Super for the balanced cost/reasoning verdict step.
// - MODELS.nano is an optional cheaper model for any pre-filtering you
//   add later; set NEBIUS_MODEL_NANO if/when you want that split.
export const MODELS = {
  main: process.env.NEBIUS_MODEL ?? "nvidia/nemotron-3-super-120b-a12b",
  nano: process.env.NEBIUS_MODEL_NANO ?? "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
} as const;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices: { message: { content: string } }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/**
 * Calls a Nemotron model on Nebius Token Factory and returns the raw text.
 */
export async function callNemotron(params: {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}): Promise<{ text: string; usage?: ChatCompletionResponse["usage"] }> {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) {
    throw new Error("NEBIUS_API_KEY is not set");
  }

  const res = await fetch(`${TOKEN_FACTORY_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens ?? 800,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token Factory request failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as ChatCompletionResponse;
  return { text: data.choices[0]?.message?.content ?? "", usage: data.usage };
}

/**
 * Calls Nemotron and parses the response as JSON. Strips ```json fences
 * if the model wraps its output in markdown, and retries once with a
 * stricter instruction if parsing fails.
 */
export async function callNemotronJSON<T>(params: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<T> {
  const messages: ChatMessage[] = [
    { role: "system", content: params.systemPrompt },
    { role: "user", content: params.userPrompt },
  ];

  const { text } = await callNemotron({
    model: params.model,
    messages,
    temperature: params.temperature,
    maxTokens: params.maxTokens,
  });

  const clean = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean) as T;
  } catch {
    // One retry with a stricter nudge, in case the model added preamble.
    const { text: retryText } = await callNemotron({
      model: params.model,
      messages: [
        ...messages,
        {
          role: "user",
          content: "Your last reply was not valid JSON. Reply with ONLY the JSON object, no preamble, no markdown fences.",
        },
      ],
      temperature: 0,
      maxTokens: params.maxTokens,
    });
    return JSON.parse(retryText.replace(/```json|```/g, "").trim()) as T;
  }
}
