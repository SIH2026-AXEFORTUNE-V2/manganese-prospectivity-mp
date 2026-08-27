"use client";

// The schedule, in full - docs/issues/09-project-workspace-flow.md §4.
// Same forward-looking rule as the suggestion rail: this page shows the plan and the
// calibrated forecast for each day. Actuals live one tab over, on the calendar.

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { CSSProperties } from "react";
import GlassCard from "@/components/GlassCard";
import SuggestionRail from "@/components/SuggestionRail";
import { setProductionTarget, useProject } from "@/lib/projectStore";
import { buildSuggestions } from "@/lib/aiSuggestions";
import { FLAG_LABELS, isoDate } from "@/lib/aiSchedule";
import { forecastTonnes } from "@/lib/forecast";
import type { ProductionTarget } from "@/lib/projectTypes";

export default function ProjectPlanPage() {
  const params = useParams<{ id: string }>();
  const { project } = useProject(params?.id ?? null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);

  const suggestions = useMemo(() => (project ? buildSuggestions(project) : []), [project]);
  if (!project) return null;

  const totalPlanned = project.plan.reduce((s, d) => s + d.plannedTonnes, 0);
  const flaggedDays = project.plan.filter((d) => d.flags.length > 0).length;

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        {!project.target || editing ? (
          <TargetForm
            initial={project.target}
            onCancel={project.target ? () => setEditing(false) : undefined}
            onSave={(t) => {
              setProductionTarget(project.id, t);
              setEditing(false);
            }}
          />
        ) : (
          <GlassCard style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Schedule</h2>
              <button type="button" onClick={() => setEditing(true)} style={smallBtn}>
                Change target
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
              <Stat label="Target" value={`${project.target.tonnes.toLocaleString()} t`} />
              <Stat label="Grade" value={`${project.target.gradePct}% Mn`} />
              <Stat label="Period" value={`${project.plan.length} days`} />
              <Stat label="Planned total" value={`${totalPlanned.toLocaleString()} t`} />
              <Stat label="Flagged days" value={String(flaggedDays)} />
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "var(--ink-dim)", lineHeight: 1.55 }}>
              Tonnage is spread in proportion to each day&rsquo;s usable capacity — a monsoon day carries
              60% of a clear day, a maintenance day 50%, a Sunday 35% — so the period still totals the
              target instead of assuming every day is identical. Those are planning allowances; the
              learned correction from your own logs is applied separately, in the forecast column.
            </p>
          </GlassCard>
        )}

        {project.plan.length > 0 && (
          <GlassCard style={{ padding: 18, overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%", minWidth: 640 }}>
              <thead>
                <tr>
                  {["Date", "Bench", "Planned", "Depth", "Forecast", "Flags"].map((h) => (
                    <th key={h} style={thStyle}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {project.plan.map((d) => {
                  const f = forecastTonnes(d, project.calibration);
                  const delta = f - d.plannedTonnes;
                  return (
                    <tr key={d.date}>
                      <td style={{ ...tdStyle, fontFamily: "monospace" }}>{d.date}</td>
                      <td style={tdStyle}>{d.bench}</td>
                      <td style={{ ...tdStyle, fontFamily: "monospace" }}>{d.plannedTonnes.toLocaleString()} t</td>
                      <td style={{ ...tdStyle, fontFamily: "monospace" }}>{d.plannedDepthM} m</td>
                      <td style={{ ...tdStyle, fontFamily: "monospace" }}>
                        {project.calibration.n > 0 ? (
                          <>
                            {f.toLocaleString()} t{" "}
                            <span style={{ color: delta < 0 ? "var(--critical)" : "var(--good)", fontSize: 11 }}>
                              ({delta >= 0 ? "+" : ""}
                              {delta})
                            </span>
                          </>
                        ) : (
                          <span style={{ color: "var(--ink-dim)" }}>—</span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        {d.flags.length === 0 ? (
                          <span style={{ color: "var(--ink-dim)" }}>—</span>
                        ) : (
                          <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                            {d.flags.map((fl) => (
                              <span
                                key={fl.kind}
                                title={fl.note}
                                style={{
                                  fontSize: 10.5,
                                  padding: "2px 8px",
                                  borderRadius: 999,
                                  border: "1px solid var(--warn)",
                                  color: "var(--warn)",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {FLAG_LABELS[fl.kind]}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </GlassCard>
        )}
      </div>

      <SuggestionRail
        suggestions={suggestions}
        collapsed={railCollapsed}
        onToggle={() => setRailCollapsed((c) => !c)}
      />
    </div>
  );
}

function TargetForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: ProductionTarget | null;
  onSave: (t: ProductionTarget) => void;
  onCancel?: () => void;
}) {
  const [tonnes, setTonnes] = useState(String(initial?.tonnes ?? 12000));
  const [gradePct, setGradePct] = useState(String(initial?.gradePct ?? 34));
  const [periodStart, setPeriodStart] = useState(initial?.periodStart ?? isoDate(new Date()));
  const [periodDays, setPeriodDays] = useState(String(initial?.periodDays ?? 26));
  const [benches, setBenches] = useState((initial?.benches ?? ["Bench 2", "Bench 3"]).join(", "));

  return (
    <GlassCard style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
          {initial ? "Change the production target" : "Set a production target"}
        </h2>
        <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink-dim)", lineHeight: 1.55 }}>
          Saving regenerates the schedule. Day logs are keyed by date and survive — days that fall
          outside the new period simply stop pairing with a plan.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <label style={labelStyle}>
          Target tonnes
          <input type="number" value={tonnes} onChange={(e) => setTonnes(e.target.value)} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Grade (% Mn)
          <input type="number" value={gradePct} onChange={(e) => setGradePct(e.target.value)} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Starts
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Days
          <input type="number" value={periodDays} onChange={(e) => setPeriodDays(e.target.value)} style={inputStyle} />
        </label>
      </div>
      <label style={labelStyle}>
        Benches (comma separated)
        <input value={benches} onChange={(e) => setBenches(e.target.value)} style={inputStyle} />
      </label>
      <div style={{ display: "flex", gap: 10 }}>
        <button
          type="button"
          onClick={() =>
            onSave({
              tonnes: Number(tonnes) || 0,
              gradePct: Number(gradePct) || 0,
              periodStart,
              periodDays: Number(periodDays) || 26,
              benches: benches.split(",").map((b) => b.trim()).filter(Boolean),
            })
          }
          style={primaryBtn}
        >
          {initial ? "Save & regenerate schedule" : "Generate schedule"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} style={smallBtn}>
            Cancel
          </button>
        )}
      </div>
    </GlassCard>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-dim)" }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "monospace" }}>{value}</div>
    </div>
  );
}

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 5,
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--ink-dim)",
};

const inputStyle: CSSProperties = {
  background: "var(--glass)",
  border: "1px solid var(--glass-border)",
  borderRadius: 9,
  padding: "9px 11px",
  fontSize: 13.5,
  color: "var(--ink)",
  fontWeight: 400,
  width: "100%",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "6px 14px 6px 0",
  borderBottom: "1px solid var(--rule)",
  color: "var(--ink-dim)",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "7px 14px 7px 0",
  borderBottom: "1px solid var(--rule)",
};

const smallBtn: CSSProperties = {
  background: "var(--glass)",
  border: "1px solid var(--glass-border)",
  borderRadius: 999,
  padding: "7px 14px",
  fontSize: 12,
  color: "var(--ink)",
  cursor: "pointer",
};

const primaryBtn: CSSProperties = {
  background: "var(--accent-lime)",
  color: "var(--chip-dark)",
  border: "none",
  borderRadius: 999,
  padding: "10px 20px",
  fontSize: 13.5,
  fontWeight: 700,
  cursor: "pointer",
};
