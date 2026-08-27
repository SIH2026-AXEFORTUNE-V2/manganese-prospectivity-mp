// ValidationPanel — shows why the model should be trusted.
// Ported from dashboard/index.template.html's renderValidation() function.
// Rule: every number must come from the ValidationReport; never recompute what the report
// already contains. Import negativeControlsMean from StatCards — one source of truth.

import type { CSSProperties } from "react";
import GlassCard from "./GlassCard";
import type { ValidationReport } from "@/lib/contract";
import { negativeControlsMean } from "./StatCards";

interface CaptureRow {
  label: string;
  top5: number;
  top10: number;
  top20: number;
  isChance?: boolean;
  isBold?: boolean;
}

export default function ValidationPanel({
  validation,
}: {
  validation: ValidationReport;
}) {
  const negCtrl = negativeControlsMean(validation);

  // Lift = top20 / 20 (chance baseline), computed client-side same as old dashboard's capRows
  function lift(top20: number): string {
    return `${(top20 / 20).toFixed(1)}×`;
  }

  const captureRows: CaptureRow[] = [
    {
      label: "Signature",
      top5: validation.capture_signature?.top5 ?? 0,
      top10: validation.capture_signature?.top10 ?? 0,
      top20: validation.capture_signature?.top20 ?? 0,
    },
    {
      label: "Anomaly",
      top5: validation.capture_anomaly?.top5 ?? 0,
      top10: validation.capture_anomaly?.top10 ?? 0,
      top20: validation.capture_anomaly?.top20 ?? 0,
    },
    {
      label: "Fused",
      top5: validation.capture_fused?.top5 ?? 0,
      top10: validation.capture_fused?.top10 ?? 0,
      top20: validation.capture_fused?.top20 ?? 0,
      isBold: true,
    },
    {
      label: "Chance",
      top5: 5,
      top10: 10,
      top20: 20,
      isChance: true,
    },
  ];

  const droppedCount = Array.isArray(validation.dropped)
    ? validation.dropped.length
    : "—";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Summary chips row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Chip
          label="Held-out percentile"
          value={
            typeof validation.heldout_pct_mean === "number"
              ? `${validation.heldout_pct_mean.toFixed(1)} ± ${(validation.heldout_pct_sd ?? 0).toFixed(1)}`
              : "—"
          }
          sub="50 = chance"
        />
        <Chip
          label="Negative controls"
          value={typeof negCtrl === "number" ? negCtrl.toFixed(1) : "—"}
          sub="50 = chance"
        />
        <Chip
          label="Permutation p"
          value={
            typeof validation.permutation_p === "number"
              ? `p = ${validation.permutation_p.toFixed(3)}`
              : "—"
          }
        />
        <Chip
          label="Features"
          value={`${validation.n_features ?? "—"}`}
          sub={`${droppedCount} dropped (collinear)`}
        />
      </div>

      {/* LOCO bars */}
      <div>
        <div style={sectionLabel}>Leave-one-cluster-out (LOCO)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
          {(validation.loco ?? []).map((fold) => (
            <div key={fold.held_out_cluster}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 4,
                  fontSize: 12,
                }}
              >
                <span style={{ fontWeight: 600, textTransform: "capitalize" }}>
                  {fold.held_out_cluster}
                </span>
                <span style={{ color: "var(--ink-dim)", fontFamily: "monospace" }}>
                  {fold.heldout_pct.toFixed(1)}%
                  <span style={{ opacity: 0.55, marginLeft: 8 }}>
                    (neg: {fold.negatives_pct.toFixed(1)}%)
                  </span>
                </span>
              </div>
              {/* Bar track */}
              <div
                style={{
                  position: "relative",
                  height: 10,
                  borderRadius: 5,
                  background: "var(--rule)",
                  overflow: "visible",
                }}
              >
                {/* Held-out bar */}
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    height: "100%",
                    width: `${fold.heldout_pct}%`,
                    borderRadius: 5,
                    background: "var(--accent-lime)",
                    opacity: 0.85,
                    transition: "width 0.4s ease",
                  }}
                />
                {/* Negative-control reference tick */}
                <div
                  style={{
                    position: "absolute",
                    top: -3,
                    left: `${fold.negatives_pct}%`,
                    width: 2,
                    height: 16,
                    background: "var(--ink-dim)",
                    borderRadius: 1,
                    opacity: 0.6,
                  }}
                  title={`Negative controls: ${fold.negatives_pct.toFixed(1)}%`}
                />
                {/* 50% chance baseline tick */}
                <div
                  style={{
                    position: "absolute",
                    top: -3,
                    left: "50%",
                    width: 1,
                    height: 16,
                    background: "var(--warn)",
                    opacity: 0.5,
                    borderRadius: 1,
                  }}
                  title="50% = chance baseline"
                />
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
          <Legend color="var(--accent-lime)" label="Held-out" />
          <Legend color="var(--ink-dim)" label="Neg. controls" />
          <Legend color="var(--warn)" label="Chance (50%)" />
        </div>
      </div>

      {/* Capture-efficiency table */}
      <div>
        <div style={sectionLabel}>Capture efficiency</div>
        <div
          style={{
            overflowX: "auto",
            marginTop: 10,
            borderRadius: 10,
            border: "1px solid var(--glass-border)",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12,
              fontFamily: "monospace",
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid var(--rule)" }}>
                {["Tier", "Top-5%", "Top-10%", "Top-20%", "Lift@20"].map(
                  (h) => (
                    <th
                      key={h}
                      style={{
                        padding: "8px 12px",
                        textAlign: h === "Tier" ? "left" : "right",
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        color: "var(--ink-dim)",
                        fontWeight: 600,
                      }}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {captureRows.map((row) => (
                <tr
                  key={row.label}
                  style={{
                    borderBottom: "1px solid var(--rule)",
                    opacity: row.isChance ? 0.55 : 1,
                    fontWeight: row.isBold ? 700 : 400,
                  }}
                >
                  <td style={{ padding: "8px 12px", color: "var(--ink)" }}>
                    {row.label}
                    {row.isBold && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 10,
                          padding: "1px 6px",
                          borderRadius: 999,
                          background: "var(--chip-dark)",
                          color: "var(--accent-lime)",
                        }}
                      >
                        best
                      </span>
                    )}
                  </td>
                  <td style={numCell}>{row.top5.toFixed(1)}%</td>
                  <td style={numCell}>{row.top10.toFixed(1)}%</td>
                  <td style={numCell}>{row.top20.toFixed(1)}%</td>
                  <td
                    style={{
                      ...numCell,
                      color: row.isChance
                        ? "var(--ink-dim)"
                        : row.isBold
                          ? "var(--accent-lime)"
                          : "var(--ink)",
                      ...(row.isBold
                        ? {
                            background: "var(--chip-dark)",
                            borderRadius: 6,
                          }
                        : {}),
                    }}
                  >
                    {lift(row.top20)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 8, lineHeight: 1.5 }}>
          Lift = % of known occurrences captured ÷ % of area searched. Fused score
          captures {(validation.capture_fused?.top20 ?? 0).toFixed(1)}% of known occurrences
          in the top 20% of predicted area.
        </div>
      </div>

      {/* Dropped features detail */}
      {Array.isArray(validation.dropped) && validation.dropped.length > 0 && (
        <GlassCard style={{ padding: "12px 14px" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--ink-dim)",
              marginBottom: 8,
            }}
          >
            Dropped for collinearity (r &gt; 0.95)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {validation.dropped.map((d) => (
              <span
                key={d.dropped}
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "var(--rule)",
                  color: "var(--ink-dim)",
                  fontFamily: "monospace",
                }}
                title={`Kept: ${d.kept} (r=${d.r.toFixed(3)})`}
              >
                {d.dropped}
              </span>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  );
}

function Chip({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        background: "var(--glass)",
        border: "1px solid var(--glass-border)",
        backdropFilter: "blur(12px)",
        borderRadius: 10,
        padding: "10px 14px",
        minWidth: 110,
      }}
    >
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-dim)", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace" }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 10, color: "var(--ink-dim)", marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--ink-dim)" }}>
      <div style={{ width: 10, height: 10, borderRadius: 2, background: color, opacity: 0.8 }} />
      {label}
    </div>
  );
}

const sectionLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--ink-dim)",
};

const numCell: CSSProperties = {
  padding: "8px 12px",
  textAlign: "right",
  color: "var(--ink)",
};
