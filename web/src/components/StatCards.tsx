// The floating glass widgets top-right of the map, standing in for the reference's
// "Candidates Online / Orion Index / Vacancies" cards. Every number here reads straight
// from data/validation.json (src/validate/score.py's output) - never invent a figure; if
// a field is missing, show "—" rather than guess.

import GlassCard from "./GlassCard";
import type { ValidationReport } from "@/lib/contract";

function fmt(v: number | undefined, digits = 1): string {
  return typeof v === "number" ? v.toFixed(digits) : "—";
}

// Same derivation the old static dashboard used (dashboard/index.template.html) - the
// report has one negatives_pct per leave-one-cluster-out fold, not a single top-line figure.
// Exported so the Validation panel (docs/issues/03-evidence-validation-panels.md) reuses this
// instead of recomputing it - there should be exactly one place this average is derived.
export function negativeControlsMean(validation: ValidationReport): number | undefined {
  const loco = validation.loco;
  if (!loco || loco.length === 0) return undefined;
  return loco.reduce((sum, fold) => sum + fold.negatives_pct, 0) / loco.length;
}

export default function StatCards({ validation }: { validation: ValidationReport }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <GlassCard style={{ padding: "16px 18px" }}>
        <div style={statLabel}>Held-out percentile</div>
        <div style={statValue}>
          {fmt(validation.heldout_pct_mean)}
          <span style={{ fontSize: 13, color: "var(--ink-dim)", fontWeight: 400 }}>
            {" "}
            ± {fmt(validation.heldout_pct_sd)} · 50 = chance
          </span>
        </div>
      </GlassCard>
      <GlassCard style={{ padding: "16px 18px" }}>
        <div style={statLabel}>Negative controls</div>
        <div style={statValue}>{fmt(negativeControlsMean(validation))}</div>
      </GlassCard>
      <GlassCard style={{ padding: "16px 18px" }}>
        <div style={statLabel}>Random-location null</div>
        <div style={statValue}>p {fmt(validation.permutation_p, 3)}</div>
      </GlassCard>
    </div>
  );
}

const statLabel = {
  fontSize: 11,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  color: "var(--ink-dim)",
  marginBottom: 6,
};

const statValue = {
  fontSize: 24,
  fontWeight: 700,
};
