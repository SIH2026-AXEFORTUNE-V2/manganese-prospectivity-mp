// Raw register -> training rows, with a confirm step in between.
// docs/issues/09-project-workspace-flow.md §6.
//
// The parser is deliberately unclever. It guesses a column mapping, shows the guess, and
// imports nothing until a human confirms it. Real production registers are messier than any
// schema - "TON", "Prod_MT", "OUTPUT (tonnes)", a merged header row, a stray total at the
// bottom - and a parser that silently picks the wrong column produces data that looks fine
// and teaches the model something false. The confirm step is the feature.

import {
  DELAY_REASONS,
  type DayLog,
  type DelayEvent,
  type DelayReason,
} from "./projectTypes";

export const IMPORT_FIELDS = [
  "date",
  "tonnes",
  "grade",
  "bench",
  "reason",
  "machine",
  "start_hour",
  "end_hour",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const FIELD_LABELS: Record<ImportField, string> = {
  date: "Date",
  tonnes: "Tonnes produced",
  grade: "Grade (% Mn)",
  bench: "Bench",
  reason: "Delay reason",
  machine: "Machine / equipment id",
  start_hour: "Delay start hour",
  end_hour: "Delay end hour",
};

export const REQUIRED_FIELDS: ImportField[] = ["date", "tonnes"];

/** Header fragments that suggest a field, most specific first. */
const HEADER_HINTS: Record<ImportField, string[]> = {
  date: ["date", "day", "dt", "dinank"],
  tonnes: ["tonne", "tons", "ton", "mt", "prod", "output", "quantity", "qty"],
  grade: ["grade", "mn%", "mn_pct", "percent", "assay"],
  bench: ["bench", "face", "level", "pit"],
  reason: ["reason", "cause", "delay", "remark", "stoppage"],
  machine: ["machine", "equip", "asset", "shovel", "excavator", "unit_id"],
  start_hour: ["start", "from", "begin"],
  end_hour: ["end", "to", "till", "until"],
};

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/**
 * Minimal RFC-4180-ish split: handles quoted fields and embedded commas, ignores everything
 * else. Anything more exotic than that belongs in a real parser, not in this app.
 */
export function parseCsv(text: string): ParsedCsv {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          quoted = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ",") {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };
  const headers = split(lines[0]);
  const rows = lines.slice(1).map(split);
  return { headers, rows };
}

export type Mapping = Partial<Record<ImportField, string>>;

/** First guess at which column is which. Always shown to the user before anything imports. */
export function suggestMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<string>();
  for (const field of IMPORT_FIELDS) {
    const hit = headers.find((h) => {
      if (used.has(h)) return false;
      const lower = h.toLowerCase();
      return HEADER_HINTS[field].some((hint) => lower.includes(hint));
    });
    if (hit) {
      mapping[field] = hit;
      used.add(hit);
    }
  }
  return mapping;
}

/** Free-text delay reasons -> the fixed enum. Anything unrecognised becomes `other`. */
export function normaliseReason(raw: string): DelayReason {
  const s = raw.toLowerCase().trim();
  if (!s) return "other";
  const direct = DELAY_REASONS.find((r) => r === s);
  if (direct) return direct;
  if (/break|b\/?d|breakdown|fail.*(shovel|dumper|excav)|repair/.test(s)) return "equipment_breakdown";
  if (/rain|wet|water|flood|monsoon/.test(s)) return "rain";
  if (/blast|charg|explos.*delay|misfire/.test(s)) return "blast_delay";
  if (/power|electric|supply fail|grid/.test(s)) return "power_failure";
  if (/manpower|labour|labor|absent|staff|strike/.test(s)) return "manpower_shortage";
  if (/road|haul|access|slip/.test(s)) return "haul_road_block";
  if (/inspect|dgms|statutory|audit/.test(s)) return "statutory_inspection";
  if (/explosive|magazine|detonator/.test(s)) return "explosive_supply";
  return "other";
}

/** Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY. Returns null on anything else. */
export function normaliseDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

function num(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export interface ImportResult {
  logs: DayLog[];
  skipped: Array<{ row: number; why: string }>;
}

/**
 * Builds day logs from confirmed columns. Several rows for one date merge into one log with
 * several delay events, which is how registers are usually written (one line per stoppage).
 */
export function buildLogs(parsed: ParsedCsv, mapping: Mapping): ImportResult {
  const idx = (field: ImportField): number => {
    const header = mapping[field];
    return header ? parsed.headers.indexOf(header) : -1;
  };
  const cols = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, idx(f)])) as Record<ImportField, number>;

  const byDate = new Map<string, DayLog>();
  const skipped: ImportResult["skipped"] = [];

  parsed.rows.forEach((row, i) => {
    const rawDate = cols.date >= 0 ? row[cols.date] : undefined;
    const date = rawDate ? normaliseDate(rawDate) : null;
    if (!date) {
      skipped.push({ row: i + 2, why: `unreadable date ${JSON.stringify(rawDate ?? "")}` });
      return;
    }
    const tonnes = num(cols.tonnes >= 0 ? row[cols.tonnes] : undefined);
    if (tonnes === null) {
      skipped.push({ row: i + 2, why: "no numeric tonnage" });
      return;
    }

    const existing = byDate.get(date);
    const grade = num(cols.grade >= 0 ? row[cols.grade] : undefined);
    const log: DayLog = existing ?? {
      date,
      actualTonnes: tonnes,
      actualGradePct: grade ?? 0,
      delays: [],
      loggedAt: new Date().toISOString(),
      source: "import",
    };
    // Repeat rows for a date are stoppage lines, not extra production - keep the first
    // tonnage rather than summing, or one register style silently doubles the day.
    if (existing && grade !== null && existing.actualGradePct === 0) log.actualGradePct = grade;

    const reasonRaw = cols.reason >= 0 ? row[cols.reason] : "";
    const startHour = num(cols.start_hour >= 0 ? row[cols.start_hour] : undefined);
    const endHour = num(cols.end_hour >= 0 ? row[cols.end_hour] : undefined);
    if (reasonRaw && reasonRaw.trim().length > 0 && startHour !== null && endHour !== null) {
      const delay: DelayEvent = {
        reason: normaliseReason(reasonRaw),
        machineId: (cols.machine >= 0 ? row[cols.machine] : "") || "unspecified",
        bench: (cols.bench >= 0 ? row[cols.bench] : "") || "unspecified",
        startHour: Math.max(0, Math.min(24, startHour)),
        endHour: Math.max(0, Math.min(24, endHour)),
      };
      if (delay.endHour > delay.startHour) log.delays.push(delay);
    }
    byDate.set(date, log);
  });

  return { logs: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), skipped };
}

/** A small sample register, so the upload screen can be tried without hunting for a file. */
export const SAMPLE_CSV = `Date,Prod_MT,Mn_Grade,Bench,Stoppage,Equip,From,To
01/06/2026,462,33.4,Bench 2,,,,
02/06/2026,410,32.8,Bench 2,Shovel breakdown,EX-204,18,21
03/06/2026,488,34.1,Bench 2,,,,
04/06/2026,301,31.9,Bench 3,Heavy rain,PIT-A,11,16
05/06/2026,455,33.0,Bench 3,,,,
`;
