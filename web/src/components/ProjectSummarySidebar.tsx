// Left rail of the New Project wizard - a running summary of what the form holds so far.
// Purely a readout: every value here is derived from the wizard's own state, nothing is
// computed independently, so it can never drift out of sync with the fields the user is
// actually editing.

import type { ReactNode } from "react";
import { ClipboardList, Compass, MapPin, Clock, ListChecks, Gauge, Target, TrendingUp } from "lucide-react";
import GlassCard from "./GlassCard";
import MineSkylineArt from "./MineSkylineArt";

function Row({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span
        style={{
          width: 26,
          height: 26,
          borderRadius: 8,
          background: "var(--glass)",
          border: "1px solid var(--glass-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          color: "var(--ink-dim)",
        }}
      >
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-dim)" }}>{label}</div>
        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 1, lineHeight: 1.35, wordBreak: "break-word" }}>
          {value}
        </div>
      </div>
    </div>
  );
}

export default function ProjectSummarySidebar({
  name,
  purposeLabel,
  aoiName,
  target,
}: {
  name: string;
  purposeLabel: string;
  aoiName: string;
  /** Absent for a discover-only project — the rail just skips the target rows. */
  target: {
    tonnes: number;
    gradePct: number;
    periodStart: string;
    periodDays: number;
    periodEndLabel: string;
    periodStartLabel: string;
  } | null;
}) {
  const avgPerDay = target ? target.tonnes / Math.max(1, target.periodDays) : 0;

  return (
    <GlassCard
      style={{
        padding: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        flex: "0 0 300px",
        width: "min(300px, 100%)",
        alignSelf: "stretch",
      }}
    >
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: "var(--chip-dark)",
              color: "var(--accent-lime)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <ClipboardList size={17} />
          </span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Project Summary</div>
            <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2, lineHeight: 1.4 }}>
              Define targets, timelines and production requirements.
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Row icon={<ClipboardList size={13} />} label="Project" value={name || "New project"} />
          <Row icon={<Compass size={13} />} label="Purpose" value={purposeLabel} />
          <Row icon={<MapPin size={13} />} label="Area" value={aoiName} />

          {target && (
            <>
              <Row
                icon={<Clock size={13} />}
                label="Target Period"
                value={`${target.periodStartLabel} – ${target.periodEndLabel} (${target.periodDays} Working Days)`}
              />
              <Row icon={<ListChecks size={13} />} label="Working Days" value={target.periodDays} />
              <Row icon={<Gauge size={13} />} label="Required Capacity" value={`${target.gradePct}%`} />
              <Row
                icon={<Target size={13} />}
                label="Target Capacity"
                value={`${target.gradePct}% of ${target.tonnes.toLocaleString()} tonnes`}
              />
              <Row
                icon={<TrendingUp size={13} />}
                label="Average"
                value={`${avgPerDay.toFixed(1)} t/day`}
              />
            </>
          )}
        </div>
      </div>

      <div style={{ marginTop: "auto", height: 150, color: "var(--ink)", position: "relative" }}>
        <MineSkylineArt />
      </div>
    </GlassCard>
  );
}
