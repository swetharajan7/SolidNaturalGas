import { kv } from "@vercel/kv";
import { SNAPSHOT_KEY } from "../../../lib/markets";

/*
 * Reads the latest price snapshot written by the markets cron job.
 * This route does no searching and no model calls, so the homepage
 * renders immediately instead of waiting on a refresh.
 */

export async function GET() {
  try {
    const snapshot = await kv.get(SNAPSHOT_KEY);

    if (!snapshot) {
      return Response.json({
        markets: null,
        updatedAt: null,
        pending: true,
        message: "Prices are being gathered. The first snapshot appears after the next refresh."
      });
    }

    return Response.json(snapshot);
  } catch (error) {
    console.error("Markets route error:", error);
    return Response.json(
      { error: "Unable to load market prices.", details: error.message },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
