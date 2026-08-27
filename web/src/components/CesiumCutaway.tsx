"use client";

// Issue #8: Cesium Cutaway View for Balaghat Mine (-383 m depth)
//
// Standalone underground 3D cutaway view scoped to Balaghat mine.
// Demonstrates subterranean shaft depth (-383 m) below the real terrain surface.
// Clearly labelled as illustrative depth, not an actual mine plan.

import { useEffect, useRef, useState } from "react";
import "cesium/Build/Cesium/Widgets/widgets.css";
import GlassCard from "./GlassCard";
import Link from "next/link";

export default function CesiumCutaway() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alpha, setAlpha] = useState<number>(0.55);

  useEffect(() => {
    let viewerInstance: any = null;
    let destroyed = false;

    async function initCesium() {
      if (!containerRef.current) return;

      try {
        // Set Cesium base URL for static assets (workers, widgets, third-party)
        (window as any).CESIUM_BASE_URL = "/cesium";

        const Cesium = await import("cesium");

        if (destroyed || !containerRef.current) return;

        // Balaghat coordinates: [80.239336, 21.851853]
        const BALAGHAT_LON = 80.239336;
        const BALAGHAT_LAT = 21.851853;
        const SURFACE_ELEV_APPROX = 320; // Surface elevation approx ~320m ASL
        const SOURCED_DEPTH_M = 383;     // Verified sourced depth from data contract
        const BOTTOM_ELEV = SURFACE_ELEV_APPROX - SOURCED_DEPTH_M; // -63m

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

        // Enable subterranean / underground rendering & globe translucency
        const globe = viewer.scene.globe;
        globe.depthTestAgainstTerrain = true;
        globe.translucency.enabled = true;
        globe.translucency.frontFaceAlpha = alpha;
        globe.translucency.backFaceAlpha = 0.3;
        globe.baseColor = Cesium.Color.fromCssColorString("#14150f");

        // Allow camera to move below ground surface
        viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;

        // 1. Surface Headframe / Collar Marker
        viewer.entities.add({
          name: "Balaghat Surface Mine Collar (Bharveli)",
          position: Cesium.Cartesian3.fromDegrees(BALAGHAT_LON, BALAGHAT_LAT, SURFACE_ELEV_APPROX),
          point: {
            pixelSize: 12,
            color: Cesium.Color.fromCssColorString("#edefe7"),
            outlineColor: Cesium.Color.fromCssColorString("#14150f"),
            outlineWidth: 3,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          },
          label: {
            text: "Balaghat / Bharveli (Collar)\nSurface Elev: ~320 m ASL",
            font: "12px system-ui, sans-serif",
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            fillColor: Cesium.Color.fromCssColorString("#edefe7"),
            outlineColor: Cesium.Color.fromCssColorString("#14150f"),
            outlineWidth: 3,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -18),
            backgroundColor: Cesium.Color.fromCssColorString("rgba(20,21,15,0.85)"),
            showBackground: true,
            backgroundPadding: new Cesium.Cartesian2(6, 4),
          },
        });

        // 2. Extruded Vertical Main Shaft Geometry (Depth -383 m)
        const shaftMidElev = SURFACE_ELEV_APPROX - SOURCED_DEPTH_M / 2;
        viewer.entities.add({
          name: "Vertical Production Shaft (-383 m)",
          position: Cesium.Cartesian3.fromDegrees(BALAGHAT_LON, BALAGHAT_LAT, shaftMidElev),
          cylinder: {
            length: SOURCED_DEPTH_M,
            topRadius: 25.0,
            bottomRadius: 25.0,
            material: Cesium.Color.fromCssColorString("#c8ff3d").withAlpha(0.8),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString("#ffffff").withAlpha(0.9),
            outlineWidth: 2,
          },
        });

        // 3. Illustrative Subsurface Working Level Disk
        viewer.entities.add({
          name: "Subsurface Working Level (-383 m)",
          position: Cesium.Cartesian3.fromDegrees(BALAGHAT_LON, BALAGHAT_LAT, BOTTOM_ELEV),
          cylinder: {
            length: 8.0,
            topRadius: 110.0,
            bottomRadius: 110.0,
            material: Cesium.Color.fromCssColorString("#c8ff3d").withAlpha(0.45),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString("#c8ff3d"),
            outlineWidth: 1.5,
          },
          label: {
            text: "▼ SOURCED DEPTH: -383 m\n(Illustrative shaft depth — not actual mine plan)",
            font: "bold 12px system-ui, sans-serif",
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            fillColor: Cesium.Color.fromCssColorString("#c8ff3d"),
            outlineColor: Cesium.Color.fromCssColorString("#14150f"),
            outlineWidth: 4,
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            pixelOffset: new Cesium.Cartesian2(0, 20),
            backgroundColor: Cesium.Color.fromCssColorString("rgba(14,15,12,0.9)"),
            showBackground: true,
            backgroundPadding: new Cesium.Cartesian2(8, 6),
          },
        });

        // 4. Depth Reference Plumb Line
        viewer.entities.add({
          name: "Shaft Centerline",
          polyline: {
            positions: [
              Cesium.Cartesian3.fromDegrees(BALAGHAT_LON, BALAGHAT_LAT, SURFACE_ELEV_APPROX),
              Cesium.Cartesian3.fromDegrees(BALAGHAT_LON, BALAGHAT_LAT, BOTTOM_ELEV),
            ],
            width: 3,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString("#c8ff3d"),
              dashLength: 16.0,
            }),
          },
        });

        // Fly camera to a dynamic isometric cutaway angle
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

      {/* Floating Header Card */}
      <div style={{ position: "absolute", top: 20, left: 20, maxWidth: 360, zIndex: 10 }}>
        <GlassCard style={{ padding: "18px 22px" }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--ink-dim)",
              fontWeight: 600,
            }}
          >
            3D Subsurface Cutaway · Issue #8
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: "6px 0 8px" }}>
            Balaghat Mine Shaft
          </h2>
          <p style={{ fontSize: 13, color: "var(--ink-dim)", margin: 0, lineHeight: 1.45 }}>
            Sourced underground depth reaching <strong>−383 m</strong> beneath the Bharveli ridge.
          </p>
          <div
            style={{
              marginTop: 12,
              padding: "8px 12px",
              background: "rgba(200, 255, 61, 0.08)",
              border: "1px solid rgba(200, 255, 61, 0.25)",
              borderRadius: 8,
              fontSize: 11,
              color: "var(--accent-lime)",
              lineHeight: 1.4,
            }}
          >
            ⚠️ <strong>Illustrative depth callout:</strong> Visualises sourced vertical depth only.
            Not an engineering mine plan.
          </div>
        </GlassCard>
      </div>

      {/* Floating Navigation & Controls Card */}
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
