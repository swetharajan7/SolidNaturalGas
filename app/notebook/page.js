"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

export default function NotebookPage() {
  const [notebook, setNotebook] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadNotebook() {
      try {
        const response = await fetch("/api/notebook");
        const data = await response.json();
        setNotebook(data.entries || []);
      } catch (error) {
        console.error("Notebook load failed:", error);
      } finally {
        setLoading(false);
      }
    }
    loadNotebook();
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
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "22px 0",
          borderBottom: "1px solid #d9e0e8",
          marginBottom: "35px"
        }}
      >
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "14px", textDecoration: "none" }}>
          <div
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #eaf3ff 0%, #fff0e0 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0
            }}
          >
            <Image src="/logo.png" alt="Solid Natural Gas" width={34} height={34} priority />
          </div>
          <span
            style={{
              fontSize: "20px",
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
        </Link>

        <Link href="/" style={{ fontSize: "14px", color: "#586474", textDecoration: "none" }}>
          ← Back to home
        </Link>
      </nav>

      <header style={{ marginBottom: "30px" }}>
        <h1 style={{ fontSize: "28px", marginBottom: "8px" }}>Research Notebook</h1>
        <p style={{ color: "#586474", lineHeight: "1.6" }}>
          An append-only audit trail of every research cycle across every tracked
          hypothesis — prior confidence, new evidence, new confidence, and the
          agent's reasoning for the change.
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
          <div style={{ fontSize: "14px", color: "#7a8593" }}>Loading notebook...</div>
        ) : notebook.length === 0 ? (
          <div style={{ fontSize: "14px", color: "#7a8593" }}>
            No research entries yet. Test a hypothesis on the homepage to start the log.
          </div>
        ) : (
          notebook.map((entry, i) => {
            const prior = entry.confidence - entry.delta;
            return (
              <div
                key={`${entry.timestamp}-${i}`}
                style={{
                  padding: "16px 0",
                  borderTop: i > 0 ? "1px solid #eef1f4" : "none"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    marginBottom: "4px",
                    gap: "12px",
                    flexWrap: "wrap"
                  }}
                >
                  <div style={{ fontSize: "15px", fontWeight: "700", color: "#0B1F3B" }}>
                    {entry.hypothesis}
                  </div>
                  <div style={{ fontSize: "12px", color: "#9aa4b0", flexShrink: 0 }}>
                    {new Date(entry.timestamp).toLocaleString()}
                  </div>
                </div>

                <div style={{ fontSize: "13px", color: "#586474", marginBottom: "6px" }}>
                  Prior confidence: {prior}% · New evidence: {entry.evidenceCount ?? 0} items
                  {entry.evidenceClass === "physical" && (
                    <span
                      style={{
                        marginLeft: "6px",
                        padding: "1px 6px",
                        borderRadius: "999px",
                        fontSize: "11px",
                        fontWeight: "700",
                        background: "#eaf3ff",
                        color: "#0B1F3B"
                      }}
                    >
                      PHYSICAL
                    </span>
                  )}
                  {" · "}New confidence: {entry.confidence}%
                  {entry.delta !== 0 && (
                    <span style={{ color: entry.delta > 0 ? "#1e7d34" : "#a13a2c", fontWeight: "700" }}>
                      {" "}({entry.delta > 0 ? "+" : ""}{entry.delta})
                    </span>
                  )}
                </div>

                {entry.reasoning && (
                  <div style={{ fontSize: "14px", color: "#0B1F3B", lineHeight: "1.6" }}>
                    {entry.reasoning}
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>
    </main>
  );
}
