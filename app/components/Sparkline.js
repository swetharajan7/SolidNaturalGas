"use client";

export default function Sparkline({ data, width = 100, height = 32 }) {
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
