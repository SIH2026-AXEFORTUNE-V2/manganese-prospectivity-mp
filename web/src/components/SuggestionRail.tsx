"use client";

// The AI Suggestions rail - docs/issues/09-project-workspace-flow.md §4.
//
// Forward-looking only, by construction: it renders whatever buildSuggestions() returns, and
// that function is not allowed to read a DayLog's outcome as a result to report. Do not add
// "yesterday came in 40 t short" here - that belongs on the calendar. Once this rail mixes
// recommendations with results, nobody can tell which is which at a glance, which is the one
// thing it exists to make obvious.

import GlassCard from "./GlassCard";
import type { Suggestion } from "@/lib/aiSuggestions";

function toneColor(tone: Suggestion["tone"]): string {
  return tone === "warn" ? "var(--warn)" : tone === "good" ? "var(--good)" : "var(--ink-dim)";
}

export default function SuggestionRail({
  suggestions,
  collapsed,
  onToggle,
}: {
  suggestions: Suggestion[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  if (collapsed) {
    return (
      <button type="button" onClick={onToggle} style={collapsedBtn}>
        <span style={{ writingMode: "vertical-rl", letterSpacing: "0.12em", fontSize: 12, fontWeight: 700 }}>
          VIEW AI SUGGESTIONS ({suggestions.length})
        </span>
      </button>
    );
  }

  return (
    <GlassCard
      style={{
        width: 320,
        flex: "0 0 320px",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        maxHeight: "100%",
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-dim)" }}>
            AI Suggestions
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>The plan ahead — not results</div>
        </div>
        <button type="button" onClick={onToggle} style={hideBtn} aria-label="Collapse suggestions">
          ›
        </button>
      </div>

      {suggestions.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>
          Nothing to suggest yet — add a production target or an AOI with ranked zones.
        </div>
      )}

      {suggestions.map((s) => (
        <div
          key={s.id}
          style={{
            borderLeft: `2px solid ${toneColor(s.tone)}`,
            paddingLeft: 10,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{s.title}</div>
          <div style={{ fontSize: 12, color: "var(--ink)", opacity: 0.85, lineHeight: 1.45 }}>{s.detail}</div>
          <div style={{ fontSize: 10.5, color: "var(--ink-dim)", lineHeight: 1.4, fontStyle: "italic" }}>
            {s.basis}
          </div>
        </div>
      ))}
    </GlassCard>
  );
}

const collapsedBtn: React.CSSProperties = {
  flex: "0 0 40px",
  width: 40,
  background: "var(--glass)",
  border: "1px solid var(--glass-border)",
  borderRadius: 16,
  cursor: "pointer",
  color: "var(--ink)",
  display: "grid",
  placeItems: "center",
  padding: "16px 0",
};

const hideBtn: React.CSSProperties = {
  background: "none",
  border: "1px solid var(--glass-border)",
  borderRadius: 8,
  width: 26,
  height: 26,
  cursor: "pointer",
  color: "var(--ink-dim)",
  fontSize: 16,
  lineHeight: 1,
};
