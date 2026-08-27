"use client";

// End-of-day entry - docs/issues/09-project-workspace-flow.md §5.
//
// Every field the model reads is enumerated or numeric. The one free-text box is labelled as
// human-only and nothing downstream parses it. This is the single most important design
// decision in the whole loop: this project's own data audit already found that an ungoverned
// field (the fabricated `manganese_present` label) produces a model that looks fine on a
// dashboard and has learned nothing. A dropdown plus a machine id costs the same fifteen
// seconds to fill and is the difference between retraining and theatre.

import { useState } from "react";
import type { CSSProperties } from "react";
import GlassCard from "./GlassCard";
import { FLAG_LABELS, tonnesToAdvanceM } from "@/lib/aiSchedule";
import { explainVariance } from "@/lib/forecast";
import {
  DELAY_REASONS,
  DELAY_REASON_LABELS,
  SURPLUS_CAUSE_LABELS,
  type Calibration,
  type DayLog,
  type DelayEvent,
  type PlanDay,
  type SurplusCause,
} from "@/lib/projectTypes";

function blankDelay(bench: string): DelayEvent {
  return { reason: "equipment_breakdown", machineId: "", bench, startHour: 18, endHour: 21 };
}

export default function DayLogForm({
  planDay,
  existing,
  calibration,
  onSave,
  onDelete,
  onClose,
}: {
  planDay: PlanDay;
  existing: DayLog | null;
  calibration: Calibration;
  onSave: (log: DayLog) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  // Seeded from the day's existing log, once. The caller keys this component by date, so
  // selecting another day remounts it rather than syncing props into state in an effect -
  // that keeps one day's numbers from ever appearing under another day's heading.
  const [tonnes, setTonnes] = useState<string>(existing ? String(existing.actualTonnes) : "");
  const [grade, setGrade] = useState<string>(existing ? String(existing.actualGradePct) : "");
  const [delays, setDelays] = useState<DelayEvent[]>(
    existing ? existing.delays.map((d) => ({ ...d })) : [],
  );
  const [surplus, setSurplus] = useState<SurplusCause | "">(existing?.surplusCause ?? "");
  const [note, setNote] = useState<string>(existing?.note ?? "");

  const actual = Number(tonnes);
  const hasActual = tonnes.trim() !== "" && Number.isFinite(actual);
  const isSurplus = hasActual && actual > planDay.plannedTonnes * 1.02;

  const preview: DayLog | null = hasActual
    ? {
        date: planDay.date,
        actualTonnes: actual,
        actualGradePct: Number(grade) || 0,
        delays: delays.filter((d) => d.endHour > d.startHour),
        surplusCause: isSurplus && surplus ? surplus : undefined,
        note: note.trim() || undefined,
        loggedAt: new Date().toISOString(),
        source: "manual",
      }
    : null;
  const variance = preview ? explainVariance(planDay, preview, calibration) : null;

  return (
    <GlassCard style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-dim)" }}>
            Day log
          </div>
          <h3 style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 700 }}>{planDay.date}</h3>
          <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
            Plan: {planDay.plannedTonnes.toLocaleString()} t · {planDay.bench} · {planDay.plannedDepthM} m advance
          </div>
          {planDay.flags.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              {planDay.flags.map((f) => (
                <span key={f.kind} title={f.note} style={{ ...pill, color: "var(--warn)", border: "1px solid var(--warn)" }}>
                  {FLAG_LABELS[f.kind]}
                </span>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={onClose} style={iconBtn} aria-label="Close day log">
          ×
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label style={labelStyle}>
          Tonnes obtained
          <input
            type="number"
            inputMode="decimal"
            value={tonnes}
            onChange={(e) => setTonnes(e.target.value)}
            placeholder={String(planDay.plannedTonnes)}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Grade obtained (% Mn)
          <input
            type="number"
            inputMode="decimal"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            placeholder="33.0"
            style={inputStyle}
          />
        </label>
      </div>

      {hasActual && (
        <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>
          That is {tonnesToAdvanceM(actual)} m of bench advance against {planDay.plannedDepthM} m planned.
        </div>
      )}

      {/* --- delays: the enumerated part ------------------------------------------ */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Delays / downtime</span>
          <button type="button" onClick={() => setDelays((d) => [...d, blankDelay(planDay.bench)])} style={smallBtn}>
            + Add event
          </button>
        </div>

        {delays.length === 0 && (
          <div style={{ fontSize: 11.5, color: "var(--ink-dim)" }}>
            No delay events logged for this day.
          </div>
        )}

        {delays.map((d, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 1fr 0.7fr 0.7fr auto",
              gap: 6,
              alignItems: "end",
              border: "1px solid var(--rule)",
              borderRadius: 10,
              padding: 8,
            }}
          >
            <label style={labelStyle}>
              Reason
              <select
                value={d.reason}
                onChange={(e) =>
                  setDelays((prev) => prev.map((x, j) => (j === i ? { ...x, reason: e.target.value as DelayEvent["reason"] } : x)))
                }
                style={inputStyle}
              >
                {DELAY_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {DELAY_REASON_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              Machine id
              <input
                value={d.machineId}
                onChange={(e) =>
                  setDelays((prev) => prev.map((x, j) => (j === i ? { ...x, machineId: e.target.value } : x)))
                }
                placeholder="EX-204"
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              From
              <input
                type="number"
                min={0}
                max={24}
                value={d.startHour}
                onChange={(e) =>
                  setDelays((prev) => prev.map((x, j) => (j === i ? { ...x, startHour: Number(e.target.value) } : x)))
                }
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              To
              <input
                type="number"
                min={0}
                max={24}
                value={d.endHour}
                onChange={(e) =>
                  setDelays((prev) => prev.map((x, j) => (j === i ? { ...x, endHour: Number(e.target.value) } : x)))
                }
                style={inputStyle}
              />
            </label>
            <button
              type="button"
              onClick={() => setDelays((prev) => prev.filter((_, j) => j !== i))}
              style={iconBtn}
              aria-label="Remove delay event"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* --- surplus is its own question, not negative shortfall ------------------- */}
      {isSurplus && (
        <label style={{ ...labelStyle, border: "1px solid var(--good)", borderRadius: 10, padding: 10 }}>
          Over plan by {Math.round(actual - planDay.plannedTonnes).toLocaleString()} t — why?
          <select value={surplus} onChange={(e) => setSurplus(e.target.value as SurplusCause)} style={inputStyle}>
            <option value="">Select a cause…</option>
            {(Object.keys(SURPLUS_CAUSE_LABELS) as SurplusCause[]).map((c) => (
              <option key={c} value={c}>
                {SURPLUS_CAUSE_LABELS[c]}
              </option>
            ))}
          </select>
          <span style={{ fontSize: 11, color: "var(--ink-dim)", fontWeight: 400 }}>
            &ldquo;Zone richer than modelled&rdquo; is a reserve-model signal; the other causes are one-offs
            that only the production forecast should see. They are not the same event.
          </span>
        </label>
      )}

      <label style={labelStyle}>
        Note (people only — not a model input)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Anything the fields above can't hold."
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </label>

      {variance && (
        <div
          style={{
            borderLeft: `2px solid ${variance.direction === "short" ? "var(--critical)" : variance.direction === "over" ? "var(--good)" : "var(--ink-dim)"}`,
            paddingLeft: 10,
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <strong>
            {variance.deltaTonnes >= 0 ? "+" : ""}
            {variance.deltaTonnes} t ({variance.deltaPct >= 0 ? "+" : ""}
            {variance.deltaPct}%) vs plan
          </strong>
          {variance.attributions.length > 0 && (
            <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
              {variance.attributions.map((a, i) => (
                <li key={i} style={{ color: "var(--ink-dim)" }}>
                  {DELAY_REASON_LABELS[a.reason]} {a.hours}h on {a.machineId || "unspecified"} ≈ {a.tonnes} t
                </li>
              ))}
            </ul>
          )}
          {variance.unexplainedTonnes > 0 && (
            <div style={{ color: "var(--warn)", marginTop: 4 }}>
              {variance.unexplainedTonnes} t of the shortfall is not accounted for by any logged event.
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          disabled={!preview}
          onClick={() => preview && onSave(preview)}
          style={{ ...primaryBtn, opacity: preview ? 1 : 0.45, cursor: preview ? "pointer" : "not-allowed" }}
        >
          {existing ? "Update day & retrain" : "Save day & retrain"}
        </button>
        {existing && (
          <button type="button" onClick={onDelete} style={smallBtn}>
            Delete entry
          </button>
        )}
        <span style={{ fontSize: 11, color: "var(--ink-dim)", marginLeft: "auto" }}>
          Saving refits the production forecast immediately.
        </span>
      </div>
    </GlassCard>
  );
}

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--ink-dim)",
};

const inputStyle: CSSProperties = {
  background: "var(--glass)",
  border: "1px solid var(--glass-border)",
  borderRadius: 8,
  padding: "7px 9px",
  fontSize: 13,
  color: "var(--ink)",
  fontWeight: 400,
  width: "100%",
};

const pill: CSSProperties = {
  fontSize: 10.5,
  padding: "2px 8px",
  borderRadius: 999,
};

const smallBtn: CSSProperties = {
  background: "var(--glass)",
  border: "1px solid var(--glass-border)",
  borderRadius: 999,
  padding: "5px 12px",
  fontSize: 11.5,
  color: "var(--ink)",
  cursor: "pointer",
};

const primaryBtn: CSSProperties = {
  background: "var(--accent-lime)",
  color: "var(--chip-dark)",
  border: "none",
  borderRadius: 999,
  padding: "9px 18px",
  fontSize: 13,
  fontWeight: 700,
};

const iconBtn: CSSProperties = {
  background: "none",
  border: "1px solid var(--glass-border)",
  borderRadius: 8,
  width: 28,
  height: 28,
  cursor: "pointer",
  color: "var(--ink-dim)",
  fontSize: 16,
  lineHeight: 1,
};
