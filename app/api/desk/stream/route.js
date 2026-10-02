import { runDesk } from "../../../../lib/agents";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/*
 * Streams the whole desk: routing, each specialist's progress, and the
 * lead analyst's synthesis. Same newline-delimited JSON protocol as
 * /api/analyze/stream, so the frontend reader works unchanged.
 */
export async function POST(request) {
  const { question } = await request.json();

  if (!question) {
    return Response.json({ error: "Please enter a question." }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch (error) {
          console.error("Stream write failed:", error);
        }
      };

      try {
        const result = await runDesk(question, {
          onStep: (step) => send({ kind: "step", ...step })
        });
        send({ kind: "result", ...result });
      } catch (error) {
        console.error("Desk run failed:", error);
        send({ kind: "error", error: error.message || "The desk was unable to answer." });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no"
    }
  });
}
