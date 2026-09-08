// The mining-schedule generator behind the AI Suggestions rail -
// docs/issues/09-project-workspace-flow.md §4.
//
// Deterministic on purpose: same target in, same plan out, so a day's "planned" number never
// silently changes under a log that was entered against it. Everything this produces is
// forward-looking. Nothing in this file may read a DayLog - that separation is what keeps
// "what the AI recommends" distinguishable from "what actually happened" on the calendar.

import type { DayFlag, PlanDay, ProductionTarget } from "./projectTypes";

/**
 * Working-face geometry used to turn tonnes into a bench advance in metres. A 10 m x 4 m face
 * at 3.4 t/m3 is ~136 t per metre advanced - the number a planner would recognise on a
 * medium opencast bench.
 */
const FACE_AREA_M2 = 40;
const ORE_DENSITY_T_M3 = 3.4;
const TONNES_PER_METRE_ADVANCE = FACE_AREA_M2 * ORE_DENSITY_T_M3;

/**
 * How much of a normal day's output each condition leaves you. These are planning
 * allowances, not learned values - the learned correction lives in forecast.ts and is
 * applied on top, so that improving the model never rewrites the plan retroactively.
 */
const CAPACITY_FACTOR: Record<"normal" | "monsoon" | "maintenance" | "rest", number> = {
  normal: 1,
  monsoon: 0.6,
  maintenance: 0.5,
  rest: 0.35,
};

/** Central India monsoon, inclusive: 15 June - 30 September. */
function inMonsoonSeason(d: Date): boolean {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if (m > 6 && m < 9) return true;
  if (m === 9) return true;
  if (m === 6) return day >= 15;
  return false;
}

/**
 * Whether *this* day, not just this season, is worth calling out on the calendar. The whole
 * monsoon still derates planned capacity below (capacityFactor reads inMonsoonSeason directly),
 * but flagging all ~135 days of it identically would make the flag mean nothing - a planner
 * scanning the month needs the handful of days genuinely worth a second look, the way an actual
 * spell of heavy rain arrives every week or two, not every day. Deterministic on the same
 * dayIndex the rest of this file uses, so a given plan always flags the same days.
 */
function isMonsoonRiskDay(d: Date, dayIndex: number): boolean {
  return inMonsoonSeason(d) && dayIndex % 9 === 3;
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(iso: string, n: number): string {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

function flagsFor(d: Date, dayIndex: number): DayFlag[] {
  const flags: DayFlag[] = [];
  if (isMonsoonRiskDay(d, dayIndex)) {
    flags.push({
      kind: "monsoon",
      note: "Elevated monsoon risk — haul roads and pit drainage may cut effective hours.",
    });
  }
  if (d.getDay() === 0) {
    flags.push({ kind: "rest_day", note: "Sunday — single shift only." });
  }
  // Weekly planned maintenance shutdown, on the 7th day of each rolling week.
  if (dayIndex > 0 && dayIndex % 7 === 6) {
    flags.push({
      kind: "maintenance",
      note: "Scheduled equipment maintenance — half day at the face.",
    });
  }
  // Blasting is permitted in a fixed daylight window; on days that already lose hours to
  // rain or maintenance the window is the thing most likely to be missed.
  if (dayIndex % 5 === 0 && flags.length > 0) {
    flags.push({
      kind: "blast_window",
      note: "Blast-permit window 13:00–14:00 is at risk on this day.",
    });
  }
  return flags;
}

// Planned capacity is derated across the *whole* monsoon season (real seasonal effect on haul
// roads generally), independent of isMonsoonRiskDay() above - that function only decides which
// of those season-long days is worth a visible flag, and must never change how many tonnes a
// day is actually planned for.
function capacityFactor(d: Date, flags: DayFlag[]): number {
  let f = CAPACITY_FACTOR.normal;
  if (inMonsoonSeason(d)) f = Math.min(f, CAPACITY_FACTOR.monsoon);
  if (flags.some((x) => x.kind === "maintenance")) f = Math.min(f, CAPACITY_FACTOR.maintenance);
  if (flags.some((x) => x.kind === "rest_day")) f = Math.min(f, CAPACITY_FACTOR.rest);
  return f;
}

/**
 * Spreads the period's tonnage target across its days in proportion to each day's usable
 * capacity, so the total still lands on target while monsoon and maintenance days carry
 * less of it. Benches rotate every 5 days.
 */
export function generatePlan(target: ProductionTarget): PlanDay[] {
  const days = Math.max(1, Math.round(target.periodDays));
  const benches = target.benches.length > 0 ? target.benches : ["Bench 1"];

  const shape = Array.from({ length: days }, (_, i) => {
    const d = parseIsoDate(target.periodStart);
    d.setDate(d.getDate() + i);
    const flags = flagsFor(d, i);
    return { date: isoDate(d), flags, factor: capacityFactor(d, flags) };
  });

  const totalFactor = shape.reduce((s, x) => s + x.factor, 0) || 1;

  return shape.map((x, i) => {
    const plannedTonnes = Math.round((target.tonnes * x.factor) / totalFactor);
    return {
      date: x.date,
      bench: benches[Math.floor(i / 5) % benches.length],
      plannedTonnes,
      plannedDepthM: Math.round((plannedTonnes / TONNES_PER_METRE_ADVANCE) * 10) / 10,
      flags: x.flags,
    } satisfies PlanDay;
  });
}

/** Tonnes -> metres of bench advance, exported so the log form can show the same conversion. */
export function tonnesToAdvanceM(tonnes: number): number {
  return Math.round((tonnes / TONNES_PER_METRE_ADVANCE) * 10) / 10;
}

export const FLAG_LABELS: Record<DayFlag["kind"], string> = {
  monsoon: "Monsoon",
  maintenance: "Maintenance",
  blast_window: "Blast risk",
  rest_day: "Rest day",
};
