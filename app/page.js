"use client";

import { useState } from "react";
import Image from "next/image";

export default function Home() {
  const [hypothesis, setHypothesis] = useState(
    "European LNG spot prices will strengthen over the next 30 days."
  );

  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  async function analyze() {
    setLoading(true);
    setResult("");

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
        padding: "40px 24px 80px",
        fontFamily: "Arial, sans-serif"
      }}
    >
      <header
        style={{
          textAlign: "center",
          marginBottom: "35px"
        }}
      >
        <Image
          src="/solid-natural-gas-logo.jpeg"
          alt="Solid Natural Gas"
          width={240}
          height={340}
          priority
          style={{
            width: "200px",
            height: "auto"
          }}
        />

        <p
          style={{
            marginTop: "10px",
            fontSize: "17px",
            color: "#44546a"
          }}
        >
          AI-native global gas intelligence.
        </p>
      </header>

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
