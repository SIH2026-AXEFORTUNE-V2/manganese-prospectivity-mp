"use client";

// Planned vs. actual, one cell per day - docs/issues/09-project-workspace-flow.md §5.
//
// The cell shows three things in a fixed order: what was planned, what came out, and the
// gap with its reason attached. That order matters - a planner reading the month should be
// able to scan the third line alone and see where the period went.

import { CloudRain, Wrench, Zap, Clock3 } from "lucide-react";
import GlassCard from "./GlassCard";
import { FLAG_LABELS, parseIsoDate } from "@/lib/aiSchedule";
import { explainVariance, forecastTonnes } from "@/lib/forecast";
import { DELAY_REASON_LABELS, type Calibration, type DayLog, type PlanDay } from "@/lib/projectTypes";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday-first column index, so the two weekend columns sit together at the right. */
function columnOf(iso: string): number {
  return (parseIsoDate(iso).getDay() + 6) % 7;
}

const FLAG_ICON: Record<PlanDay["flags"][number]["kind"], typeof CloudRain> = {
  monsoon: CloudRain,
  maintenance: Wrench,
  blast_window: Zap,
  rest_day: Clock3,
};

export default function PlanCalendar({
  plan,
  logs,
  calibration,
  selectedDate,
  onSelectDate,
}: {
  plan: PlanDay[];
  logs: Record<string, DayLog>;
  calibration: Calibration;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}) {
  if (plan.length === 0) {
    return (
      <GlassCard style={{ padding: 24, fontSize: 13, color: "var(--ink-dim)" }}>
        No schedule yet — this project has no production target. Add one from the Plan tab and
        the calendar fills in.
      </GlassCard>
    );
  }

  const leadingBlanks = columnOf(plan[0].date);
  const cells: Array<PlanDay | null> = [...Array<null>(leadingBlanks).fill(null), ...plan];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 8 }}>
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            style={{
              fontSize: 11,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--ink-dim)",
              paddingLeft: 2,
            }}
          >
            {d}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 8 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`blank-${i}`} />;
          const log = logs[day.date];
          const variance = log ? explainVariance(day, log, calibration) : null;
          const forecast = forecastTonnes(day, calibration);
          const selected = selectedDate === day.date;
          const topReason = variance?.attributions.slice().sort((a, b) => b.tonnes - a.tonnes)[0];

          return (
            <GlassCard
              key={day.date}
              onClick={() => onSelectDate(day.date)}
              style={{
                padding: 10,
                minHeight: 116,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                cursor: "pointer",
                outline: selected ? "2px solid var(--accent-lime)" : "2px solid transparent",
                outlineOffset: 2,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{day.date.slice(8)}</span>
                <span style={{ display: "flex", gap: 3 }}>
                  {day.flags.map((f) => {
                    const Icon = FLAG_ICON[f.kind];
                    return (
                      <span key={f.kind} title={`${FLAG_LABELS[f.kind]} — ${f.note}`} style={{ display: "flex" }}>
                        <Icon size={11} />
                      </span>
                    );
                  })}
                </span>
              </div>

              <div style={{ fontSize: 11, color: "var(--ink-dim)", lineHeight: 1.35 }}>
                Plan {day.plannedTonnes.toLocaleString()} t
                <br />
                {day.bench} · {day.plannedDepthM} m
              </div>

              {log ? (
                <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>
                    {log.actualTonnes.toLocaleString()} t
                  </div>
                  {variance && (
                    <div
                      style={{
                        fontSize: 10.5,
                        color:
                          variance.direction === "short"
                            ? "var(--critical)"
                            : variance.direction === "over"
                              ? "var(--good)"
                              : "var(--ink-dim)",
                        lineHeight: 1.3,
                      }}
                    >
                      {variance.deltaTonnes >= 0 ? "+" : ""}
                      {variance.deltaTonnes} t
                      {topReason
                        ? ` · ${DELAY_REASON_LABELS[topReason.reason]} ${topReason.hours}h (${topReason.machineId})`
                        : log.surplusCause
                          ? " · surplus logged"
                          : ""}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ marginTop: "auto", fontSize: 10.5, color: "var(--ink-dim)" }}>
                  {calibration.n > 0 ? `forecast ${forecast.toLocaleString()} t` : "not logged"}
                </div>
              )}
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}
