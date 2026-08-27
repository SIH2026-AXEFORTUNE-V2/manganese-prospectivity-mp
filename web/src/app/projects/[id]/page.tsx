"use client";

// Zone results - docs/issues/09-project-workspace-flow.md §3 + §4.
// Map of the AOI, ranked zone cards side by side underneath, AI suggestions on the right.

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import GlassCard from "@/components/GlassCard";
import ZoneCard from "@/components/ZoneCard";
import SuggestionRail from "@/components/SuggestionRail";
import DetailDrawer from "@/components/DetailDrawer";
import PipelineFooter from "@/components/PipelineFooter";
import { useOreCompassData } from "@/lib/useOreCompassData";
import { refreshZones, useProject } from "@/lib/projectStore";
import { buildSuggestions } from "@/lib/aiSuggestions";
import { zoneColorFamily, PIN_COLOR_HEX } from "@/lib/aiZones";
import type { FeatureCollectionLike, TargetProperties } from "@/lib/contract";
import type { ZonePin } from "@/components/CommandMap";

// maplibre-gl touches `window` on instantiation, so the map is browser-only - same
// `ssr: false` dynamic import the Explore screen uses.
const CommandMap = dynamic(() => import("@/components/CommandMap"), { ssr: false });
const MnHexMap = dynamic(() => import("@/components/MnHexMap"), { ssr: false });

type MapView = "prospectivity" | "hexgrid";

export default function ProjectZonesPage() {
  const params = useParams<{ id: string }>();
  const { project } = useProject(params?.id ?? null);
  const { status, manifest, targets, mines, validation, terrain } = useOreCompassData();
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [mapView, setMapView] = useState<MapView>("hexgrid");

  // Only the AOI's targets go to the map - a project map that draws every target statewide
  // isn't this project's map.
  const aoiTargets: FeatureCollectionLike | null = useMemo(() => {
    if (!targets || !project) return null;
    const ranks = new Set(project.zones.map((z) => z.sourceRank));
    return {
      type: "FeatureCollection",
      features: targets.features.filter((f) =>
        ranks.has((f.properties as unknown as TargetProperties).rank),
      ),
    };
  }, [targets, project]);

  const suggestions = useMemo(() => (project ? buildSuggestions(project) : []), [project]);

  // One pin per zone, numbered and coloured exactly as its card below - see zoneColorFamily().
  const zonePins: ZonePin[] = useMemo(
    () =>
      project
        ? project.zones.map((z) => ({
            rank: z.sourceRank,
            order: z.order,
            colorHex: PIN_COLOR_HEX[zoneColorFamily(z.gradeBand, z.confidence)],
          }))
        : [],
    [project],
  );

  if (!project) return null;

  const fusedLayer = manifest?.layers.fused;
  const thumbnailImage = fusedLayer?.static_image ? `/data/${fusedLayer.static_image}` : undefined;

  const selectedZone = project.zones.find((z) => z.id === selectedZoneId) ?? null;
  const selectedTarget: TargetProperties | null =
    selectedZone && targets
      ? ((targets.features
          .map((f) => f.properties as unknown as TargetProperties)
          .find((t) => t.rank === selectedZone.sourceRank)) ?? null)
      : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Two ways to look at the same fused score: the raster draped over terrain, or the
            same numbers aggregated into blocks you can click for tonnage and depth. They read
            off one dataset, so switching views must never change what the ground is worth. */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {(
            [
              ["hexgrid", "Mn hex grid"],
              ["prospectivity", "Prospectivity map"],
            ] as Array<[MapView, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMapView(id)}
              style={{
                borderRadius: 999,
                padding: "7px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                background: mapView === id ? "var(--accent-lime)" : "var(--glass)",
                color: mapView === id ? "var(--chip-dark)" : "var(--ink)",
                border: `1px solid ${mapView === id ? "transparent" : "var(--glass-border)"}`,
              }}
            >
              {label}
            </button>
          ))}
          <span style={{ fontSize: 11.5, color: "var(--ink-dim)", marginLeft: 4 }}>
            {mapView === "hexgrid"
              ? "Blocks of ore-grade anomaly — click one for its tonnage and depth to ore."
              : "The model's fused prospectivity score, draped over real terrain."}
          </span>
        </div>

        <div
          style={{
            position: "relative",
            height: mapView === "hexgrid" ? 560 : 420,
            borderRadius: 18,
            overflow: "hidden",
            border: "1px solid var(--glass-border)",
          }}
        >
          {status !== "ready" || !manifest || !aoiTargets || !mines ? (
            <div style={placeholder}>{status === "error" ? "fixture failed to load" : "loading map…"}</div>
          ) : mapView === "hexgrid" ? (
            <MnHexMap
              bbox={project.aoi.bbox}
              aoiName={project.aoi.name}
              manifest={manifest}
              targets={targets}
              mines={mines}
              terrain={terrain}
            />
          ) : (
            <CommandMap manifest={manifest} targets={aoiTargets} mines={mines} terrain={terrain} zonePins={zonePins} />
          )}

          {mapView === "prospectivity" && selectedTarget && validation && (
            <DetailDrawer
              target={selectedTarget}
              validation={validation}
              onClose={() => setSelectedZoneId(null)}
            />
          )}
        </div>

        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Ranked zones — {project.aoi.name}</h2>
            <div style={{ fontSize: 12.5, color: "var(--ink-dim)", marginTop: 4 }}>
              Estimates derived from the validated fused score. Click a card for the evidence behind it.
            </div>
          </div>
          {targets && (
            <button
              type="button"
              onClick={() => refreshZones(project.id, targets, mines)}
              style={{
                background: "var(--glass)",
                border: "1px solid var(--glass-border)",
                borderRadius: 999,
                padding: "7px 14px",
                fontSize: 12,
                color: "var(--ink)",
                cursor: "pointer",
              }}
            >
              Re-derive from latest pipeline output
            </button>
          )}
        </div>

        {project.zones.length === 0 ? (
          <GlassCard style={{ padding: 22, fontSize: 13.5, color: "var(--ink-dim)", lineHeight: 1.6 }}>
            No ranked target falls inside this AOI. That is the model&rsquo;s actual answer for this
            ground, not a loading state — nothing has been substituted in to fill the space. Widen
            the project&rsquo;s bounds or run the pipeline over a larger AOI.
          </GlassCard>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
            {project.zones.map((z) => (
              <ZoneCard
                key={z.id}
                zone={z}
                selected={selectedZoneId === z.id}
                onSelect={() => setSelectedZoneId((prev) => (prev === z.id ? null : z.id))}
                thumbnailImage={thumbnailImage}
                manifestBounds={fusedLayer?.bounds}
              />
            ))}
          </div>
        )}
      </div>

      <SuggestionRail
        suggestions={suggestions}
        collapsed={railCollapsed}
        onToggle={() => setRailCollapsed((c) => !c)}
      />
    </div>
      <PipelineFooter />
    </div>
  );
}

const placeholder: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "grid",
  placeItems: "center",
  color: "var(--ink-dim)",
  fontFamily: "monospace",
  fontSize: 13,
};
