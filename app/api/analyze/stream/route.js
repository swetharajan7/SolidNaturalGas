import { analyzeHypothesis } from "../../../../lib/analyze";

export const maxDuration = 90;
export const dynamic = "force-dynamic";

/*
 * Streams the agent's own steps as newline-delimited JSON while the
 * analysis runs, then sends the finished report as the last line.
 * The plain /api/analyze route still works unchanged for the cron job
 * and for any client that would rather wait for one response.
 */
export async function POST(request) {
  const { hypothesis } = await request.json();

  if (!hypothesis) {
    return Response.json({ error: "Please enter a market hypothesis." }, { status: 400 });
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
        const analysis = await analyzeHypothesis(hypothesis, {
          trigger: "user",
          onStep: (step) => send({ kind: "step", ...step })
        });
        send({ kind: "result", ...analysis });
      } catch (error) {
        console.error("Streaming analysis failed:", error);
        send({
          kind: "error",
          error: error.message || "Unable to analyze the market hypothesis."
        });
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
