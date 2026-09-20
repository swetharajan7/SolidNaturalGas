import { kv } from "@vercel/kv";

export async function GET() {
  try {
    const hypotheses = await kv.zrange("tracked:hypotheses", 0, -1);

    if (!hypotheses || hypotheses.length === 0) {
      return Response.json({ entries: [] });
    }

    const perHypothesis = await Promise.all(
      hypotheses.map(async (hypothesis) => {
        const normalized = hypothesis.trim().toLowerCase().replace(/\s+/g, " ");
        const historyKey = `history:${normalized}`;
        const raw = await kv.lrange(historyKey, 0, 9);

        return (raw || [])
          .map((entry) => {
            try {
              const parsed = typeof entry === "string" ? JSON.parse(entry) : entry;
              return { ...parsed, hypothesis };
            } catch {
              return null;
            }
          })
          .filter(Boolean);
      })
    );

        const merged = perHypothesis
      .flat()
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 100);

    return Response.json({ entries: merged });
  } catch (error) {
    console.error("Notebook route error:", error);
    return Response.json(
      { error: "Unable to load research notebook.", details: error.message },
      { status: 500 }
    );
  }
}
