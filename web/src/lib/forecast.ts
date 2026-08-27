// The production-forecast model. This is the loop that genuinely retrains every day -
// docs/issues/09-project-workspace-flow.md §7.
//
// It is deliberately small: a bias factor (how optimistic the plan runs) plus a learned
// tonnes-per-hour cost for each delay reason. Small is the point - it fits in the browser on
// every log entry, every coefficient is inspectable, and a planner can be shown exactly what
// changed and why. A black box that nobody can interrogate would be a worse answer here even
// if it scored better.
//
// What this file must NOT do: touch the reserve/prospectivity side. Ordinary production
// numbers from an already-mined bench say nothing about whether an unmined polygon is
// prospective. That model retrains on BlockOutcome records, offline, in the Python pipeline.

import type {
  Calibration,
  DayLog,
  DelayReason,
  PlanDay,
  ReasonLoss,
} from "./projectTypes";
import { emptyCalibration } from "./projectTypes";

/** Weight on the newest observation. 0.3 = roughly a three-week memory at one log a day. */
const LEARNING_RATE = 0.3;
/** Below this many logs the fit is shown but explicitly marked as not yet trustworthy. */
export const MIN_LOGS_FOR_TRUST = 5;

function hoursOf(startHour: number, endHour: number): number {
  return Math.max(0, endHour - startHour);
}

/**
 * Refits the whole calibration from scratch over every log the project holds. Refitting from
 * scratch rather than updating in place means the coefficients can never drift away from the
 * data through a bug in an incremental path - at this size it costs nothing.
 */
export function calibrate(
  plan: PlanDay[],
  logs: Record<string, DayLog>,
  previous: Calibration,
): Calibration {
  const byDate = new Map(plan.map((p) => [p.date, p]));
  const paired = Object.values(logs)
    .map((log) => ({ log, planned: byDate.get(log.date) }))
    .filter((x): x is { log: DayLog; planned: PlanDay } => !!x.planned && x.planned.plannedTonnes > 0)
    .sort((a, b) => a.log.date.localeCompare(b.log.date));

  if (paired.length === 0) return { ...emptyCalibration(), history: previous.history };

  // 1. Bias: exponentially weighted mean of actual/planned over *incident-free* days only.
  //    Fitting it on every day would fold the cost of breakdowns into "the plan is
  //    optimistic", and then step 2 would charge that same shortfall a second time to
  //    whichever machine happened to fail - an hour of downtime ends up costing more than
  //    an hour of production, which is nonsense the moment anyone checks it.
  const clean = paired.filter((x) => x.log.delays.length === 0);
  const biasFrom = clean.length > 0 ? clean : paired;
  let bias = biasFrom[0].log.actualTonnes / biasFrom[0].planned.plannedTonnes;
  for (const { log, planned } of biasFrom.slice(1)) {
    bias = bias * (1 - LEARNING_RATE) + (log.actualTonnes / planned.plannedTonnes) * LEARNING_RATE;
  }

  // 2. Per-reason loss: each day's shortfall *against the bias-corrected expectation* is
  //    split across the delay hours logged that day. A day that lost 120 t across 4 hours of
  //    breakdown and 2 hours of rain attributes 20 t/h to each - crude, but it is an
  //    attribution a pit foreman can argue with, which a learned interaction term at n=6
  //    would not be.
  const acc = new Map<DelayReason, { total: number; n: number }>();
  let lossTotal = 0;
  for (const { log, planned } of paired) {
    const expected = planned.plannedTonnes * bias;
    const shortfall = expected - log.actualTonnes;
    if (log.delays.length === 0 || shortfall <= 0) continue;
    lossTotal += shortfall;
    const totalHours = log.delays.reduce((s, d) => s + hoursOf(d.startHour, d.endHour), 0);
    if (totalHours <= 0) continue;
    const perHour = shortfall / totalHours;
    for (const d of log.delays) {
      if (hoursOf(d.startHour, d.endHour) <= 0) continue;
      const cur = acc.get(d.reason) ?? { total: 0, n: 0 };
      acc.set(d.reason, { total: cur.total + perHour, n: cur.n + 1 });
    }
  }
  const reasonLoss: Partial<Record<DelayReason, ReasonLoss>> = {};
  for (const [reason, v] of acc) {
    reasonLoss[reason] = { tonnesPerHour: Math.round((v.total / v.n) * 10) / 10, n: v.n };
  }

  // 3. Expected daily delay loss: total attributed loss spread over *every* logged day, not
  //    just the bad ones. Tomorrow's incidents are unknown, but assuming zero of them is a
  //    forecast that is wrong in the same direction every single time.
  const expectedDelayLoss = round1(lossTotal / paired.length);

  // 4. In-sample error, full model vs. raw plan. In-sample because a held-out split at
  //    n < 30 tells you less than the honest label does; the UI says "in-sample".
  const err = paired.map(({ log, planned }) => ({
    calibrated: Math.abs(planned.plannedTonnes * bias - expectedDelayLoss - log.actualTonnes),
    raw: Math.abs(planned.plannedTonnes - log.actualTonnes),
  }));
  const mae = round1(err.reduce((s, e) => s + e.calibrated, 0) / err.length);
  const baselineMae = round1(err.reduce((s, e) => s + e.raw, 0) / err.length);

  const version = previous.version + 1;
  const at = new Date().toISOString();
  return {
    version,
    bias: Math.round(bias * 1000) / 1000,
    reasonLoss,
    expectedDelayLoss,
    n: paired.length,
    mae,
    baselineMae,
    updatedAt: at,
    history: [...previous.history, { version, at, bias: Math.round(bias * 1000) / 1000, mae, n: paired.length }].slice(-40),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * What the model now expects from a planned day: the plan corrected for how optimistic it
 * runs on a clean day, less the tonnage a typical day loses to incidents.
 */
export function forecastTonnes(planned: PlanDay, cal: Calibration): number {
  if (cal.n === 0) return planned.plannedTonnes;
  return Math.max(0, Math.round(planned.plannedTonnes * cal.bias - cal.expectedDelayLoss));
}

export interface VarianceAttribution {
  reason: DelayReason;
  machineId: string;
  hours: number;
  tonnes: number;
}

export interface Variance {
  deltaTonnes: number;
  deltaPct: number;
  direction: "short" | "over" | "on_plan";
  attributions: VarianceAttribution[];
  /** Shortfall the logged delays do not account for. Worth surfacing, not worth hiding. */
  unexplainedTonnes: number;
}

/**
 * Explains one day's gap. Uses the *learned* per-reason cost where the model has seen that
 * reason before, and falls back to splitting the day's shortfall evenly across logged hours
 * where it hasn't - so the very first breakdown still gets attributed instead of showing a
 * blank until the model has enough history.
 */
export function explainVariance(planned: PlanDay, log: DayLog, cal: Calibration): Variance {
  const delta = log.actualTonnes - planned.plannedTonnes;
  const deltaPct = planned.plannedTonnes > 0 ? (delta / planned.plannedTonnes) * 100 : 0;
  const totalHours = log.delays.reduce((s, d) => s + hoursOf(d.startHour, d.endHour), 0);
  // Attribution works off the bias-corrected expectation for the same reason calibrate()
  // does: the part of a gap that is chronic plan optimism is not the breakdown's fault.
  const expected = planned.plannedTonnes * (cal.n > 0 ? cal.bias : 1);
  const shortfall = Math.max(0, expected - log.actualTonnes);
  const fallbackPerHour = totalHours > 0 ? shortfall / totalHours : 0;

  const attributions = log.delays
    .map((d) => {
      const hours = hoursOf(d.startHour, d.endHour);
      const learned = cal.reasonLoss[d.reason];
      const perHour = learned ? learned.tonnesPerHour : fallbackPerHour;
      return {
        reason: d.reason,
        machineId: d.machineId,
        hours,
        tonnes: Math.round(perHour * hours),
      };
    })
    .filter((a) => a.hours > 0);

  const attributed = attributions.reduce((s, a) => s + a.tonnes, 0);
  return {
    deltaTonnes: Math.round(delta),
    deltaPct: Math.round(deltaPct * 10) / 10,
    direction: Math.abs(deltaPct) < 2 ? "on_plan" : delta < 0 ? "short" : "over",
    attributions,
    unexplainedTonnes: Math.max(0, Math.round(shortfall - attributed)),
  };
}
