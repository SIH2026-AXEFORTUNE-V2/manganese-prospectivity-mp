// Wordmark + workspace switch + theme toggle, echoing the reference's top bar (logo,
// search, avatar). Explore/Protect is a pill toggle here, same pattern as the reference's
// "Junior / Middle / Senior" segmented control - the active segment gets the lime chip.

"use client";

import ThemeToggle from "./ThemeToggle";

export default function TopNav({
  workspace,
  onWorkspaceChange,
}: {
  workspace: "explore" | "protect";
  onWorkspaceChange: (w: "explore" | "protect") => void;
}) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 24px",
        gap: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 20 }}>🧭</span>
        <strong style={{ fontSize: 17, letterSpacing: "0.01em" }}>ORE COMPASS</strong>
      </div>

      <div
        style={{
          display: "flex",
          background: "var(--glass)",
          border: "1px solid var(--glass-border)",
          backdropFilter: "blur(16px)",
          borderRadius: 999,
          padding: 4,
          gap: 4,
        }}
      >
        {(["explore", "protect"] as const).map((w) => (
          <button
            key={w}
            onClick={() => onWorkspaceChange(w)}
            style={{
              border: "none",
              borderRadius: 999,
              padding: "8px 18px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              background: workspace === w ? "var(--accent-lime)" : "transparent",
              color: workspace === w ? "var(--chip-dark)" : "var(--ink)",
            }}
          >
            {w === "explore" ? "Explore" : "Protect"}
          </button>
        ))}
      </div>

      <ThemeToggle />
    </header>
  );
}
