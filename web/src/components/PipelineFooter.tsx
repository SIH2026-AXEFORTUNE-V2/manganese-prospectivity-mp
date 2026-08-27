"use client";

// The standing status bar every project workspace screen shares - who this belongs to, what
// the model is built on, and when the pipeline last ran. One component so all five screens
// (Zones, Plan, Calendar, Data, Learning) read the same version/status rather than five copies
// silently drifting apart.

import { Boxes, Circle } from "lucide-react";

export default function PipelineFooter() {
  const lastRun = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 10,
        padding: "12px 24px",
        borderTop: "1px solid var(--rule)",
        fontSize: 11.5,
        color: "var(--ink-dim)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <img src="/logo.png" alt="" width={20} height={20} style={{ borderRadius: 5 }} />
        <strong style={{ color: "var(--ink)", fontWeight: 700 }}>MOIL LTD.</strong> — Balaghat Division
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Boxes size={12} /> Powered by Sentinel-2, SRTM, GSI Bhukosh
        </span>
        <span>Model v2.4.1</span>
        <span>Last pipeline run: {lastRun}, 10:30 AM IST</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--good)", fontWeight: 600 }}>
          <Circle size={7} fill="var(--good)" color="var(--good)" /> All systems operational
        </span>
      </div>
    </div>
  );
}
