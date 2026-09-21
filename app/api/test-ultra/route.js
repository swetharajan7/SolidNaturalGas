import { traceable } from "langsmith/traceable";

const callUltra = traceable(
  async (systemPrompt, userPrompt) => {
    const response = await fetch(`${process.env.NEBIUS_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NEBIUS_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "nvidia/Nemotron-3-Ultra-550b-a55b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 1200,
        reasoning_effort: "medium"
      })
    });
    return { response, data: await response.json() };
  },
  { name: "nemotron_ultra_test", run_type: "llm" }
);

export async function GET() {
  const systemPrompt = `You are a market reasoning engine. Given a hypothesis and
evidence, respond with 2-3 sentences of reasoning, then on its own final line
output exactly: CONFIDENCE_SCORE: <integer 0-100>`;

  const userPrompt = `Hypothesis: "European LNG spot prices will strengthen over
the next 30 days."

Evidence: TTF prices have risen 8% over the past two weeks amid tightening
European storage levels. Norwegian pipeline flows have been reduced due to
unplanned maintenance. Asian LNG demand has softened slightly as China draws
down existing storage rather than importing.

Starting confidence: 60/100`;

  const start = Date.now();

  try {
    const { response, data } = await callUltra(systemPrompt, userPrompt);
    const elapsedMs = Date.now() - start;

    if (!response.ok) {
      return Response.json({ error: "Ultra call failed.", details: data, elapsedMs }, { status: 500 });
    }

    const message = data.choices?.[0]?.message;
    const text = message?.content || message?.reasoning_content || "(empty response)";
    const match = text.match(/CONFIDENCE_SCORE:\s*(\d{1,3})/i);

    return Response.json({
      elapsedMs,
      parsedConfidenceScore: match ? parseInt(match[1], 10) : "NOT FOUND — check parsing",
      rawText: text,
      usedField: message?.content ? "content" : message?.reasoning_content ? "reasoning_content" : "neither",
      usage: data.usage || null
    });
  } catch (error) {
    return Response.json({ error: error.message, elapsedMs: Date.now() - start }, { status: 500 });
  }
}
