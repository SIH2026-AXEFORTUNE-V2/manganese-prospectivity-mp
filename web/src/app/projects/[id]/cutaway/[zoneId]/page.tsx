"use client";

// Route: /projects/[id]/cutaway/[zoneId]
//
// A zone's own underground cutaway - the same Cesium view CutawayPage gives Balaghat, but
// datumed against this zone's real coordinate instead. Depth comes from estimateDepth() in
// lib/mnHexGrid.ts, the identical datum-interpolation the Mn hex grid uses for the hexagon
// sitting on this same ground - a zone card, its hexagon and its cutaway can never disagree
// about how deep the ore is.

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useProject } from "@/lib/projectStore";
import { useOreCompassData } from "@/lib/useOreCompassData";
import { decodeTerrain } from "@/lib/terrain";
import { estimateDepth } from "@/lib/mnHexGrid";
import GlassCard from "@/components/GlassCard";
import type { CesiumCutawayProps } from "@/components/CesiumCutaway";

const CesiumCutaway = dynamic(() => import("@/components/CesiumCutaway"), {
  ssr: false,
  loading: () => (
    <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--ink-dim)", fontFamily: "monospace", fontSize: 13 }}>
      Loading Cesium 3D engine…
    </div>
  ),
});

export default function ZoneCutawayPage() {
  const params = useParams<{ id: string; zoneId: string }>();
  const { project, hydrated } = useProject(params?.id ?? null);
  const { status, mines, terrain } = useOreCompassData();

  const zone = project?.zones.find((z) => z.id === params?.zoneId) ?? null;
  const decodedTerrain = useMemo(() => decodeTerrain(terrain), [terrain]);

  const depth = useMemo(() => {
    if (!zone) return null;
    return estimateDepth(zone.lat, zone.lon, mines, decodedTerrain);
  }, [zone, mines, decodedTerrain]);

  const shellStyle: React.CSSProperties = { display: "flex", flexDirection: "column", height: "100dvh" };
  const mainStyle: React.CSSProperties = { flex: 1, minHeight: 0, position: "relative", margin: 16 };
  const frameStyle: React.CSSProperties = { position: "absolute", inset: 0, borderRadius: 20, overflow: "hidden", border: "1px solid var(--glass-border)" };

  if (hydrated && !project) {
    return (
      <div style={shellStyle}>
        <main style={{ padding: 24 }}>
          <GlassCard style={{ padding: 24, maxWidth: 560, fontSize: 13.5, lineHeight: 1.6 }}>
            No project with that id in this browser.
          </GlassCard>
        </main>
      </div>
    );
  }

  if (hydrated && project && !zone) {
    return (
      <div style={shellStyle}>
        <main style={{ padding: 24 }}>
          <GlassCard style={{ padding: 24, maxWidth: 560, fontSize: 13.5, lineHeight: 1.6 }}>
            No zone with that id on this project — it may have been re-derived since this link
            was made. Re-derive zones and open the cutaway from the current card.
          </GlassCard>
        </main>
      </div>
    );
  }

  const backHref = `/projects/${params?.id ?? ""}`;

  if (status !== "ready" || !zone || !depth) {
    return (
      <div style={shellStyle}>
        <main style={{ padding: 24 }}>
          <GlassCard style={{ padding: 24, maxWidth: 560, fontSize: 13.5, color: "var(--ink-dim)" }}>
            {status === "error" ? "fixture failed to load" : "loading zone geometry…"}
          </GlassCard>
        </main>
      </div>
    );
  }

  const cutawayProps: CesiumCutawayProps =
    depth.depthToOreM !== null
      ? {
          name: `${zone.label} · ${zone.placeName}`,
          lat: zone.lat,
          lon: zone.lon,
          surfaceAltitude: depth.surfaceElevM,
          depthMeters: depth.depthToOreM,
          backHref,
          backLabel: "Back to zones",
        }
      : {
          name: `${zone.label} · ${zone.placeName}`,
          lat: zone.lat,
          lon: zone.lon,
          surfaceAltitude: depth.surfaceElevM,
          // No known working within MAX_DATUM_KM to datum a real depth against - REGOLITH_COVER_M
          // alone (cover only, no fold/plunge inference) is the honest floor rather than
          // inventing a shaft depth this zone has no basis for.
          depthMeters: 8,
          backHref,
          backLabel: "Back to zones",
        };

  return (
    <div style={shellStyle}>
      <main style={mainStyle}>
        <div style={frameStyle}>
          <CesiumCutaway key={zone.id} {...cutawayProps} />
        </div>
        {depth.depthToOreM === null && (
          <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 15, maxWidth: 420 }}>
            <GlassCard style={{ padding: "10px 14px", fontSize: 11.5, color: "var(--warn)", textAlign: "center" }}>
              No known working within 40 km of this zone to datum a depth against — showing
              surface cover only, not an estimated ore depth.
            </GlassCard>
          </div>
        )}
      </main>
    </div>
  );
}
