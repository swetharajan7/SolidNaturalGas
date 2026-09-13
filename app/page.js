"use client";

import { useState } from "react";

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
        maxWidth: "850px",
        margin: "60px auto",
        padding: "24px",
        fontFamily: "Arial"
      }}
    >
      <h1>Solid Natural Gas</h1>

      <p>
        Agentic LNG market intelligence that develops,
        challenges and updates hypotheses using live evidence.
      </p>

      <hr />

      <h2>Test a Market Hypothesis</h2>

      <textarea
        value={hypothesis}
        onChange={(e) => setHypothesis(e.target.value)}
        rows={6}
        style={{
          width: "100%",
          padding: "14px",
          fontSize: "16px"
        }}
      />

      <br />

      <button
        onClick={analyze}
        disabled={loading}
        style={{
          marginTop: "15px",
          padding: "12px 22px",
          fontSize: "16px",
          cursor: "pointer"
        }}
      >
        {loading ? "Nemotron is analyzing..." : "Analyze with Nemotron"}
      </button>

      {result && (
        <section
          style={{
            marginTop: "35px",
            whiteSpace: "pre-wrap"
          }}
        >
          <h2>Analysis</h2>
          <p>{result}</p>
        </section>
      )}
    </main>
  );
}
