import { getSpreads } from "../../../lib/spreads";

export async function GET() {
  try {
    return Response.json(await getSpreads());
  } catch (error) {
    console.error("Spreads route error:", error);
    return Response.json(
      { error: "Unable to compute spreads.", details: error.message },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
