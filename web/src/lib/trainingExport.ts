// Turns the project's logs into the flat, fully-enumerated rows the Python side trains on,
// and hands them out as files. docs/issues/09-project-workspace-flow.md §6-7.
//
// Two exports, because there are two models and they learn from different things:
//   production rows  -> one per logged day, features from the plan, label from the actual
//   reserve rows     -> one per mined block, prediction vs. what was found
// Keeping them in separate files is not tidiness. It is what stops someone downstream
// concatenating them and training one model on both, which is exactly the mistake the
// project's own data audit already caught once.

import { DELAY_REASONS, type DelayReason, type Project } from "./projectTypes";
import { parseIsoDate } from "./aiSchedule";

export interface ProductionTrainingRow {
  project_id: string;
  date: string;
  bench: string;
  planned_tonnes: number;
  planned_depth_m: number;
  day_of_week: number;
  flag_monsoon: 0 | 1;
  flag_maintenance: 0 | 1;
  flag_rest_day: 0 | 1;
  flag_blast_window: 0 | 1;
  /** Delay hours, one column per reason - enumerated, never free text. */
  delay_hours: Record<DelayReason, number>;
  actual_tonnes: number;
  actual_grade_pct: number;
  surplus_cause: string;
}

export function buildProductionRows(project: Project): ProductionTrainingRow[] {
  const planByDate = new Map(project.plan.map((p) => [p.date, p]));
  return Object.values(project.logs)
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((log) => {
      const plan = planByDate.get(log.date);
      if (!plan) return [];
      const delay_hours = Object.fromEntries(DELAY_REASONS.map((r) => [r, 0])) as Record<DelayReason, number>;
      for (const d of log.delays) {
        delay_hours[d.reason] += Math.max(0, d.endHour - d.startHour);
      }
      return [
        {
          project_id: project.id,
          date: log.date,
          bench: plan.bench,
          planned_tonnes: plan.plannedTonnes,
          planned_depth_m: plan.plannedDepthM,
          day_of_week: parseIsoDate(log.date).getDay(),
          flag_monsoon: plan.flags.some((f) => f.kind === "monsoon") ? 1 : 0,
          flag_maintenance: plan.flags.some((f) => f.kind === "maintenance") ? 1 : 0,
          flag_rest_day: plan.flags.some((f) => f.kind === "rest_day") ? 1 : 0,
          flag_blast_window: plan.flags.some((f) => f.kind === "blast_window") ? 1 : 0,
          delay_hours,
          actual_tonnes: log.actualTonnes,
          actual_grade_pct: log.actualGradePct,
          surplus_cause: log.surplusCause ?? "",
        } satisfies ProductionTrainingRow,
      ];
    });
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function productionRowsToCsv(rows: ProductionTrainingRow[]): string {
  const headers = [
    "project_id",
    "date",
    "bench",
    "planned_tonnes",
    "planned_depth_m",
    "day_of_week",
    "flag_monsoon",
    "flag_maintenance",
    "flag_rest_day",
    "flag_blast_window",
    ...DELAY_REASONS.map((r) => `delay_h_${r}`),
    "actual_tonnes",
    "actual_grade_pct",
    "surplus_cause",
  ];
  const lines = rows.map((r) =>
    [
      r.project_id,
      r.date,
      r.bench,
      r.planned_tonnes,
      r.planned_depth_m,
      r.day_of_week,
      r.flag_monsoon,
      r.flag_maintenance,
      r.flag_rest_day,
      r.flag_blast_window,
      ...DELAY_REASONS.map((x) => r.delay_hours[x]),
      r.actual_tonnes,
      r.actual_grade_pct,
      r.surplus_cause,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [headers.join(","), ...lines].join("\n");
}

export function reserveRowsToCsv(project: Project): string {
  const headers = [
    "project_id",
    "zone_id",
    "zone_label",
    "lat",
    "lon",
    "source_rank",
    "score_mean",
    "predicted_grade_pct",
    "actual_grade_pct",
    "predicted_tonnes_kt",
    "actual_tonnes_kt",
    "mined_on",
    "verdict",
  ];
  const zoneById = new Map(project.zones.map((z) => [z.id, z]));
  const lines = project.blockOutcomes.map((o) => {
    const z = zoneById.get(o.zoneId);
    return [
      project.id,
      o.zoneId,
      o.zoneLabel,
      z?.lat ?? "",
      z?.lon ?? "",
      z?.sourceRank ?? "",
      z?.scoreMean ?? "",
      o.predictedGradePct,
      o.actualGradePct,
      o.predictedTonnesKt,
      o.actualTonnesKt,
      o.minedOn,
      o.verdict,
    ]
      .map(csvEscape)
      .join(",");
  });
  return [headers.join(","), ...lines].join("\n");
}

/** Browser download. Kept here so no component has to know about Blob/anchor plumbing. */
export function downloadText(filename: string, text: string, mime = "text/csv") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
