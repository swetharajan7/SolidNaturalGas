import { refreshMarkets } from "../../../../lib/markets";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const snapshot = await refreshMarkets();
    return Response.json({
      extracted: snapshot.extracted,
      rejected: snapshot.rejected,
      updatedAt: snapshot.updatedAt,
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    console.error("Markets refresh failed:", error);
    return Response.json(
      { error: "Markets refresh failed.", details: error.message },
      { status: 500 }
    );
  }
}
