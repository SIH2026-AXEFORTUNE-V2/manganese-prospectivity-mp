// Aggregates the real fused-score raster into H3 hexagons, with a tonnage and a depth-to-ore
// figure attached to each - docs/issues/09-project-workspace-flow.md §3a.
//
// Three rules this file exists to enforce:
//
//  1. A hexagon is only drawn where the pipeline actually found ore-grade anomaly. Cells with
//     no anomalous pixels under them are dropped, not interpolated from their neighbours. The
//     result is a patchy grid that follows the belt, which is the honest shape of the data - a
//     tidy wall-to-wall grid would claim coverage the model does not have.
//  2. Tonnage comes from tonnesForArea() in aiZones.ts, the same function the zone cards use,
//     so a hexagon and the card over the same ground cannot quote different numbers.
//  3. Tonnage is charged only to the *anomalous* area inside a hexagon, never to the whole
//     hexagon. Applying the target-polygon assumption to every square metre of scored ground
//     is what turns a 40 km2 belt of anomaly into three billion tonnes of imaginary ore - it
//     is the single easiest way to make this map lie, and it is measured here instead.
//
// The depth figure is the one genuinely new estimate - see depthToOre() for what it assumes.

import { cellArea, cellToLatLng, getHexagonAreaAvg, latLngToCell } from "h3-js";
import type { FeatureCollectionLike, LatLonBounds, TargetProperties } from "./contract";
import type { Confidence, GradeBand } from "./projectTypes";
import { GRADE_RANGES, haversineKm, placeNameFor, spreadFor, tonnesForArea } from "./aiZones";
import { sampleElevation, type DecodedTerrain } from "./terrain";
import type { ScoreGrid } from "./scoreRaster";

/**
 * Nominal thickness of soil/laterite over the ore horizon even where it subcrops. Nothing in
 * this belt is genuinely at zero depth, and a popup reading "0 m" would be taken to mean ore
 * is lying on the surface, which is never true.
 */
export const REGOLITH_COVER_M = 8;

/**
 * Past this distance there is no working close enough to datum a depth against, and the
 * honest answer is "unknown" rather than a number extrapolated across half the belt.
 */
export const MAX_DATUM_KM = 40;

/** Cells sampled by fewer pixels than this are dropped - a mean of two pixels is noise. */
const MIN_SAMPLES = 3;

export interface OreDatum {
  /** Known working the horizon elevation was taken from. */
  mine: string;
  elevM: number;
  km: number;
  /** Depth the working actually reaches, where the fixture records one. Real, not derived. */
  workedToM: number | null;
}

export interface MnHexCell {
  h3: string;
  lat: number;
  lon: number;
  /** Mean fused score over every scored pixel in the cell. The model's own output. */
  scoreMean: number;
  scoreMax: number;
  /** Raster pixels aggregated - the honest sample size behind the mean. */
  samples: number;
  areaKm2: number;
  /** Pixels at or above the anomaly threshold, and the ground they cover. */
  anomalousPixels: number;
  anomalousAreaKm2: number;
  anomalousFraction: number;
  /** Point estimate, thousand tonnes in situ, charged to the anomalous area only. */
  tonnesKt: number;
  tonnesRangeKt: [number, number];
  confidence: Confidence;
  surfaceElevM: number;
  /** Estimated depth below surface to the top of ore. null when no working is near enough. */
  depthToOreM: number | null;
  datum: OreDatum | null;
  /** 0-100, this cell's tonnage against every other kept cell in the same AOI. */
  percentile: number;
  band: GradeBand;
  gradeRangePct: [number, number];
  placeName: string;
  /** Rank of a pipeline target whose centroid falls in this cell, if any. */
  targetRank: number | null;
}

/* ------------------------------------------------------------------ resolution -- */

/**
 * Base resolution is chosen from the AOI's area so a lease and a whole belt both come back
 * with a readable number of hexagons; the detail setting then steps one level either side.
 * Stepping from a computed base rather than fixing three resolutions is what keeps the three
 * settings distinct at every zoom - a fixed table collapses to one value on small AOIs.
 */
export function pickResolution(bbox: LatLonBounds, detail: "coarse" | "medium" | "fine"): number {
  const [w, s, e, n] = bbox;
  const midLat = (s + n) / 2;
  const widthKm = (e - w) * 111.32 * Math.cos((midLat * Math.PI) / 180);
  const heightKm = (n - s) * 110.57;
  const areaKm2 = Math.max(1, widthKm * heightKm);

  let base = 5;
  for (let res = 4; res <= 9; res++) {
    if (areaKm2 / getHexagonAreaAvg(res, "km2") <= 900) base = res;
  }
  const step = detail === "coarse" ? -1 : detail === "fine" ? 1 : 0;
  return Math.max(4, Math.min(9, base + step));
}

/* ------------------------------------------------------------------- threshold -- */

export interface AnomalyCalibration {
  threshold: number;
  /** Share of scored pixels at or above it. */
  fraction: number;
  /** What the pipeline's own delineated targets cover, for comparison. */
  targetAreaKm2: number;
  anomalousAreaKm2: number;
  scoredAreaKm2: number;
}

/**
 * Sets the "this is ore-grade anomaly" cutoff from the pipeline's own behaviour rather than a
 * number someone liked the look of: the threshold is the score at the percentile whose area
 * matches the total footprint the pipeline delineated as ranked targets. The kept area comes
 * out larger than that footprint, which is correct - targets.geojson is the top twenty
 * clusters, not every patch of anomalous ground in the belt.
 */
export function calibrateAnomalyThreshold(
  grid: ScoreGrid,
  targets: FeatureCollectionLike | null,
): AnomalyCalibration {
  const [w, s, e, n] = grid.bounds;
  const frameKm2 = (e - w) * 111.32 * Math.cos((((s + n) / 2) * Math.PI) / 180) * (n - s) * 110.57;
  const scoredAreaKm2 = (frameKm2 * grid.valid) / (grid.width * grid.height);

  const targetAreaKm2 =
    (targets?.features ?? []).reduce(
      (sum, f) => sum + ((f.properties as unknown as TargetProperties).area_ha || 0),
      0,
    ) / 100;

  const sorted = Array.from(grid.values).filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { threshold: 1, fraction: 0, targetAreaKm2, anomalousAreaKm2: 0, scoredAreaKm2 };
  }
  const wanted = targetAreaKm2 > 0 ? Math.min(0.5, targetAreaKm2 / Math.max(scoredAreaKm2, 1)) : 0.01;
  const threshold = sorted[Math.min(sorted.length - 1, Math.floor((1 - wanted) * sorted.length))];

  // The raster is 8-bit, so the cutoff lands on a quantised step and the kept share is
  // whatever that step actually holds - report the real number, not the requested one.
  let above = 0;
  for (const v of sorted) if (v >= threshold) above++;
  const fraction = above / sorted.length;

  return {
    threshold,
    fraction,
    targetAreaKm2,
    anomalousAreaKm2: scoredAreaKm2 * fraction,
    scoredAreaKm2,
  };
}

/* ----------------------------------------------------------------------- depth -- */

/**
 * Depth below surface to the top of the manganese horizon.
 *
 * The model: the Sausar Group ore horizon is worked from surface at the known mines, so their
 * ground elevation is taken as the local datum for the top of ore. Ground standing higher than
 * the nearest working carries that much extra rock above the same horizon; ground at or below
 * it carries only regolith. The elevations are real (the pipeline's terrain grid) and the mine
 * positions are real (mines.geojson). *The horizon being flat between them* is the assumption,
 * and it is the one to attack - real Sausar bands fold and plunge steeply, so this is a
 * first-order cover estimate for ordering drill targets, not a substitute for a section.
 */
function depthToOre(surfaceElevM: number, datum: OreDatum | null): number | null {
  if (!datum || datum.km > MAX_DATUM_KM) return null;
  return Math.round(REGOLITH_COVER_M + Math.max(0, surfaceElevM - datum.elevM));
}

/**
 * Same depth-to-ore estimate as a hex cell gets, for one arbitrary point rather than a whole
 * raster - what the per-zone cutaway view datums its shaft against. Reuses nearestDatum() and
 * depthToOre() so a zone's cutaway can never quote a different depth than the hexagon sitting
 * on the same ground would.
 */
export function estimateDepth(
  lat: number,
  lon: number,
  mines: FeatureCollectionLike | null,
  terrain: DecodedTerrain | null,
): { surfaceElevM: number; depthToOreM: number | null; datum: OreDatum | null } {
  const surfaceElevM = Math.round(sampleElevation(lon, lat, terrain));
  const datum = nearestDatum(lat, lon, mines, terrain);
  return { surfaceElevM, depthToOreM: depthToOre(surfaceElevM, datum), datum };
}

function nearestDatum(
  lat: number,
  lon: number,
  mines: FeatureCollectionLike | null,
  terrain: DecodedTerrain | null,
): OreDatum | null {
  let best: OreDatum | null = null;
  for (const f of mines?.features ?? []) {
    const g = f.geometry as { type?: string; coordinates?: number[] };
    if (g?.type !== "Point" || !Array.isArray(g.coordinates)) continue;
    const [mLon, mLat] = g.coordinates;
    const km = haversineKm(mLat, mLon, lat, lon);
    if (best && km >= best.km) continue;
    const props = f.properties as { name?: unknown; depth_m?: unknown };
    best = {
      mine: String(props.name ?? "unnamed working"),
      elevM: Math.round(sampleElevation(mLon, mLat, terrain)),
      km,
      workedToM: typeof props.depth_m === "number" ? props.depth_m : null,
    };
  }
  return best;
}

/* ------------------------------------------------------------------ aggregation -- */

export interface BuildHexOptions {
  grid: ScoreGrid;
  bbox: LatLonBounds;
  resolution: number;
  anomalyThreshold: number;
  mines: FeatureCollectionLike | null;
  targets: FeatureCollectionLike | null;
  terrain: DecodedTerrain | null;
}

export interface MnHexResult {
  cells: MnHexCell[];
  resolution: number;
  /** Cells that carried any score at all, before the anomaly filter. */
  scoredCells: number;
  /** Raster pixels inside the AOI that carried a score. */
  scoredPixels: number;
  anomalousPixels: number;
  totalTonnesKt: number;
  totalAnomalousAreaKm2: number;
}

export function buildMnHexGrid({
  grid,
  bbox,
  resolution,
  anomalyThreshold,
  mines,
  targets,
  terrain,
}: BuildHexOptions): MnHexResult {
  const [west, south, east, north] = bbox;
  const [gw, gs, ge, gn] = grid.bounds;

  // Pixel window covering the AOI, clamped to the raster.
  const lonToX = (lon: number) => ((lon - gw) / (ge - gw)) * grid.width;
  const latToY = (lat: number) => ((gn - lat) / (gn - gs)) * grid.height;
  const x0 = Math.max(0, Math.floor(lonToX(west)));
  const x1 = Math.min(grid.width, Math.ceil(lonToX(east)));
  const y0 = Math.max(0, Math.floor(latToY(north)));
  const y1 = Math.min(grid.height, Math.ceil(latToY(south)));

  // Every pixel, no striding. Anomalous area is the thing tonnage is charged to, so skipping
  // pixels would not blur the answer - it would scale it by whatever the stride was.
  const midLat = (gs + gn) / 2;
  const pxKm2 =
    (((ge - gw) * 111.32 * Math.cos((midLat * Math.PI) / 180)) / grid.width) *
    (((gn - gs) * 110.57) / grid.height);

  interface Acc {
    sum: number;
    max: number;
    n: number;
    anomN: number;
    anomSum: number;
  }
  const acc = new Map<string, Acc>();
  let scoredPixels = 0;
  let anomalousPixels = 0;

  for (let y = y0; y < y1; y++) {
    const lat = gn - ((y + 0.5) / grid.height) * (gn - gs);
    if (lat < south || lat > north) continue;
    const row = y * grid.width;
    for (let x = x0; x < x1; x++) {
      const v = grid.values[row + x];
      if (!Number.isFinite(v)) continue;
      const lon = gw + ((x + 0.5) / grid.width) * (ge - gw);
      if (lon < west || lon > east) continue;
      scoredPixels++;
      const isAnom = v >= anomalyThreshold;
      if (isAnom) anomalousPixels++;

      const h3 = latLngToCell(lat, lon, resolution);
      const cur = acc.get(h3);
      if (cur) {
        cur.sum += v;
        cur.n++;
        if (v > cur.max) cur.max = v;
        if (isAnom) {
          cur.anomN++;
          cur.anomSum += v;
        }
      } else {
        acc.set(h3, { sum: v, max: v, n: 1, anomN: isAnom ? 1 : 0, anomSum: isAnom ? v : 0 });
      }
    }
  }

  // Which cell each ranked target lands in, so a hexagon can point at the zone card for the
  // same ground instead of the two reading like unrelated claims.
  const targetByCell = new Map<string, number>();
  for (const f of targets?.features ?? []) {
    const t = f.properties as unknown as TargetProperties;
    if (t.lat < south || t.lat > north || t.lon < west || t.lon > east) continue;
    targetByCell.set(latLngToCell(t.lat, t.lon, resolution), t.rank);
  }

  const kept = [...acc.entries()].filter(([, a]) => a.anomN > 0 && a.n >= MIN_SAMPLES);

  const draft = kept.map(([h3, a]) => {
    const [lat, lon] = cellToLatLng(h3);
    const areaKm2 = cellArea(h3, "km2");
    const anomalousAreaKm2 = a.anomN * pxKm2;
    const anomScoreMean = a.anomSum / a.anomN;
    const tonnes = tonnesForArea(anomalousAreaKm2 * 1_000_000, anomScoreMean);
    return { h3, a, lat, lon, areaKm2, anomalousAreaKm2, tonnes };
  });

  // Percentile is over tonnage, because that is what the map colours and labels by - ranking
  // by score while colouring by tonnes would put the darkest hexagon outside the top band.
  const byTonnes = [...draft].sort((x, y) => x.tonnes - y.tonnes);
  const rankOf = new Map(byTonnes.map((d, i) => [d.h3, i]));
  const denom = Math.max(1, byTonnes.length - 1);

  const cells: MnHexCell[] = draft.map((d) => {
    const { a } = d;
    const percentile = Math.round(((rankOf.get(d.h3) ?? 0) / denom) * 100);

    // Confidence here is confidence in the *tonnage*, so it is driven by how much anomaly the
    // cell actually contains and how coherent it is. The zone cards use whole-polygon score
    // spread instead, which is right for a delineated anomaly and wrong for a hexagon: a
    // hexagon always straddles anomaly and background, so its spread is wide by construction
    // and would mark every cell low no matter how well resolved the anomaly inside it is.
    let level = a.anomN >= 25 ? 2 : a.anomN >= 8 ? 1 : 0;
    if (a.anomN / a.n >= 0.04) level += 1;
    if (a.n < 12) level -= 1;
    const confidence: Confidence = level >= 2 ? "high" : level >= 1 ? "medium" : "low";
    const spread = spreadFor(confidence);

    // Band by where the cell sits in this AOI's own distribution. Stated in the UI: there is
    // no absolute cutoff that means anything for a rank-normalised score.
    const band: GradeBand = percentile >= 90 ? "high" : percentile >= 70 ? "medium" : "low";

    const surfaceElevM = Math.round(sampleElevation(d.lon, d.lat, terrain));
    const datum = nearestDatum(d.lat, d.lon, mines, terrain);

    return {
      h3: d.h3,
      lat: d.lat,
      lon: d.lon,
      scoreMean: a.sum / a.n,
      scoreMax: a.max,
      samples: a.n,
      areaKm2: d.areaKm2,
      anomalousPixels: a.anomN,
      anomalousAreaKm2: d.anomalousAreaKm2,
      anomalousFraction: a.anomN / a.n,
      tonnesKt: d.tonnes / 1000,
      tonnesRangeKt: [(d.tonnes * (1 - spread)) / 1000, (d.tonnes * (1 + spread)) / 1000],
      confidence,
      surfaceElevM,
      depthToOreM: depthToOre(surfaceElevM, datum),
      datum,
      percentile,
      band,
      gradeRangePct: GRADE_RANGES[band],
      // placeNameFor() names ground after the nearest working, which reads well for zone
      // cards (always near one) and badly for a hexagon 90 km out in the belt. Past the datum
      // radius, fall back to coordinates rather than implying a relationship to a distant mine.
      placeName:
        datum && datum.km <= MAX_DATUM_KM
          ? placeNameFor(d.lat, d.lon, mines)
          : `Block ${d.lat.toFixed(2)}, ${d.lon.toFixed(2)}`,
      targetRank: targetByCell.get(d.h3) ?? null,
    };
  });

  cells.sort((a, b) => b.tonnesKt - a.tonnesKt);
  return {
    cells,
    resolution,
    scoredCells: acc.size,
    scoredPixels,
    anomalousPixels,
    totalTonnesKt: cells.reduce((sum, c) => sum + c.tonnesKt, 0),
    totalAnomalousAreaKm2: cells.reduce((sum, c) => sum + c.anomalousAreaKm2, 0),
  };
}
