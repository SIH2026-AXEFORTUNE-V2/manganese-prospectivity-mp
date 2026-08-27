// Shared types for the data contract defined in docs/04-data-contract.md.
//
// Whoever changes the shape of web/public/data/*.json must update this file in the same
// commit - every page in this app imports types from here rather than guessing shapes,
// so a schema change is a one-file diff, not a hunt through every component.

export type LatLonBounds = [west: number, south: number, east: number, north: number];

export interface LayerManifest {
  static_image: string | null;
  tiles: string | null;
  bounds: LatLonBounds;
  value_range: [number, number];
}

export interface Manifest {
  generated_at: string;
  aoi: string;
  bounds: LatLonBounds | null;
  layers: Record<"fused" | "signature" | "anomaly", LayerManifest>;
  terrain: {
    static_grid: string | null;
    terrain_rgb_tiles: string | null;
    elevation_range_m: [number, number] | null;
  };
  vectors: {
    mines: string;
    negatives: string;
    clusters: string;
    targets: string;
  };
  validation: string;
  risk: string;
}

export interface TargetProperties {
  rank: number;
  area_ha: number;
  score_mean: number;
  score_max: number;
  lat: number;
  lon: number;
  near_non_mn_mine: boolean;
}

export interface MineProperties {
  name: string;
  mine_type: "underground" | "opencast" | "unknown";
  depth_m: number | null;
  [key: string]: unknown;
}

export interface RiskEntry {
  mine_id: string;
  name: string;
  lat: number;
  lon: number;
  mine_type: "underground" | "opencast";
  depth_m: number | null;
  series: Array<{
    date: string;
    rainfall_mm: number;
    soil_moisture: number;
    lst_c: number;
    ndvi: number;
  }>;
  risk_tier: "normal" | "watch" | "critical";
  risk_reasons: string[];
}

// Field names match data/processed/validation_report.json exactly (src/validate/score.py) -
// don't rename these on the frontend side, rename them at the source if they're wrong.
export interface ValidationReport {
  n_features?: number;
  dropped?: Array<{ dropped: string; kept: string; r: number }>;
  heldout_pct_mean?: number;
  heldout_pct_sd?: number;
  permutation_p?: number;
  loco?: Array<{
    held_out_cluster: string;
    n_train: number;
    n_test: number;
    heldout_pct: number;
    negatives_pct: number;
    median_NDVI: number;
  }>;
  capture_signature?: { top5: number; top10: number; top20: number };
  capture_anomaly?: { top5: number; top10: number; top20: number };
  capture_fused?: { top5: number; top10: number; top20: number };
  [key: string]: unknown;
}

// Loose on purpose - this app never edits geometry, only reads and draws it, so a full
// GeoJSON type dependency isn't worth adding for a weak-typed pass-through.
export interface FeatureCollectionLike {
  type: "FeatureCollection";
  features: Array<{ type: "Feature"; geometry: unknown; properties: Record<string, unknown> }>;
}

const DATA_BASE = "/data";

export async function loadManifest(): Promise<Manifest> {
  const res = await fetch(`${DATA_BASE}/manifest.json`);
  if (!res.ok) throw new Error(`manifest.json: HTTP ${res.status}`);
  return res.json();
}

export async function loadJson<T>(filename: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}/${filename}`);
  if (!res.ok) throw new Error(`${filename}: HTTP ${res.status}`);
  return res.json();
}
