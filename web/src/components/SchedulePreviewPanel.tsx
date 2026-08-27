"use client";

// Right rail of the New Project wizard, step 3 - a live look at the schedule the target
// currently on screen would generate. Runs the same generatePlan() the Plan tab uses once the
// project actually exists, so what this shows is never a separate guess at the numbers - just
// that function, called early. Nothing here is "actual" yet (there is no project, no logs), so
// every day reads as planned, not logged.

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CloudRain, Wrench, Zap, Clock3 } from "lucide-react";
import GlassCard from "./GlassCard";
import { generatePlan, parseIsoDate } from "@/lib/aiSchedule";
import type { DayFlagKind, PlanDay, ProductionTarget } from "@/lib/projectTypes";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** First flag in this priority takes over the cell's colour and label. Monsoon is deliberately
 *  excluded from that takeover: at these latitudes it covers most of Jul-Sep (see inMonsoon in
 *  aiSchedule.ts), so treating it as a solid-colour flag like the sparse ones would paint most
 *  of the calendar one colour and hide the number that actually matters - the reduced tonnage
 *  a monsoon day still produces. It gets a soft tint and a small rain icon instead; a full stop
 *  (rest day) or a planned shutdown (maintenance) is the rarer, more decisive state and keeps
 *  the solid treatment. */
const PRIORITY: DayFlagKind[] = ["rest_day", "maintenance"];

const FLAG_STYLE: Record<DayFlagKind, { bg: string; fg: string; label: string; icon: typeof CloudRain }> = {
  monsoon: { bg: "var(--critical)", fg: "#fff", label: "Monsoon", icon: CloudRain },
  maintenance: { bg: "var(--warn)", fg: "#fff", label: "Mainten.", icon: Wrench },
  blast_window: { bg: "#e0c34a", fg: "#2a2205", label: "Blast Rsk", icon: Zap },
  rest_day: { bg: "var(--glass-border)", fg: "var(--ink-dim)", label: "Rest Day", icon: Clock3 },
};

function topFlag(day: PlanDay): DayFlagKind | null {
  for (const kind of PRIORITY) {
    if (day.flags.some((f) => f.kind === kind)) return kind;
  }
  return null;
}

function hasMonsoon(day: PlanDay): boolean {
  return day.flags.some((f) => f.kind === "monsoon");
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default function SchedulePreviewPanel({ target }: { target: ProductionTarget }) {
  const plan = useMemo(() => generatePlan(target), [target]);
  const byDate = useMemo(() => new Map(plan.map((d) => [d.date, d])), [plan]);

  const [viewMonth, setViewMonth] = useState(() => {
    const d = parseIsoDate(target.periodStart);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const maxTonnes = Math.max(1, ...plan.map((d) => d.plannedTonnes));

  const gridStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1 - viewMonth.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <GlassCard style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14, flex: "0 0 360px", width: "min(360px, 100%)" }}>
      <div>
        <div style={{ fontSize: 14.5, fontWeight: 700 }}>Live Schedule Preview</div>
        <div style={{ fontSize: 11.5, color: "var(--ink-dim)", marginTop: 2 }}>Preview updates in real-time.</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button type="button" onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))} style={navBtn}>
          <ChevronLeft size={15} />
        </button>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{monthLabel(viewMonth)}</div>
        <button type="button" onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))} style={navBtn}>
          <ChevronRight size={15} />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {WEEKDAYS.map((w) => (
          <div key={w} style={{ fontSize: 10, textAlign: "center", color: "var(--ink-dim)", fontWeight: 600 }}>
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === viewMonth.getMonth();
          const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const day = byDate.get(iso);
          const flag = day ? topFlag(day) : null;
          const style = flag ? FLAG_STYLE[flag] : null;
          const monsoon = day ? hasMonsoon(day) : false;
          const blastRisk = day ? day.flags.some((f) => f.kind === "blast_window") : false;

          return (
            <div
              key={i}
              title={
                day
                  ? [flag ? FLAG_STYLE[flag].label : null, monsoon ? "Monsoon (reduced capacity)" : null, blastRisk ? "Blast risk" : null]
                      .filter(Boolean)
                      .join(" · ") || `${day.plannedTonnes.toLocaleString()} t planned`
                  : undefined
              }
              style={{
                position: "relative",
                minHeight: 44,
                borderRadius: 7,
                padding: "3px 4px",
                fontSize: 9,
                lineHeight: 1.25,
                background: style
                  ? style.bg
                  : monsoon
                    ? "color-mix(in srgb, var(--critical) 16%, transparent)"
                    : day
                      ? "color-mix(in srgb, var(--good) 20%, transparent)"
                      : "transparent",
                color: style ? style.fg : "var(--ink)",
                opacity: inMonth ? 1 : 0.35,
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700 }}>{d.getDate()}</span>
                {!style && (monsoon || blastRisk) && (
                  <span style={{ display: "flex", gap: 2, color: monsoon ? "var(--critical)" : "#a5841f" }}>
                    {monsoon && <CloudRain size={9} />}
                    {blastRisk && <Zap size={9} />}
                  </span>
                )}
              </span>
              {day && (
                <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {style ? style.label : `${day.plannedTonnes.toLocaleString()} t`}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <BarChart plan={plan} max={maxTonnes} />

      <div style={{ fontSize: 10.5, color: "var(--ink-dim)", textAlign: "center" }}>Preview updates in real time.</div>
    </GlassCard>
  );
}

function BarChart({ plan, max }: { plan: PlanDay[]; max: number }) {
  const height = 110;
  const width = 320;
  const barGap = 2;
  const barWidth = plan.length > 0 ? Math.max(2, width / plan.length - barGap) : 0;
  const ticks = [1, 6, 12, 16, 20, plan.length].filter((n, i, arr) => n > 0 && n <= plan.length && arr.indexOf(n) === i);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 10.5, color: "var(--ink-dim)", fontWeight: 600 }}>Tonnes</div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ display: "block", width: "100%", height }}>
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={0}
            x2={width}
            y1={height - f * (height - 14)}
            y2={height - f * (height - 14)}
            stroke="var(--glass-border)"
            strokeWidth={1}
          />
        ))}
        {plan.map((d, i) => {
          const h = Math.max(1, (d.plannedTonnes / max) * (height - 14));
          const flag = topFlag(d);
          return (
            <rect
              key={d.date}
              x={i * (barWidth + barGap)}
              y={height - 14 - h}
              width={barWidth}
              height={h}
              rx={1}
              fill={flag ? FLAG_STYLE[flag].bg : "var(--ink-dim)"}
              opacity={flag ? 0.85 : 0.55}
            />
          );
        })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: "var(--ink-dim)" }}>
        {ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  background: "var(--glass)",
  border: "1px solid var(--glass-border)",
  borderRadius: 8,
  width: 26,
  height: 26,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  color: "var(--ink)",
};
