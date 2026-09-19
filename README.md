# Solid Natural Gas

**AI-native global gas intelligence.** An agentic LNG market intelligence system that develops, challenges, and continuously updates confidence-scored hypotheses about natural gas pricing using live evidence — not a one-shot chatbot answer, but a persistent, self-updating research agent.

🔗 **Live app:** [solidnaturalgas.com](https://www.solidnaturalgas.com)

Built for the Nebius × NVIDIA Global AI Hackathon — **Best Apps and Agents** track.

---

## What it does

Most LLM apps answer a question once and forget it. Solid Natural Gas treats a market hypothesis (e.g. *"European LNG spot prices will strengthen over the next 30 days"*) as a living thing:

1. You submit a hypothesis, or the system already has one running.
2. It searches the live web for current evidence — spot prices, storage levels, outages, geopolitical developments.
3. An NVIDIA Nemotron model reasons over that evidence against the hypothesis and outputs an updated **confidence score (0–100)**, not just prose.
4. The new confidence is **persisted**, so the next run — whether triggered by a person clicking "Research" or by the system's own hourly cron job — picks up exactly where the last one left off, and the score visibly moves up or down over time.
5. Every hypothesis anyone runs is automatically added to a **dashboard** of autonomously tracked hypotheses, each with a confidence trend sparkline built from real historical runs.

The same architecture also powers the **Henry Hub spot price** widget on the homepage — instead of depending on a single external government API, it's derived from live search evidence the same way the hypothesis engine is, keeping the entire page powered by one consistent, agentic pipeline.

---

## How Nebius and NVIDIA technology power this

This project's core reasoning loop is not decoration — it is the product. Specifically:

### NVIDIA Nemotron, via Nebius Token Factory
Every piece of reasoning in this app — evaluating a hypothesis against evidence, scoring confidence, and even extracting the Henry Hub price from search results — is done by an **NVIDIA Nemotron-3-Super** model, called through **Nebius Token Factory's** OpenAI-compatible `/chat/completions` endpoint (`api.tokenfactory.nebius.com`). No hardcoded logic decides the confidence score; the model does, constrained by a system prompt that requires it to cite specific evidence and explain its reasoning before outputting a machine-parseable score.

This happens in three separate routes:
- `app/api/analyze/route.js` — the interactive hypothesis-testing endpoint
- `app/api/henry-hub/route.js` — live price extraction from search evidence
- `app/api/cron/reevaluate/route.js` — autonomous re-evaluation of every tracked hypothesis, once an hour, with no human in the loop

### Tavily
Every Nemotron call above is grounded in live web evidence fetched via the **Tavily Search API**. The model is explicitly instructed not to invent market facts — it can only reason over what Tavily actually returned, with each claim traceable back to a numbered source. Sources are surfaced directly in the UI so a user can verify the evidence themselves, not just trust the model's summary.

### Nebius Vercel KV-backed persistence (autonomous agent loop)
What makes this "agentic" rather than a chatbot: hypotheses don't reset to a neutral state every time. Confidence scores and full historical runs are persisted, and a Vercel Cron job calls `/api/cron/reevaluate` every hour, re-running the Tavily → Nemotron pipeline for every tracked hypothesis independently of any user interaction. The system keeps researching and updating its own conclusions even when nobody is looking at it.

---

## Architecture
