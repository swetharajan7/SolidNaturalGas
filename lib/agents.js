import { kv } from "@vercel/kv";
import { traceable } from "langsmith/traceable";
import { getSpreads } from "./spreads";
import { analyzeHypothesis } from "./analyze";

const ULTRA_MODEL = process.env.NEBIUS_MODEL_ULTRA || "nvidia/Nemotron-3-Ultra-550b-a55b";
const FAST_MODEL = process.env.NEBIUS_MODEL_FAST || "nvidia/nemotron-3-super-120b-a12b";

/*
 * MULTI-AGENT DESK
 *
 * Every agent implements the same contract:
 *   { name, title, capability, run(task, ctx) -> { summary, data, sources, confidence } }
 *
 * The orchestrator decides WHICH agents to call and WHAT to ask each one.
 * Specialists never call each other; they return findings, and synthesis
 * happens once, at the end, with everything on the table.
 */

const callModel = traceable(
  async (systemPrompt, userPrompt, { model, maxTokens = 900, effort = "low", json = false }) => {
    const response = await fetch(`${process.env.NEBIUS_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NEBIUS_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: maxTokens,
        reasoning_effort: effort
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`Model call failed: ${JSON.stringify(data)}`);

    const message = data.choices?.[0]?.message;
    const raw = message?.content || message?.reasoning_content || "";
    if (!json) return raw.trim();

    const clean = raw.replace(/```json|```/g, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : clean);
  },
  { name: "desk_model_call", run_type: "llm" }
);

/* ------------------------------------------------------------------ *
 * AGENT 1 — PRICE
 * Deterministic. Every number comes from the spread engine, never from
 * a model. Its job is to put the right figures on the table.
 * ------------------------------------------------------------------ */
const priceAgent = {
  name: "price",
  title: "Price agent",
  capability:
    "Current benchmark prices, unit-normalized values, arbitrage margins (US Gulf to Europe and Asia), basis differentials (Waha, Houston Ship Channel, AECO), spot versus oil-indexed, and stored price history.",

  async run(task, { emit }) {
    await emit(`Price agent: computing spreads for "${task}"`);
    const result = await getSpreads();

    if (result.pending) {
      return {
        summary: "No price snapshot is available yet.",
        data: null,
        sources: [],
        confidence: 0
      };
    }

    const lines = [];
    for (const group of Object.values(result.spreads)) {
      for (const item of group) {
        if (item.value === null) continue;
        lines.push(`${item.name}: ${item.value} ${item.unit} (${item.status}) — ${item.formula}`);
      }
    }

    return {
      summary: lines.length
        ? `Computed ${lines.length} spreads from the latest snapshot:\n${lines.join("\n")}`
        : "Prices are present but no spread could be computed.",
      data: { spreads: result.spreads, normalized: result.normalized, fx: result.fx },
      sources: [],
      confidence: lines.length ? 0.9 : 0.2
    };
  }
};

/* ------------------------------------------------------------------ *
 * AGENT 2 — RESEARCH
 * Wraps the existing self-directed pipeline: plan, search, extract,
 * gap-check, synthesize, and update the tracked confidence score.
 * ------------------------------------------------------------------ */
const researchAgent = {
  name: "research",
  title: "Research agent",
  capability:
    "Live web evidence on supply, demand, outages, policy, sanctions and forecasts. Evaluates a market hypothesis against that evidence and maintains a confidence score over time.",

  async run(task, { emit }) {
    await emit(`Research agent: investigating "${task}"`);

    const analysis = await analyzeHypothesis(task, {
      trigger: "desk",
      onStep: (step) => emit(`Research agent: ${step.message}`)
    });

    return {
      summary: analysis.result,
      data: {
        confidence: analysis.confidence,
        previousConfidence: analysis.previousConfidence,
        delta: analysis.confidenceDelta
      },
      sources: analysis.sources || [],
      confidence: (analysis.confidence ?? 50) / 100
    };
  }
};

/* ------------------------------------------------------------------ *
 * AGENT 3 — FLOWS
 * Physical movement: carriers, corridors, chokepoints.
 *
 * TODO: point FLOWS_KV_KEY at whatever key /api/vessels/poll writes,
 * or import that module's read function directly. Until then the agent
 * reports honestly that it has no data rather than inventing any.
 * ------------------------------------------------------------------ */
const FLOWS_KV_KEY = process.env.FLOWS_KV_KEY || "flows:latest";

const flowsAgent = {
  name: "flows",
  title: "Flows agent",
  capability:
    "Physical LNG movement: tracked carriers, trade corridors, and chokepoint status (Panama, Suez, Hormuz, Malacca, Cape of Good Hope, Bosporus).",

  async run(task, { emit }) {
    await emit(`Flows agent: checking corridors and chokepoints`);

    let snapshot = null;
    try {
      snapshot = await kv.get(FLOWS_KV_KEY);
    } catch (error) {
      console.error("Flows read failed:", error);
    }

    if (!snapshot) {
      return {
        summary: "No flows snapshot is available, so physical movement is unassessed.",
        data: null,
        sources: [],
        confidence: 0
      };
    }

    return {
      summary: `Latest flows snapshot:\n${JSON.stringify(snapshot).slice(0, 1500)}`,
      data: snapshot,
      sources: [],
      confidence: 0.7
    };
  }
};

export const AGENTS = [priceAgent, researchAgent, flowsAgent];

const byName = Object.fromEntries(AGENTS.map((a) => [a.name, a]));

/* ------------------------------------------------------------------ *
 * ORCHESTRATOR
 * ------------------------------------------------------------------ */

async function plan(question, emit) {
  const roster = AGENTS.map((a) => `- ${a.name}: ${a.capability}`).join("\n");

  const fallback = {
    assignments: [
      { agent: "price", task: question },
      { agent: "research", task: question }
    ],
    reason: "Defaulted to price and research."
  };

  try {
    const result = await callModel(
      `You coordinate a desk of specialist LNG market agents. Given a question,
decide which agents to call and what to ask each one. Call only the agents
whose capability is genuinely relevant — calling fewer, well-targeted agents
is better than calling all of them. Give each a specific sub-task in its own
area, not a copy of the original question.

Available agents:
${roster}

Respond with ONLY a JSON object:
{"assignments": [{"agent": "<name>", "task": "<specific sub-task>"}], "reason": "<one sentence>"}`,
      `Question: "${question}"`,
      { model: FAST_MODEL, maxTokens: 400, effort: "low", json: true }
    );

    const assignments = (result.assignments || []).filter((a) => byName[a.agent] && a.task);
    if (!assignments.length) return fallback;
    return { assignments, reason: result.reason || "" };
  } catch (error) {
    console.error("Desk planning failed, using fallback:", error);
    await emit("Planner unavailable — defaulting to price and research");
    return fallback;
  }
}

async function synthesize(question, findings) {
  const body = findings
    .map(
      (f) =>
        `### ${f.title} (self-reported confidence ${(f.confidence * 100).toFixed(0)}%)\nTask: ${f.task}\n${f.summary}`
    )
    .join("\n\n");

  return callModel(
    `You are the lead analyst on an LNG desk. Several specialist agents have
reported back. Write a single integrated answer to the user's question.

Rules:
- Numbers produced by the price agent are computed, not estimated. Use them
  exactly as given and never recompute or adjust them.
- Where agents disagree or an agent reports no data, say so plainly.
- Distinguish what the evidence shows from what you are inferring.
- Be concise: a short direct answer first, then the reasoning that supports it.
- Close with what would change the picture.`,
    `QUESTION: ${question}\n\nAGENT REPORTS:\n\n${body}`,
    { model: ULTRA_MODEL, maxTokens: 1600, effort: "medium" }
  );
}

/*
 * Runs the full desk. onStep receives a live trace, exactly like the
 * single-agent analyze stream, so the frontend pattern is unchanged.
 */
export async function runDesk(question, { onStep } = {}) {
  const emit = async (message, extra = {}) => {
    if (!onStep) return;
    try {
      await onStep({ message, at: new Date().toISOString(), ...extra });
    } catch (error) {
      console.error("Desk step emit failed:", error);
    }
  };

  await emit("Routing the question across the desk");

  const { assignments, reason } = await plan(question, emit);

  await emit(
    `Assigned ${assignments.length} agent${assignments.length === 1 ? "" : "s"}${reason ? ` — ${reason}` : ""}`,
    { assignments }
  );

  // Specialists run in parallel; one failure does not sink the desk.
  const findings = await Promise.all(
    assignments.map(async ({ agent, task }) => {
      const spec = byName[agent];
      try {
        const out = await spec.run(task, { emit });
        await emit(`${spec.title}: done`);
        return { agent, title: spec.title, task, ...out };
      } catch (error) {
        console.error(`${agent} agent failed:`, error);
        await emit(`${spec.title}: failed (${error.message})`);
        return {
          agent,
          title: spec.title,
          task,
          summary: `This agent failed: ${error.message}`,
          data: null,
          sources: [],
          confidence: 0
        };
      }
    })
  );

  await emit("Lead analyst: integrating the reports");
  const answer = await synthesize(question, findings);
  await emit("Done");

  const sources = [];
  const seen = new Set();
  for (const f of findings) {
    for (const s of f.sources || []) {
      if (s.url && !seen.has(s.url)) {
        seen.add(s.url);
        sources.push(s);
      }
    }
  }

  return {
    question,
    answer,
    assignments,
    findings: findings.map(({ agent, title, task, confidence, data }) => ({
      agent,
      title,
      task,
      confidence,
      data
    })),
    sources
  };
}
