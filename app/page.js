"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

function Sparkline({ data, width = 100, height = 32 }) {
  if (!data || data.length < 2) {
    return (
      <div style={{ fontSize: "11px", color: "#9aa4b0" }}>Not enough history</div>
    );
  }

  const values = data.map((d) => d.confidence);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  const color = values[values.length - 1] >= values[0] ? "#1e7d34" : "#a13a2c";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

const MARKET_LABELS = {
  henryHub: { name: "Henry Hub", unit: "$/MMBtu" },
  ttf: { name: "TTF", unit: "€/MWh" },
  jkm: { name: "JKM", unit: "$/MMBtu" },
  brent: { name: "Brent", unit: "$/bbl" },
  wti: { name: "WTI", unit: "$/bbl" }
};

const CHOKEPOINT_LABELS = {
  panama: "Panama Canal",
  suez: "Suez Canal",
  hormuz: "Strait of Hormuz",
  malacca: "Strait of Malacca",
  capeOfGoodHope: "Cape of Good Hope",
  bosporus: "Bosporus"
};

const CORRIDOR_LABELS = {
  usGulfEurope: "US Gulf → Europe",
  usGulfAsia: "US Gulf → Asia",
  qatarEurope: "Qatar → Europe",
  qatarAsia: "Qatar → Asia",
  australiaNorthAsia: "Australia → North Asia",
  eastAfricaAsia: "East Africa → Asia",
  russiaArcticEuropeAsia: "Russia/Arctic → Europe/Asia",
  atlanticBasinEurope: "Atlantic Basin → Europe"
};

const STATUS_COLORS = {
  normal: "#1e7d34",
  elevated: "#b8860b",
  disrupted: "#a13a2c"
};

const TREND_DISPLAY = {
  up: { symbol: "▲", color: "#1e7d34" },
  down: { symbol: "▼", color: "#a13a2c" },
  stable: { symbol: "→", color: "#7a8593" }
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

  const [flows, setFlows] = useState(null);
  const [flowsError, setFlowsError] = useState("");

  async function loadDashboard() {
    try {
      const response = await fetch("/api/dashboard");
      const data = await response.json();
      setDashboard(data.hypotheses || []);
    } catch (error) {
      console.error("Dashboard load failed:", error);
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

    async function loadFlows() {
      try {
        const response = await fetch("/api/flows");
        const data = await response.json();

        if (!response.ok) {
          setFlowsError(data.error || "Unable to load flow intelligence.");
          return;
        }

        setFlows(data);
      } catch (error) {
        console.error("Flows load failed:", error);
        setFlowsError("Unable to load flow intelligence.");
      }
    }

    loadMarkets();
    loadFlows();
    loadDashboard();
  }, []);

  async function analyze() {
    setLoading(true);
    setResult("");
    setConfidence(null);
    setConfidenceDelta(0);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ hypothesis })
      });

      const data = await response.json();

      setResult(
        data.result ||
        data.error ||
        "No analysis was returned."
      );

      if (typeof data.confidence === "number") {
        setConfidence(data.confidence);
        setConfidenceDelta(
          typeof data.confidenceDelta === "number" ? data.confidenceDelta : 0
        );
      }
      setSources(data.sources || []);
      loadDashboard();
    } catch {
      setResult("Unable to reach the analysis service.");
    }

    setLoading(false);
  }

  return (
    <main
      style={{
        maxWidth: "900px",
        margin: "0 auto",
        padding: "0 24px 80px",
        fontFamily: "Arial, sans-serif"
      }}
    >
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          gap: "14px",
          padding: "22px 0",
          borderBottom: "1px solid #d9e0e8",
          marginBottom: "35px"
        }}
      >
        <div
          style={{
            width: "60px",
            height: "60px",
            borderRadius: "50%",
            background: "linear-gradient(135deg, #eaf3ff 0%, #fff0e0 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0
          }}
        >
          <Image
            src="/logo.png"
            alt="Solid Natural Gas"
            width={48}
            height={48}
            priority
          />
        </div>

        <span
          style={{
            fontSize: "24px",
            fontWeight: "800",
            letterSpacing: "-0.02em",
            background: "linear-gradient(90deg, #d85a1e 0%, #0B1F3B 60%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text"
          }}
        >
          Solid Natural Gas
        </span>
      </nav>

      <header
        style={{
          textAlign: "center",
          marginBottom: "35px"
        }}
      >
        <p
          style={{
            fontSize: "17px",
            color: "#44546a"
          }}
        >
          AI-native global gas intelligence.
        </p>
      </header>

      <section
        style={{
          marginBottom: "30px",
          padding: "20px",
          border: "1px solid #d9e0e8",
          borderRadius: "8px",
          background: "#ffffff"
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: "16px"
          }}
        >
          <div
            style={{
              fontSize: "14px",
              fontWeight: "700",
              letterSpacing: "0.08em",
              color: "#586474"
            }}
          >
            MARKETS
          </div>
          {marketsUpdatedAt && (
            <div style={{ fontSize: "11px", color: "#9aa4b0" }}>
              Updated {new Date(marketsUpdatedAt).toLocaleTimeString()}
            </div>
          )}
        </div>

        {marketsError ? (
          <div style={{ fontSize: "14px", color: "#8a4b4b" }}>{marketsError}</div>
        ) : markets ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "18px"
            }}
          >
            {Object.entries(MARKET_LABELS).map(([key, { name, unit }]) => {
              const entry = markets[key];
              return (
                <div key={key}>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: "700",
                      letterSpacing: "0.06em",
                      color: "#7a8593",
                      marginBottom: "4px"
                    }}
                  >
                    {name.toUpperCase()}
                  </div>
                  <div
                    style={{
                      fontSize: "24px",
                      fontWeight: "800",
                      color: "#0B1F3B"
                    }}
                  >
                    {entry && entry.value != null ? (
                      <>
                        {unit.startsWith("€") ? "€" : "$"}
                        {Number(entry.value).toFixed(2)}
                      </>
                    ) : (
                      "—"
                    )}
                  </div>
                  <div style={{ fontSize: "11px", color: "#9aa4b0" }}>
                    {unit}
                    {entry?.date ? ` · ${entry.date}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: "14px", color: "#7a8593" }}>
            Loading latest market prices...
          </div>
        )}

        <div
          style={{
            fontSize: "11px",
            color: "#9aa4b0",
            marginTop: "16px",
            borderTop: "1px solid #eef1f4",
            paddingTop: "10px"
          }}
        >
          Live evidence via Tavily + Nemotron
        </div>
      </section>

      <section
        style={{
          marginBottom: "30px",
          padding: "20px",
          border: "1px solid #d9e0e8",
          borderRadius: "8px",
          background: "#ffffff"
        }}
      >
        <div
          style={{
            fontSize: "14px",
            fontWeight: "700",
            letterSpacing: "0.08em",
            color: "#586474",
            marginBottom: "16px"
          }}
        >
          GLOBAL LNG FLOWS
        </div>

        {flowsError ? (
          <div style={{ fontSize: "14px", color: "#8a4b4b" }}>{flowsError}</div>
        ) : flows ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "28px"
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: "700",
                  letterSpacing: "0.06em",
                  color: "#7a8593",
                  marginBottom: "10px"
                }}
              >
                CHOKEPOINT STATUS
              </div>
              {Object.entries(CHOKEPOINT_LABELS).map(([key, label]) => {
                const entry = flows.chokepoints?.[key];
                const status = entry?.status || "normal";
                return (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "8px",
                      padding: "8px 0",
                      borderTop: "1px solid #eef1f4"
                    }}
                  >
                    <span
                      style={{
                        marginTop: "5px",
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: STATUS_COLORS[status] || STATUS_COLORS.normal,
                        flexShrink: 0
                      }}
                    />
                    <div>
                      <div style={{ fontSize: "14px", color: "#0B1F3B" }}>{label}</div>
                      {entry?.note && (
                        <div style={{ fontSize: "12px", color: "#9aa4b0" }}>
                          {entry.note}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: "700",
                  letterSpacing: "0.06em",
                  color: "#7a8593",
                  marginBottom: "10px"
                }}
              >
                ROUTE TRENDS
              </div>
              {Object.entries(CORRIDOR_LABELS).map(([key, label]) => {
                const entry = flows.corridors?.[key];
                const trend = entry?.trend || "stable";
                const display = TREND_DISPLAY[trend] || TREND_DISPLAY.stable;
                return (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: "8px",
                      padding: "8px 0",
                      borderTop: "1px solid #eef1f4"
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "14px", color: "#0B1F3B" }}>{label}</div>
                      {entry?.note && (
                        <div style={{ fontSize: "12px", color: "#9aa4b0" }}>
                          {entry.note}
                        </div>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: "16px",
                        fontWeight: "700",
                        color: display.color,
                        flexShrink: 0
                      }}
                    >
                      {display.symbol}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: "14px", color: "#7a8593" }}>
            Loading flow intelligence...
          </div>
        )}

        <div
          style={{
            fontSize: "11px",
            color: "#9aa4b0",
            marginTop: "16px",
            borderTop: "1px solid #eef1f4",
            paddingTop: "10px"
          }}
        >
          Chokepoint and corridor status reflect recent reported activity, via Tavily + Nemotron — not live vessel telemetry.
        </div>
      </section>

      {dashboard.length > 0 && (
        <section
          style={{
            marginBottom: "30px",
            padding: "20px",
            border: "1px solid #d9e0e8",
            borderRadius: "8px",
            background: "#ffffff"
          }}
        >
          <div
            style={{
              fontSize: "14px",
              fontWeight: "700",
              letterSpacing: "0.08em",
              color: "#586474",
              marginBottom: "14px"
            }}
          >
            TRACKED HYPOTHESES
          </div>

          {dashboard.map((item) => (
            <div
              key={item.hypothesis}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "16px",
                padding: "12px 0",
                borderTop: "1px solid #eef1f4"
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "15px", color: "#0B1F3B" }}>
                  {item.hypothesis}
                </div>
                {item.lastRun && (
                  <div style={{ fontSize: "12px", color: "#9aa4b0", marginTop: "2px" }}>
                    Last checked {new Date(item.lastRun).toLocaleString()}
                  </div>
                )}
              </div>

              <Sparkline data={item.history} />

              <div
                style={{
                  fontSize: "22px",
                  fontWeight: "800",
                  color: "#0B1F3B",
                  minWidth: "56px",
                  textAlign: "right"
                }}
              >
                {item.confidence ?? "—"}
              </div>
            </div>
          ))}
        </section>
      )}

      <section
        style={{
          borderTop: "1px solid #d9e0e8",
          paddingTop: "30px"
        }}
      >
        <h1
          style={{
            fontSize: "30px",
            marginBottom: "8px"
          }}
        >
          Test a Market Hypothesis
        </h1>

        <p
          style={{
            color: "#586474",
            lineHeight: "1.6"
          }}
        >
          Challenge a natural gas or LNG market thesis using
          current evidence and AI reasoning.
        </p>

        <textarea
          value={hypothesis}
          onChange={(e) => setHypothesis(e.target.value)}
          rows={6}
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
      </section>

      {result && (
        <section
          style={{
            marginTop: "45px",
            paddingTop: "30px",
            borderTop: "1px solid #d9e0e8"
          }}
        >
          {confidence !== null && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                marginBottom: "20px"
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: "700",
                    letterSpacing: "0.08em",
                    color: "#586474"
                  }}
                >
                  CONFIDENCE
                </div>
                <div
                  style={{
                    fontSize: "36px",
                    fontWeight: "800",
                    color: "#0B1F3B"
                  }}
                >
                  {confidence}
                  <span
                    style={{
                      fontSize: "18px",
                      fontWeight: "500",
                      color: "#7a8593"
                    }}
                  >
                    /100
                  </span>
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
                  {confidenceDelta > 0 ? "▲" : "▼"}{" "}
                  {Math.abs(confidenceDelta)} since last check
                </div>
              )}
            </div>
          )}

          <h2>Research Assessment</h2>

          <div
            style={{
              whiteSpace: "pre-wrap",
              lineHeight: "1.7",
              fontSize: "16px"
            }}
          >
            {result}
          </div>

          {sources.length > 0 && (
            <div style={{ marginTop: "24px" }}>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: "700",
                  letterSpacing: "0.06em",
                  color: "#586474",
                  marginBottom: "8px"
                }}
              >
                SOURCES
              </div>
              <ul style={{ paddingLeft: "20px", margin: 0 }}>
                {sources.map((source) => (
                  <li key={source.id} style={{ marginBottom: "6px" }}>
                    <a href={source.url} target="_blank" rel="noopener noreferrer" style={{ color: "#0B1F3B" }}>
                      {source.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
