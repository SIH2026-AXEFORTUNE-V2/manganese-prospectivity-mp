// The horizontal scrolling row of ranked-target cards, echoing the job-card rail in the UI
// reference: one card per target, a ScoreRing standing in for their "match %".

import type { CSSProperties } from "react";
import GlassCard from "./GlassCard";
import ScoreRing from "./ScoreRing";
import type { FeatureCollectionLike, TargetProperties } from "@/lib/contract";

function scoreBand(score: number): string {
  if (score >= 0.75) return "Strong signal";
  if (score >= 0.6) return "Worth a look";
  return "Marginal";
}

export default function TargetRail({ targets }: { targets: FeatureCollectionLike }) {
  const sorted = [...targets.features]
    .map((f) => f.properties as unknown as TargetProperties)
    .sort((a, b) => a.rank - b.rank);

  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        overflowX: "auto",
        padding: "2px 2px 10px",
      }}
    >
      {sorted.map((t) => (
        <GlassCard
          key={t.rank}
          style={{
            flex: "0 0 auto",
            width: 220,
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--ink-dim)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Target #{String(t.rank).padStart(2, "0")}
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-dim)", fontFamily: "monospace", marginTop: 4 }}>
                {t.lat.toFixed(3)}, {t.lon.toFixed(3)}
              </div>
            </div>
            <ScoreRing value={t.score_mean} size={56} />
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span style={pillStyle}>{t.area_ha.toFixed(0)} ha</span>
            <span style={pillStyle}>{scoreBand(t.score_mean)}</span>
            {t.near_non_mn_mine && (
              <span style={{ ...pillStyle, color: "var(--warn)" }}>near non-Mn mine</span>
            )}
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

const pillStyle: CSSProperties = {
  fontSize: 11,
  padding: "3px 9px",
  borderRadius: 999,
  background: "var(--chip-dark)",
  color: "var(--chip-dark-ink)",
};
