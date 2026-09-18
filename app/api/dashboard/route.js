import { kv } from "@vercel/kv";

export async function GET() {
  try {
    const hypotheses = await kv.smembers("tracked:hypotheses");

    if (!hypotheses || hypotheses.length === 0) {
      return Response.json({ hypotheses: [] });
    }

    const results = await Promise.all(
      hypotheses.map(async (hypothesis) => {
        const normalized = hypothesis.trim().toLowerCase().replace(/\s+/g, " ");
        const confKey = `confidence:${normalized}`;
        const historyKey = `history:${normalized}`;

        const [snapshot, rawHistory] = await Promise.all([
          kv.get(confKey),
          kv.lrange(historyKey, 0, 9)
        ]);

        const history = (rawHistory || [])
          .map((entry) => {
            try {
              return typeof entry === "string" ? JSON.parse(entry) : entry;
            } catch {
              return null;
            }
          })
          .filter(Boolean)
          .reverse(); // oldest -> newest, for charting left-to-right

        return {
          hypothesis,
          confidence: snapshot?.confidence ?? null,
          lastRun: snapshot?.lastRun ?? null,
          history
        };
      })
    );

    return Response.json({ hypotheses: results });
  } catch (error) {
    console.error("Dashboard route error:", error);
    return Response.json(
      { error: "Unable to load dashboard.", details: error.message },
      { status: 500 }
    );
  }
}
