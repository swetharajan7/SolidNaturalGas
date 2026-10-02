"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Sidebar, { SIDEBAR_WIDTH, useIsDesktop } from "./components/Sidebar";

function timeAgo(isoString) {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const MARKET_GROUPS = [
  {
    heading: "North America",
    items: {
      henryHub: { name: "Henry Hub", unit: "$/MMBtu", symbol: "$" },
      waha: { name: "Waha", unit: "$/MMBtu", symbol: "$" },
      houstonShipChannel: { name: "Houston Ship Ch.", unit: "$/MMBtu", symbol: "$" },
      aeco: { name: "AECO (NIT)", unit: "C$/GJ", symbol: "C$" }
    }
  },
  {
    heading: "Europe & Asia-Pacific",
    items: {
      ttf: { name: "TTF", unit: "\u20AC/MWh", symbol: "\u20AC" },
      jkm: { name: "JKM", unit: "$/MMBtu", symbol: "$" },
      wallumbilla: { name: "Wallumbilla", unit: "A$/GJ", symbol: "A$" }
    }
  },
  {
    heading: "Crude",
    items: {
      brent: { name: "Brent", unit: "$/bbl", symbol: "$" },
      wti: { name: "WTI", unit: "$/bbl", symbol: "$" }
    }
  }
];

export default function Home() {
  const [hypothesis, setHypothesis] = useState(
    "European LNG spot prices will strengthen over the next 30 days."
  );

  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  const [confidence, setConfidence] = useState(null);
  const [confidenceDelta, setConfidenceDelta] = useState(0);
  const [sources, setSources] = useState([]);
  const [steps, setSteps] = useState([]);

  const [deskQuestion, setDeskQuestion] = useState(
    "Is the US-Europe arb open, and what would close it?"
  );
  const [deskLoading, setDeskLoading] = useState(false);
  const [deskSteps, setDeskSteps] = useState([]);
  const [deskAnswer, setDeskAnswer] = useState("");
  const [deskFindings, setDeskFindings] = useState([]);
  const [deskSources, setDeskSources] = useState([]);
  const [dashboard, setDashboard] = useState([]);

  const [markets, setMarkets] = useState(null);
  const [marketsError, setMarketsError] = useState("");
  const [marketsUpdatedAt, setMarketsUpdatedAt] = useState(null);

  const [activity, setActivity] = useState([]);
  const [notebook, setNotebook] = useState([]);

  const isDesktop = useIsDesktop();

  async function loadDashboard() {
    try {
      const response = await fetch("/api/dashboard");
      const data = await response.json();
      setDashboard(data.hypotheses || []);
    } catch (error) {
      console.error("Dashboard load failed:", error);
    }
  }

  async function loadActivity() {
    try {
      const response = await fetch("/api/activity");
      const data = await response.json();
      setActivity(data.entries || []);
    } catch (error) {
      console.error("Activity load failed:", error);
    }
  }

  async function loadNotebook() {
    try {
      const response = await fetch("/api/notebook");
      const data = await response.json();
      setNotebook(data.entries || []);
    } catch (error) {
      console.error("Notebook load failed:", error);
    }
  }

  useEffect(() => {
    async function loadMarkets() {
      try {
        const response = await fetch("/api/markets");
        const data = await response.json();
        if (!response.ok) {
          setMarketsError(data.error || "Unable to load market prices.");
          return;
        }
        if (data.pending || !data.markets) {
          setMarketsError(
            data.message || "Prices are being gathered — the first snapshot is on its way."
          );
          return;
        }
        setMarkets(data.markets);
        setMarketsUpdatedAt(data.updatedAt || null);
      } catch (error) {
        console.error("Markets load failed:", error);
        setMarketsError("Unable to load market prices.");
      }
    }

    loadMarkets();
    loadDashboard();
    loadActivity();
    loadNotebook();

    const interval = setInterval(loadActivity, 20000);
    return () => clearInterval(interval);
  }, []);

  // Reads a newline-delimited JSON stream, handing each object to onPayload.
  async function readStream(url, body, onPayload) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.body) throw new Error("No stream returned.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          onPayload(JSON.parse(line));
        } catch {
          /* ignore a partial line */
        }
      }
    }
  }

  async function askDesk() {
    setDeskLoading(true);
    setDeskSteps([]);
    setDeskAnswer("");
    setDeskFindings([]);
    setDeskSources([]);

    try {
      await readStream("/api/desk/stream", { question: deskQuestion }, (payload) => {
        if (payload.kind === "step") {
          setDeskSteps((previous) => [...previous, payload]);
        } else if (payload.kind === "result") {
          setDeskAnswer(payload.answer || "No answer was returned.");
          setDeskFindings(payload.findings || []);
          setDeskSources(payload.sources || []);
        } else if (payload.kind === "error") {
          setDeskAnswer(payload.error);
        }
      });
      loadActivity();
      loadDashboard();
    } catch {
      setDeskAnswer("Unable to reach the desk.");
    }

    setDeskLoading(false);
  }

  async function analyze() {
    setLoading(true);
    setResult("");
    setConfidence(null);
    setConfidenceDelta(0);
    setSources([]);
    setSteps([]);

    try {
      const response = await fetch("/api/analyze/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hypothesis })
      });

      if (!response.body) {
        setResult("Unable to reach the analysis service.");
        setLoading(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Each line is one JSON object: a step, the final result, or an error.
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let payload;
          try {
            payload = JSON.parse(line);
          } catch {
            continue;
          }

          if (payload.kind === "step") {
            setSteps((previous) => [...previous, payload]);
          } else if (payload.kind === "result") {
            setResult(payload.result || "No analysis was returned.");
            if (typeof payload.confidence === "number") {
              setConfidence(payload.confidence);
              setConfidenceDelta(
                typeof payload.confidenceDelta === "number" ? payload.confidenceDelta : 0
              );
            }
            setSources(payload.sources || []);
          } else if (payload.kind === "error") {
            setResult(payload.error);
          }
        }
      }

      loadDashboard();
      loadActivity();
      loadNotebook();
    } catch {
      setResult("Unable to reach the analysis service.");
    }

    setLoading(false);
  }


  const AGENT_STYLE = {
    price: { label: "PRICE", color: "#1e7d34" },
    research: { label: "RESEARCH", color: "#0B1F3B" },
    flows: { label: "FLOWS", color: "#8a5a00" }
  };

  function agentOf(message) {
    const match = /^(price|research|flows) agent/i.exec(message || "");
    return match ? match[1].toLowerCase() : null;
  }

  const cardStyle = {
    padding: "20px",
    border: "1px solid #d9e0e8",
    borderRadius: "8px",
    background: "#ffffff"
  };

  const sectionLabelStyle = {
    fontSize: "13px",
    fontWeight: "700",
    letterSpacing: "0.06em",
    color: "#7a8593",
    marginBottom: "12px"
  };

  return (
    <>
      <Sidebar activity={activity} />

      <main
        style={{
          marginLeft: isDesktop ? `${SIDEBAR_WIDTH}px` : 0,
          maxWidth: "1180px",
          padding: isDesktop ? "32px 32px 80px" : "64px 18px 60px",
          fontFamily: "Arial, sans-serif"
        }}
      >
        <header style={{ marginBottom: "28px" }}>
          <p style={{ fontSize: "17px", color: "#44546a", margin: 0, maxWidth: "760px" }}>
            An AI agent that tests LNG price hypotheses against live evidence and revises its own confidence — hourly, autonomously.
          </p>
        </header>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "flex-start" }}>
          <div style={{ flex: "2 1 520px", minWidth: 0 }}>
            <section
              style={{
                ...cardStyle,
                marginBottom: "24px",
                background: "#0B1F3B",
                border: "1px solid #0B1F3B"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: "#4ade80",
                    display: "inline-block"
                  }}
                />
                <div style={{ fontSize: "13px", fontWeight: "700", letterSpacing: "0.08em", color: "#cbd5e1" }}>
                  AGENT ACTIVITY — LIVE
                </div>
              </div>

              {activity.length === 0 ? (
                <div style={{ fontSize: "14px", color: "#94a3b8" }}>Waiting for the next research cycle...</div>
              ) : (
                <div>
                  {activity.slice(0, 8).map((entry, i) => (
                    <div
                      key={`${entry.timestamp}-${i}`}
                      style={{
                        display: "flex",
                        gap: "12px",
                        padding: "6px 0",
                        fontSize: "13px",
                        borderTop: i > 0 ? "1px solid #1e2f4d" : "none"
                      }}
                    >
                      <span style={{ color: "#64748b", flexShrink: 0, minWidth: "56px" }}>
                        {timeAgo(entry.timestamp)}
                      </span>
                      <span style={{ color: "#e2e8f0" }}>{entry.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section style={{ ...cardStyle, marginBottom: "24px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "8px" }}>
                <h1 style={{ fontSize: "26px", margin: 0 }}>Ask the desk</h1>
                <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.08em", color: "#7a8593" }}>
                  3 SPECIALIST AGENTS
                </span>
              </div>
              <p style={{ color: "#586474", lineHeight: "1.6", marginTop: 0 }}>
                A question is routed across a price agent, a research agent and a flows agent. Each works its own
                corner — prices are computed, evidence is searched, movement is checked — and a lead analyst integrates
                the reports.
              </p>

              <textarea
                value={deskQuestion}
                onChange={(e) => setDeskQuestion(e.target.value)}
                rows={3}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "16px",
                  fontSize: "16px",
                  lineHeight: "1.5",
                  border: "1px solid #b8c3cf",
                  borderRadius: "8px"
                }}
              />

              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" }}>
                {[
                  "Is the US-Europe arb open, and what would close it?",
                  "Where is Permian production stress showing up?",
                  "Should the next flexible cargo go to Europe or Asia?"
                ].map((example) => (
                  <button
                    key={example}
                    onClick={() => setDeskQuestion(example)}
                    style={{
                      padding: "6px 11px",
                      fontSize: "12px",
                      color: "#44546a",
                      background: "#f7f9fb",
                      border: "1px solid #e4e9ef",
                      borderRadius: "14px",
                      cursor: "pointer"
                    }}
                  >
                    {example}
                  </button>
                ))}
              </div>

              <button
                onClick={askDesk}
                disabled={deskLoading}
                style={{
                  marginTop: "15px",
                  padding: "12px 22px",
                  fontSize: "16px",
                  fontWeight: "600",
                  cursor: deskLoading ? "default" : "pointer",
                  borderRadius: "6px",
                  border: "none",
                  background: "#0B1F3B",
                  color: "white"
                }}
              >
                {deskLoading
                  ? deskSteps.length > 0
                    ? deskSteps[deskSteps.length - 1].message
                    : "Routing the question..."
                  : "Ask the desk"}
              </button>

              {deskSteps.length > 0 && (
                <div style={{ marginTop: "24px", padding: "16px 18px", background: "#f7f9fb", border: "1px solid #e4e9ef", borderRadius: "8px" }}>
                  <div style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.1em", color: "#7a8593", marginBottom: "12px" }}>
                    DESK TRACE
                  </div>

                  {deskSteps.map((step, i) => {
                    const agent = agentOf(step.message);
                    const style = agent ? AGENT_STYLE[agent] : null;
                    const pending = deskLoading && i === deskSteps.length - 1;
                    return (
                      <div key={`${step.at}-${i}`} style={{ display: "flex", gap: "10px", padding: "5px 0", alignItems: "flex-start" }}>
                        <span
                          style={{
                            width: "7px",
                            height: "7px",
                            borderRadius: "50%",
                            marginTop: "6px",
                            flexShrink: 0,
                            background: pending ? "#f59e0b" : style ? style.color : "#64748b"
                          }}
                        />
                        <div style={{ fontSize: "13px", lineHeight: "1.5", color: "#35454b" }}>
                          {style && (
                            <span style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "0.06em", color: style.color, marginRight: "6px" }}>
                              {style.label}
                            </span>
                          )}
                          {step.message}
                          {step.assignments && (
                            <div style={{ marginTop: "4px" }}>
                              {step.assignments.map((a, ai) => (
                                <div key={ai} style={{ fontSize: "12px", color: "#64748b", paddingLeft: "10px" }}>
                                  → {a.agent}: {a.task}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {deskAnswer && (
                <div style={{ marginTop: "26px", paddingTop: "22px", borderTop: "1px solid #eef1f4" }}>
                  {deskFindings.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
                      {deskFindings.map((f) => {
                        const style = AGENT_STYLE[f.agent] || { color: "#64748b", label: f.agent.toUpperCase() };
                        return (
                          <div
                            key={f.agent}
                            style={{
                              padding: "6px 11px",
                              borderRadius: "14px",
                              fontSize: "12px",
                              fontWeight: "600",
                              color: style.color,
                              border: `1px solid ${style.color}33`,
                              background: `${style.color}0d`
                            }}
                          >
                            {style.label} · {Math.round((f.confidence || 0) * 100)}%
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <h2 style={{ fontSize: "20px", marginTop: 0 }}>Desk answer</h2>
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: "1.7", fontSize: "16px" }}>{deskAnswer}</div>

                  {deskSources.length > 0 && (
                    <div style={{ marginTop: "20px" }}>
                      <div style={{ fontSize: "13px", fontWeight: "700", letterSpacing: "0.06em", color: "#586474", marginBottom: "8px" }}>
                        SOURCES
                      </div>
                      <ul style={{ paddingLeft: "20px", margin: 0 }}>
                        {deskSources.map((source) => (
                          <li key={source.id || source.url} style={{ marginBottom: "6px" }}>
                            <a href={source.url} target="_blank" rel="noopener noreferrer" style={{ color: "#0B1F3B" }}>
                              {source.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section style={{ ...cardStyle, marginBottom: "24px" }}>
              <h1 style={{ fontSize: "26px", marginBottom: "8px", marginTop: 0 }}>Test a Market Hypothesis</h1>
              <p style={{ color: "#586474", lineHeight: "1.6" }}>
                Challenge a natural gas or LNG market thesis using current evidence and AI reasoning.
              </p>

              <textarea
                value={hypothesis}
                onChange={(e) => setHypothesis(e.target.value)}
                rows={5}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "16px",
                  fontSize: "16px",
                  lineHeight: "1.5",
                  border: "1px solid #b8c3cf",
                  borderRadius: "8px"
                }}
              />

              <button
                onClick={analyze}
                disabled={loading}
                style={{
                  marginTop: "15px",
                  padding: "12px 22px",
                  fontSize: "16px",
                  fontWeight: "600",
                  cursor: loading ? "default" : "pointer",
                  borderRadius: "6px",
                  border: "none",
                  background: "#0B1F3B",
                  color: "white"
                }}
              >
                {loading
                  ? steps.length > 0
                    ? steps[steps.length - 1].message
                    : "Starting the agent..."
                  : "Research"}
              </button>

              {steps.length > 0 && (
                <div style={{ marginTop: "24px", padding: "16px 18px", background: "#f7f9fb", border: "1px solid #e4e9ef", borderRadius: "8px" }}>
                  <div style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.1em", color: "#7a8593", marginBottom: "12px" }}>
                    AGENT RUN TRACE
                  </div>

                  {steps.map((step, i) => {
                    const isLast = i === steps.length - 1;
                    const pending = loading && isLast;
                    return (
                      <div key={`${step.at}-${i}`} style={{ display: "flex", gap: "10px", padding: "5px 0" }}>
                        <span
                          style={{
                            width: "7px",
                            height: "7px",
                            borderRadius: "50%",
                            marginTop: "6px",
                            flexShrink: 0,
                            background: pending ? "#f59e0b" : "#1e7d34"
                          }}
                        />
                        <div style={{ fontSize: "13px", lineHeight: "1.5", color: "#35454b" }}>
                          {step.message}
                          {step.queries && (
                            <div style={{ marginTop: "4px" }}>
                              {step.queries.map((query, qi) => (
                                <div key={qi} style={{ fontSize: "12px", color: "#64748b", paddingLeft: "10px" }}>
                                  → {query}
                                </div>
                              ))}
                            </div>
                          )}
                          {step.titles && (
                            <div style={{ marginTop: "4px" }}>
                              {step.titles.map((title, ti) => (
                                <div key={ti} style={{ fontSize: "12px", color: "#64748b", paddingLeft: "10px" }}>
                                  · {title}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {result && (
                <div style={{ marginTop: "30px", paddingTop: "24px", borderTop: "1px solid #eef1f4" }}>
                  {confidence !== null && (
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: "700", letterSpacing: "0.08em", color: "#586474" }}>
                          CONFIDENCE
                        </div>
                        <div style={{ fontSize: "36px", fontWeight: "800", color: "#0B1F3B" }}>
                          {confidence}
                          <span style={{ fontSize: "18px", fontWeight: "500", color: "#7a8593" }}>/100</span>
                        </div>
                      </div>

                      {confidenceDelta !== 0 && (
                        <div
                          style={{
                            padding: "6px 12px",
                            borderRadius: "999px",
                            fontSize: "14px",
                            fontWeight: "700",
                            background: confidenceDelta > 0 ? "#e6f4ea" : "#fbe9e7",
                            color: confidenceDelta > 0 ? "#1e7d34" : "#a13a2c"
                          }}
                        >
                          {confidenceDelta > 0 ? "▲" : "▼"} {Math.abs(confidenceDelta)} since last check
                        </div>
                      )}
                    </div>
                  )}

                  <h2 style={{ fontSize: "20px" }}>Research Assessment</h2>

                  <div style={{ whiteSpace: "pre-wrap", lineHeight: "1.7", fontSize: "16px" }}>{result}</div>

                  {sources.length > 0 && (
                    <div style={{ marginTop: "24px" }}>
                      <div style={{ fontSize: "13px", fontWeight: "700", letterSpacing: "0.06em", color: "#586474", marginBottom: "8px" }}>
                        SOURCES
                      </div>
                      <ul style={{ paddingLeft: "20px", margin: 0 }}>
                        {sources.map((source) => (
                          <li key={source.id} style={{ marginBottom: "6px" }}>
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: "#0B1F3B", display: "inline-flex", alignItems: "center", gap: "6px" }}
                            >
                              {source.favicon && (
                                <img
                                  src={source.favicon}
                                  alt=""
                                  width={14}
                                  height={14}
                                  style={{ borderRadius: "2px", flexShrink: 0 }}
                                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                                />
                              )}
                              {source.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </section>

            {notebook.length > 0 && (
              <section style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "14px" }}>
                  <div style={sectionLabelStyle}>RESEARCH NOTEBOOK</div>
                  <Link href="/notebook" style={{ fontSize: "13px", color: "#0B1F3B", fontWeight: "600" }}>
                    View full notebook →
                  </Link>
                </div>

                {notebook.slice(0, 3).map((entry, i) => {
                  const prior = entry.confidence - entry.delta;
                  return (
                    <div key={`${entry.timestamp}-${i}`} style={{ padding: "10px 0", borderTop: i > 0 ? "1px solid #eef1f4" : "none" }}>
                      <div style={{ fontSize: "14px", fontWeight: "700", color: "#0B1F3B" }}>{entry.hypothesis}</div>
                      <div style={{ fontSize: "12px", color: "#586474" }}>
                        {prior}% → {entry.confidence}%
                        {entry.delta !== 0 && (
                          <span style={{ color: entry.delta > 0 ? "#1e7d34" : "#a13a2c", fontWeight: "700" }}>
                            {" "}({entry.delta > 0 ? "+" : ""}{entry.delta})
                          </span>
                        )}
                        {" · "}
                        {new Date(entry.timestamp).toLocaleString()}
                      </div>
                    </div>
                  );
                })}
              </section>
            )}
          </div>

          <div style={{ flex: "1 1 280px", minWidth: 0 }}>
            <section style={{ ...cardStyle, marginBottom: "24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "14px" }}>
                <div style={sectionLabelStyle}>MARKETS</div>
                {marketsUpdatedAt && (
                  <div style={{ fontSize: "10px", color: "#9aa4b0" }}>
                    {new Date(marketsUpdatedAt).toLocaleTimeString()}
                  </div>
                )}
              </div>

              {marketsError ? (
                <div style={{ fontSize: "13px", color: "#8a4b4b" }}>{marketsError}</div>
              ) : markets ? (
                <div>
                  {MARKET_GROUPS.map((group, gi) => (
                    <div key={group.heading} style={{ marginTop: gi === 0 ? 0 : "16px" }}>
                      <div style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "0.08em", color: "#9aa4b0", marginBottom: "8px" }}>
                        {group.heading.toUpperCase()}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(104px, 1fr))", gap: "12px" }}>
                        {Object.entries(group.items).map(([key, { name, unit, symbol }]) => {
                          const entry = markets[key];
                          const value = entry && entry.value != null ? Number(entry.value) : null;
                          return (
                            <div key={key}>
                              <div style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.04em", color: "#7a8593", marginBottom: "2px" }}>
                                {name.toUpperCase()}
                              </div>
                              <div
                                style={{
                                  fontSize: "18px",
                                  fontWeight: "700",
                                  color: value != null && value < 0 ? "#a13a2c" : "#0B1F3B"
                                }}
                              >
                                {value != null
                                  ? `${value < 0 ? "-" : ""}${symbol}${Math.abs(value).toFixed(2)}`
                                  : "\u2014"}
                              </div>
                              <div style={{ fontSize: "10px", color: "#9aa4b0" }}>
                                {unit}
                                {entry?.date ? ` \u00B7 ${entry.date}` : ""}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: "13px", color: "#7a8593" }}>Loading...</div>
              )}

              <div style={{ fontSize: "10px", color: "#9aa4b0", marginTop: "14px", borderTop: "1px solid #eef1f4", paddingTop: "8px" }}>
                Live evidence via Tavily + Nemotron
              </div>
            </section>

            <section style={{ ...cardStyle, marginBottom: "24px" }}>
              <div style={sectionLabelStyle}>GLOBAL LNG FLOWS</div>
              <p style={{ fontSize: "13px", color: "#586474", marginBottom: "14px" }}>
                Chokepoint status, trade corridor trends, and a live tracked fleet of real LNG carriers.
              </p>
              <Link href="/flows" style={{ fontSize: "13px", color: "#0B1F3B", fontWeight: "600" }}>
                View LNG Flows →
              </Link>
            </section>

            <section style={cardStyle}>
              <div style={sectionLabelStyle}>TRACKED HYPOTHESES</div>
              <p style={{ fontSize: "13px", color: "#586474", marginBottom: "14px" }}>
                {dashboard.length} hypothes{dashboard.length === 1 ? "is" : "es"} under continuous, autonomous re-evaluation.
              </p>
              <Link href="/hypotheses" style={{ fontSize: "13px", color: "#0B1F3B", fontWeight: "600" }}>
                View all hypotheses →
              </Link>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
