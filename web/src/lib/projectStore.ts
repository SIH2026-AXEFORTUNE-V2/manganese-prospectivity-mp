"use client";

// The whole app's writable state, in localStorage behind one module.
//
// There is no backend (see docs/04-data-contract.md's opening paragraph) - the Python
// pipeline writes files, this app reads them, and everything the *user* authors lives here.
// That is a deliberate limit, not an oversight: a real deployment swaps this one file for an
// API client and nothing above it changes, because every component reads projects through
// the hooks below rather than touching localStorage itself. Keep it that way.

import { useCallback, useSyncExternalStore } from "react";
import type { FeatureCollectionLike, LatLonBounds } from "./contract";
import {
  emptyCalibration,
  type BlockOutcome,
  type DayLog,
  type DelayEvent,
  type Project,
  type ProductionTarget,
  type Session,
  type SurplusCause,
  type UploadRecord,
} from "./projectTypes";
import { deriveZones } from "./aiZones";
import { generatePlan, isoDate } from "./aiSchedule";
import { calibrate } from "./forecast";

const SESSION_KEY = "ore-compass-session";
const PROJECTS_KEY = "ore-compass-projects";
const SEED_KEY = "ore-compass-seeded";

interface StoreState {
  session: Session | null;
  projects: Project[];
  hydrated: boolean;
}

const EMPTY: StoreState = { session: null, projects: [], hydrated: false };

let state: StoreState = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function read<T>(key: string, fallback: T): T {
  // Every localStorage access is wrapped: private windows, blocked site data, and
  // thumbnailing contexts all throw on access rather than returning null.
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing here is worth breaking the UI over - the app stays usable for this session,
    // it just won't survive a reload.
  }
}

function hydrate() {
  if (state.hydrated || typeof window === "undefined") return;
  state = {
    session: read<Session | null>(SESSION_KEY, null),
    projects: read<Project[]>(PROJECTS_KEY, []),
    hydrated: true,
  };
  emit();
}

function setProjects(projects: Project[]) {
  state = { ...state, projects };
  write(PROJECTS_KEY, projects);
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Runs after the first commit, so server and first client render agree on EMPTY and only
  // then does the stored state land. That ordering is what avoids a hydration mismatch.
  hydrate();
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): StoreState {
  return state;
}

function getServerSnapshot(): StoreState {
  return EMPTY;
}

function useStore(): StoreState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ---------------------------------------------------------------------------- session

export function useSession() {
  const { session, hydrated } = useStore();
  const signIn = useCallback((name: string, org: string) => {
    const s: Session = { name, org, startedAt: new Date().toISOString() };
    state = { ...state, session: s };
    write(SESSION_KEY, s);
    emit();
  }, []);
  const signOut = useCallback(() => {
    state = { ...state, session: null };
    try {
      window.localStorage.removeItem(SESSION_KEY);
    } catch {
      /* see write() */
    }
    emit();
  }, []);
  return { session, hydrated, signIn, signOut };
}

// ---------------------------------------------------------------------------- projects

export function useProjects() {
  const { projects, hydrated } = useStore();
  return { projects, hydrated };
}

export function useProject(id: string | null) {
  const { projects, hydrated } = useStore();
  return { project: projects.find((p) => p.id === id) ?? null, hydrated };
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export interface CreateProjectInput {
  name: string;
  mode: Project["mode"];
  aoiName: string;
  bbox: LatLonBounds;
  target: ProductionTarget | null;
  owner: string;
  targets: FeatureCollectionLike | null;
  mines: FeatureCollectionLike | null;
}

export function createProject(input: CreateProjectInput): Project {
  const now = new Date().toISOString();
  const zones =
    input.targets && input.mode !== "produce"
      ? deriveZones({ bbox: input.bbox, targets: input.targets, mines: input.mines })
      : [];
  const project: Project = {
    id: newId("prj"),
    name: input.name,
    mode: input.mode,
    aoi: { name: input.aoiName, bbox: input.bbox },
    target: input.target,
    zones,
    plan: input.target ? generatePlan(input.target) : [],
    logs: {},
    uploads: [],
    blockOutcomes: [],
    calibration: emptyCalibration(),
    createdAt: now,
    updatedAt: now,
    owner: input.owner,
  };
  setProjects([project, ...state.projects]);
  return project;
}

export function deleteProject(id: string) {
  setProjects(state.projects.filter((p) => p.id !== id));
}

/**
 * The single write path for an existing project. Recalibrating here rather than in each
 * caller is what makes "the model retrains on every entry" true by construction - there is
 * no way to save a log and forget to refit.
 */
function updateProject(id: string, fn: (p: Project) => Project) {
  setProjects(
    state.projects.map((p) => {
      if (p.id !== id) return p;
      const next = fn(p);
      return {
        ...next,
        calibration: calibrate(next.plan, next.logs, p.calibration),
        updatedAt: new Date().toISOString(),
      };
    }),
  );
}

export function saveDayLog(projectId: string, log: DayLog) {
  updateProject(projectId, (p) => ({ ...p, logs: { ...p.logs, [log.date]: log } }));
}

export function deleteDayLog(projectId: string, date: string) {
  updateProject(projectId, (p) => {
    const logs = { ...p.logs };
    delete logs[date];
    return { ...p, logs };
  });
}

export function saveImportedLogs(projectId: string, logs: DayLog[], record: UploadRecord) {
  updateProject(projectId, (p) => {
    const merged = { ...p.logs };
    for (const l of logs) merged[l.date] = l;
    return { ...p, logs: merged, uploads: [record, ...p.uploads] };
  });
}

export function addBlockOutcome(projectId: string, outcome: BlockOutcome) {
  updateProject(projectId, (p) => ({ ...p, blockOutcomes: [outcome, ...p.blockOutcomes] }));
}

export function setProductionTarget(projectId: string, target: ProductionTarget) {
  // Regenerating the plan is the only thing that may change a "planned" number. Logs are
  // keyed by date and survive; days that fall outside the new period simply stop pairing.
  updateProject(projectId, (p) => ({
    ...p,
    target,
    plan: generatePlan(target),
    mode: p.mode === "discover" ? "both" : p.mode,
  }));
}

export function refreshZones(
  projectId: string,
  targets: FeatureCollectionLike,
  mines: FeatureCollectionLike | null,
) {
  updateProject(projectId, (p) => ({
    ...p,
    zones: deriveZones({ bbox: p.aoi.bbox, targets, mines }),
  }));
}

// ---------------------------------------------------------------------------- demo seed

/**
 * Puts one worked example in the list on first run, so the app is never a blank page and the
 * retraining loop has something to show. Seeded logs are marked `source: "import"` and the
 * project name says "demo" - nothing here should be mistakable for real MOIL production data.
 */
interface ScriptedDay {
  offset: number;
  /** Actual as a fraction of that day's planned tonnes. */
  factor: number;
  delays?: DelayEvent[];
  surplusCause?: SurplusCause;
}

export function seedDemoProject(
  targets: FeatureCollectionLike,
  mines: FeatureCollectionLike | null,
  owner: string,
) {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(SEED_KEY)) return;
  } catch {
    return;
  }
  write(SEED_KEY, true);
  if (state.projects.length > 0) return;

  const start = new Date();
  start.setDate(start.getDate() - 13);
  const target: ProductionTarget = {
    tonnes: 12000,
    gradePct: 34,
    periodStart: isoDate(start),
    periodDays: 26,
    benches: ["Bench 2", "Bench 3", "Bench 5"],
  };
  const project = createProject({
    name: "Balaghat North (demo)",
    mode: "both",
    aoiName: "Balaghat / Bharveli lease",
    bbox: [79.9, 21.5, 80.6, 22.1],
    target,
    owner,
    targets,
    mines,
  });

  // Fourteen days of plausible actuals: a steady ~7% optimism in the plan, one three-hour
  // breakdown, one wet day, and one surplus - enough for the calibration panel to have
  // something real to show on first open.
  const scripted: ScriptedDay[] = [
    { offset: 0, factor: 0.95 },
    { offset: 1, factor: 0.92 },
    { offset: 2, factor: 0.9 },
    {
      offset: 3,
      factor: 0.62,
      delays: [{ reason: "equipment_breakdown", machineId: "EX-204", bench: "Bench 2", startHour: 18, endHour: 21 }],
    },
    { offset: 4, factor: 0.97 },
    { offset: 5, factor: 0.88 },
    { offset: 6, factor: 0.94 },
    {
      offset: 7,
      factor: 0.71,
      delays: [{ reason: "rain", machineId: "PIT-A", bench: "Bench 3", startHour: 11, endHour: 16 }],
    },
    { offset: 8, factor: 0.93 },
    { offset: 9, factor: 1.18, surplusCause: "richer_zone" },
    { offset: 10, factor: 0.91 },
    {
      offset: 11,
      factor: 0.79,
      delays: [{ reason: "blast_delay", machineId: "DRL-11", bench: "Bench 3", startHour: 13, endHour: 15 }],
    },
    { offset: 12, factor: 0.96 },
    { offset: 13, factor: 0.9 },
  ];

  const logs: DayLog[] = [];
  for (const s of scripted) {
    const planDay = project.plan[s.offset];
    if (!planDay) continue;
    logs.push({
      date: planDay.date,
      actualTonnes: Math.round(planDay.plannedTonnes * s.factor),
      actualGradePct: Math.round((32 + Math.sin(s.offset) * 2.4) * 10) / 10,
      delays: s.delays ?? [],
      surplusCause: s.surplusCause,
      loggedAt: new Date().toISOString(),
      source: "import",
    });
  }
  updateProject(project.id, (p) => ({
    ...p,
    logs: Object.fromEntries(logs.map((l) => [l.date, l])),
  }));
}
