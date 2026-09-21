"use client";

import { useEffect, useState } from "react";
import NavBar from "../components/NavBar";

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

export default function FlowsPage() {
  const [flows, setFlows] = useState(null);
  const [flowsError, setFlowsError] = useState("");
  const [vessels, setVessels] = useState([]);

  useEffect(() => {
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

    async function loadVessels() {
      try {
        const response = await fetch("/api/vessels");
        const data = await response.json();
        setVessels(data.vessels || []);
      } catch (error) {
        console.error("Vessels load failed:", error);
      }
    }

    loadFlows();
    loadVessels();
  }, []);

  return (
    <main
      style={{
        maxWidth: "1100px",
        margin: "0 auto",
        padding: "0 24px 80px",
        fontFamily: "Arial, sans-serif"
      }}
    >
      <NavBar />

      <header style={{ marginBottom: "30px" }}>
        <h1 style={{ fontSize: "28px", marginBottom: "8px" }}>Global LNG Flows</h1>
        <p style={{ color: "#586474", lineHeight: "1.6" }}>
          The physical world behind the numbers — shipping chokepoint status,
          trade corridor trends, and a tracked sample fleet of real LNG carriers.
        </p>
      </header>

      <section
        style={{
          padding: "20px",
          border: "1px solid #d9e0e8",
          borderRadius: "8px",
          background: "#ffffff",
          marginBottom: "24px"
        }}
      >
        {flowsError ? (
          <div style={{ fontSize: "14px", color: "#8a4b4b" }}>{flowsError}</div>
        ) : flows ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: "32px"
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: "700",
                  letterSpacing: "0.06em",
                  color: "#7a8593",
                  marginBottom: "12px"
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
                      gap: "10px",
                      padding: "10px 0",
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
                        <div style={{ fontSize: "12px", color: "#9aa4b0" }}>{entry.note}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: "700",
                  letterSpacing: "0.06em",
                  color: "#7a8593",
                  marginBottom: "12px"
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
                      gap: "10px",
                      padding: "10px 0",
                      borderTop: "1px solid #eef1f4"
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "14px", color: "#0B1F3B" }}>{label}</div>
                      {entry?.note && (
                        <div style={{ fontSize: "12px", color: "#9aa4b0" }}>{entry.note}</div>
                      )}
                    </div>
                    <span style={{ fontSize: "16px", fontWeight: "700", color: display.color, flexShrink: 0 }}>
                      {display.symbol}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: "14px", color: "#7a8593" }}>Loading...</div>
        )}

        <div
          style={{
            fontSize: "11px",
            color: "#9aa4b0",
            marginTop: "18px",
            borderTop: "1px solid #eef1f4",
            paddingTop: "10px"
          }}
        >
          Chokepoint and corridor status reflect recent reported activity, via Tavily + Nemotron — not live vessel telemetry.
        </div>
      </section>

      <section
        style={{
          padding: "20px",
          border: "1px solid #d9e0e8",
          borderRadius: "8px",
          background: "#ffffff"
        }}
      >
        <div style={{ fontSize: "13px", fontWeight: "700", letterSpacing: "0.06em", color: "#7a8593", marginBottom: "6px" }}>
          PHYSICAL LNG — LIVE
        </div>
        <div style={{ fontSize: "12px", color: "#9aa4b0", marginBottom: "16px" }}>
          {vessels.length} tracked carrier{vessels.length !== 1 ? "s" : ""} · real AIS data
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
          {vessels.map((v) => (
            <div key={v.name} style={{ padding: "12px", border: "1px solid #eef1f4", borderRadius: "6px" }}>
              <div style={{ fontSize: "14px", fontWeight: "700", color: "#0B1F3B" }}>{v.name}</div>
              <div style={{ fontSize: "11px", color: "#9aa4b0", marginBottom: "6px" }}>{v.operator}</div>
              {v.observedAt ? (
                <div style={{ fontSize: "12px", color: "#586474" }}>
                  {v.destination ? `→ ${v.destination}` : "Destination unknown"}
                  {v.speed != null ? ` · ${v.speed.toFixed(1)} kn` : ""}
                </div>
              ) : (
                <div style={{ fontSize: "12px", color: "#b8a978" }}>No AIS signal received yet</div>
              )}
            </div>
          ))}
        </div>

        <div
          style={{
            fontSize: "11px",
            color: "#9aa4b0",
            marginTop: "16px",
            borderTop: "1px solid #eef1f4",
            paddingTop: "10px"
          }}
        >
          Representative sample, not comprehensive fleet coverage. Terrestrial AIS only — a vessel mid-ocean may show no signal for hours.
        </div>
      </section>
    </main>
  );
}
