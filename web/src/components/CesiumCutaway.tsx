"use client";

// Issue #8: Cesium Cutaway View, generalised from a single hardcoded Balaghat view into one
// reusable per-location component - docs/issues/09-project-workspace-flow.md §3b.
//
// Standalone underground 3D cutaway view for any surface point + depth-to-ore pair. Displays
// Longitude, Latitude, Surface Altitude and Subsurface Altitude in separate columns, and an
// extruded shaft down to the estimated depth. Every number here traces back to either the
// pipeline's own terrain sample (surface altitude) or estimateDepth() in lib/mnHexGrid.ts (the
// same datum-interpolation the Mn hex grid uses) - a zone's cutaway can never show a different
// depth figure than the hexagon sitting on the same ground. Clearly labelled as illustrative
// depth, not an actual engineering mine plan - real Sausar bands fold and plunge.

import { useEffect, useRef, useState, useCallback, type CSSProperties } from "react";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { Copy, Box, ArrowDown, ArrowLeft, Layers, TriangleAlert, Camera } from "lucide-react";
import GlassCard from "./GlassCard";
import Link from "next/link";

const DEFAULT_GEO = {
  name: "Balaghat / Bharveli Manganese Mine",
  lat: 21.851853,
  lon: 80.239336,
  surfaceAltitude: 320.0,
  depthMeters: 383.0,
};

export interface CesiumCutawayProps {
  name?: string;
  lat?: number;
  lon?: number;
  /** Surface collar altitude, m ASL - real terrain sample when the caller has one. */
  surfaceAltitude?: number;
  /** Estimated vertical depth to ore, m - real datum-interpolated figure when available. */
  depthMeters?: number;
  /** Where "Back to Map View" returns to - a project's Zones page when opened from a zone. */
  backHref?: string;
  backLabel?: string;
}

export default function CesiumCutaway({
  name = DEFAULT_GEO.name,
  lat = DEFAULT_GEO.lat,
  lon = DEFAULT_GEO.lon,
  surfaceAltitude = DEFAULT_GEO.surfaceAltitude,
  depthMeters = DEFAULT_GEO.depthMeters,
  backHref = "/",
  backLabel = "Back to Map View",
}: CesiumCutawayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const bottomAltitude = surfaceAltitude - depthMeters;

  const [cameraTelemetry, setCameraTelemetry] = useState<{
    lat: number;
    lon: number;
    alt: number;
    heading: number;
    pitch: number;
  }>({
    lat,
    lon,
    alt: surfaceAltitude + 630,
    heading: 310,
    pitch: -22,
  });

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(`Copied ${label}!`);
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  // Fly Camera Viewpoints - offsets are relative to the collar, not absolute Balaghat
  // coordinates, so the same three perspectives work for any zone's cutaway.
  const flyToPerspective = useCallback(
    (type: "cutaway" | "collar" | "subsurface") => {
      const viewer = viewerRef.current;
      if (!viewer || !viewer.camera) return;
      const Cesium = (window as any).Cesium;
      if (!Cesium) return;

      if (type === "cutaway") {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon + 0.0127, lat - 0.0099, surfaceAltitude + 630),
          orientation: { heading: Cesium.Math.toRadians(310), pitch: Cesium.Math.toRadians(-22), roll: 0.0 },
          duration: 1.2,
        });
      } else if (type === "collar") {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, surfaceAltitude + 380),
          orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-75), roll: 0.0 },
          duration: 1.2,
        });
      } else if (type === "subsurface") {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon + 0.0067, lat - 0.0039, Math.max(80, bottomAltitude + 183)),
          orientation: { heading: Cesium.Math.toRadians(305), pitch: Cesium.Math.toRadians(-8), roll: 0.0 },
          duration: 1.2,
        });
      }
    },
    [lat, lon, surfaceAltitude, bottomAltitude],
  );

  useEffect(() => {
    let viewerInstance: any = null;
    let destroyed = false;

    async function initCesium() {
      if (!containerRef.current) return;

      try {
        (window as any).CESIUM_BASE_URL = "/cesium";

        const Cesium = await import("cesium");
        (window as any).Cesium = Cesium;

        if (destroyed || !containerRef.current) return;

        // Create Cesium Viewer. No baseLayer override - Cesium falls back to its own
        // shipped-in-the-package demo ion access token, which serves real Cesium World
        // Imagery (visible satellite imagery, not a plain color or a stand-in relief map)
        // well enough for evaluation/demo use. Cesium prints its own "assign your own ion
        // token" notice at the bottom of the viewer - that's an informational nag about the
        // shared demo token's limits for production use, not an error; it does not block
        // rendering. Get a free personal ion token (cesium.com) before any real deployment.
        const viewer = new Cesium.Viewer(containerRef.current, {
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          infoBox: false,
          selectionIndicator: false,
          timeline: false,
          animation: false,
          navigationHelpButton: false,
          sceneModePicker: false,
          fullscreenButton: false,
        });
        viewerInstance = viewer;
        viewerRef.current = viewer;

        const globe = viewer.scene.globe;
        globe.depthTestAgainstTerrain = true;
        globe.translucency.enabled = true;
        globe.translucency.frontFaceAlpha = 0.52;
        globe.translucency.backFaceAlpha = 0.28;
        globe.baseColor = Cesium.Color.fromCssColorString("#14150f");

        viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;

        // 1. Surface Mine Collar Marker & Altitude Label
        viewer.entities.add({
          name: `${name} - surface collar`,
          position: Cesium.Cartesian3.fromDegrees(lon, lat, surfaceAltitude),
          point: {
            pixelSize: 14,
            color: Cesium.Color.fromCssColorString("#edefe7"),
            outlineColor: Cesium.Color.fromCssColorString("#14150f"),
            outlineWidth: 3,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          },
          label: {
            // Cesium renders this to a bitmap billboard, not the DOM - no React icon can
            // appear here, so it stays plain text (see the deck.gl TextLayer note in
            // CommandMap.tsx for the same constraint).
            text: `${name}\n${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E\nSurface Altitude: +${surfaceAltitude.toFixed(1)} m ASL`,
            font: "12px system-ui, sans-serif",
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            fillColor: Cesium.Color.fromCssColorString("#edefe7"),
            outlineColor: Cesium.Color.fromCssColorString("#14150f"),
            outlineWidth: 3,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -18),
            backgroundColor: Cesium.Color.fromCssColorString("rgba(20,21,15,0.88)"),
            showBackground: true,
            backgroundPadding: new Cesium.Cartesian2(8, 5),
          },
        });

        // 2. Extruded Vertical Shaft Geometry, down to the estimated depth-to-ore
        const shaftMidElev = surfaceAltitude - depthMeters / 2;
        viewer.entities.add({
          name: `Vertical shaft (-${depthMeters.toFixed(0)} m)`,
          position: Cesium.Cartesian3.fromDegrees(lon, lat, shaftMidElev),
          cylinder: {
            length: depthMeters,
            topRadius: 28.0,
            bottomRadius: 28.0,
            material: Cesium.Color.fromCssColorString("#c8ff3d").withAlpha(0.82),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString("#ffffff").withAlpha(0.9),
            outlineWidth: 2,
          },
        });

        // 3. Staging depth ticks at quarter/half/three-quarter depth, scaled to this shaft -
        // fixed -100/-200/-300 m only made sense for Balaghat's own 383 m shaft.
        const tickFractions = [0.25, 0.5, 0.75];
        tickFractions.forEach((frac) => {
          const depth = Math.round((depthMeters * frac) / 10) * 10;
          const alt = surfaceAltitude - depth;
          viewer.entities.add({
            name: `-${depth} m depth tick`,
            position: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
            cylinder: {
              length: 2.0,
              topRadius: 45.0,
              bottomRadius: 45.0,
              material: Cesium.Color.fromCssColorString("#c8ff3d").withAlpha(0.4),
              outline: true,
              outlineColor: Cesium.Color.fromCssColorString("#c8ff3d").withAlpha(0.6),
              outlineWidth: 1,
            },
            label: {
              text: `-${depth} m depth (Alt: ${alt >= 0 ? "+" : ""}${Math.round(alt)} m ASL)`,
              font: "11px system-ui, sans-serif",
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              fillColor: Cesium.Color.fromCssColorString("#9aa08c"),
              outlineColor: Cesium.Color.fromCssColorString("#14150f"),
              outlineWidth: 2,
              horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              pixelOffset: new Cesium.Cartesian2(48, 0),
              backgroundColor: Cesium.Color.fromCssColorString("rgba(14,15,12,0.75)"),
              showBackground: true,
              backgroundPadding: new Cesium.Cartesian2(6, 3),
            },
          });
        });

        // 4. Illustrative subsurface working-level disk at the full estimated depth
        viewer.entities.add({
          name: `Subsurface working level (-${depthMeters.toFixed(0)} m)`,
          position: Cesium.Cartesian3.fromDegrees(lon, lat, bottomAltitude),
          cylinder: {
            length: 10.0,
            topRadius: 130.0,
            bottomRadius: 130.0,
            material: Cesium.Color.fromCssColorString("#c8ff3d").withAlpha(0.45),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString("#c8ff3d"),
            outlineWidth: 2,
          },
          label: {
            text: `SUBTERRANEAN WORKING LEVEL\nAltitude: ${bottomAltitude.toFixed(1)} m ${bottomAltitude < 0 ? "BSL" : "ASL"}\nEstimated depth to ore: -${depthMeters.toFixed(0)} m\n(Illustrative depth - not actual engineering mine plan)`,
            font: "bold 12px system-ui, sans-serif",
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            fillColor: Cesium.Color.fromCssColorString("#c8ff3d"),
            outlineColor: Cesium.Color.fromCssColorString("#14150f"),
            outlineWidth: 4,
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            pixelOffset: new Cesium.Cartesian2(0, 24),
            backgroundColor: Cesium.Color.fromCssColorString("rgba(14,15,12,0.92)"),
            showBackground: true,
            backgroundPadding: new Cesium.Cartesian2(10, 7),
          },
        });

        // 5. Centerline Depth Plumb Line
        viewer.entities.add({
          name: "Shaft centerline",
          polyline: {
            positions: [
              Cesium.Cartesian3.fromDegrees(lon, lat, surfaceAltitude),
              Cesium.Cartesian3.fromDegrees(lon, lat, bottomAltitude),
            ],
            width: 3,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString("#c8ff3d"),
              dashLength: 16.0,
            }),
          },
        });

        viewer.camera.changed.addEventListener(() => {
          const carto = viewer.camera.positionCartographic;
          if (carto) {
            setCameraTelemetry({
              lat: Cesium.Math.toDegrees(carto.latitude),
              lon: Cesium.Math.toDegrees(carto.longitude),
              alt: Math.round(carto.height),
              heading: Math.round(Cesium.Math.toDegrees(viewer.camera.heading)),
              pitch: Math.round(Cesium.Math.toDegrees(viewer.camera.pitch)),
            });
          }
        });

        // Fly camera to isometric cutaway perspective on load
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon + 0.0127, lat - 0.0099, surfaceAltitude + 630),
          orientation: { heading: Cesium.Math.toRadians(310), pitch: Cesium.Math.toRadians(-22), roll: 0.0 },
          duration: 1.5,
        });

        setLoading(false);
      } catch (err: any) {
        console.error("Cesium initialization error:", err);
        setError(err.message || "Failed to initialize Cesium 3D viewer");
        setLoading(false);
      }
    }

    void initCesium();

    return () => {
      destroyed = true;
      if (viewerInstance && !viewerInstance.isDestroyed()) {
        viewerInstance.destroy();
      }
    };
    // Mount-once: the scene is built from these props at init time. A different zone renders
    // through a fresh mount (the caller keys the component on zone id), not a live prop swap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* Cesium Viewer Container */}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* Floating Header Card (Top-Left) */}
      <div style={{ position: "absolute", top: 20, left: 20, maxWidth: 440, zIndex: 10 }}>
        <GlassCard style={{ padding: "18px 20px" }}>
          {/* Header Bar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--ink-dim)",
                fontWeight: 600,
              }}
            >
              3D Subsurface Cutaway · Geospatial Telemetry
            </div>
            {copyFeedback && (
              <span style={{ fontSize: 11, color: "var(--accent-lime)", fontWeight: 600 }}>
                {copyFeedback}
              </span>
            )}
          </div>

          <h2 style={{ fontSize: 20, fontWeight: 700, margin: "2px 0 6px" }}>{name}</h2>

          <p style={{ fontSize: 12, color: "var(--ink-dim)", margin: "0 0 12px", lineHeight: 1.4 }}>
            Subterranean cutaway visualizing the <strong>−{depthMeters.toFixed(0)} m</strong> estimated depth to ore below surface.
          </p>

          {/* SEPARATE COLUMNS: LONGITUDE, LATITUDE & ALTITUDES */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            {/* COLUMN 1: LONGITUDE */}
            <div style={geoCol}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={geoColLabel}>LONGITUDE</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(lon.toFixed(6), "Longitude")}
                  title="Copy Longitude"
                  style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex" }}
                >
                  <Copy size={12} />
                </button>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", fontFamily: "monospace" }}>
                {lon.toFixed(4)}° E
              </div>
              <div style={{ fontSize: 10, color: "var(--ink-dim)", fontFamily: "monospace" }}>Dec: {lon.toFixed(6)}</div>
            </div>

            {/* COLUMN 2: LATITUDE */}
            <div style={geoCol}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={geoColLabel}>LATITUDE</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(lat.toFixed(6), "Latitude")}
                  title="Copy Latitude"
                  style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex" }}
                >
                  <Copy size={12} />
                </button>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", fontFamily: "monospace" }}>
                {lat.toFixed(4)}° N
              </div>
              <div style={{ fontSize: 10, color: "var(--ink-dim)", fontFamily: "monospace" }}>Dec: {lat.toFixed(6)}</div>
            </div>
          </div>

          {/* SEPARATE COLUMNS: SURFACE ALTITUDE & SUBTERRANEAN ALTITUDE */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            {/* COLUMN 3: SURFACE ALTITUDE */}
            <div style={geoCol}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={geoColLabel}>SURFACE ALTITUDE</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(`+${surfaceAltitude.toFixed(1)} m ASL`, "Surface Altitude")}
                  title="Copy Surface Altitude"
                  style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex" }}
                >
                  <Copy size={12} />
                </button>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", fontFamily: "monospace" }}>
                +{surfaceAltitude.toFixed(1)} m ASL
              </div>
              <div style={{ fontSize: 10, color: "var(--ink-dim)" }}>Above Sea Level (Collar)</div>
            </div>

            {/* COLUMN 4: SUBTERRANEAN ALTITUDE */}
            <div style={geoCol}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ ...geoColLabel, color: "var(--accent-lime)" }}>BOTTOM ALTITUDE</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(`${bottomAltitude.toFixed(1)} m`, "Bottom Altitude")}
                  title="Copy Bottom Altitude"
                  style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex" }}
                >
                  <Copy size={12} />
                </button>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--accent-lime)", fontFamily: "monospace" }}>
                {bottomAltitude.toFixed(1)} m {bottomAltitude < 0 ? "BSL" : "ASL"}
              </div>
              <div style={{ fontSize: 10, color: "var(--accent-lime)" }}>Depth: −{depthMeters.toFixed(0)} m</div>
            </div>
          </div>

          {/* Perspective Preset Buttons */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <button type="button" onClick={() => flyToPerspective("cutaway")} style={{ ...perspBtn, background: "rgba(200, 255, 61, 0.12)", color: "var(--accent-lime)" }}>
              <Box size={12} style={{ marginRight: 4, verticalAlign: -2 }} />Isometric
            </button>
            <button type="button" onClick={() => flyToPerspective("collar")} style={perspBtn}>
              <ArrowDown size={12} style={{ marginRight: 4, verticalAlign: -2 }} />Top Collar
            </button>
            <button type="button" onClick={() => flyToPerspective("subsurface")} style={perspBtn}>
              <Layers size={12} style={{ marginRight: 4, verticalAlign: -2 }} />Deep Level
            </button>
          </div>

          {/* Honesty Callout */}
          <div
            style={{
              padding: "7px 10px",
              background: "rgba(200, 255, 61, 0.07)",
              border: "1px solid rgba(200, 255, 61, 0.2)",
              borderRadius: 8,
              fontSize: 11,
              color: "var(--accent-lime)",
              lineHeight: 1.35,
            }}
          >
            <TriangleAlert size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
            <strong>Illustrative depth callout:</strong> Visualises an estimated vertical depth,
            not an engineering mine plan.
          </div>
          {error && (
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--critical)" }}>{error}</div>
          )}
        </GlassCard>
      </div>

      {/* Floating Camera Telemetry HUD (Bottom-Left) */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          left: 20,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--glass)",
          border: "1px solid var(--glass-border)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderRadius: 999,
          padding: "6px 16px",
          color: "var(--ink)",
          fontSize: 12,
          fontFamily: "monospace",
          boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
          pointerEvents: "none",
        }}
      >
        <Camera size={13} color="var(--accent-lime)" />
        <span>
          VIEWER ALTITUDE: <strong style={{ color: "var(--accent-lime)" }}>{cameraTelemetry.alt} m ASL</strong>
        </span>
        <span style={{ color: "var(--ink-dim)" }}>|</span>
        <span style={{ color: "var(--ink-dim)" }}>
          Heading: {cameraTelemetry.heading}° · Pitch: {cameraTelemetry.pitch}°
        </span>
      </div>

      {/* Floating Navigation Card (Top-Right) */}
      <div style={{ position: "absolute", top: 20, right: 20, zIndex: 10, display: "flex", gap: 10 }}>
        <Link
          href={backHref}
          style={{
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "var(--glass)",
            border: "1px solid var(--glass-border)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            borderRadius: 999,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--ink)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
          }}
        >
          <ArrowLeft size={13} /> {backLabel}
        </Link>
      </div>

      {/* Loading Overlay */}
      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            background: "var(--bg)",
            color: "var(--ink-dim)",
            fontFamily: "monospace",
            fontSize: 13,
            zIndex: 20,
          }}
        >
          Loading Cesium 3D engine…
        </div>
      )}
    </div>
  );
}

const geoCol: CSSProperties = {
  background: "rgba(20, 21, 15, 0.5)",
  border: "1px solid var(--glass-border)",
  borderRadius: 10,
  padding: "8px 10px",
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const geoColLabel: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "var(--ink-dim)",
  letterSpacing: "0.05em",
};

const perspBtn: CSSProperties = {
  flex: 1,
  border: "1px solid var(--glass-border)",
  borderRadius: 8,
  padding: "6px 8px",
  fontSize: 11,
  fontWeight: 600,
  background: "rgba(20, 21, 15, 0.4)",
  color: "var(--ink)",
  cursor: "pointer",
};
