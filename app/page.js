"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

export default function Home() {
  const [hypothesis, setHypothesis] = useState(
    "European LNG spot prices will strengthen over the next 30 days."
  );

  const [confidence, setConfidence] = useState(null);
  const [confidenceDelta, setConfidenceDelta] = useState(0);
  const [sources, setSources] = useState([]);
  const [dashboard, setDashboard] = useState([]);

  const [henryHub, setHenryHub] = useState([]);
  const [henryHubError, setHenryHubError] = useState("");

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
        </section>
      )}
    </main>
  );
}
