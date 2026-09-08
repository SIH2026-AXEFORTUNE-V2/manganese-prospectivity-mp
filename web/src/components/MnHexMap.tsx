"use client";

// The Mn hexagon grid — docs/issues/09-project-workspace-flow.md §3a.
//
// One hexagon per H3 cell that contains ore-grade anomaly in the pipeline's fused-score
// raster. Click one and it says how much manganese it holds, what the place is called, and how
// far below surface the ore horizon is expected to start.
//
// The colour ramp is deliberately the same magma the pipeline writes its score PNG with, so
// this view and the raster view read as one dataset rather than two opinions about the ground.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

setWorkerUrl("/maplibre-gl-worker.mjs");

import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { TextLayer } from "@deck.gl/layers";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import type { FeatureCollectionLike, LatLonBounds, Manifest, TerrainData } from "@/lib/contract";
import { loadScoreGrid, type ScoreGrid } from "@/lib/scoreRaster";
import { decodeTerrain } from "@/lib/terrain";
import {
  buildMnHexGrid,
  calibrateAnomalyThreshold,
  pickResolution,
  MAX_DATUM_KM,
  REGOLITH_COVER_M,
  type AnomalyCalibration,
  type MnHexCell,
} from "@/lib/mnHexGrid";

const BASEMAPS = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
} as const;
type Basemap = keyof typeof BASEMAPS;
type Detail = "coarse" | "medium" | "fine";

/** Magma stops, matching the palette the pipeline bakes into score_fused.png. */
const RAMP: Array<[number, number, number]> = [
  [12, 8, 38],
  [70, 16, 105],
  [138, 36, 99],
  [205, 64, 68],
  [246, 134, 37],
  [252, 220, 141],
];

function rampColor(t: number, alpha: number): [number, number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = RAMP[i];
  const b = RAMP[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
    alpha,
  ];
}

function fmtKt(kt: number): string {
  if (kt >= 1000) return `${(kt / 1000).toFixed(2)} Mt`;
  return `${Math.round(kt).toLocaleString()} kt`;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export interface HexZoneMarker {
  order: number;
  sourceRank: number;
  colorHex: string;
}

export default function MnHexMap({
  bbox,
  aoiName,
  manifest,
  targets,
  mines,
  terrain,
  zoneMarkers,
}: {
  bbox: LatLonBounds;
  aoiName: string;
  manifest: Manifest;
  targets: FeatureCollectionLike | null;
  mines: FeatureCollectionLike | null;
  terrain: TerrainData | null;
  /** When given, the grid draws only the hexagon each ranked zone's target actually falls in -
   *  matching the numbered pins the Prospectivity map shows for the same zones, rather than
   *  every anomalous block in the AOI. Matched by MnHexCell.targetRank, so a hexagon is only
   *  ever shown for ground the pipeline actually ranked, never a nearest-neighbour guess. */
  zoneMarkers?: HexZoneMarker[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  const [grid, setGrid] = useState<ScoreGrid | null>(null);
  const [gridError, setGridError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail>("medium");
  const [extrude, setExtrude] = useState(true);
  const [basemap, setBasemap] = useState<Basemap>("dark");
  const [showLabels, setShowLabels] = useState(true);
  const [selected, setSelected] = useState<MnHexCell | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; cell: MnHexCell } | null>(null);

  /* ------------------------------------------------------------ decode the raster */

  const fusedLayer = manifest.layers.fused;

  useEffect(() => {
    let cancelled = false;
    const image = fusedLayer.static_image;
    if (!image) {
      setGridError("manifest has no static score image to read values from");
      return;
    }
    loadScoreGrid(`/data/${image}`, fusedLayer.bounds)
      .then((g) => {
        if (!cancelled) setGrid(g);
      })
      .catch((err: Error) => {
        if (!cancelled) setGridError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [fusedLayer.static_image, fusedLayer.bounds]);

  const decodedTerrain = useMemo(() => decodeTerrain(terrain), [terrain]);

  const calibration: AnomalyCalibration | null = useMemo(
    () => (grid ? calibrateAnomalyThreshold(grid, targets) : null),
    [grid, targets],
  );

  const resolution = useMemo(() => pickResolution(bbox, detail), [bbox, detail]);

  const result = useMemo(() => {
    if (!grid || !calibration) return null;
    return buildMnHexGrid({
      grid,
      bbox,
      resolution,
      anomalyThreshold: calibration.threshold,
      mines,
      targets,
      terrain: decodedTerrain,
    });
  }, [grid, calibration, bbox, resolution, mines, targets, decodedTerrain]);

  // A stable empty-array identity when there's no result yet, so the useMemo hooks below it
  // don't re-run every render on a freshly-allocated `[]`.
  const cells = useMemo(() => result?.cells ?? [], [result]);
  const maxKt = useMemo(() => Math.max(1, ...cells.map((c) => c.tonnesKt)), [cells]);

  // Zone-matched order/colour per cell, keyed by h3 - a cell only gets an entry when a ranked
  // zone's target actually falls inside it (MnHexCell.targetRank), not by nearest-distance.
  const markerByH3 = useMemo(() => {
    if (!zoneMarkers || zoneMarkers.length === 0) return null;
    const byRank = new Map(zoneMarkers.map((z) => [z.sourceRank, z]));
    const m = new Map<string, HexZoneMarker>();
    for (const c of cells) {
      if (c.targetRank === null) continue;
      const marker = byRank.get(c.targetRank);
      if (marker) m.set(c.h3, marker);
    }
    return m;
  }, [zoneMarkers, cells]);

  // With zoneMarkers given, the map surface shows only the ranked zones' own hexagons - the
  // same reduction the Prospectivity map's numbered pins make - while the stats panel below
  // keeps reporting the true AOI-wide totals (see the caption near "Blocks with ore").
  const displayCells = useMemo(() => {
    if (!markerByH3) return cells;
    return cells.filter((c) => markerByH3.has(c.h3));
  }, [cells, markerByH3]);

  /* ------------------------------------------------------------------- the map -- */

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const [w, s, e, n] = bbox;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: BASEMAPS.dark,
      // Framing the AOI via `bounds` rather than a guessed centre+zoom: the constructor knows
      // the container's real size, where a fitBounds() fired from a load handler can run
      // against a stale one and leave the blocks as a speck in the middle of the view.
      bounds: [
        [w, s],
        [e, n],
      ],
      fitBoundsOptions: { padding: 48 },
      pitch: 40,
      maxPitch: 85,
    });
    mapRef.current = map;
    map.on("error", (ev) => console.error("MapLibre error:", ev.error));
    map.once("load", () => {
      map.resize();
      map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding: 48, animate: false },
      );
    });

    const overlay = new MapboxOverlay({ layers: [] });
    overlayRef.current = overlay;
    map.addControl(overlay);

    return () => {
      overlayRef.current = null;
      mapRef.current = null;
      map.remove();
    };
    // Mount-only: the AOI of a project never changes under an open map, and re-running this
    // would tear down the map on every bbox array identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.setStyle(BASEMAPS[basemap]);
  }, [basemap]);

  // The AOI can change under an open map when a project's bounds are edited; reframe rather
  // than leaving the user looking at the previous lease.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const [w, s, e, n] = bbox;
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: 48, animate: false },
    );
  }, [bbox]);

  const onClickCell = useCallback((info: PickingInfo) => {
    const cell = info.object as MnHexCell | undefined;
    setSelected((prev) => (cell && prev?.h3 === cell.h3 ? null : (cell ?? null)));
  }, []);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const layers: Layer[] = [
      new H3HexagonLayer<MnHexCell>({
        id: "mn-hex",
        data: displayCells,
        getHexagon: (d) => d.h3,
        extruded: extrude,
        elevationScale: 1,
        // Height is tonnage, normalised so the tallest block in view reads at a fixed height
        // whatever the AOI - an absolute scale makes a lease look flat next to the belt.
        getElevation: (d) => (extrude ? (d.tonnesKt / maxKt) * 5000 : 0),
        getFillColor: (d) =>
          rampColor(d.tonnesKt / maxKt, selected && selected.h3 === d.h3 ? 255 : 205),
        getLineColor: (d) => {
          if (selected && selected.h3 === d.h3) return [200, 255, 61, 255];
          const marker = markerByH3?.get(d.h3);
          if (marker) return [...hexToRgb(marker.colorHex), 255];
          return [255, 255, 255, 40];
        },
        getLineWidth: (d) => (selected && selected.h3 === d.h3 ? 3 : markerByH3?.has(d.h3) ? 2.5 : 1),
        lineWidthUnits: "pixels",
        stroked: true,
        filled: true,
        pickable: true,
        autoHighlight: true,
        highlightColor: [200, 255, 61, 90],
        onClick: onClickCell,
        onHover: (info: PickingInfo) => {
          const cell = info.object as MnHexCell | undefined;
          setHover(cell ? { x: info.x, y: info.y, cell } : null);
        },
        updateTriggers: {
          getFillColor: [maxKt, selected?.h3],
          getLineColor: [selected?.h3, markerByH3],
          getLineWidth: [selected?.h3, markerByH3],
          getElevation: [extrude, maxKt],
        },
      }),
    ];

    // Labels are the thing that makes the grid readable at a glance, and also the first thing
    // to turn into mush - past a few hundred cells they overlap into noise, so they switch off.
    // A zone-matched cell always labels with its order number (ties it to the card/pin sharing
    // that number) rather than tonnage, which the click-to-inspect panel still shows in full.
    if (showLabels && displayCells.length <= 350) {
      layers.push(
        new TextLayer<MnHexCell>({
          id: "mn-hex-labels",
          data: displayCells,
          getPosition: (d) => [d.lon, d.lat],
          getText: (d) => {
            const marker = markerByH3?.get(d.h3);
            if (marker) return String(marker.order);
            return d.tonnesKt >= 1000 ? `${(d.tonnesKt / 1000).toFixed(1)}M` : String(Math.round(d.tonnesKt));
          },
          getSize: (d) => (markerByH3?.has(d.h3) ? 20 : 12),
          getColor: [255, 255, 255, 230],
          outlineColor: [0, 0, 0, 255],
          outlineWidth: 3,
          fontSettings: { sdf: true },
          fontWeight: 800,
          getTextAnchor: "middle",
          getAlignmentBaseline: "center",
          billboard: true,
          parameters: { depthCompare: "always" },
          updateTriggers: { getText: [markerByH3], getSize: [markerByH3] },
        }),
      );
    }

    overlay.setProps({ layers });
  }, [displayCells, extrude, maxKt, selected, showLabels, onClickCell, markerByH3]);

  /* ------------------------------------------------------------------ rendering -- */

  const loading = !grid && !gridError;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {/* ---------------------------------------------------------- left controls */}
      <div style={{ ...panel, top: 14, left: 14, width: 250 }}>
        <div style={eyebrow}>Manganese hex grid</div>
        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{aoiName}</div>

        {loading && <div style={{ ...dim, marginTop: 10 }}>decoding fused-score raster…</div>}
        {gridError && (
          <div style={{ ...dim, marginTop: 10, color: "#ff9b8a" }}>
            could not read the score raster: {gridError}
          </div>
        )}

        {result && calibration && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
              <Metric label="Blocks with ore" value={String(result.cells.length)} />
              <Metric label="Anomaly area" value={`${result.totalAnomalousAreaKm2.toFixed(1)} km²`} />
              <Metric label="Indicative in situ" value={fmtKt(result.totalTonnesKt)} />
              <Metric label="H3 resolution" value={String(result.resolution)} />
            </div>
            {markerByH3 && (
              <div style={{ ...dim, marginTop: 8, lineHeight: 1.5 }}>
                Showing the {displayCells.length} block{displayCells.length === 1 ? "" : "s"} the ranked zones below actually
                fall in, out of {result.cells.length} with ore-grade anomaly in this AOI.
              </div>
            )}

            <div style={{ ...eyebrow, marginTop: 14 }}>Detail</div>
            <Segmented
              options={[
                ["coarse", "Coarse"],
                ["medium", "Medium"],
                ["fine", "Fine"],
              ]}
              value={detail}
              onChange={(v) => setDetail(v as Detail)}
            />

            <div style={{ ...eyebrow, marginTop: 14 }}>View</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Toggle on={extrude} onClick={() => setExtrude((v) => !v)} label="3D height" />
              <Toggle on={showLabels} onClick={() => setShowLabels((v) => !v)} label="Labels" />
              <Toggle
                on={basemap === "light"}
                onClick={() => setBasemap((b) => (b === "dark" ? "light" : "dark"))}
                label="Light base"
              />
            </div>
            {showLabels && cells.length > 350 && (
              <div style={{ ...dim, marginTop: 8 }}>
                {cells.length} blocks — labels hidden until you go coarser.
              </div>
            )}

            <div style={{ ...eyebrow, marginTop: 14 }}>Anomaly cutoff</div>
            <div style={{ ...dim, lineHeight: 1.5 }}>
              Score ≥ <strong style={{ color: "#fff" }}>{calibration.threshold.toFixed(3)}</strong>, set so the
              anomalous footprint matches the {calibration.targetAreaKm2.toFixed(0)} km² the pipeline
              delineated as ranked targets. Ground below it is scored but not drawn.
            </div>
          </>
        )}
      </div>

      {/* --------------------------------- right column: info card above the legend --
          One scrolling column rather than two anchored corners. A selected block's card grows
          with its content, and anchoring a legend to the bottom right guarantees that at some
          content length the two overlap and the depth figure ends up underneath the colour
          ramp - which is exactly what happened the first time this was built. */}
      <div
        style={{
          position: "absolute",
          top: 14,
          right: 14,
          bottom: 14,
          width: 310,
          zIndex: 4,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          overflowY: "auto",
          pointerEvents: "none",
        }}
      >
        <div style={{ ...stackPanel, pointerEvents: "auto" }}>
          {selected ? (
            <SelectedCell cell={selected} onClose={() => setSelected(null)} />
          ) : (
            <>
              <div style={{ fontSize: 15, fontWeight: 700 }}>No block selected</div>
              <div style={{ ...dim, marginTop: 6, lineHeight: 1.55 }}>
                Click any hexagon for its manganese tonnage, the place it sits in, and how far below
                surface the ore horizon is expected to start.
              </div>
            </>
          )}
        </div>

        <div style={{ ...stackPanel, marginTop: "auto", pointerEvents: "auto" }}>
          <div style={eyebrow}>Manganese per block</div>
          <div
            style={{
              height: 10,
              borderRadius: 999,
              marginTop: 6,
              background: `linear-gradient(90deg, ${RAMP.map((c) => `rgb(${c.join(",")})`).join(",")})`,
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", ...dim, marginTop: 4 }}>
            <span>0</span>
            <span>{fmtKt(maxKt)}</span>
          </div>
          <div style={{ ...dim, marginTop: 8, lineHeight: 1.5 }}>
            Hexagons appear only where the model found ore-grade anomaly — the gaps are real, not
            missing tiles. Tonnages are indicative in-situ estimates, not drilled reserves.
          </div>
        </div>
      </div>

      {/* -------------------------------------------------------------- hover chip */}
      {hover && !selected && (
        <div
          style={{
            position: "absolute",
            left: Math.min(hover.x + 12, 9999),
            top: hover.y + 12,
            pointerEvents: "none",
            background: "rgba(10,10,12,0.92)",
            border: "1px solid rgba(255,255,255,0.16)",
            borderRadius: 8,
            padding: "6px 9px",
            fontSize: 11.5,
            color: "#fff",
            zIndex: 5,
            whiteSpace: "nowrap",
          }}
        >
          <strong>{fmtKt(hover.cell.tonnesKt)}</strong> · {hover.cell.placeName}
        </div>
      )}

    </div>
  );
}

/* --------------------------------------------------------------- selected card -- */

function SelectedCell({ cell, onClose }: { cell: MnHexCell; onClose: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div style={eyebrow}>Selected block</div>
          <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.25, marginTop: 2 }}>
            {cell.placeName}
          </div>
          <div style={{ ...dim, fontFamily: "monospace", marginTop: 3 }}>
            {cell.lat.toFixed(4)}°N, {cell.lon.toFixed(4)}°E
          </div>
        </div>
        <button type="button" onClick={onClose} style={closeBtn} aria-label="Clear selection">
          ×
        </button>
      </div>

      {/* --- tonnage ------------------------------------------------------------ */}
      <div style={block}>
        <div style={eyebrow}>Manganese ore in this block</div>
        <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "monospace", lineHeight: 1.1, marginTop: 2 }}>
          {fmtKt(cell.tonnesKt)}
        </div>
        <div style={dim}>
          range {fmtKt(cell.tonnesRangeKt[0])} – {fmtKt(cell.tonnesRangeKt[1])} · {cell.confidence} confidence
        </div>
        <div style={{ ...dim, marginTop: 6, lineHeight: 1.5 }}>
          Charged to the {cell.anomalousAreaKm2.toFixed(2)} km² of ore-grade anomaly inside this
          {" "}{cell.areaKm2.toFixed(1)} km² block ({(cell.anomalousFraction * 100).toFixed(1)}% of it), not to
          the whole hexagon. That anomaly resolves to {cell.anomalousPixels} raster{" "}
          {cell.anomalousPixels === 1 ? "pixel" : "pixels"}, so the figure steps in units of about{" "}
          {fmtKt(cell.tonnesKt / Math.max(cell.anomalousPixels, 1))} — read it as a magnitude, not a
          measured number.
        </div>
      </div>

      {/* --- depth -------------------------------------------------------------- */}
      <div style={block}>
        <div style={eyebrow}>Top of ore</div>
        {cell.depthToOreM == null ? (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>Not estimated here</div>
            <div style={{ ...dim, marginTop: 4, lineHeight: 1.5 }}>
              No known working within {MAX_DATUM_KM} km to datum the ore horizon against. Depth is
              left blank rather than extrapolated across the belt.
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "monospace", lineHeight: 1.1, marginTop: 2 }}>
              {cell.depthToOreM} m
            </div>
            <div style={dim}>below surface ({cell.surfaceElevM} m ASL at this block)</div>
            <div style={{ ...dim, marginTop: 6, lineHeight: 1.5 }}>
              Horizon datumed on {cell.datum?.mine} ({cell.datum?.elevM} m ASL,{" "}
              {cell.datum?.km.toFixed(1)} km away), plus {REGOLITH_COVER_M} m of regolith. Assumes the
              horizon is flat between the two — Sausar bands fold and plunge, so treat this as cover
              for ordering drill targets, not a section.
              {cell.datum?.workedToM != null && (
                <> The working there reaches {cell.datum.workedToM} m, which is measured, not modelled.</>
              )}
            </div>
          </>
        )}
      </div>

      {/* --- grade + provenance -------------------------------------------------- */}
      <div style={block}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span
            style={{
              ...chip,
              background: cell.band === "high" ? "#c8ff3d" : cell.band === "medium" ? "#e0aa4a" : "#7d7f74",
              color: "#14150f",
            }}
          >
            {cell.band} grade band
          </span>
          <span style={{ ...dim, fontFamily: "monospace" }}>
            {cell.gradeRangePct[0]}–{cell.gradeRangePct[1]}% Mn
          </span>
        </div>
        <div style={{ ...dim, marginTop: 6, lineHeight: 1.5 }}>
          Band is this block&rsquo;s position in the AOI&rsquo;s own tonnage distribution (p{cell.percentile}) — the
          fused score is rank-normalised, so no absolute cutoff would mean anything. The percentages
          are nominal band definitions, not an assay.
        </div>
        <div style={{ ...dim, marginTop: 8, fontFamily: "monospace" }}>
          fused score mean {cell.scoreMean.toFixed(3)} · max {cell.scoreMax.toFixed(3)} ·{" "}
          {cell.samples} px sampled, {cell.anomalousPixels} anomalous
        </div>
        {cell.targetRank != null && (
          <div style={{ ...dim, marginTop: 8, color: "#c8ff3d" }}>
            Holds ranked target #{cell.targetRank} — the zone card below covers this same ground.
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ small bits -- */

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(255,255,255,0.5)" }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace" }}>{value}</div>
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: Array<[string, string]>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.07)", borderRadius: 999, padding: 3 }}>
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          style={{
            flex: 1,
            border: "none",
            borderRadius: 999,
            padding: "5px 0",
            fontSize: 11.5,
            fontWeight: 600,
            cursor: "pointer",
            background: value === id ? "#c8ff3d" : "transparent",
            color: value === id ? "#14150f" : "rgba(255,255,255,0.75)",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${on ? "#c8ff3d" : "rgba(255,255,255,0.2)"}`,
        background: on ? "rgba(200,255,61,0.15)" : "transparent",
        color: on ? "#c8ff3d" : "rgba(255,255,255,0.75)",
        borderRadius: 999,
        padding: "5px 11px",
        fontSize: 11.5,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

/* The panels sit on a dark map in both themes, so they carry their own fixed dark palette
   rather than the app's light/dark tokens - a translucent light card over a dark basemap is
   unreadable, and the map is the one surface in the app that never follows the theme. */
const panel: CSSProperties = {
  position: "absolute",
  zIndex: 4,
  background: "rgba(14,15,12,0.86)",
  border: "1px solid rgba(255,255,255,0.14)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  borderRadius: 14,
  padding: 14,
  color: "#edefe7",
};

/** Same look as `panel`, but laid out by the flex column instead of anchoring itself. */
const stackPanel: CSSProperties = {
  background: "rgba(14,15,12,0.86)",
  border: "1px solid rgba(255,255,255,0.14)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  borderRadius: 14,
  padding: 14,
  color: "#edefe7",
  flex: "0 0 auto",
};

const eyebrow: CSSProperties = {
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "rgba(255,255,255,0.55)",
  fontWeight: 600,
};

const dim: CSSProperties = { fontSize: 11.5, color: "rgba(255,255,255,0.62)" };

const block: CSSProperties = {
  borderTop: "1px solid rgba(255,255,255,0.12)",
  paddingTop: 10,
};

const chip: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  padding: "3px 9px",
  borderRadius: 999,
  textTransform: "capitalize",
};

const closeBtn: CSSProperties = {
  background: "none",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 8,
  width: 26,
  height: 26,
  cursor: "pointer",
  color: "rgba(255,255,255,0.7)",
  fontSize: 15,
  lineHeight: 1,
  flex: "0 0 auto",
};
