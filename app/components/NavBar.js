"use client";

import Image from "next/image";
import Link from "next/link";

export default function NavBar() {
  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "14px",
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

      <div style={{ display: "flex", gap: "22px", alignItems: "center" }}>
        <Link href="/hypotheses" style={{ fontSize: "14px", color: "#586474", textDecoration: "none", fontWeight: "600" }}>
          Hypotheses
        </Link>
        <Link href="/flows" style={{ fontSize: "14px", color: "#586474", textDecoration: "none", fontWeight: "600" }}>
          LNG Flows
        </Link>
        <Link href="/notebook" style={{ fontSize: "14px", color: "#586474", textDecoration: "none", fontWeight: "600" }}>
          Notebook
        </Link>
      </div>
    </nav>
  );
}
