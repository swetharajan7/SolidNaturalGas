import { kv } from "@vercel/kv";

// Keep this list in sync with app/api/vessels/poll/route.js's FLEET array.
const FLEET = [
  { mmsi: "538003212", imo: "9337755", name: "Mozah", operator: "Nakilat/Qatargas" },
  { mmsi: "228391700", imo: "9870159", name: "LNG Adventure", operator: "France" },
  { mmsi: "228408700", imo: "9893606", name: "LNG Endeaa", operator: "France" },
  { mmsi: "431177000", imo: "9645748", name: "LNG Mars", operator: "Japan" }
];

export async function GET() {
  try {
    const vessels = await Promise.all(
      FLEET.map(async (vessel) => {
        let snapshot = null;
        try {
          snapshot = await kv.get(`vessel:snapshot:${vessel.mmsi}`);
        } catch (error) {
          console.error(`Vessel snapshot read failed for ${vessel.mmsi}:`, error);
        }

        return {
          name: vessel.name,
          operator: vessel.operator,
          destination: snapshot?.destination || null,
          speed: snapshot?.speed ?? null,
          lat: snapshot?.lat ?? null,
          lon: snapshot?.lon ?? null,
          observedAt: snapshot?.observedAt || null
        };
      })
    );

    return Response.json({ vessels });
  } catch (error) {
    console.error("Vessels route error:", error);
    return Response.json(
      { error: "Unable to load fleet data.", details: error.message },
      { status: 500 }
    );
  }
}
