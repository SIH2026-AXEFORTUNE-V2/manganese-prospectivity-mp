// EvidencePanel — shows why a specific target scored the way it did.
// Ported from dashboard/index.template.html's renderEvidence() function.
// Rule: every number here must come from the target's TargetProperties; nothing is invented.
// The fusion-weights caveat is mandatory copy — don't drop it for looking nicer.

import type { CSSProperties } from "react";
import { TriangleAlert } from "lucide-react";
import GlassCard from "./GlassCard";
import ScoreRing from "./ScoreRing";
import type { TargetProperties } from "@/lib/contract";

export default function EvidencePanel({ target }: { target: TargetProperties }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <ScoreRing value={target.score_mean} size={72} />
        <div>
          <div style={labelStyle}>Target</div>
          <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1 }}>
            #{String(target.rank).padStart(2, "0")}
          </div>
        </div>
      </div>

      {/* Near non-Mn mine warning — surface it, never hide it */}
      {target.near_non_mn_mine && (
        <div
          style={{
            background: "rgba(169, 121, 31, 0.15)",
            border: "1px solid var(--warn)",
            borderRadius: 10,
            padding: "10px 14px",
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
          }}
        >
          <TriangleAlert size={16} color="var(--warn)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--warn)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Near non-Mn mine
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 3 }}>
              An active non-manganese mine sits within the search radius. The anomaly signal
              may partly reflect disturbed ground rather than Mn geology — verify against
              lithology before committing survey resources.
            </div>
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <StatRow label="Centroid" value={`${target.lat.toFixed(5)}° N`} />
        <StatRow label="" value={`${target.lon.toFixed(5)}° E`} />
        <StatRow label="Area" value={`${target.area_ha.toFixed(1)} ha`} />
        <StatRow label="Rank" value={`#${target.rank} of all targets`} />
        <StatRow label="Mean fused score" value={pct(target.score_mean)} accent />
        <StatRow label="Max fused score" value={pct(target.score_max)} />
      </div>

      {/* Score breakdown bar */}
      <div>
        <div style={labelStyle}>Fused score breakdown</div>
        <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginTop: 6 }}>
          <div
            style={{
              width: "70%",
              background: "var(--accent-lime)",
              opacity: 0.9,
            }}
          />
          <div
            style={{
              width: "30%",
              background: "var(--ink-dim)",
              opacity: 0.5,
            }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontSize: 11, color: "var(--ink-dim)" }}>Signature 70%</span>
          <span style={{ fontSize: 11, color: "var(--ink-dim)" }}>Anomaly 30%</span>
        </div>
      </div>

      {/* Mandatory honesty note — from the issue spec, do not remove */}
      <GlassCard style={{ padding: "12px 14px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-dim)", marginBottom: 6 }}>
          Attribution note
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-dim)", lineHeight: 1.6 }}>
          Fusion weights are fixed (signature 0.7 × anomaly 0.3), not per-target. Per-feature
          attribution needs a SHAP pass over the full band stack, which is not yet built.
        </div>
      </GlassCard>
    </div>
  );
}

function StatRow({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      {label && <div style={labelStyle}>{label}</div>}
      <div
        style={{
          fontSize: label ? 15 : 13,
          fontWeight: label ? 600 : 400,
          color: accent ? "var(--accent-lime)" : "var(--ink)",
          fontFamily: "monospace",
          marginTop: label ? 2 : 0,
          // accent-lime only appears inside a chip-dark context per the theme rule —
          // wrap it in a dark pill if the background is light
          ...(accent
            ? {
                display: "inline-block",
                background: "var(--chip-dark)",
                color: "var(--accent-lime)",
                padding: "2px 10px",
                borderRadius: 999,
                fontSize: 13,
              }
            : {}),
        }}
      >
        {value}
      </div>
    </div>
  );
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

const labelStyle: CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--ink-dim)",
};
