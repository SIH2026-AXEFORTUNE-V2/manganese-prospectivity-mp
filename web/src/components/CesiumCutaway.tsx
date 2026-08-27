"use client";

// Issue #8: Cesium Cutaway View for Balaghat Mine (-383 m depth)
//
// Standalone underground 3D cutaway view scoped to Balaghat mine.
// Displays Longitude, Latitude, Surface Altitude (+320 m ASL), and Subsurface Altitude (-63 m BSL) in separate columns.
// Demonstrates subterranean shaft depth (-383 m) below the real terrain surface.
// Clearly labelled as illustrative depth, not an actual mine plan.

import { useEffect, useRef, useState, useCallback } from "react";
import "cesium/Build/Cesium/Widgets/widgets.css";
import GlassCard from "./GlassCard";
import Link from "next/link";

export default function CesiumCutaway() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // Live Camera Telemetry state
  const [cameraTelemetry, setCameraTelemetry] = useState<{
    lat: number;
    lon: number;
    alt: number;
    heading: number;
    pitch: number;
  }>({
    lat: 21.842,
    lon: 80.252,
    alt: 950,
    heading: 310,
    pitch: -22,
  });

  // Balaghat Mine Telemetry Data
  const BALAGHAT_GEO = {
    name: "Balaghat / Bharveli Manganese Mine",
    lat: 21.851853,
    lon: 80.239336,
    surfaceAltitude: 320.0,    // Surface collar altitude above sea level (+320 m ASL)
    depthMeters: 383.0,        // Sourced vertical shaft depth (383 m)
    bottomAltitude: -63.0,     // Bottom working level altitude relative to sea level (-63 m BSL)
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(`Copied ${label}!`);
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  // Fly Camera Viewpoints
  const flyToPerspective = useCallback((type: "cutaway" | "collar" | "subsurface") => {
    const viewer = viewerRef.current;
    if (!viewer || !viewer.camera) return;

    if (type === "cutaway") {
      viewer.camera.flyTo({
        destination: (window as any).Cesium.Cartesian3.fromDegrees(80.252, 21.842, 950),
        orientation: {
          heading: (window as any).Cesium.Math.toRadians(310),
          pitch: (window as any).Cesium.Math.toRadians(-22),
          roll: 0.0,
        },
        duration: 1.2,
      });
    } else if (type === "collar") {
      viewer.camera.flyTo({
        destination: (window as any).Cesium.Cartesian3.fromDegrees(80.239336, 21.851853, 700),
        orientation: {
          heading: (window as any).Cesium.Math.toRadians(0),
          pitch: (window as any).Cesium.Math.toRadians(-75),
          roll: 0.0,
        },
        duration: 1.2,
      });
    } else if (type === "subsurface") {
      viewer.camera.flyTo({
        destination: (window as any).Cesium.Cartesian3.fromDegrees(80.246, 21.848, 120),
        orientation: {
          heading: (window as any).Cesium.Math.toRadians(305),
          pitch: (window as any).Cesium.Math.toRadians(-8),
          roll: 0.0,
        },
        duration: 1.2,
      });
    }
  }, []);

  useEffect(() => {
    let viewerInstance: any = null;
    let destroyed = false;

    async function initCesium() {
      if (!containerRef.current) return;

      try {
        // Set Cesium base URL for static assets (workers, widgets, third-party)
        (window as any).CESIUM_BASE_URL = "/cesium";

        const Cesium = await import("cesium");
        (window as any).Cesium = Cesium;

        if (destroyed || !containerRef.current) return;

        const { lat, lon, surfaceAltitude, depthMeters, bottomAltitude } = BALAGHAT_GEO;

        // Create Cesium Viewer
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

        // Enable subterranean / underground rendering & globe translucency
        const globe = viewer.scene.globe;
        globe.depthTestAgainstTerrain = true;
        globe.translucency.enabled = true;
        globe.translucency.frontFaceAlpha = 0.52;
        globe.translucency.backFaceAlpha = 0.28;
        globe.baseColor = Cesium.Color.fromCssColorString("#14150f");

        // Allow camera to move below ground surface
        viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;

        // 1. Surface Mine Collar Marker & Altitude Label
        viewer.entities.add({
          name: "Balaghat Surface Mine Collar (Bharveli)",
          position: Cesium.Cartesian3.fromDegrees(lon, lat, surfaceAltitude),
          point: {
            pixelSize: 14,
            color: Cesium.Color.fromCssColorString("#edefe7"),
            outlineColor: Cesium.Color.fromCssColorString("#14150f"),
            outlineWidth: 3,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          },
          label: {
            text: `Balaghat Mine Collar (Bharveli)\n📍 ${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E\n⛰️ Surface Altitude: +${surfaceAltitude.toFixed(1)} m ASL`,
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

        // 2. Extruded Vertical Main Shaft Geometry (Depth -383 m)
        const shaftMidElev = surfaceAltitude - depthMeters / 2;
        viewer.entities.add({
          name: "Vertical Production Shaft (-383 m)",
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

        // 3. Staging Altitude Depth Ticks along Shaft (-100m, -200m, -300m)
        const depthTicks = [
          { depth: 100, alt: surfaceAltitude - 100, label: "-100 m Depth (Alt: +220 m ASL)" },
          { depth: 200, alt: surfaceAltitude - 200, label: "-200 m Depth (Alt: +120 m ASL)" },
          { depth: 300, alt: surfaceAltitude - 300, label: "-300 m Depth (Alt: +20 m ASL)" },
        ];

        depthTicks.forEach((tick) => {
          viewer.entities.add({
            name: tick.label,
            position: Cesium.Cartesian3.fromDegrees(lon, lat, tick.alt),
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
              text: `── ${tick.label}`,
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

        // 4. Illustrative Subsurface Working Level Disk (-383 m Sourced Depth)
        viewer.entities.add({
          name: "Subsurface Working Level (-383 m)",
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
            text: `▼ SUBTERRANEAN WORKING LEVEL\nAltitude: ${bottomAltitude.toFixed(1)} m BSL (Sub-Sea Datum)\nSourced Shaft Depth: −${depthMeters.toFixed(0)} m\n(Illustrative depth — not actual engineering mine plan)`,
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
          name: "Shaft Centerline",
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

        // Camera move listener to update live camera altitude
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

        // Fly camera to isometric cutaway perspective
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(80.252, 21.842, 950),
          orientation: {
            heading: Cesium.Math.toRadians(310),
            pitch: Cesium.Math.toRadians(-22),
            roll: 0.0,
          },
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

          <h2 style={{ fontSize: 20, fontWeight: 700, margin: "2px 0 6px" }}>
            Balaghat Mine (Bharveli)
          </h2>

          <p style={{ fontSize: 12, color: "var(--ink-dim)", margin: "0 0 12px", lineHeight: 1.4 }}>
            Subterranean cutaway visualizing the <strong>−383 m</strong> vertical production shaft reaching below sea level.
          </p>

          {/* SEPARATE COLUMNS: LONGITUDE, LATITUDE & ALTITUDES */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            {/* COLUMN 1: LONGITUDE */}
            <div
              style={{
                background: "rgba(20, 21, 15, 0.5)",
                border: "1px solid var(--glass-border)",
                borderRadius: 10,
                padding: "8px 10px",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--ink-dim)", letterSpacing: "0.05em" }}>
                  LONGITUDE
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(BALAGHAT_GEO.lon.toFixed(6), "Longitude")}
                  title="Copy Longitude"
                  style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 11, padding: 0 }}
                >
                  📋
                </button>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", fontFamily: "monospace" }}>
                80.2393° E
              </div>
              <div style={{ fontSize: 10, color: "var(--ink-dim)", fontFamily: "monospace" }}>
                Dec: {BALAGHAT_GEO.lon.toFixed(6)}
              </div>
            </div>

            {/* COLUMN 2: LATITUDE */}
            <div
              style={{
                background: "rgba(20, 21, 15, 0.5)",
                border: "1px solid var(--glass-border)",
                borderRadius: 10,
                padding: "8px 10px",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--ink-dim)", letterSpacing: "0.05em" }}>
                  LATITUDE
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(BALAGHAT_GEO.lat.toFixed(6), "Latitude")}
                  title="Copy Latitude"
                  style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 11, padding: 0 }}
                >
                  📋
                </button>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", fontFamily: "monospace" }}>
                21.8519° N
              </div>
              <div style={{ fontSize: 10, color: "var(--ink-dim)", fontFamily: "monospace" }}>
                Dec: {BALAGHAT_GEO.lat.toFixed(6)}
              </div>
            </div>
          </div>

          {/* SEPARATE COLUMNS: SURFACE ALTITUDE & SUBTERRANEAN ALTITUDE */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            {/* COLUMN 3: SURFACE ALTITUDE */}
            <div
              style={{
                background: "rgba(20, 21, 15, 0.5)",
                border: "1px solid var(--glass-border)",
                borderRadius: 10,
                padding: "8px 10px",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--ink-dim)", letterSpacing: "0.05em" }}>
                  SURFACE ALTITUDE
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(`+${BALAGHAT_GEO.surfaceAltitude.toFixed(1)} m ASL`, "Surface Altitude")}
                  title="Copy Surface Altitude"
                  style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 11, padding: 0 }}
                >
                  📋
                </button>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", fontFamily: "monospace" }}>
                +{BALAGHAT_GEO.surfaceAltitude.toFixed(1)} m ASL
              </div>
              <div style={{ fontSize: 10, color: "var(--ink-dim)" }}>
                Above Sea Level (Collar)
              </div>
            </div>

            {/* COLUMN 4: SUBTERRANEAN ALTITUDE */}
            <div
              style={{
                background: "rgba(20, 21, 15, 0.5)",
                border: "1px solid var(--glass-border)",
                borderRadius: 10,
                padding: "8px 10px",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--accent-lime)", letterSpacing: "0.05em" }}>
                  BOTTOM ALTITUDE
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(`${BALAGHAT_GEO.bottomAltitude.toFixed(1)} m BSL`, "Bottom Altitude")}
                  title="Copy Bottom Altitude"
                  style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 11, padding: 0 }}
                >
                  📋
                </button>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--accent-lime)", fontFamily: "monospace" }}>
                {BALAGHAT_GEO.bottomAltitude.toFixed(1)} m BSL
              </div>
              <div style={{ fontSize: 10, color: "var(--accent-lime)" }}>
                Depth: −{BALAGHAT_GEO.depthMeters.toFixed(0)} m
              </div>
            </div>
          </div>

          {/* Perspective Preset Buttons */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => flyToPerspective("cutaway")}
              style={{
                flex: 1,
                border: "1px solid var(--glass-border)",
                borderRadius: 8,
                padding: "6px 8px",
                fontSize: 11,
                fontWeight: 600,
                background: "rgba(200, 255, 61, 0.12)",
                color: "var(--accent-lime)",
                cursor: "pointer",
              }}
            >
              📐 Isometric
            </button>
            <button
              type="button"
              onClick={() => flyToPerspective("collar")}
              style={{
                flex: 1,
                border: "1px solid var(--glass-border)",
                borderRadius: 8,
                padding: "6px 8px",
                fontSize: 11,
                fontWeight: 600,
                background: "rgba(20, 21, 15, 0.4)",
                color: "var(--ink)",
                cursor: "pointer",
              }}
            >
              ⬇️ Top Collar
            </button>
            <button
              type="button"
              onClick={() => flyToPerspective("subsurface")}
              style={{
                flex: 1,
                border: "1px solid var(--glass-border)",
                borderRadius: 8,
                padding: "6px 8px",
                fontSize: 11,
                fontWeight: 600,
                background: "rgba(20, 21, 15, 0.4)",
                color: "var(--ink)",
                cursor: "pointer",
              }}
            >
              🚇 Deep Level
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
            ⚠️ <strong>Illustrative depth callout:</strong> Visualises sourced vertical depth only.
            Not an engineering mine plan.
          </div>
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
        <span style={{ color: "var(--accent-lime)", fontSize: 13 }}>📷</span>
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
          href="/"
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
          ← Back to Map View
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
            zIndex: 50,
          }}
        >
          {error ? `Error: ${error}` : "Initializing Cesium 3D cutaway engine…"}
        </div>
      )}
    </div>
  );
}
