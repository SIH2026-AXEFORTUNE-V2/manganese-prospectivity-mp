// Types for the project workspace — see docs/issues/09-project-workspace-flow.md.
//
// Everything here is *user-authored* state (projects, plans, day logs), which is the exact
// opposite of lib/contract.ts: that file types files the Python pipeline writes and this app
// only reads. These types describe what the app itself creates. Keep the two separate — a
// project references pipeline output by id, it never copies pipeline shapes.

import type { LatLonBounds } from "./contract";

/** What the user came here to do. The wizard branches on this; see the doc's §2 table. */
export type ProjectMode = "discover" | "produce" | "both";

export interface Session {
  name: string;
  org: string;
  startedAt: string;
}

export interface Aoi {
  /** Human label - a lease name if picked from mines.geojson, else "custom area". */
  name: string;
  bbox: LatLonBounds;
}

/** Production-planning inputs. Absent on a pure `discover` project. */
export interface ProductionTarget {
  tonnes: number;
  gradePct: number;
  /** ISO date (YYYY-MM-DD) of day 1. */
  periodStart: string;
  periodDays: number;
  benches: string[];
}

export type GradeBand = "high" | "medium" | "low";
export type Confidence = "high" | "medium" | "low";

/**
 * One ranked zone card. Derived from a targets.geojson feature by lib/aiZones.ts - every
 * numeric field here is an estimate off `score_mean`/`area_ha` through a stated assumption
 * set, never a measurement. `assumptions` carries that set so the card can show its work.
 */
export interface Zone {
  id: string;
  /** 1 = best in this project (not the same as the fixture's global `rank`). */
  order: number;
  sourceRank: number;
  label: string;
  placeName: string;
  lat: number;
  lon: number;
  areaHa: number;
  scoreMean: number;
  scoreMax: number;
  nearNonMnMine: boolean;
  gradeBand: GradeBand;
  gradeRangePct: [number, number];
  tonnageRangeMt: [number, number];
  confidence: Confidence;
  assumptions: string[];
}

export type DayFlagKind = "monsoon" | "maintenance" | "blast_window" | "rest_day";

export interface DayFlag {
  kind: DayFlagKind;
  note: string;
}

/** One row of the AI schedule. Regenerated whenever the target changes; never edited by hand. */
export interface PlanDay {
  date: string;
  bench: string;
  plannedTonnes: number;
  plannedDepthM: number;
  flags: DayFlag[];
}

/**
 * Why a day fell short. Fixed list on purpose - see the doc's §5. Free text is allowed as a
 * note on the log, but nothing downstream reads it, and the model never sees it.
 */
export const DELAY_REASONS = [
  "equipment_breakdown",
  "rain",
  "blast_delay",
  "power_failure",
  "manpower_shortage",
  "haul_road_block",
  "statutory_inspection",
  "explosive_supply",
  "other",
] as const;
export type DelayReason = (typeof DELAY_REASONS)[number];

export const DELAY_REASON_LABELS: Record<DelayReason, string> = {
  equipment_breakdown: "Equipment breakdown",
  rain: "Rain / water ingress",
  blast_delay: "Blast delay",
  power_failure: "Power failure",
  manpower_shortage: "Manpower shortage",
  haul_road_block: "Haul road blocked",
  statutory_inspection: "Statutory inspection",
  explosive_supply: "Explosive supply",
  other: "Other",
};

export interface DelayEvent {
  reason: DelayReason;
  /** Machine / equipment id, e.g. "EX-204". Free-form but required - it makes the row joinable. */
  machineId: string;
  bench: string;
  /** Hour of day, 0-24, half-open [startHour, endHour). */
  startHour: number;
  endHour: number;
}

/** Why a day *over*-produced. A surplus is its own event, not a negative shortfall (doc §5). */
export type SurplusCause = "richer_zone" | "stockpile_blend" | "extra_shift" | "unknown";

export const SURPLUS_CAUSE_LABELS: Record<SurplusCause, string> = {
  richer_zone: "Zone richer than modelled",
  stockpile_blend: "Stockpile blended in",
  extra_shift: "Extra shift worked",
  unknown: "Not sure yet",
};

export interface DayLog {
  date: string;
  actualTonnes: number;
  actualGradePct: number;
  delays: DelayEvent[];
  surplusCause?: SurplusCause;
  /** Read by humans only. Deliberately not a model input. */
  note?: string;
  loggedAt: string;
  /** "manual" = typed on the calendar; "import" = came in through the CSV mapper. */
  source: "manual" | "import";
}

/**
 * A block that was actually mined where the map made a call. This - not daily production -
 * is what the reserve model retrains on, which is why it is a separate, much rarer record.
 */
export interface BlockOutcome {
  id: string;
  zoneId: string;
  zoneLabel: string;
  predictedGradePct: number;
  actualGradePct: number;
  predictedTonnesKt: number;
  actualTonnesKt: number;
  minedOn: string;
  recordedAt: string;
  /** Whether the map's call held up. Derived, stored so the export is self-contained. */
  verdict: "hit" | "partial" | "miss";
}

export interface UploadRecord {
  id: string;
  filename: string;
  rows: number;
  accepted: number;
  uploadedAt: string;
  /** The confirmed header -> field mapping, kept so a bad import can be explained later. */
  mapping: Record<string, string>;
}

/** Per-reason learned loss: how many tonnes an hour of this reason actually costs. */
export interface ReasonLoss {
  tonnesPerHour: number;
  n: number;
}

/**
 * The production-forecast model's fitted state. Refit in the browser on every day log -
 * this is the loop that genuinely runs daily (doc §7).
 */
export interface Calibration {
  version: number;
  /**
   * Multiplier applied to a plan's tonnes on an incident-free day. 1.0 = plan is unbiased.
   * Fitted on clean days only, so it measures plan optimism and nothing else.
   */
  bias: number;
  reasonLoss: Partial<Record<DelayReason, ReasonLoss>>;
  /**
   * Tonnes a typical day loses to delays, averaged over every logged day including the ones
   * that had none - i.e. how often things go wrong times how much it costs when they do.
   * Subtracted from the forecast, because tomorrow's incidents are unknown but not zero.
   */
  expectedDelayLoss: number;
  n: number;
  /** Mean absolute error, tonnes, of the calibrated forecast over logged days. */
  mae: number;
  /** MAE of the raw uncalibrated plan over the same days - the "before" number. */
  baselineMae: number;
  updatedAt: string | null;
  history: Array<{ version: number; at: string; bias: number; mae: number; n: number }>;
}

export interface Project {
  id: string;
  name: string;
  mode: ProjectMode;
  aoi: Aoi;
  target: ProductionTarget | null;
  zones: Zone[];
  plan: PlanDay[];
  /** Keyed by ISO date. */
  logs: Record<string, DayLog>;
  uploads: UploadRecord[];
  blockOutcomes: BlockOutcome[];
  calibration: Calibration;
  createdAt: string;
  updatedAt: string;
  owner: string;
}

export function emptyCalibration(): Calibration {
  return {
    version: 0,
    bias: 1,
    reasonLoss: {},
    expectedDelayLoss: 0,
    n: 0,
    mae: 0,
    baselineMae: 0,
    updatedAt: null,
    history: [],
  };
}
