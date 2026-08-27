import type { RiskEntry } from "@/lib/contract";
import GlassCard from "./GlassCard";
import RiskRibbon from "./RiskRibbon";

export default function MinePortfolioGrid({ mines }: { mines: RiskEntry[] }) {
  if (!mines || mines.length === 0) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
        gap: 16,
        width: "100%",
      }}
    >
      {mines.map((mine) => (
        <MineTile key={mine.mine_id} mine={mine} />
      ))}
    </div>
  );
}

function MineTile({ mine }: { mine: RiskEntry }) {
  const isNormal = mine.risk_tier === "normal";
  const badgeColor =
    mine.risk_tier === "normal"
      ? "var(--good)"
      : mine.risk_tier === "watch"
        ? "var(--warn)"
        : "var(--critical)";

  return (
    <GlassCard style={{ padding: "16px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "var(--ink)" }}>{mine.name}</h3>
          <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
            {mine.mine_type} &middot; {mine.depth_m ? `${mine.depth_m}m depth` : "Surface"}
          </div>
        </div>
        <div
          style={{
            background: "var(--chip-dark)",
            color: badgeColor,
            padding: "4px 10px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {mine.risk_tier}
        </div>
      </div>

      {!isNormal && mine.risk_reasons.length > 0 && (
        <div
          style={{
            fontSize: 12,
            color: badgeColor,
            background: `color-mix(in srgb, ${badgeColor} 15%, transparent)`,
            padding: "8px 12px",
            borderRadius: 8,
            marginBottom: 12,
            lineHeight: 1.4,
            fontWeight: 500,
          }}
        >
          {mine.risk_reasons.map((r, i) => (
            <div key={i}>{r}</div>
          ))}
        </div>
      )}

      <RiskRibbon series={mine.series} />
    </GlassCard>
  );
}
