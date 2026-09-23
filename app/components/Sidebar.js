"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/*
 * CHANGE THIS if your logo lives somewhere else.
 * Copy the src from the <img> in your old NavBar.js.
 */
const LOGO_SRC =           <Image src="/logo.png" alt="Solid Natural Gas" width={34} height={34} priority />
;

export const SIDEBAR_WIDTH = 260;

export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return isDesktop;
}

const NAV_LINKS = [
  { href: "/", label: "Research" },
  { href: "/hypotheses", label: "Hypotheses" },
  { href: "/flows", label: "LNG Flows" },
  { href: "/notebook", label: "Notebook" }
];

/*
 * Tasks are grouped by category. If an activity entry already has a
 * `category` field (see logActivity in lib/analyze.js), that wins.
 * Otherwise the category is inferred from the message text, so this
 * works with the entries already in KV.
 */
const GROUPS = [
  {
    key: "hypotheses",
    label: "Hypotheses",
    href: "/hypotheses",
    match: /hypothes|confidence|queried live evidence|agent planned|re-evaluat|research cycle|additional evidence/i
  },
  { key: "markets", label: "Markets", href: "/", match: /^\s*markets updated/i },
  { key: "vessels", label: "Vessels", href: "/flows", match: /vessel|carrier|chokepoint|corridor/i }
];

const OTHER_GROUP = { key: "other", label: "Activity", href: null };

function groupFor(entry) {
  if (entry.category) {
    const known = GROUPS.find((g) => g.key === entry.category);
    if (known) return known;
  }
  const message = entry.message || "";
  return GROUPS.find((g) => g.match.test(message)) || OTHER_GROUP;
}

function timeAgoShort(isoString) {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function cleanMessage(message) {
  return (message || "").replace(/^\[Scheduled\]\s*/, "");
}

function SidebarContent({ activity, onNavigate }) {
  const pathname = usePathname();

  const buckets = [...GROUPS, OTHER_GROUP]
    .map((group) => ({
      group,
      entries: activity.filter((entry) => groupFor(entry).key === group.key).slice(0, 6)
    }))
    .filter((bucket) => bucket.entries.length > 0);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#0B1F3B",
        color: "#e2e8f0",
        fontFamily: "Arial, sans-serif"
      }}
    >
      {/* Brand */}
      <Link
        href="/"
        onClick={onNavigate}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "22px 18px 18px",
          textDecoration: "none",
          color: "inherit"
        }}
      >
        <img
          src={LOGO_SRC}
          alt=""
          width={46}
          height={46}
          style={{ borderRadius: "50%", flexShrink: 0 }}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
        <span style={{ fontSize: "21px", fontWeight: "800", lineHeight: "1.15", color: "#ffffff" }}>
          Solid Natural Gas
        </span>
      </Link>

      {/* Shortcuts */}
      <nav style={{ padding: "0 10px 16px" }}>
        {NAV_LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={onNavigate}
              style={{
                display: "block",
                padding: "9px 12px",
                marginBottom: "2px",
                borderRadius: "6px",
                fontSize: "14px",
                fontWeight: active ? "700" : "500",
                textDecoration: "none",
                color: active ? "#ffffff" : "#b6c2d4",
                background: active ? "#17304f" : "transparent"
              }}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      {/* Tasks */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          borderTop: "1px solid #1e2f4d",
          padding: "16px 10px 24px"
        }}
      >
        <div
          style={{
            fontSize: "11px",
            fontWeight: "700",
            letterSpacing: "0.1em",
            color: "#7d8ca6",
            padding: "0 12px 10px"
          }}
        >
          TASKS
        </div>

        {buckets.length === 0 ? (
          <div style={{ fontSize: "13px", color: "#7d8ca6", padding: "0 12px" }}>
            Waiting for the next research cycle...
          </div>
        ) : (
          buckets.map(({ group, entries }) => (
            <div key={group.key} style={{ marginBottom: "18px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  padding: "0 12px 6px"
                }}
              >
                <span style={{ fontSize: "12px", fontWeight: "700", color: "#9fb0c9" }}>
                  {group.label}
                </span>
                <span style={{ fontSize: "11px", color: "#5f7591" }}>{entries.length}</span>
              </div>

              {entries.map((entry, i) => {
                const body = (
                  <>
                    <span
                      style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        color: "#dbe3ee"
                      }}
                    >
                      {cleanMessage(entry.message)}
                    </span>
                    <span style={{ fontSize: "11px", color: "#6b7e99", flexShrink: 0 }}>
                      {timeAgoShort(entry.timestamp)}
                    </span>
                  </>
                );

                const rowStyle = {
                  display: "flex",
                  gap: "8px",
                  justifyContent: "space-between",
                  padding: "7px 12px",
                  borderRadius: "6px",
                  fontSize: "12.5px",
                  lineHeight: "1.4",
                  textDecoration: "none"
                };

                return group.href ? (
                  <Link
                    key={`${entry.timestamp}-${i}`}
                    href={group.href}
                    onClick={onNavigate}
                    style={rowStyle}
                  >
                    {body}
                  </Link>
                ) : (
                  <div key={`${entry.timestamp}-${i}`} style={rowStyle}>
                    {body}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function Sidebar({ activity = [] }) {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);

  if (isDesktop) {
    return (
      <aside
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          width: `${SIDEBAR_WIDTH}px`,
          zIndex: 40
        }}
      >
        <SidebarContent activity={activity} />
      </aside>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        style={{
          position: "fixed",
          top: "12px",
          left: "12px",
          zIndex: 45,
          padding: "10px 14px",
          borderRadius: "8px",
          border: "none",
          background: "#0B1F3B",
          color: "#ffffff",
          fontSize: "16px",
          cursor: "pointer"
        }}
      >
        ☰
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(11,31,59,0.5)",
              zIndex: 49
            }}
          />
          <aside
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              bottom: 0,
              width: `${SIDEBAR_WIDTH}px`,
              zIndex: 50,
              boxShadow: "0 0 24px rgba(0,0,0,0.3)"
            }}
          >
            <SidebarContent activity={activity} onNavigate={() => setOpen(false)} />
          </aside>
        </>
      )}
    </>
  );
}
