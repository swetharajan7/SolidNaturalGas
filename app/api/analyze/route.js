import { analyzeHypothesis } from "../../../lib/analyze";

export const maxDuration = 90;

export async function POST(request) {
  try {
    const { hypothesis } = await request.json();

    if (!hypothesis) {
      return Response.json(
        { error: "Please enter a market hypothesis." },
        { status: 400 }
      );
    }

    const analysis = await analyzeHypothesis(hypothesis, { trigger: "user" });
    return Response.json(analysis);
  } catch (error) {
    console.error("Solid Natural Gas route error:", error);

    if (error.status) {
      return Response.json(
        { error: error.message, details: error.details },
        { status: error.status }
      );
    }

    return Response.json(
      { error: "Unable to analyze the market hypothesis.", details: error.message },
      { status: 500 }
    );
  }
}
