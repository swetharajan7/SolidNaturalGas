import { kv } from "@vercel/kv";
import WebSocket from "ws";
import { traceable } from "langsmith/traceable";

// Verified real vessel — confirmed MMSI/IMO from public vessel records.
// Add more by looking up "LNG Carrier" ship type on vesselfinder.com or
// marinetraffic.com's public search — copy the MMSI/IMO shown there.
// Never guess or invent an identifier here.
const FLEET = [
  { mmsi: "538003212", imo: "9337755", name: "Mozah", operator: "Nakilat/Qatargas" }
  { mmsi: "228391700", imo: "9870159", name: "LNG Adventure", operator: "France" }
{ mmsi: "228408700", imo: "9893606", name: "LNG Endeavour", operator: "France" }
{ mmsi: "431177000", imo: "9645748", name: "LNG Mars", operator: "Japan" }
  // { mmsi: "...", imo: "...", name: "...", operator: "..." },
];

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

function listenToAISStream(mmsiList, windowMs) {
  return new Promise((resolve) => {
    const collected = {};
    let ws;

    try {
      ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
    } catch (error) {
      console.error("AISStream connect failed:", error);
      resolve(collected);
      return;
    }

    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      resolve(collected);
    }, windowMs);

    ws.on("open", () => {
      ws.send(JSON.stringify({
        APIKey: process.env.AISSTREAM_API_KEY,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FiltersShipMMSI: mmsiList,
        FilterMessageTypes: ["PositionReport", "ShipStaticData"]
      }));
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const mmsi = String(msg.MetaData?.MMSI || "");
        if (!mmsi || !mmsiList.includes(mmsi)) return;

        collected[mmsi] = collected[mmsi] || {};

        if (msg.MessageType === "PositionReport") {
          const p = msg.Message.PositionReport;
          collected[mmsi].lat = msg.MetaData.latitude;
          collected[mmsi].lon = msg.MetaData.longitude;
          collected[mmsi].speed = p?.Sog ?? null;
          collected[mmsi].course = p?.Cog ?? null;
        }

        if (msg.MessageType === "ShipStaticData") {
          const s = msg.Message.ShipStaticData;
          collected[mmsi].destination = (s?.Destination || "").trim();
          collected[mmsi].eta = s?.Eta || null;
        }
      } catch (error) {
        console.error("AIS message parse failed:", error);
      }
    });

    ws.on("error", (error) => {
      console.error("AISStream error:", error);
      clearTimeout(timer);
      resolve(collected);
    });
  });
}

const assessPhysicalEvidence = traceable(
  async (hypothesis, startingConfidence, eventDescription) => {
    const response = await fetch(`${process.env.NEBIUS_BASE_URL}/chat/completions`, {
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
            content: `You are the reasoning engine for Solid Natural Gas. You are
given ONE piece of physical AIS vessel evidence (a real ship's tracked movement,
not a news article) and asked how it affects a specific hypothesis. This evidence
class is more concrete than reported news, but a single vessel movement is also
a small signal — don't swing confidence drastically on one ship. The hypothesis
currently has a confidence score of ${startingConfidence}/100. Respond with 1-2
sentences of reasoning, then on its own final line output exactly:
CONFIDENCE_SCORE: <integer 0-100>`
          },
          {
            role: "user",
            content: `Hypothesis: "${hypothesis}"\n\nPhysical AIS evidence:\n${eventDescription}`
          }
        ],
        max_tokens: 300,
        reasoning_effort: "low"
      })
    });
    const data = await response.json();
    return { response, data };
  },
  { name: "nemotron_physical_evidence", run_type: "llm" }
);

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.AISSTREAM_API_KEY) {
    return Response.json({ error: "AISSTREAM_API_KEY not configured." }, { status: 500 });
  }

  const mmsiList = FLEET.map((v) => v.mmsi);
  const observed = await listenToAISStream(mmsiList, 25000);

  const events = [];

  for (const vessel of FLEET) {
    const fresh = observed[vessel.mmsi];
    if (!fresh) continue; // no message received this window — normal, AIS is intermittent

    const snapKey = `vessel:snapshot:${vessel.mmsi}`;
    let previous = null;
    try {
      previous = await kv.get(snapKey);
    } catch (error) {
      console.error("Vessel snapshot read failed:", error);
    }

    const newSnapshot = {
      mmsi: vessel.mmsi,
      imo: vessel.imo,
      name: vessel.name,
      lat: fresh.lat ?? previous?.lat ?? null,
      lon: fresh.lon ?? previous?.lon ?? null,
      speed: fresh.speed ?? previous?.speed ?? null,
      course: fresh.course ?? previous?.course ?? null,
      destination: fresh.destination || previous?.destination || "",
      eta: fresh.eta || previous?.eta || null,
      observedAt: new Date().toISOString()
    };

    if (
      previous?.destination &&
      newSnapshot.destination &&
      previous.destination !== newSnapshot.destination
    ) {
      events.push({
        vessel: vessel.name,
        type: "destination_changed",
        from: previous.destination,
        to: newSnapshot.destination
      });
    }

    try {
      await kv.set(snapKey, newSnapshot);
    } catch (error) {
      console.error("Vessel snapshot write failed:", error);
    }
  }

  if (events.length === 0) {
    return Response.json({ observed: Object.keys(observed).length, events: [] });
  }

  await logActivity(
    `Physical LNG event detected: ${events.map((e) => `${e.vessel} destination changed (${e.from} → ${e.to})`).join("; ")}`
  );

  // Feed the event into the primary tracked hypothesis as evidence
  const targetHypothesis = "European LNG spot prices will strengthen over the next 30 days.";
  const kvKey = `confidence:${targetHypothesis.trim().toLowerCase().replace(/\s+/g, " ")}`;
  const historyKey = kvKey.replace(/^confidence:/, "history:");

  let startingConfidence = 50;
  try {
    const stored = await kv.get(kvKey);
    if (stored && typeof stored.confidence === "number") {
      startingConfidence = stored.confidence;
    }
  } catch (error) {
    console.error("KV read failed:", error);
  }

  const eventDescription = events
    .map((e) => `Vessel "${e.vessel}" (real LNG carrier, tracked via AIS) changed its declared destination from "${e.from}" to "${e.to}".`)
    .join(" ");

  try {
    const { response, data } = await assessPhysicalEvidence(
      targetHypothesis,
      startingConfidence,
      eventDescription
    );

    if (response.ok) {
      const message = data.choices?.[0]?.message;
      const raw = message?.content || message?.reasoning_content || "";
      const match = raw.match(/CONFIDENCE_SCORE:\s*(\d{1,3})/i);
      const newConfidence = match
        ? Math.max(0, Math.min(100, parseInt(match[1], 10)))
        : startingConfidence;
      const reasoning = raw.replace(/CONFIDENCE_SCORE:\s*\d{1,3}\s*$/i, "").trim();
      const lastRun = new Date().toISOString();

      await kv.set(kvKey, { confidence: newConfidence, hypothesis: targetHypothesis, lastRun });
      await kv.lpush(
        historyKey,
        JSON.stringify({
          confidence: newConfidence,
          delta: newConfidence - startingConfidence,
          timestamp: lastRun,
          evidenceCount: events.length,
          evidenceClass: "physical",
          reasoning
        })
      );
      await kv.ltrim(historyKey, 0, 49);

      await logActivity(
        `Physical LNG evidence updated "${targetHypothesis}": ${startingConfidence}% → ${newConfidence}%`
      );
    }
  } catch (error) {
    console.error("Physical evidence reasoning failed:", error);
  }

  return Response.json({ observed: Object.keys(observed).length, events });
}

export const maxDuration = 60;
