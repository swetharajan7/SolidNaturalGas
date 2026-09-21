"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import NavBar from "./components/NavBar";

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

const MARKET_LABELS = {
  henryHub: { name: "Henry Hub", unit: "$/MMBtu" },
  ttf: { name: "TTF", unit: "€/MWh" },
  jkm: { name: "JKM", unit: "$/MMBtu" },
  brent: { name: "Brent", unit: "$/bbl" },
  wti: { name: "WTI", unit: "$/bbl" }
};

export default function Home() {
  const [hypothesis, setHypothesis] = useState(
    "European LNG spot prices will strengthen over the next 30 days."
  );

  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  const [confidence, setConfidence] = useState(null);
  const [confidenceDelta, setConfidenceDelta] = useState(0);
  const [sources, setSources] = useState([]);
  const [dashboard, setDashboard] = useState([]);

  const [markets, setMarkets] = useState(null);
  const [marketsError, setMarketsError] = useState("");
  const [marketsUpdatedAt, setMarketsUpdatedAt] = useState(null);

  const [activity, setActivity] = useState([]);
  const [notebook, setNotebook] = useState([]);

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
        setMarkets(data.markets || null);
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

  async function analyze() {
    setLoading(true);
    setResult("");
    setConfidence(null);
    setConfidenceDelta(0);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hypothesis })
      });

      const data = await response.json();

      setResult(data.result || data.error || "No analysis was returned.");

      if (typeof data.confidence === "number") {
        setConfidence(data.confidence);
        setConfidenceDelta(typeof data.confidenceDelta === "number" ? data.confidenceDelta : 0);
      }
      setSources(data.sources || []);
      loadDashboard();
      loadActivity();
      loadNotebook();
    } catch {
      setResult("Unable to reach the analysis service.");
    }

    setLoading(false);
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
    <main
      style={{
        maxWidth: "1280px",
        margin: "0 auto",
        padding: "0 24px 80px",
        fontFamily: "Arial, sans-serif"
      }}
    >
      <NavBar />

      <header style={{ textAlign: "center", marginBottom: "35px" }}>
        <p style={{ fontSize: "17px", color: "#44546a" }}>
          An AI agent that tests LNG price hypotheses against live evidence and revises its own confidence — hourly, autonomously.
        </p>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "flex-start" }}>
        <div style={{ flex: "2 1 560px", minWidth: 0 }}>
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
              {loading ? "Researching live evidence..." : "Research"}
            </button>

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

        <div style={{ flex: "1 1 300px", minWidth: 0 }}>
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
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "14px" }}>
                {Object.entries(MARKET_LABELS).map(([key, { name, unit }]) => {
                  const entry = markets[key];
                  return (
                    <div key={key}>
                      <div style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.04em", color: "#7a8593", marginBottom: "2px" }}>
                        {name.toUpperCase()}
                      </div>
                      <div style={{ fontSize: "18px", fontWeight: "700", color: "#0B1F3B" }}>
                        {entry && entry.value != null ? (
                          <>
                            {unit.startsWith("€") ? "€" : "$"}
                            {Number(entry.value).toFixed(2)}
                          </>
                        ) : (
                          "—"
                        )}
                      </div>
                      <div style={{ fontSize: "10px", color: "#9aa4b0" }}>
                        {unit}
                        {entry?.date ? ` · ${entry.date}` : ""}
                      </div>
                    </div>
                  );
                })}
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
  );
}
