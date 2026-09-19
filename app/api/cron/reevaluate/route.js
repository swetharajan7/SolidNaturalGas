import { kv } from "@vercel/kv";

function keyFor(hypothesis) {
  const normalized = hypothesis.trim().toLowerCase().replace(/\s+/g, " ");
  return `confidence:${normalized}`;
}

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

// Fallback only — used on a fresh deploy before anyone has run a
// hypothesis yet. Once someone uses the site, the tracked set below
// takes over automatically.
const DEFAULT_HYPOTHESES = [
  "European LNG spot prices will strengthen over the next 30 days."
];

async function evaluateOne(hypothesis) {
  const kvKey = keyFor(hypothesis);

  let startingConfidence = 50;
  try {
    const stored = await kv.get(kvKey);
    if (stored && typeof stored.confidence === "number") {
      startingConfidence = stored.confidence;
    }
  } catch (kvError) {
    console.error("KV read failed:", kvError);
  }

  const searchQuery = `
    Latest natural gas and LNG market evidence relevant to this hypothesis:
    "${hypothesis}"

    Focus on LNG spot prices, TTF, JKM, Henry Hub where relevant,
    European gas storage, LNG supply and demand, shipping,
    weather, outages and geopolitical developments.
  `;

  const tavilyResponse = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: searchQuery,
      search_depth: "basic",
      max_results: 5,
      include_answer: false,
      include_raw_content: false
    })
  });

  const tavilyData = await tavilyResponse.json();
  if (!tavilyResponse.ok) {
    throw new Error(`Tavily failed: ${JSON.stringify(tavilyData)}`);
  }

  const sources = (tavilyData.results || []).map((source, index) => ({
    id: index + 1,
    title: source.title,
    content: source.content
  }));

  await logActivity(
    `Queried live evidence for "${hypothesis}" (${sources.length} sources)`
  );

  const evidenceText = sources.length
    ? sources.map((s) => `SOURCE ${s.id}\nTitle: ${s.title}\nEvidence:\n${s.content}`).join("\n\n")
    : "No live sources were returned.";

  const nemotronResponse = await fetch(
    `${process.env.NEBIUS_BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NEBIUS_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.NEBIUS_MODEL,
        messages: [
          {
            role: "system",
            content: `You are the reasoning engine for Solid Natural Gas.
Evaluate the hypothesis against the supplied evidence only. The hypothesis
currently has a confidence score of ${startingConfidence}/100. Weigh the
new evidence against that starting point; don't swing wildly on weak
evidence. Respond with 2-3 sentences of reasoning, then on its own final
line output exactly: CONFIDENCE_SCORE: <integer 0-100>`
          },
          {
            role: "user",
            content: `Hypothesis: "${hypothesis}"\n\nEvidence:\n${evidenceText}`
          }
        ],
        max_tokens: 400,
        reasoning_effort: "low"
      })
    }
  );

  const nemotronData = await nemotronResponse.json();
  if (!nemotronResponse.ok) {
    throw new Error(`Nemotron failed: ${JSON.stringify(nemotronData)}`);
  }

  const message = nemotronData.choices?.[0]?.message;
  const raw = message?.content || message?.reasoning_content || "";

  const match = raw.match(/CONFIDENCE_SCORE:\s*(\d{1,3})/i);
  const newConfidence = match
    ? Math.max(0, Math.min(100, parseInt(match[1], 10)))
    : startingConfidence;

  const historyKey = kvKey.replace(/^confidence:/, "history:");
  const lastRun = new Date().toISOString();

  const reasoning = raw.replace(/CONFIDENCE_SCORE:\s*\d{1,3}\s*$/i, "").trim();

  await kv.set(kvKey, { confidence: newConfidence, hypothesis, lastRun });
  await kv.lpush(
    historyKey,
    JSON.stringify({
      confidence: newConfidence,
      delta: newConfidence - startingConfidence,
      timestamp: lastRun,
      evidenceCount: sources.length,
      reasoning
    })
  );
  await kv.ltrim(historyKey, 0, 49);

  await logActivity(
    `Re-evaluated "${hypothesis}": ${startingConfidence}% → ${newConfidence}%`
  );

  return { hypothesis, previousConfidence: startingConfidence, newConfidence };
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await logActivity("Scheduled research cycle started");

  let hypotheses = [];
  try {
    hypotheses = await kv.zrange("tracked:hypotheses", 0, -1);
  } catch (kvError) {
    console.error("KV zrange failed:", kvError);
  }
  if (!hypotheses || hypotheses.length === 0) {
    hypotheses = DEFAULT_HYPOTHESES;
  }

  const results = [];
  for (const hypothesis of hypotheses) {
    try {
      results.push(await evaluateOne(hypothesis));
    } catch (error) {
      console.error(`Failed to re-evaluate "${hypothesis}":`, error);
      results.push({ hypothesis, error: error.message });
    }
  }

  await logActivity(`Research cycle complete: ${hypotheses.length} hypotheses reviewed`);

  return Response.json({ ranAt: new Date().toISOString(), results });
}
