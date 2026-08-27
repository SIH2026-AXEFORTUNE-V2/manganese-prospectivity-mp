"use client";

// One ranked zone, side by side with its peers - docs/issues/09-project-workspace-flow.md §3.
//
// The card flips to show its assumptions. That is not a flourish: every number on the front
// is derived from a fused score through a stated assumption set, and a planner who cannot see
// that set has no way to judge whether "1.8-2.4 Mt" means anything. Front says what; back
// says how it was arrived at.

import { useState } from "react";
import type { CSSProperties } from "react";
import { TriangleAlert, ChevronRight } from "lucide-react";
import GlassCard from "./GlassCard";
import { zoneColorFamily, PIN_COLOR_HEX } from "@/lib/aiZones";
import type { Confidence, GradeBand, Zone } from "@/lib/projectTypes";
import type { LatLonBounds } from "@/lib/contract";

const BAND_LABEL: Record<GradeBand, string> = {
  high: "High grade",
  medium: "Medium grade",
  low: "Low grade",
};

function bandColor(band: GradeBand): string {
  return band === "high" ? "var(--accent-lime)" : band === "medium" ? "var(--warn)" : "var(--ink-dim)";
}

function confidenceColor(c: Confidence): string {
  return c === "high" ? "var(--good)" : c === "medium" ? "var(--warn)" : "var(--critical)";
}

export default function ZoneCard({
  zone,
  selected,
  onSelect,
  onRecordOutcome,
  thumbnailImage,
  manifestBounds,
}: {
  zone: Zone;
  selected: boolean;
  onSelect: () => void;
  onRecordOutcome?: () => void;
  /** `/data/<static_image>` of the fused score - reused as the card's thumbnail crop rather
   *  than inventing a fake satellite photo per zone. */
  thumbnailImage?: string;
  manifestBounds?: LatLonBounds;
}) {
  const [showBasis, setShowBasis] = useState(false);
  const family = zoneColorFamily(zone.gradeBand, zone.confidence);
  const pinColor = PIN_COLOR_HEX[family];

  return (
    <GlassCard
      style={{
        padding: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        outline: selected ? "2px solid var(--accent-lime)" : "2px solid transparent",
        outlineOffset: 2,
        transition: "outline-color 0.15s",
      }}
    >
      {thumbnailImage && manifestBounds && (
        <ZoneThumbnail image={thumbnailImage} bounds={manifestBounds} zone={zone} badgeColor={pinColor} onSelect={onSelect} />
      )}

      <div
        onClick={onSelect}
        style={{ cursor: "pointer", display: "flex", flexDirection: "column", gap: 8, padding: 16, paddingTop: thumbnailImage ? 12 : 16 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            {!thumbnailImage && <OrderBadge order={zone.order} color={pinColor} inline />}
            <strong style={{ fontSize: 15 }}>{zone.label}</strong>
          </div>
          <span style={{ fontSize: 11, color: "var(--ink-dim)", fontFamily: "monospace" }}>
            #{zone.sourceRank}
          </span>
        </div>

        <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.3 }}>{zone.placeName}</div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ ...pill, background: "var(--chip-dark)", color: bandColor(zone.gradeBand) }}>
            {BAND_LABEL[zone.gradeBand]}
          </span>
          <span style={{ fontSize: 12, color: "var(--ink-dim)", fontFamily: "monospace" }}>
            {zone.gradeRangePct[0]}–{zone.gradeRangePct[1]}% Mn
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 8 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "monospace", lineHeight: 1.1 }}>
              {zone.tonnageRangeMt[0]}–{zone.tonnageRangeMt[1]}
              <span style={{ fontSize: 12, fontWeight: 500, marginLeft: 4, color: "var(--ink-dim)" }}>Mt est.</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 2 }}>
              {zone.areaHa.toFixed(0)} ha · {zone.lat.toFixed(3)}, {zone.lon.toFixed(3)}
            </div>
          </div>
          <span style={{ ...pill, color: confidenceColor(zone.confidence), border: `1px solid ${confidenceColor(zone.confidence)}` }}>
            {zone.confidence} conf.
          </span>
        </div>

        {zone.nearNonMnMine && (
          <div style={{ fontSize: 11, color: "var(--warn)", display: "flex", alignItems: "flex-start", gap: 5 }}>
            <TriangleAlert size={12} style={{ flexShrink: 0, marginTop: 1 }} />
            Near a known non-manganese mine — most likely way this call is wrong.
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--rule)", padding: "10px 16px 16px" }}>
        <button type="button" onClick={() => setShowBasis((s) => !s)} style={{ ...linkBtn, display: "inline-flex", alignItems: "center", gap: 3 }}>
          {showBasis ? "Hide basis" : "How was this derived?"} <ChevronRight size={12} style={{ transform: showBasis ? "rotate(90deg)" : undefined, transition: "transform 0.15s" }} />
        </button>
        {onRecordOutcome && (
          <button type="button" onClick={onRecordOutcome} style={{ ...linkBtn, marginLeft: "auto" }}>
            Record mined result
          </button>
        )}
      </div>

      {showBasis && (
        <ul style={{ margin: 0, padding: "0 16px 16px 32px", display: "flex", flexDirection: "column", gap: 6 }}>
          {zone.assumptions.map((a, i) => (
            <li key={i} style={{ fontSize: 11, color: "var(--ink-dim)", lineHeight: 1.45 }}>
              {a}
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}

/* ------------------------------------------------------------------- badge + thumb -- */

function OrderBadge({ order, color, inline }: { order: number; color: string; inline?: boolean }) {
  return (
    <span
      style={{
        width: 20,
        height: 20,
        borderRadius: 999,
        background: color,
        color: "#14150f",
        fontSize: 10.5,
        fontWeight: 800,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
        border: inline ? "none" : "2px solid var(--bg)",
      }}
    >
      {order}
    </span>
  );
}

/** A real crop of the pipeline's own fused-score PNG, centred on the zone's coordinate -
 *  visually reads as a mini-map thumbnail without inventing a satellite photo that was never
 *  taken. The zone's outline itself isn't in the fixture (only its centroid + area are), so a
 *  plain rounded frame stands in for a true polygon overlay. */
function ZoneThumbnail({
  image,
  bounds,
  zone,
  badgeColor,
  onSelect,
}: {
  image: string;
  bounds: LatLonBounds;
  zone: Zone;
  badgeColor: string;
  onSelect: () => void;
}) {
  const [west, south, east, north] = bounds;
  const xPct = ((zone.lon - west) / (east - west)) * 100;
  const yPct = ((north - zone.lat) / (north - south)) * 100;

  return (
    <div onClick={onSelect} style={{ position: "relative", height: 110, cursor: "pointer", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `url(${image})`,
          backgroundSize: "500% 500%",
          backgroundPosition: `${xPct}% ${yPct}%`,
          filter: "saturate(1.1)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 8,
          border: "1.5px solid rgba(255,255,255,0.85)",
          borderRadius: 8,
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "absolute", top: 8, left: 8 }}>
        <OrderBadge order={zone.order} color={badgeColor} />
      </div>
    </div>
  );
}

const pill: CSSProperties = {
  fontSize: 11,
  padding: "3px 9px",
  borderRadius: 999,
  background: "transparent",
  whiteSpace: "nowrap",
};

const linkBtn: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  fontSize: 11,
  color: "var(--ink-dim)",
  cursor: "pointer",
  textDecoration: "underline",
  textUnderlineOffset: 2,
};
