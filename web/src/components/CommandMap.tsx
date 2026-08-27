"use client";

// CommandMap: Georeferenced 2D & 3D Geospatial Map View
//
// 1. 2D Mode: MapLibre base map + deck.gl BitmapLayer (fused prospectivity score) + GeoJsonLayers (targets & mines).
// 2. 3D Mode: Georeferenced 3D terrain mesh decoded from terrain.json, draped with the fused prospectivity score,
//    true-elevation surface mine markers, and subsurface depth plumb-line annotations for underground mines (Balaghat: ▼ 383 m).
// 3. Dynamic Controls: 2D ⟷ 3D mode switch pill, vertical exaggeration slider (1x to 8x), and interactive tooltips.

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Turbopack static worker resolution workaround
setWorkerUrl("/maplibre-gl-worker.mjs");

import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import { BitmapLayer, GeoJsonLayer, ScatterplotLayer, PathLayer, TextLayer } from "@deck.gl/layers";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import type { Manifest, FeatureCollectionLike, TerrainData } from "@/lib/contract";

// CARTO Dark Matter vector basemap style
const BASEMAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

interface DecodedTerrain {
  width: number;
  height: number;
  bounds: [number, number, number, number];
  min: number;
  max: number;
  heights: Uint16Array;
}

// Decode base64 Uint16Array heightmap from terrain.json (matching decodeTerrain() logic)
function decodeTerrain(t: TerrainData): DecodedTerrain | null {
  if (!t || !t.data) return null;
  try {
    const bin = atob(t.data);
    const u16 = new Uint16Array(bin.length / 2);
    for (let i = 0; i < u16.length; i++) {
      u16[i] = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
    }
    return {
      width: t.width,
      height: t.height,
      bounds: t.bounds,
      min: t.min,
      max: t.max,
      heights: u16,
    };
  } catch (err) {
    console.error("Failed to decode terrain data:", err);
    return null;
  }
}

// Bilinear interpolation for sampling elevation at exact (lon, lat)
function sampleElevation(lon: number, lat: number, terrain: DecodedTerrain | null): number {
  if (!terrain) return 0;
  const [west, south, east, north] = terrain.bounds;
  if (lon < west || lon > east || lat < south || lat > north) {
    return terrain.min;
  }
  const u = (lon - west) / (east - west);
  const v = (north - lat) / (north - south); // row 0 corresponds to the northern boundary

  const x = Math.max(0, Math.min(terrain.width - 1, u * (terrain.width - 1)));
  const y = Math.max(0, Math.min(terrain.height - 1, v * (terrain.height - 1)));
  const x0 = Math.floor(x);
  const x1 = Math.min(terrain.width - 1, x0 + 1);
  const y0 = Math.floor(y);
  const y1 = Math.min(terrain.height - 1, y0 + 1);
  const dx = x - x0;
  const dy = y - y0;

  const w = terrain.width;
  const h00 = terrain.min + (terrain.heights[y0 * w + x0] / 65535) * (terrain.max - terrain.min);
  const h10 = terrain.min + (terrain.heights[y0 * w + x1] / 65535) * (terrain.max - terrain.min);
  const h01 = terrain.min + (terrain.heights[y1 * w + x0] / 65535) * (terrain.max - terrain.min);
  const h11 = terrain.min + (terrain.heights[y1 * w + x1] / 65535) * (terrain.max - terrain.min);

  const top = h00 * (1 - dx) + h10 * dx;
  const bot = h01 * (1 - dx) + h11 * dx;
  return top * (1 - dy) + bot * dy;
}

// Build 3D mesh geometry buffers with georeferenced coordinates and texture UVs
function buildTerrainMesh(terrain: DecodedTerrain, exaggeration: number) {
  const { width: w, height: h, bounds, min, max, heights } = terrain;
  const [west, south, east, north] = bounds;
  const numVertices = w * h;
  const positions = new Float32Array(numVertices * 3);
  const texCoords = new Float32Array(numVertices * 2);

  for (let j = 0; j < h; j++) {
    const v = j / (h - 1);
    const lat = north - v * (north - south);
    for (let i = 0; i < w; i++) {
      const u = i / (w - 1);
      const lon = west + u * (east - west);
      const idx = j * w + i;
      const rawH = heights[idx];
      const elevM = min + (rawH / 65535) * (max - min);

      const pIdx = idx * 3;
      positions[pIdx] = lon;
      positions[pIdx + 1] = lat;
      positions[pIdx + 2] = elevM * exaggeration;

      const tIdx = idx * 2;
      texCoords[tIdx] = u;
      texCoords[tIdx + 1] = v;
    }
  }

  const numQuads = (w - 1) * (h - 1);
  const indices = new Uint32Array(numQuads * 6);
  let ptr = 0;
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const tl = j * w + i;
      const tr = tl + 1;
      const bl = (j + 1) * w + i;
      const br = bl + 1;

      indices[ptr++] = tl;
      indices[ptr++] = bl;
      indices[ptr++] = tr;

      indices[ptr++] = tr;
      indices[ptr++] = bl;
      indices[ptr++] = br;
    }
  }

  return { positions, texCoords, indices };
}

export default function CommandMap({
  manifest,
  targets,
  mines,
  terrain,
}: {
  manifest: Manifest;
  targets: FeatureCollectionLike;
  mines: FeatureCollectionLike;
  terrain?: TerrainData | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  const [mode, setMode] = useState<"2d" | "3d">("2d");
  const [exaggeration, setExaggeration] = useState<number>(3.5);
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    object: Record<string, unknown> | null;
  } | null>(null);

  // Decode terrain data once when prop arrives
  const decodedTerrain = useMemo(() => {
    return terrain ? decodeTerrain(terrain) : null;
  }, [terrain]);

  // Compute 3D terrain mesh geometry dynamically based on exaggeration
  const terrainMesh = useMemo(() => {
    if (!decodedTerrain) return null;
    return buildTerrainMesh(decodedTerrain, exaggeration);
  }, [decodedTerrain, exaggeration]);

  // Prepare mine data with true sampled surface elevations and subsurface depths
  const mineData = useMemo(() => {
    if (!mines?.features) return [];
    return mines.features.map((feat) => {
      const geom = feat.geometry as { type: string; coordinates: [number, number] };
      const [lon, lat] = geom.coordinates;
      const props = (feat.properties || {}) as {
        name: string;
        mine_type: "underground" | "opencast" | "unknown";
        depth_m?: number | null;
        source?: string;
      };
      const surfaceElev = sampleElevation(lon, lat, decodedTerrain);
      const depth = props.depth_m ?? null;
      return {
        id: feat.properties?.name || `${lon}-${lat}`,
        name: props.name,
        mine_type: props.mine_type,
        depth_m: depth,
        source: props.source,
        lon,
        lat,
        surfaceElevation: surfaceElev * (mode === "3d" ? exaggeration : 0),
        rawSurfaceM: surfaceElev,
        bottomElevation:
          depth !== null
            ? Math.max(0, surfaceElev - depth) * (mode === "3d" ? exaggeration : 0)
            : null,
      };
    });
  }, [mines, decodedTerrain, exaggeration, mode]);

  // Mines with verified underground depth figures (Balaghat: 383m)
  const depthAnnotatedMines = useMemo(() => {
    return mineData.filter(
      (m) => m.mine_type === "underground" && m.depth_m !== null && m.bottomElevation !== null,
    );
  }, [mineData]);

  // Handle 2D <-> 3D view toggle with smooth camera transition
  const toggleMode = useCallback(
    (newMode: "2d" | "3d") => {
      setMode(newMode);
      const map = mapRef.current;
      if (!map) return;

      if (newMode === "3d") {
        map.easeTo({
          pitch: 58,
          bearing: -18,
          duration: 900,
        });
      } else {
        map.easeTo({
          pitch: 0,
          bearing: 0,
          duration: 800,
        });
      }
    },
    [],
  );

  // Initialize MapLibre map and deck.gl MapboxOverlay
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: [79.6, 21.8], // Sausar belt center
      zoom: 7,
      maxPitch: 85,
    });
    mapRef.current = map;

    const overlay = new MapboxOverlay({
      layers: [],
      onHover: (info) => {
        if (info.object) {
          setHoverInfo({
            x: info.x,
            y: info.y,
            object: info.object as Record<string, unknown>,
          });
        } else {
          setHoverInfo(null);
        }
      },
    });
    overlayRef.current = overlay;
    map.addControl(overlay);

    map.on("error", (e) => console.error("MapLibre error:", e.error));

    map.on("load", () => {
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
      overlayRef.current = null;
    };
  }, [manifest.bounds]);

  // Update deck.gl layers reactively on state changes
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const fused = manifest.layers.fused;
    const layers: Layer[] = [];

    if (mode === "2d") {
      // --- 2D LAYERS ---
      if (fused?.static_image) {
        layers.push(
          new BitmapLayer({
            id: "score-fused-2d",
            image: `/data/${fused.static_image}`,
            bounds: fused.bounds,
            opacity: 0.82,
          }),
        );
      }

      layers.push(
        new GeoJsonLayer({
          id: "targets-2d",
          data: targets as never,
          filled: true,
          getFillColor: [200, 255, 61, 90], // --accent-lime
          getLineColor: [200, 255, 61, 230],
          lineWidthMinPixels: 1.5,
          pickable: true,
        }),
        new GeoJsonLayer({
          id: "mines-2d",
          data: mines as never,
          pointType: "circle",
          getPointRadius: 420,
          getFillColor: [237, 239, 231, 255],
          getLineColor: [20, 21, 15, 255],
          lineWidthMinPixels: 2,
          stroked: true,
          pickable: true,
        }),
      );
    } else {
      // --- 3D GEOREFERENCED TERRAIN LAYERS ---
      if (terrainMesh && fused?.static_image) {
        layers.push(
          new SimpleMeshLayer({
            id: "terrain-mesh-3d",
            data: [1],
            mesh: {
              attributes: {
                POSITION: { value: terrainMesh.positions, size: 3 },
                TEXCOORD_0: { value: terrainMesh.texCoords, size: 2 },
              },
              indices: { value: terrainMesh.indices, size: 1 },
            },
            texture: `/data/${fused.static_image}`,
            _instanced: false,
            getColor: [255, 255, 255, 255],
            pickable: false,
          }),
        );
      }

      // 3D Targets Layer
      layers.push(
        new GeoJsonLayer({
          id: "targets-3d",
          data: targets as never,
          filled: true,
          getFillColor: [200, 255, 61, 110],
          getLineColor: [200, 255, 61, 240],
          lineWidthMinPixels: 2,
          pickable: true,
        }),
      );

      // 3D Surface Mine Markers
      layers.push(
        new ScatterplotLayer({
          id: "mines-surface-3d",
          data: mineData,
          getPosition: (d) => [d.lon, d.lat, d.surfaceElevation + 20],
          getRadius: 400,
          getFillColor: (d) =>
            d.mine_type === "underground" ? [96, 165, 250, 255] : [237, 239, 231, 255],
          getLineColor: [20, 21, 15, 255],
          lineWidthMinPixels: 2,
          stroked: true,
          pickable: true,
        }),
      );

      // 3D Subsurface Shaft Plumb-line for underground mines with known depth
      if (depthAnnotatedMines.length > 0) {
        layers.push(
          new PathLayer({
            id: "mines-shafts-3d",
            data: depthAnnotatedMines,
            getPath: (d) => [
              [d.lon, d.lat, d.surfaceElevation + 10],
              [d.lon, d.lat, d.bottomElevation!],
            ],
            getColor: [200, 255, 61, 230], // Lime shaft indicator
            getWidth: 20,
            widthMinPixels: 3,
            pickable: true,
          }),
          new ScatterplotLayer({
            id: "mines-subsurface-points-3d",
            data: depthAnnotatedMines,
            getPosition: (d) => [d.lon, d.lat, d.bottomElevation!],
            getRadius: 300,
            getFillColor: [200, 255, 61, 255],
            getLineColor: [20, 21, 15, 255],
            lineWidthMinPixels: 2,
            stroked: true,
            pickable: true,
          }),
          new TextLayer({
            id: "mines-depth-labels-3d",
            data: depthAnnotatedMines,
            getPosition: (d) => [d.lon, d.lat, d.bottomElevation!],
            getText: (d) => `${d.name}\n▼ ${d.depth_m} m (${d.mine_type})`,
            getSize: 12,
            getColor: [237, 239, 231, 255],
            background: true,
            getBackgroundColor: () => [20, 21, 15, 220],
            backgroundPadding: [6, 4],
            getTextAnchor: "start",
            getAlignmentBaseline: "center",
            getPixelOffset: [16, 0],
            fontFamily: "system-ui, -apple-system, sans-serif",
            fontWeight: 600,
            characterSet: "auto",
            pickable: false,
          }),
        );
      }
    }

    overlay.setProps({ layers });
  }, [mode, manifest, targets, mines, terrainMesh, mineData, depthAnnotatedMines]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* MapLibre Canvas Container */}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* Map Control Floating Card (Top Center / Right) */}
      <div
        style={{
          position: "absolute",
          top: 20,
          right: 250, // Beside the stat cards
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 10,
        }}
      >
        {/* 2D / 3D Mode Switcher */}
        <div
          style={{
            display: "flex",
            background: "var(--glass)",
            border: "1px solid var(--glass-border)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            borderRadius: 999,
            padding: 3,
            gap: 4,
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
          }}
        >
          <button
            type="button"
            onClick={() => toggleMode("2d")}
            style={{
              border: "none",
              borderRadius: 999,
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              background: mode === "2d" ? "var(--accent-lime)" : "transparent",
              color: mode === "2d" ? "var(--chip-dark)" : "var(--ink)",
              transition: "all 0.18s ease",
            }}
          >
            2D Map
          </button>
          <button
            type="button"
            onClick={() => toggleMode("3d")}
            style={{
              border: "none",
              borderRadius: 999,
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              background: mode === "3d" ? "var(--accent-lime)" : "transparent",
              color: mode === "3d" ? "var(--chip-dark)" : "var(--ink)",
              transition: "all 0.18s ease",
            }}
          >
            3D Terrain
          </button>
        </div>

        {/* 3D Vertical Exaggeration Slider Control */}
        {mode === "3d" && (
          <div
            style={{
              background: "var(--glass)",
              border: "1px solid var(--glass-border)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              borderRadius: 14,
              padding: "10px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              minWidth: 160,
              boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--ink-dim)",
              }}
            >
              <span>RELIEF EXAGGERATION</span>
              <span style={{ color: "var(--accent-lime)", fontFamily: "monospace" }}>
                {exaggeration.toFixed(1)}x
              </span>
            </div>
            <input
              type="range"
              min="1.0"
              max="8.0"
              step="0.5"
              value={exaggeration}
              onChange={(e) => setExaggeration(parseFloat(e.target.value))}
              style={{
                width: "100%",
                accentColor: "var(--accent-lime)",
                cursor: "pointer",
              }}
            />
            <div
              style={{
                fontSize: 10,
                color: "var(--ink-dim)",
                textAlign: "center",
                marginTop: 2,
              }}
            >
              Right-click / Ctrl+Drag to orbit
            </div>
          </div>
        )}
      </div>

      {/* Interactive Feature Tooltip */}
      {hoverInfo && hoverInfo.object && (
        <div
          style={{
            position: "absolute",
            left: hoverInfo.x + 12,
            top: hoverInfo.y + 12,
            pointerEvents: "none",
            background: "rgba(20, 21, 15, 0.92)",
            border: "1px solid var(--glass-border)",
            backdropFilter: "blur(12px)",
            borderRadius: 10,
            padding: "8px 12px",
            color: "var(--ink)",
            fontSize: 12,
            zIndex: 100,
            boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
            maxWidth: 240,
          }}
        >
          {hoverInfo.object.name ? (
            <div>
              <strong style={{ display: "block", color: "var(--accent-lime)" }}>
                {String(hoverInfo.object.name)}
              </strong>
              <div style={{ color: "var(--ink-dim)", fontSize: 11, marginTop: 2 }}>
                Type: {String(hoverInfo.object.mine_type || "N/A")}
              </div>
              {hoverInfo.object.depth_m !== undefined && hoverInfo.object.depth_m !== null && (
                <div style={{ color: "var(--accent-lime)", fontSize: 11, fontWeight: 600 }}>
                  Depth: ▼ {String(hoverInfo.object.depth_m)} m
                </div>
              )}
              {hoverInfo.object.rawSurfaceM !== undefined && (
                <div style={{ color: "var(--ink-dim)", fontSize: 10 }}>
                  Elev: {Math.round(Number(hoverInfo.object.rawSurfaceM))} m ASL
                </div>
              )}
            </div>
          ) : hoverInfo.object.properties ? (
            <div>
              <strong style={{ display: "block", color: "var(--accent-lime)" }}>
                Target #{String((hoverInfo.object.properties as Record<string, unknown>).rank || "—")}
              </strong>
              <div style={{ color: "var(--ink-dim)", fontSize: 11, marginTop: 2 }}>
                Area: {String((hoverInfo.object.properties as Record<string, unknown>).area_ha || 0)} ha
              </div>
              <div style={{ color: "var(--ink-dim)", fontSize: 11 }}>
                Score: {Number((hoverInfo.object.properties as Record<string, unknown>).score_mean || 0).toFixed(2)}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
