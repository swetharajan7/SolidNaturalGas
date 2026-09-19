import { kv } from "@vercel/kv";

export async function GET() {
  try {
    const raw = await kv.lrange("activity:log", 0, 39);
    const entries = (raw || [])
      .map((entry) => {
        try {
          return typeof entry === "string" ? JSON.parse(entry) : entry;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    return Response.json({ entries });
  } catch (error) {
    console.error("Activity route error:", error);
    return Response.json(
      { error: "Unable to load activity log.", details: error.message },
      { status: 500 }
    );
  }
}
