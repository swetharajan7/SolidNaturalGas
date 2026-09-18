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

  const [henryHub, setHenryHub] = useState([]);
  const [henryHubError, setHenryHubError] = useState("");

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
    async function loadHenryHub() {
      try {
        const response = await fetch("/api/henry-hub");
        const data = await response.json();

        if (!response.ok) {
          setHenryHubError(
            data.error || "Unable to load Henry Hub data."
          );
          return;
        }

        setHenryHub(data.series || []);
      } catch (error) {
        console.error("Henry Hub load failed:", error);
        setHenryHubError("Unable to load Henry Hub data.");
      }
    }

    loadHenryHub();
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

  const latestHenryHub =
    henryHub.length > 0 ? henryHub[0] : null;

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
            fontSize: "14px",
            fontWeight: "700",
            letterSpacing: "0.08em",
            color: "#586474"
          }}
        >
          HENRY HUB
        </div>

        {latestHenryHub ? (
          <>
            <div
              style={{
                fontSize: "30px",
                fontWeight: "700",
                marginTop: "6px",
                color: "#0B1F3B"
              }}
            >
              ${latestHenryHub.value.toFixed(2)} / MMBtu
            </div>

            <div
              style={{
                fontSize: "13px",
                color: "#7a8593",
                marginTop: "4px"
              }}
            >
              Daily spot · {latestHenryHub.date} · Live evidence via Tavily + Nemotron
            </div>
          </>
        ) : henryHubError ? (
          <div
            style={{
              marginTop: "8px",
              fontSize: "14px",
              color: "#8a4b4b"
            }}
          >
            {henryHubError}
          </div>
        ) : (
          <div
            style={{
              marginTop: "8px",
              fontSize: "14px",
              color: "#7a8593"
            }}
          >
            Loading latest Henry Hub price...
          </div>
        )}
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
                    
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#0B1F3B" }}
                    >
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
