"use client";

// One fetch, shared by every component on the page - the map, the stat cards, and the
// target rail all read the same targets/mines/validation data instead of each fetching
// their own copy. Add fields here as new screens need them; don't add a second fetch.

import { useEffect, useState } from "react";
import {
  loadManifest,
  loadJson,
  type Manifest,
  type TerrainData,
  type FeatureCollectionLike,
  type ValidationReport,
} from "./contract";

interface OreCompassData {
  status: "loading" | "ready" | "error";
  error: string | null;
  manifest: Manifest | null;
  targets: FeatureCollectionLike | null;
  mines: FeatureCollectionLike | null;
  validation: ValidationReport | null;
  terrain: TerrainData | null;
}

export function useOreCompassData(): OreCompassData {
  const [data, setData] = useState<OreCompassData>({
    status: "loading",
    error: null,
    manifest: null,
    targets: null,
    mines: null,
    validation: null,
    terrain: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const manifest = await loadManifest();
        const [targets, mines, validation, terrain] = await Promise.all([
          loadJson<FeatureCollectionLike>(manifest.vectors.targets),
          loadJson<FeatureCollectionLike>(manifest.vectors.mines),
          loadJson<ValidationReport>(manifest.validation),
          manifest.terrain.static_grid
            ? loadJson<TerrainData>(manifest.terrain.static_grid)
            : Promise.resolve(null),
        ]);
        if (!cancelled) {
          setData({ status: "ready", error: null, manifest, targets, mines, validation, terrain });
        }
      } catch (err) {
        if (!cancelled) {
          setData((prev) => ({ ...prev, status: "error", error: (err as Error).message }));
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}
