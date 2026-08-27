"use client";

// CommandMap: Georeferenced 2D & 3D Geospatial Map View
//
// 1. 2D Mode: MapLibre base map + deck.gl BitmapLayer (fused prospectivity score) + GeoJsonLayers (targets & mines).
// 2. 3D Mode: Georeferenced 3D terrain mesh decoded from terrain.json, draped with the fused prospectivity score,
//    true-elevation surface mine markers, and subsurface depth plumb-line annotations for underground mines (Balaghat: ▼ 383 m).
// 3. Search location panel: type a place name or coordinate, or click the map, to pin a point and read
//    its latitude/longitude/elevation back in one line.
// 4. Heatmap legend, map-scale bar, active-layer readout and a transparency slider for the draped score.
// 5. Numbered, coloured zone pins (rank 1 = best in this AOI) tying the map straight to the ranked-zone
//    cards below it - a pin and its card always share a number and a colour.

import { useEffect, useRef, useState, useMemo, useCallback, type CSSProperties } from "react";
import { Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapPin, Copy, ArrowDown, Search, ArrowLeftRight, Info, Maximize2, Minimize2, Layers, ChevronDown } from "lucide-react";

// Turbopack static worker resolution workaround
setWorkerUrl("/maplibre-gl-worker.mjs");

import { MapboxOverlay } from "@deck.gl/mapbox";
import { COORDINATE_SYSTEM } from "@deck.gl/core";
import type { Layer } from "@deck.gl/core";
import { BitmapLayer, GeoJsonLayer, ScatterplotLayer, PathLayer, TextLayer, IconLayer } from "@deck.gl/layers";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import { TileLayer } from "@deck.gl/geo-layers";
import type { Manifest, LayerManifest, FeatureCollectionLike, TerrainData } from "@/lib/contract";
// Terrain decode/sample live in lib/terrain.ts so the Mn hex grid reads elevations off the
// exact same heightmap this view renders - see the note at the top of that file.
import { decodeTerrain, sampleElevation, type DecodedTerrain } from "@/lib/terrain";

// CARTO Dark Matter vector basemap style
const BASEMAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// Same magma family MnHexMap ramps tonnage with, so the legend reads as one dataset across
// both map views rather than two different opinions about what "high" means.
const LEGEND_RAMP = ["rgb(12,8,38)", "rgb(70,16,105)", "rgb(138,36,99)", "rgb(205,64,68)", "rgb(246,134,37)", "rgb(252,220,141)"];

interface PickedLocation {
  lat: number;
  lon: number;
  elev: number;
  name?: string;
  type?: string;
}

/** A ranked zone's map pin - number + colour are computed by the caller from the same
 *  gradeBand/confidence the zone card underneath shows, so a pin and its card never disagree. */
export interface ZonePin {
  rank: number;
  order: number;
  colorHex: string;
}

// Preset prominent Indian mining locations in the Sausar Manganese Belt (MP / MH) - also what
// the search box matches against by name.
const PRESET_LOCATIONS: Array<{ name: string; lat: number; lon: number; type: string }> = [
  { name: "Balaghat (Bharveli)", lat: 21.851853, lon: 80.239336, type: "Underground Mine" },
  { name: "Ukwa", lat: 21.972343, lon: 80.457069, type: "Underground Mine" },
  { name: "Tirodi", lat: 21.681971, lon: 79.719128, type: "Opencast Mine" },
  { name: "Dongri Buzurg", lat: 21.543965, lon: 79.676276, type: "Opencast Mine" },
  { name: "Chikla", lat: 21.53801, lon: 79.74348, type: "Underground Mine" },
  { name: "Mansar", lat: 21.402786, lon: 79.255341, type: "Underground Mine" },
  { name: "Munsar", lat: 21.404754, lon: 79.286392, type: "Underground Mine" },
];

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

// Format latitude and longitude nicely with N/S and E/W direction notation
function formatCoordinates(lat: number, lon: number): string {
  const latStr = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}`;
  const lonStr = `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? "E" : "W"}`;
  return `${latStr}, ${lonStr}`;
}

// Picks tiles when available, falls back to a single draped image otherwise. Also used as
// the 3D mesh texture below - the score layer is the score layer regardless of view mode.
// Never returns null silently without a reason - a layer manifest with neither field set is
// a data bug, not a "just don't draw anything" case, so it's worth being able to grep the
// console for.
function buildScoreLayer(layer: LayerManifest | undefined, opacity: number): Layer | null {
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
      opacity,
      // The belt is an irregular polygon, not a rectangle - build_tiles.py only generates
      // PNGs for tiles that actually intersect it (src.dashboard.build_tiles's
      // _iter_intersecting_tiles), so any tile at the viewport's edge that falls outside the
      // belt legitimately 404s. That's expected, not a bug - swallow it here instead of
      // letting it surface as an unhandled rejection Next's dev overlay treats as a crash.
      onTileError: (err: unknown) => {
        console.debug("score tile outside belt coverage (expected):", err);
      },
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
      opacity,
    });
  }

  console.warn("score layer has neither `tiles` nor `static_image` - nothing to draw", layer);
  return null;
}

/** Generates (and caches) a small teardrop pin SVG, tinted per colour, for IconLayer. */
const pinIconCache = new Map<string, string>();
function pinIconUrl(hex: string): string {
  const cached = pinIconCache.get(hex);
  if (cached) return cached;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="56" viewBox="0 0 44 56">
    <path d="M22 2C11 2 3 10.2 3 20.6 3 33 22 54 22 54s19-21 19-33.4C41 10.2 33 2 22 2z" fill="${hex}" stroke="#14150f" stroke-width="2.5"/>
    <circle cx="22" cy="20.5" r="12.5" fill="#ffffff"/>
  </svg>`;
  const url = `data:image/svg+xml;base64,${typeof window === "undefined" ? "" : btoa(svg)}`;
  pinIconCache.set(hex, url);
  return url;
}

export default function CommandMap({
  manifest,
  targets,
  mines,
  terrain,
  zonePins,
}: {
  manifest: Manifest;
  targets: FeatureCollectionLike;
  mines: FeatureCollectionLike;
  terrain?: TerrainData | null;
  /** Rank -> {order, colour} for the numbered pins. Omit outside a project AOI (e.g. Atlas). */
  zonePins?: ZonePin[];
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  const [mode, setMode] = useState<"2d" | "3d">("2d");
  const [exaggeration, setExaggeration] = useState<number>(3.5);
  const [opacity, setOpacity] = useState<number>(0.7);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    object: Record<string, unknown> | null;
  } | null>(null);

  const [pickedLocation, setPickedLocation] = useState<PickedLocation>({
    lat: 21.851853,
    lon: 80.239336,
    elev: 320,
    name: "Balaghat / Bharveli Mine (Default)",
    type: "Underground Manganese Mine",
  });

  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lon: number; elev: number; zoom: number }>({
    lat: 21.85,
    lon: 79.6,
    elev: 320,
    zoom: 7.0,
  });

  const decodedTerrain = useMemo(() => (terrain ? decodeTerrain(terrain) : null), [terrain]);

  const terrainMesh = useMemo(() => {
    if (!decodedTerrain) return null;
    return buildTerrainMesh(decodedTerrain, exaggeration);
  }, [decodedTerrain, exaggeration]);

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
        bottomElevation: depth !== null ? Math.max(0, surfaceElev - depth) * (mode === "3d" ? exaggeration : 0) : null,
      };
    });
  }, [mines, decodedTerrain, exaggeration, mode]);

  const depthAnnotatedMines = useMemo(
    () => mineData.filter((m) => m.mine_type === "underground" && m.depth_m !== null && m.bottomElevation !== null),
    [mineData],
  );

  const pickedPinData = useMemo(() => {
    if (!pickedLocation) return [];
    const elev = sampleElevation(pickedLocation.lon, pickedLocation.lat, decodedTerrain);
    return [{ ...pickedLocation, surfaceElevation: elev * (mode === "3d" ? exaggeration : 0) }];
  }, [pickedLocation, decodedTerrain, exaggeration, mode]);

  // Numbered zone pins: one per target feature that has a matching ZonePin (rank -> order/colour).
  const zonePinData = useMemo(() => {
    if (!zonePins || zonePins.length === 0 || !targets?.features) return [];
    const byRank = new Map(zonePins.map((z) => [z.rank, z]));
    return targets.features
      .map((f) => {
        const props = (f.properties || {}) as { rank?: number; lat?: number; lon?: number };
        if (props.rank === undefined) return null;
        const pin = byRank.get(props.rank);
        if (!pin || props.lat === undefined || props.lon === undefined) return null;
        const surfaceElev = sampleElevation(props.lon, props.lat, decodedTerrain);
        return {
          rank: props.rank,
          order: pin.order,
          colorHex: pin.colorHex,
          lat: props.lat,
          lon: props.lon,
          surfaceElevation: surfaceElev * (mode === "3d" ? exaggeration : 0),
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .sort((a, b) => a.order - b.order);
  }, [zonePins, targets, decodedTerrain, exaggeration, mode]);

  function flyAndPick(lat: number, lon: number, elev: number, name: string, type: string) {
    setPickedLocation({ lat, lon, elev: Math.round(elev), name, type });
    const map = mapRef.current;
    if (map) {
      map.flyTo({ center: [lon, lat], zoom: Math.max(9.5, map.getZoom()), duration: 1200 });
    }
  }

  const handleSelectPreset = (preset: (typeof PRESET_LOCATIONS)[0]) => {
    const elev = sampleElevation(preset.lon, preset.lat, decodedTerrain);
    flyAndPick(preset.lat, preset.lon, elev, preset.name, preset.type);
  };

  // Search box: matches a preset by name fragment, or accepts a "lat, lon" pair typed in
  // directly - the two things someone actually types into a field like this.
  const runSearch = useCallback(() => {
    const q = searchText.trim();
    if (!q) return;
    const coordMatch = q.match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lon = parseFloat(coordMatch[2]);
      const elev = sampleElevation(lon, lat, decodedTerrain);
      flyAndPick(lat, lon, elev, "Searched coordinate", "Typed lat, lon");
      return;
    }
    const hit = PRESET_LOCATIONS.find((p) => p.name.toLowerCase().includes(q.toLowerCase()));
    if (hit) handleSelectPreset(hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, decodedTerrain]);

  function swapLatLon() {
    setPickedLocation((p) => {
      const next = { ...p, lat: p.lon, lon: p.lat, name: "Custom pin", type: "Swapped coordinates" };
      const map = mapRef.current;
      if (map) map.flyTo({ center: [next.lon, next.lat], duration: 600 });
      return next;
    });
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(`Copied ${label}!`);
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  const toggleMode = useCallback((newMode: "2d" | "3d") => {
    setMode(newMode);
    const map = mapRef.current;
    if (!map) return;
    if (newMode === "3d") {
      map.easeTo({ pitch: 58, bearing: -18, duration: 900 });
    } else {
      map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      void el.requestFullscreen();
    } else {
      void document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      // The map's canvas needs to know its box changed size once the fullscreen transition
      // settles - MapLibre's own ResizeObserver can miss the exact frame the OS chrome hides.
      setTimeout(() => mapRef.current?.resize(), 60);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Initialize MapLibre map and deck.gl MapboxOverlay
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: [79.6, 21.8],
      zoom: 7,
      maxPitch: 85,
    });
    mapRef.current = map;

    const overlay = new MapboxOverlay({
      layers: [],
      onHover: (info) => {
        if (info.object) {
          setHoverInfo({ x: info.x, y: info.y, object: info.object as Record<string, unknown> });
        } else {
          setHoverInfo(null);
        }
      },
    });
    overlayRef.current = overlay;
    map.addControl(overlay);

    map.on("error", (e) => console.error("MapLibre error:", e.error));

    map.on("click", (e) => {
      const lon = e.lngLat.lng;
      const lat = e.lngLat.lat;
      const elev = sampleElevation(lon, lat, decodedTerrain);
      setPickedLocation({ lat, lon, elev: Math.round(elev), name: "Custom location pin", type: "Coordinates picked from map" });
    });

    map.on("mousemove", (e) => {
      const lon = e.lngLat.lng;
      const lat = e.lngLat.lat;
      const elev = sampleElevation(lon, lat, decodedTerrain);
      setCursorCoords({ lon, lat, elev: Math.round(elev), zoom: parseFloat(map.getZoom().toFixed(1)) });
    });

    map.on("move", () => {
      setCursorCoords((prev) => ({ ...prev, zoom: parseFloat(map.getZoom().toFixed(1)) }));
    });

    map.on("load", () => {
      if (manifest.bounds) {
        const [west, south, east, north] = manifest.bounds;
        map.fitBounds([[west, south], [east, north]], { padding: 60, duration: 0 });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, [manifest.bounds, decodedTerrain]);

  // Update deck.gl layers reactively on state changes
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const fused = manifest.layers.fused;
    const layers: Layer[] = [];

    if (mode === "2d") {
      const scoreLayer2d = buildScoreLayer(fused, opacity);
      if (scoreLayer2d) layers.push(scoreLayer2d);

      layers.push(
        new GeoJsonLayer({
          id: "targets-2d",
          data: targets as never,
          filled: true,
          getFillColor: [200, 255, 61, 60],
          getLineColor: [200, 255, 61, 180],
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
            coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
            texture: `/data/${fused.static_image}`,
            _instanced: false,
            getColor: [255, 255, 255, 255],
            pickable: false,
          }),
        );
      }

      layers.push(
        new GeoJsonLayer({
          id: "targets-3d",
          data: targets as never,
          filled: true,
          getFillColor: [200, 255, 61, 90],
          getLineColor: [200, 255, 61, 220],
          lineWidthMinPixels: 2,
          pickable: true,
        }),
      );

      layers.push(
        new ScatterplotLayer({
          id: "mines-surface-3d",
          data: mineData,
          getPosition: (d) => [d.lon, d.lat, d.surfaceElevation + 20],
          getRadius: 400,
          getFillColor: (d) => (d.mine_type === "underground" ? [96, 165, 250, 255] : [237, 239, 231, 255]),
          getLineColor: [20, 21, 15, 255],
          lineWidthMinPixels: 2,
          stroked: true,
          pickable: true,
        }),
      );

      if (depthAnnotatedMines.length > 0) {
        layers.push(
          new PathLayer({
            id: "mines-shafts-3d",
            data: depthAnnotatedMines,
            getPath: (d) => [
              [d.lon, d.lat, d.surfaceElevation + 10],
              [d.lon, d.lat, d.bottomElevation!],
            ],
            getColor: [200, 255, 61, 230],
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

    // --- NUMBERED ZONE PINS (both modes) ---
    if (zonePinData.length > 0) {
      layers.push(
        new IconLayer({
          id: "zone-pins",
          data: zonePinData,
          getPosition: (d) => [d.lon, d.lat, (d.surfaceElevation || 0) + 15],
          getIcon: (d) => ({ url: pinIconUrl(d.colorHex), width: 44, height: 56, anchorY: 56, anchorX: 22 }),
          sizeUnits: "pixels",
          getSize: 40,
          pickable: true,
          billboard: true,
        }),
        new TextLayer({
          id: "zone-pin-numbers",
          data: zonePinData,
          getPosition: (d) => [d.lon, d.lat, (d.surfaceElevation || 0) + 15],
          getText: (d) => String(d.order),
          getSize: 13,
          getColor: [20, 21, 15, 255],
          getPixelOffset: [0, -29],
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontWeight: 800,
          billboard: true,
          pickable: false,
        }),
      );
    }

    // --- PICKED PIN MARKER (both modes) ---
    if (pickedPinData.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: "picked-pin-glow",
          data: pickedPinData,
          getPosition: (d) => [d.lon, d.lat, (d.surfaceElevation || 0) + 30],
          getRadius: 700,
          getFillColor: [200, 255, 61, 70],
          getLineColor: [200, 255, 61, 255],
          lineWidthMinPixels: 2,
          stroked: true,
          pickable: false,
        }),
        new ScatterplotLayer({
          id: "picked-pin-core",
          data: pickedPinData,
          getPosition: (d) => [d.lon, d.lat, (d.surfaceElevation || 0) + 35],
          getRadius: 260,
          getFillColor: [200, 255, 61, 255],
          getLineColor: [20, 21, 15, 255],
          lineWidthMinPixels: 2.5,
          stroked: true,
          pickable: false,
        }),
        new TextLayer({
          id: "picked-pin-label",
          data: pickedPinData,
          getPosition: (d) => [d.lon, d.lat, (d.surfaceElevation || 0) + 40],
          // Rendered onto the WebGL canvas by deck.gl's SDF text layer, not the DOM - a React
          // icon component can't appear here, so this stays a plain label (no pin glyph).
          getText: (d) => `${d.name || "Picked Point"}\n${formatCoordinates(d.lat, d.lon)}`,
          getSize: 12,
          getColor: [237, 239, 231, 255],
          background: true,
          getBackgroundColor: () => [20, 21, 15, 235],
          backgroundPadding: [6, 4],
          getTextAnchor: "middle",
          getAlignmentBaseline: "bottom",
          getPixelOffset: [0, -16],
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontWeight: 600,
          characterSet: "auto",
          pickable: false,
        }),
      );
    }

    overlay.setProps({ layers });
  }, [mode, manifest, targets, mines, terrainMesh, mineData, depthAnnotatedMines, pickedPinData, zonePinData, opacity]);

  return (
    <div ref={wrapperRef} style={{ position: "relative", width: "100%", height: "100%", background: "var(--bg-2)" }}>
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 300,
          right: 0,
          borderRadius: isFullscreen ? 0 : 20,
          overflow: "hidden",
          border: "1px solid var(--glass-border)",
          background: "var(--bg-2)",
        }}
      />

      {/* ---------------------------------------------------------- left control rail -- */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: 280,
          overflowY: "auto",
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          padding: "0 12px 12px 0",
        }}
      >
        {/* Search location */}
        <div style={panelCard}>
          <div style={sectionLabel}>Search location</div>
          <div style={{ position: "relative", marginTop: 8 }}>
            <Search size={13} color="var(--ink-dim)" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="Search by place or coordinate…"
              style={{ ...fieldInput, paddingLeft: 28 }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 6, alignItems: "end", marginTop: 10 }}>
            <label style={miniLabel}>
              Latitude
              <input
                type="number"
                step="0.0001"
                value={pickedLocation.lat}
                onChange={(e) => setPickedLocation((p) => ({ ...p, lat: parseFloat(e.target.value) || 0 }))}
                style={fieldInput}
              />
            </label>
            <button type="button" onClick={swapLatLon} title="Swap latitude / longitude" style={swapBtn}>
              <ArrowLeftRight size={13} />
            </button>
            <label style={miniLabel}>
              Longitude
              <input
                type="number"
                step="0.0001"
                value={pickedLocation.lon}
                onChange={(e) => setPickedLocation((p) => ({ ...p, lon: parseFloat(e.target.value) || 0 }))}
                style={fieldInput}
              />
            </label>
          </div>

          <button
            type="button"
            onClick={() => {
              const map = mapRef.current;
              const elev = sampleElevation(pickedLocation.lon, pickedLocation.lat, decodedTerrain);
              setPickedLocation((p) => ({ ...p, elev: Math.round(elev) }));
              if (map) map.flyTo({ center: [pickedLocation.lon, pickedLocation.lat], zoom: Math.max(9.5, map.getZoom()), duration: 900 });
            }}
            style={coordChip}
          >
            <MapPin size={12} color="var(--accent-lime)" />
            <span>{formatCoordinates(pickedLocation.lat, pickedLocation.lon)}</span>
            <span style={{ color: "var(--ink-dim)" }}>|</span>
            <span>{pickedLocation.elev} m ASL</span>
            <span style={{ color: "var(--ink-dim)" }}>|</span>
            <span>z {cursorCoords.zoom}</span>
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                copyToClipboard(`${pickedLocation.lat.toFixed(4)}, ${pickedLocation.lon.toFixed(4)}`, "coordinates");
              }}
              style={{ marginLeft: "auto", display: "flex" }}
            >
              <Copy size={11} color="var(--ink-dim)" />
            </span>
          </button>
          {copyFeedback && <div style={{ fontSize: 10.5, color: "var(--accent-lime)", marginTop: 4 }}>{copyFeedback}</div>}
        </div>

        {/* Heatmap legend */}
        <div style={panelCard}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={sectionLabel}>Heatmap legend</div>
            <Info size={12} color="var(--ink-dim)" />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--ink-dim)", marginTop: 8 }}>
            <span>Low prospectivity</span>
            <span>High prospectivity</span>
          </div>
          <div style={{ height: 9, borderRadius: 999, marginTop: 4, background: `linear-gradient(90deg, ${LEGEND_RAMP.join(",")})` }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: "#0e0f0c", flexShrink: 0 }} />
            <span style={{ fontSize: 10.5, color: "var(--ink-dim)" }}>Masked / No data</span>
          </div>
        </div>

        {/* Map scale */}
        <div style={panelCard}>
          <div style={sectionLabel}>Map scale</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--ink-dim)", marginTop: 8 }}>
            <span>0</span>
            <span>5</span>
            <span>10</span>
            <span>15 km</span>
          </div>
          <div style={{ height: 5, borderRadius: 999, marginTop: 4, background: "linear-gradient(90deg, var(--accent-lime), var(--glass-border))" }} />
        </div>

        {/* Active layer */}
        <div style={panelCard}>
          <div style={sectionLabel}>Active layer</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, border: "1px solid var(--glass-border)", borderRadius: 10, padding: "8px 10px" }}>
            <Layers size={13} color="var(--accent-lime)" />
            <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>Manganese Prospectivity</span>
            <ChevronDown size={13} color="var(--ink-dim)" />
          </div>
        </div>

        {/* Transparency */}
        <div style={panelCard}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={sectionLabel}>Transparency</div>
            <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--accent-lime)" }}>{Math.round(opacity * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(opacity * 100)}
            onChange={(e) => setOpacity(parseInt(e.target.value, 10) / 100)}
            style={{ width: "100%", accentColor: "var(--accent-lime)", cursor: "pointer", marginTop: 8 }}
          />
        </div>
      </div>

      {/* --------------------------------------------------------------- fullscreen -- */}
      <button
        type="button"
        onClick={toggleFullscreen}
        title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          zIndex: 10,
          width: 32,
          height: 32,
          display: "grid",
          placeItems: "center",
          background: "var(--glass)",
          border: "1px solid var(--glass-border)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderRadius: 9,
          cursor: "pointer",
          color: "var(--ink)",
          boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
        }}
      >
        {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      </button>

      {/* --------------------------------------------------- 2D/3D + exaggeration -- */}
      <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, zIndex: 10 }}>
        <div style={{ display: "flex", background: "var(--glass)", border: "1px solid var(--glass-border)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderRadius: 999, padding: 3, gap: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
          <button
            type="button"
            onClick={() => toggleMode("2d")}
            style={{ border: "none", borderRadius: 999, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", background: mode === "2d" ? "var(--accent-lime)" : "transparent", color: mode === "2d" ? "var(--chip-dark)" : "var(--ink)", transition: "all 0.18s ease" }}
          >
            2D Map
          </button>
          <button
            type="button"
            onClick={() => toggleMode("3d")}
            style={{ border: "none", borderRadius: 999, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", background: mode === "3d" ? "var(--accent-lime)" : "transparent", color: mode === "3d" ? "var(--chip-dark)" : "var(--ink)", transition: "all 0.18s ease" }}
          >
            3D Terrain
          </button>
        </div>

        {mode === "3d" && (
          <div style={{ background: "var(--glass)", border: "1px solid var(--glass-border)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderRadius: 14, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6, minWidth: 160, boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, fontWeight: 600, color: "var(--ink-dim)" }}>
              <span>RELIEF EXAGGERATION</span>
              <span style={{ color: "var(--accent-lime)", fontFamily: "monospace" }}>{exaggeration.toFixed(1)}x</span>
            </div>
            <input type="range" min="1.0" max="8.0" step="0.5" value={exaggeration} onChange={(e) => setExaggeration(parseFloat(e.target.value))} style={{ width: "100%", accentColor: "var(--accent-lime)", cursor: "pointer" }} />
            <div style={{ fontSize: 10, color: "var(--ink-dim)", textAlign: "center", marginTop: 2 }}>Right-click / Ctrl+Drag to orbit</div>
          </div>
        )}
      </div>

      {/* ----------------------------------------------------------- hover tooltip -- */}
      {hoverInfo && hoverInfo.object && (
        <div
          style={{
            position: "absolute",
            left: hoverInfo.x + 12,
            top: hoverInfo.y + 12,
            pointerEvents: "none",
            background: "rgba(20, 21, 15, 0.94)",
            border: "1px solid var(--glass-border)",
            backdropFilter: "blur(12px)",
            borderRadius: 10,
            padding: "9px 13px",
            color: "var(--ink)",
            fontSize: 12,
            zIndex: 100,
            boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
            maxWidth: 260,
          }}
        >
          {hoverInfo.object.name ? (
            <div>
              <strong style={{ display: "block", color: "var(--accent-lime)", fontSize: 13 }}>{String(hoverInfo.object.name)}</strong>
              <div style={{ color: "var(--ink-dim)", fontSize: 11, marginTop: 2 }}>
                Type: <span style={{ color: "var(--ink)", fontWeight: 500 }}>{String(hoverInfo.object.mine_type || "N/A")}</span>
              </div>
              <div style={{ color: "var(--ink-dim)", fontSize: 11, fontFamily: "monospace", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                <MapPin size={11} /> {formatCoordinates(Number(hoverInfo.object.lat), Number(hoverInfo.object.lon))}
              </div>
              {hoverInfo.object.depth_m !== undefined && hoverInfo.object.depth_m !== null && (
                <div style={{ color: "var(--accent-lime)", fontSize: 11, fontWeight: 600, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                  Depth: <ArrowDown size={11} /> {String(hoverInfo.object.depth_m)} m
                </div>
              )}
              {hoverInfo.object.rawSurfaceM !== undefined && (
                <div style={{ color: "var(--ink-dim)", fontSize: 10, marginTop: 1 }}>Elev: {Math.round(Number(hoverInfo.object.rawSurfaceM))} m ASL</div>
              )}
            </div>
          ) : hoverInfo.object.order !== undefined ? (
            <div>
              <strong style={{ display: "block", color: "var(--accent-lime)", fontSize: 13 }}>Zone #{String(hoverInfo.object.order)}</strong>
              <div style={{ color: "var(--ink-dim)", fontSize: 11, marginTop: 2, fontFamily: "monospace" }}>
                {formatCoordinates(Number(hoverInfo.object.lat), Number(hoverInfo.object.lon))}
              </div>
            </div>
          ) : hoverInfo.object.properties ? (
            <div>
              <strong style={{ display: "block", color: "var(--accent-lime)", fontSize: 13 }}>
                Target #{String((hoverInfo.object.properties as Record<string, unknown>).rank || "—")}
              </strong>
              <div style={{ color: "var(--ink-dim)", fontSize: 11, marginTop: 2 }}>
                Area: <span style={{ color: "var(--ink)", fontWeight: 500 }}>{String((hoverInfo.object.properties as Record<string, unknown>).area_ha || 0)} ha</span>
              </div>
              <div style={{ color: "var(--ink-dim)", fontSize: 11 }}>
                Score: <span style={{ color: "var(--accent-lime)", fontWeight: 600 }}>{Number((hoverInfo.object.properties as Record<string, unknown>).score_mean || 0).toFixed(2)}</span>
              </div>
              {(hoverInfo.object.properties as Record<string, unknown>).lat !== undefined && (
                <div style={{ color: "var(--ink-dim)", fontSize: 10, fontFamily: "monospace", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                  <MapPin size={10} />{" "}
                  {formatCoordinates(
                    Number((hoverInfo.object.properties as Record<string, unknown>).lat),
                    Number((hoverInfo.object.properties as Record<string, unknown>).lon),
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ styles -- */

const panelCard: CSSProperties = {
  background: "var(--glass)",
  border: "1px solid var(--glass-border)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  borderRadius: 14,
  padding: 12,
  color: "var(--ink)",
  boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
};

const sectionLabel: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
};

const fieldInput: CSSProperties = {
  width: "100%",
  background: "rgba(20,21,15,0.35)",
  border: "1px solid var(--glass-border)",
  borderRadius: 8,
  padding: "6px 8px",
  fontSize: 11.5,
  color: "var(--ink)",
  fontFamily: "monospace",
};

const miniLabel: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  fontSize: 9.5,
  fontWeight: 600,
  color: "var(--ink-dim)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const swapBtn: CSSProperties = {
  border: "1px solid var(--glass-border)",
  background: "rgba(20,21,15,0.35)",
  borderRadius: 8,
  width: 26,
  height: 26,
  display: "grid",
  placeItems: "center",
  color: "var(--ink-dim)",
  cursor: "pointer",
  flexShrink: 0,
};

const coordChip: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  marginTop: 10,
  border: "1px solid var(--glass-border)",
  background: "rgba(200, 255, 61, 0.07)",
  borderRadius: 999,
  padding: "6px 10px",
  fontSize: 10.5,
  fontFamily: "monospace",
  color: "var(--ink)",
  cursor: "pointer",
};
