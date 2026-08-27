// The "View AI Suggestions" rail - docs/issues/09-project-workspace-flow.md §4.
//
// Forward-looking only. Every suggestion carries a `basis` string saying which numbers
// produced it, because a recommendation a planner cannot interrogate is one they will
// (rightly) ignore. If you add a suggestion whose basis you can't write in one line, that is
// a sign the suggestion isn't grounded in anything.

import { FLAG_LABELS } from "./aiSchedule";
import { forecastTonnes, MIN_LOGS_FOR_TRUST } from "./forecast";
import { DELAY_REASON_LABELS, type DelayReason, type Project } from "./projectTypes";

export interface Suggestion {
  id: string;
  tone: "info" | "warn" | "good";
  title: string;
  detail: string;
  /** Where the numbers came from. Shown in smaller type under the suggestion. */
  basis: string;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function buildSuggestions(project: Project): Suggestion[] {
  const out: Suggestion[] = [];
  const today = todayIso();
  const cal = project.calibration;
  const remaining = project.plan.filter((d) => d.date >= today);
  const logged = Object.values(project.logs);

  // --- pace against the target -------------------------------------------------------
  if (project.target && project.plan.length > 0) {
    const produced = logged.reduce((s, l) => s + l.actualTonnes, 0);
    const elapsedPlan = project.plan
      .filter((d) => d.date < today)
      .reduce((s, d) => s + d.plannedTonnes, 0);
    const remainingPlanned = remaining.reduce((s, d) => s + d.plannedTonnes, 0);
    const remainingForecast = remaining.reduce((s, d) => s + forecastTonnes(d, cal), 0);
    const projected = produced + remainingForecast;
    const gap = projected - project.target.tonnes;
    const pct = Math.round((projected / project.target.tonnes) * 100);
    out.push({
      id: "pace",
      tone: gap >= 0 ? "good" : Math.abs(gap) > project.target.tonnes * 0.1 ? "warn" : "info",
      title:
        gap >= 0
          ? `On track — projected ${pct}% of target`
          : `Projected ${pct}% of target — ${Math.abs(gap).toLocaleString()} t short`,
      detail:
        gap >= 0
          ? `${produced.toLocaleString()} t logged so far against ${elapsedPlan.toLocaleString()} t planned to date. The rest of the period is expected to add ${remainingForecast.toLocaleString()} t against ${remainingPlanned.toLocaleString()} t planned.`
          : `${produced.toLocaleString()} t logged against ${elapsedPlan.toLocaleString()} t planned to date. Closing the gap needs about ${Math.ceil(Math.abs(gap) / Math.max(remaining.length, 1)).toLocaleString()} t/day above plan across the ${remaining.length} days left.`,
      basis:
        cal.n > 0
          ? `Remaining plan × clean-day bias ${cal.bias.toFixed(2)}, less ${cal.expectedDelayLoss} t/day of expected delay loss (fitted on ${cal.n} logged days).`
          : "Remaining plan at face value — no logged days yet to correct it with.",
    });
  }

  // --- the next few days, and what will get in their way ------------------------------
  const nextFlagged = remaining.filter((d) => d.flags.length > 0).slice(0, 1)[0];
  if (nextFlagged) {
    out.push({
      id: "next-flag",
      tone: "warn",
      title: `${nextFlagged.date}: ${nextFlagged.flags.map((f) => FLAG_LABELS[f.kind]).join(" + ")}`,
      detail: nextFlagged.flags.map((f) => f.note).join(" "),
      basis: `Plan carries ${nextFlagged.plannedTonnes.toLocaleString()} t (${nextFlagged.plannedDepthM} m advance) on that day, already reduced for these conditions.`,
    });
  }

  const monsoonDays = remaining.filter((d) => d.flags.some((f) => f.kind === "monsoon"));
  if (monsoonDays.length > 0) {
    const carried = monsoonDays.reduce((s, d) => s + d.plannedTonnes, 0);
    const totalRemaining = remaining.reduce((s, d) => s + d.plannedTonnes, 0) || 1;
    out.push({
      id: "monsoon",
      tone: "warn",
      title: `${monsoonDays.length} monsoon-flagged days ahead`,
      detail: `They carry ${carried.toLocaleString()} t — ${Math.round((carried / totalRemaining) * 100)}% of what is left. Pulling tonnage forward into the ${remaining.length - monsoonDays.length} clear days protects the period total.`,
      basis: "Central India monsoon window (15 Jun – 30 Sep) intersected with the project period.",
    });
  }

  // --- what the model has actually learned to fear ------------------------------------
  const worstReason = (Object.entries(cal.reasonLoss) as Array<[DelayReason, { tonnesPerHour: number; n: number }]>)
    .sort((a, b) => b[1].tonnesPerHour * b[1].n - a[1].tonnesPerHour * a[1].n)[0];
  if (worstReason) {
    const [reason, loss] = worstReason;
    out.push({
      id: "reason-loss",
      tone: "warn",
      title: `${DELAY_REASON_LABELS[reason]} costs ${loss.tonnesPerHour} t per hour here`,
      detail: `Learned from ${loss.n} logged occurrence${loss.n === 1 ? "" : "s"} on this project. A three-hour event of this kind is worth about ${Math.round(loss.tonnesPerHour * 3).toLocaleString()} t — schedule anything avoidable onto a day that is already flagged.`,
      basis: "Per-reason tonnage loss fitted from this project's own day logs, not an industry average.",
    });
  }

  // --- tomorrow's number, corrected ---------------------------------------------------
  const nextDay = remaining[0];
  if (nextDay && cal.n > 0) {
    const f = forecastTonnes(nextDay, cal);
    const delta = f - nextDay.plannedTonnes;
    out.push({
      id: "tomorrow",
      tone: "info",
      title: `${nextDay.date} forecast: ${f.toLocaleString()} t on ${nextDay.bench}`,
      detail: `Plan says ${nextDay.plannedTonnes.toLocaleString()} t at ${nextDay.plannedDepthM} m advance; the calibrated forecast is ${delta >= 0 ? "+" : ""}${delta.toLocaleString()} t against that.`,
      basis:
        cal.n < MIN_LOGS_FOR_TRUST
          ? `Clean-day bias ${cal.bias.toFixed(2)} less ${cal.expectedDelayLoss} t expected delay loss, from only ${cal.n} days — provisional.`
          : `Clean-day bias ${cal.bias.toFixed(2)} less ${cal.expectedDelayLoss} t expected delay loss, from ${cal.n} days; in-sample MAE ${cal.mae} t vs ${cal.baselineMae} t uncorrected.`,
    });
  }

  // --- where to send the survey crew ---------------------------------------------------
  const topZone = project.zones[0];
  if (topZone) {
    out.push({
      id: "survey",
      tone: "info",
      title: `Survey ${topZone.label} first — ${topZone.placeName}`,
      detail: `${topZone.gradeBand} grade band (${topZone.gradeRangePct[0]}–${topZone.gradeRangePct[1]}% Mn), ${topZone.tonnageRangeMt[0]}–${topZone.tonnageRangeMt[1]} Mt over ${topZone.areaHa.toFixed(0)} ha, ${topZone.confidence} confidence.${topZone.nearNonMnMine ? " Sits near a known non-manganese mine — check that first, it is the most likely way this one is wrong." : ""}`,
      basis: `Fused score ${topZone.scoreMean.toFixed(3)}, rank ${topZone.sourceRank} in the pipeline's ranked targets.`,
    });
  }

  // --- the reserve loop, stated at its real cadence --------------------------------------
  if (project.zones.length > 0) {
    const n = project.blockOutcomes.length;
    out.push({
      id: "reserve-loop",
      tone: n > 0 ? "good" : "info",
      title:
        n > 0
          ? `${n} block outcome${n === 1 ? "" : "s"} recorded for the reserve model`
          : "No block outcomes recorded yet",
      detail:
        "The reserve map only learns when a block the model called is actually drilled or mined. Daily production from an already-open bench does not move it, and the app will not pretend otherwise.",
      basis: "Reserve retraining runs offline in the Python pipeline; these records are its input queue.",
    });
  }

  return out;
}
