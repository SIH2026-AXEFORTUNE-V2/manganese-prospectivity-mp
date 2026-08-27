// Turns pipeline output (targets.geojson + mines.geojson) into the ranked zone cards the
// project screen shows - docs/issues/09-project-workspace-flow.md §3.
//
// This is a *derivation layer*, not a second model. Every zone here traces back to one
// targets.geojson feature and the validated fused score inside it; nothing is invented and
// no score is recomputed. If you find yourself wanting a number that isn't derivable from
// the fixture, add it to the pipeline instead - two sources of truth for a score is how a
// demo starts lying.

import type { FeatureCollectionLike, LatLonBounds, TargetProperties } from "./contract";
import type { Confidence, GradeBand, Zone } from "./projectTypes";

/**
 * Nominal Mn grade bands, percent. These are band *definitions* (what "high grade" means to
 * a MOIL planner), not assay results - the model ranks prospectivity, it does not predict an
 * assay. The UI must say so; see ZoneCard's assumption list.
 */
export const GRADE_RANGES: Record<GradeBand, [number, number]> = {
  high: [36, 42],
  medium: [28, 33],
  low: [18, 25],
};

/** Tonnage assumptions, printed on every card that uses them. */
export const ORE_THICKNESS_M = 6;
export const ORE_DENSITY_T_M3 = 3.4;
export const RECOVERY = 0.65;
/** Fraction of an anomalous polygon that is actually ore, scaled by its fused score. */
export const MINERALISED_FRACTION_PER_SCORE = 0.15;

/**
 * Which colour family a zone gets, shared by its map pin and its card badge so a number always
 * means the same thing in both places. High confidence stands out regardless of grade band (a
 * small, tight, well-understood target is worth flagging even off-band); short of that, grade
 * band carries it. Callers resolve the family to an actual colour themselves - the map always
 * sits on a dark basemap and needs light-toned hexes, the card follows the app's light/dark
 * theme and needs the matching CSS custom property instead.
 */
export function zoneColorFamily(gradeBand: GradeBand, confidence: Confidence): "accent" | "warn" | "good" {
  if (confidence === "high") return "accent";
  if (gradeBand === "low") return "warn";
  return "good";
}

/** Concrete hex per family, tuned for the map's always-dark basemap. */
export const PIN_COLOR_HEX: Record<ReturnType<typeof zoneColorFamily>, string> = {
  accent: "#c8ff3d",
  warn: "#e0aa4a",
  good: "#6fbe7f",
};

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

function bearingLabel(fromLat: number, fromLon: number, toLat: number, toLon: number): string {
  const dy = toLat - fromLat;
  const dx = (toLon - fromLon) * Math.cos((fromLat * Math.PI) / 180);
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  const idx = Math.round(((deg + 360) % 360) / 45) % 8;
  return COMPASS[idx];
}

function centroidOf(geometry: unknown): { lat: number; lon: number } | null {
  // mines.geojson features are points; that's all this needs to handle.
  const g = geometry as { type?: string; coordinates?: unknown };
  if (g?.type !== "Point" || !Array.isArray(g.coordinates)) return null;
  const [lon, lat] = g.coordinates as number[];
  return { lat, lon };
}

/**
 * Names a zone after the nearest known mine plus a bearing - "Bharveli NE extension" reads
 * like a place a geologist would say, where "Target #7" reads like a row id.
 */
export function placeNameFor(lat: number, lon: number, mines: FeatureCollectionLike | null): string {
  let best: { name: string; km: number; bearing: string } | null = null;
  for (const f of mines?.features ?? []) {
    const c = centroidOf(f.geometry);
    if (!c) continue;
    const name = String((f.properties as { name?: unknown }).name ?? "").split("/")[0].trim();
    if (!name) continue;
    const km = haversineKm(c.lat, c.lon, lat, lon);
    if (!best || km < best.km) {
      best = { name, km, bearing: bearingLabel(c.lat, c.lon, lat, lon) };
    }
  }
  if (!best) return `Block ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  if (best.km <= 8) return `${best.name} ${best.bearing} extension`;
  return `${best.name} ${best.bearing} block · ${best.km.toFixed(0)} km`;
}

/**
 * Bands by rank *within the ranked-target population*, not against an absolute score cutoff.
 * The fused score is rank-normalised (see docs/02-modelling-plan.md), so an absolute 0.70
 * threshold would mean nothing; "top third of everything the model surfaced" does.
 */
export function bandFor(sourceRank: number, totalTargets: number): GradeBand {
  const pct = sourceRank / Math.max(totalTargets, 1);
  if (pct <= 1 / 3) return "high";
  if (pct <= 2 / 3) return "medium";
  return "low";
}

export function confidenceFor(t: TargetProperties): Confidence {
  // A tight max-vs-mean spread means the whole polygon scores consistently, rather than one
  // hot pixel dragging up an otherwise dull area. Tiny polygons and anything sitting next to
  // a known non-manganese mine get pulled down a step.
  const spread = t.score_max - t.score_mean;
  let level = spread < 0.09 ? 2 : spread < 0.14 ? 1 : 0;
  if (t.area_ha < 60) level -= 1;
  if (t.near_non_mn_mine) level -= 1;
  return level >= 2 ? "high" : level >= 1 ? "medium" : "low";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * In-situ tonnes for a patch of ground at a given fused score. The single place this chain of
 * assumptions lives - the zone cards and the Mn hex grid both call it, so a hexagon can never
 * quote a different tonnage from the card covering the same ground.
 */
export function tonnesForArea(areaM2: number, scoreMean: number): number {
  const mineralised = areaM2 * MINERALISED_FRACTION_PER_SCORE * scoreMean;
  return mineralised * ORE_THICKNESS_M * ORE_DENSITY_T_M3 * RECOVERY;
}

/** Range width by confidence, shared for the same reason tonnesForArea() is. */
export function spreadFor(confidence: Confidence): number {
  return confidence === "high" ? 0.2 : confidence === "medium" ? 0.3 : 0.45;
}

function tonnageRangeMt(t: TargetProperties, confidence: Confidence): [number, number] {
  const mt = tonnesForArea(t.area_ha * 10_000, t.score_mean) / 1_000_000;
  const spread = spreadFor(confidence);
  return [round2(mt * (1 - spread)), round2(mt * (1 + spread))];
}

function inBbox(lat: number, lon: number, bbox: LatLonBounds): boolean {
  const [w, s, e, n] = bbox;
  return lon >= w && lon <= e && lat >= s && lat <= n;
}

export interface DeriveZonesOptions {
  bbox: LatLonBounds;
  targets: FeatureCollectionLike;
  mines: FeatureCollectionLike | null;
  /** Cap on cards shown; the rest stay in the fixture, they just don't get a card. */
  limit?: number;
}

/**
 * Ranked zones for one AOI. Returns [] when the AOI contains no ranked target - that is a
 * real answer ("the model found nothing here"), so callers must render it as one rather
 * than falling back to the nearest few and quietly implying coverage that isn't there.
 */
export function deriveZones({ bbox, targets, mines, limit = 8 }: DeriveZonesOptions): Zone[] {
  const all = targets.features.map((f) => f.properties as unknown as TargetProperties);
  const total = all.length;

  return all
    .filter((t) => inBbox(t.lat, t.lon, bbox))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((t, i) => {
      const gradeBand = bandFor(t.rank, total);
      const confidence = confidenceFor(t);
      const mineralisedPct = (MINERALISED_FRACTION_PER_SCORE * t.score_mean * 100).toFixed(1);
      const caveats =
        (t.area_ha < 60 ? ", small polygon" : "") +
        (t.near_non_mn_mine ? ", near a non-Mn mine" : "");
      return {
        id: `zone-${t.rank}`,
        order: i + 1,
        sourceRank: t.rank,
        label: `Zone ${String.fromCharCode(65 + i)}`,
        placeName: placeNameFor(t.lat, t.lon, mines),
        lat: t.lat,
        lon: t.lon,
        areaHa: t.area_ha,
        scoreMean: t.score_mean,
        scoreMax: t.score_max,
        nearNonMnMine: t.near_non_mn_mine,
        gradeBand,
        gradeRangePct: GRADE_RANGES[gradeBand],
        tonnageRangeMt: tonnageRangeMt(t, confidence),
        confidence,
        assumptions: [
          `Grade band = position in the ranked-target population (rank ${t.rank} of ${total}). Band widths are nominal Mn% definitions, not assay results.`,
          `Tonnage = ${t.area_ha.toFixed(0)} ha × ${mineralisedPct}% mineralised × ${ORE_THICKNESS_M} m thickness × ${ORE_DENSITY_T_M3} t/m³ × ${(RECOVERY * 100).toFixed(0)}% recovery.`,
          `Range width reflects ${confidence} confidence (score spread ${(t.score_max - t.score_mean).toFixed(3)}${caveats}).`,
          "Nothing here is a drilled estimate — it is a survey-priority ranking with size attached.",
        ],
      } satisfies Zone;
    });
}

/** Known leases the AOI picker offers, straight out of mines.geojson. */
export interface LeasePreset {
  name: string;
  lat: number;
  lon: number;
  bbox: LatLonBounds;
}

export function leasePresets(
  mines: FeatureCollectionLike | null,
  halfSpanDeg = 0.35,
): LeasePreset[] {
  const out: LeasePreset[] = [];
  for (const f of mines?.features ?? []) {
    const c = centroidOf(f.geometry);
    const name = String((f.properties as { name?: unknown }).name ?? "").trim();
    if (!c || !name) continue;
    out.push({
      name,
      lat: c.lat,
      lon: c.lon,
      bbox: [c.lon - halfSpanDeg, c.lat - halfSpanDeg, c.lon + halfSpanDeg, c.lat + halfSpanDeg],
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
