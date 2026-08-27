"use client";

// The one working example the rest of the geospatial build extends. It does three things:
//   1. Opens a real, georeferenced MapLibre map (no API token needed).
//   2. Drapes the fused prospectivity score on top as an image layer via deck.gl.
//   3. Draws the ranked targets and known mines as GeoJSON layers on top of that.
//
// docs/issues/02-3d-terrain-layer.md extends this same file to add the 3D/terrain view -
// it does not start a new map from scratch, it adds a TerrainLayer next to BitmapLayer here.
//
// Data comes in as props, already fetched by useOreCompassData - this component never
// fetches on its own, so the map and the target rail on the page never disagree about
// what they're showing.

import { useEffect, useRef } from "react";
import { Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Turbopack (and Webpack before it) can't statically resolve the `new Worker(...)` call
// maplibre-gl makes internally to load its own tile-processing worker - the worker script
// silently 404s (served as the app's HTML shell instead), so tiles never render and the
// map looks empty with no console error. Pointing it at a plain static copy of the same
// worker file sidesteps bundler resolution entirely. Keep this file in sync with the
// installed maplibre-gl version:
//   cp node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs public/maplibre-gl-worker.mjs
setWorkerUrl("/maplibre-gl-worker.mjs");
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import { BitmapLayer, GeoJsonLayer } from "@deck.gl/layers";
import type { Manifest, FeatureCollectionLike } from "@/lib/contract";

// CARTO's free, keyless dark vector basemap - matches the UI reference's dark hero.
// Swap for a Mapbox/MapTiler style later if the team gets a token; nothing else changes.
const BASEMAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export default function CommandMap({
  manifest,
  targets,
  mines,
}: {
  manifest: Manifest;
  targets: FeatureCollectionLike;
  mines: FeatureCollectionLike;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: [79.6, 21.8], // Sausar belt, roughly - fitBounds below overrides this
      zoom: 7,
    });
    mapRef.current = map;

    const overlay = new MapboxOverlay({ layers: [] });
    map.addControl(overlay);

    // MapLibre swallows a lot of tile/style-loading failures as silent no-ops rather than
    // throwing - this is the one signal you get. If the map ever looks blank, check here
    // before assuming the layers are wrong.
    map.on("error", (e) => console.error("MapLibre error:", e.error));

    map.on("load", () => {
      const fused = manifest.layers.fused;
      const layers: Layer[] = [];

      // The fused score, draped as a plain image today. Once Seat 3 ships real XYZ tiles
      // (see docs/04-data-contract.md - `tiles` becomes non-null), replace this BitmapLayer
      // with a deck.gl TileLayer reading `fused.tiles`. Nothing else on this page changes,
      // which is the entire point of freezing the contract first.
      if (fused?.static_image) {
        layers.push(
          new BitmapLayer({
            id: "score-fused",
            image: `/data/${fused.static_image}`,
            bounds: fused.bounds,
            opacity: 0.8,
          }),
        );
      }

      layers.push(
        new GeoJsonLayer({
          id: "targets",
          data: targets as never,
          filled: true,
          getFillColor: [200, 255, 61, 90], // --accent-lime, translucent
          getLineColor: [200, 255, 61, 220],
          lineWidthMinPixels: 1,
          pickable: true,
        }),
        new GeoJsonLayer({
          id: "mines",
          data: mines as never,
          pointType: "circle",
          getPointRadius: 400,
          getFillColor: [237, 239, 231, 255],
          pickable: true,
        }),
      );

      overlay.setProps({ layers });

      if (manifest.bounds) {
        const [west, south, east, north] = manifest.bounds;
        map.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          { padding: 60, duration: 0 },
        );
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // manifest/targets/mines come from one shared fetch at the page level and don't change
    // after load - intentionally not in the dependency array to avoid rebuilding the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
