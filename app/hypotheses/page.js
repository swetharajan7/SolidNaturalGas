"use client";

import { useEffect, useState } from "react";
import NavBar from "../components/NavBar";
import Sparkline from "../components/Sparkline";

export default function HypothesesPage() {
  const [dashboard, setDashboard] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboard() {
      try {
        const response = await fetch("/api/dashboard");
        const data = await response.json();
        setDashboard(data.hypotheses || []);
      } catch (error) {
        console.error("Dashboard load failed:", error);
      } finally {
        setLoading(false);
      }
    }
    loadDashboard();
  }, []);

  return (
    <main
      style={{
        maxWidth: "900px",
        margin: "0 auto",
        padding: "0 24px 80px",
        fontFamily: "Arial, sans-serif"
      }}
    >
      <NavBar />

      <header style={{ marginBottom: "30px" }}>
        <h1 style={{ fontSize: "28px", marginBottom: "8px" }}>Tracked Hypotheses</h1>
        <p style={{ color: "#586474", lineHeight: "1.6" }}>
          Every hypothesis the agent is autonomously re-evaluating, with its
          confidence trend over time.
        </p>
      </header>

      <section
        style={{
          padding: "20px",
          border: "1px solid #d9e0e8",
          borderRadius: "8px",
          background: "#ffffff"
        }}
      >
        {loading ? (
          <div style={{ fontSize: "14px", color: "#7a8593" }}>Loading...</div>
        ) : dashboard.length === 0 ? (
          <div style={{ fontSize: "14px", color: "#7a8593" }}>
            No hypotheses tracked yet. Test one on the homepage to start tracking it.
          </div>
        ) : (
          dashboard.map((item, i) => (
            <div
              key={item.hypothesis}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "16px",
                padding: "16px 0",
                borderTop: i > 0 ? "1px solid #eef1f4" : "none"
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "16px", color: "#0B1F3B" }}>
                  {item.hypothesis}
                </div>
                {item.lastRun && (
                  <div style={{ fontSize: "12px", color: "#9aa4b0", marginTop: "2px" }}>
                    Last checked {new Date(item.lastRun).toLocaleString()}
                  </div>
                )}
              </div>

              <Sparkline data={item.history} width={140} height={40} />

              <div
                style={{
                  fontSize: "26px",
                  fontWeight: "800",
                  color: "#0B1F3B",
                  minWidth: "64px",
                  textAlign: "right"
                }}
              >
                {item.confidence ?? "—"}
              </div>
            </div>
          ))
        )}
      </section>
    </main>
  );
}
