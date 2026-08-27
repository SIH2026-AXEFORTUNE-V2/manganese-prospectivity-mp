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
import { TileLayer } from "@deck.gl/geo-layers";
import type { Manifest, LayerManifest, FeatureCollectionLike } from "@/lib/contract";

// CARTO's free, keyless dark vector basemap - matches the UI reference's dark hero.
// Swap for a Mapbox/MapTiler style later if the team gets a token; nothing else changes.
const BASEMAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// Picks tiles when available, falls back to a single draped image otherwise. Never returns
// null silently without a reason - a layer manifest with neither field set is a data bug,
// not a "just don't draw anything" case, so it's worth being able to grep the console for.
function buildScoreLayer(layer: LayerManifest | undefined): Layer | null {
  if (!layer) return null;

  if (layer.tiles) {
    // layer.tiles is already an absolute path template, e.g. "/tiles/fused/{z}/{x}/{y}.png"
    // (docs/04-data-contract.md) - don't prefix it again here.
    return new TileLayer({
      id: "score-fused-tiles",
      data: layer.tiles,
      minZoom: 0,
      maxZoom: 19,
      tileSize: 256,
      opacity: 0.8,
      renderSubLayers: (props) => {
        const { boundingBox } = props.tile;
        const [[west, south], [east, north]] = boundingBox as [[number, number], [number, number]];
        return new BitmapLayer(props, {
          data: undefined,
          image: props.data,
          bounds: [west, south, east, north],
        });
      },
    });
  }

  if (layer.static_image) {
    return new BitmapLayer({
      id: "score-fused",
      image: `/data/${layer.static_image}`,
      bounds: layer.bounds,
      opacity: 0.8,
    });
  }

  console.warn("score layer has neither `tiles` nor `static_image` - nothing to draw", layer);
  return null;
}

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

      // Seat 3 now ships real XYZ tiles for belt_sausar (docs/issues/01-statewide-tiling.md) -
      // `fused.tiles` is a "/tiles/fused/{z}/{x}/{y}.png" template. `static_image` stays as
      // the fallback for any AOI that hasn't been tiled yet (e.g. a quick local run), so this
      // never silently shows nothing the way it did the moment the contract's static_image
      // went null with no tile path wired up to replace it.
      const scoreLayer = buildScoreLayer(fused);
      if (scoreLayer) layers.push(scoreLayer);

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
