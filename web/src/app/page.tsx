"use client";

// M0 target (see docs/issues/00-milestones.md): prove the migration works by rendering the
// same belt-only data the old static dashboard/index.html shows, through the new Next.js +
// MapLibre + deck.gl stack, styled to the UI reference (dark glass, lime accent, floating
// cards over a full-bleed map). This is the Explore lane's home screen; the Protect lane
// (docs/issues/05-protect-lane.md) is a separate route reached via the TopNav switch.

import { useState } from "react";
import dynamic from "next/dynamic";
import TopNav from "@/components/TopNav";
import GlassCard from "@/components/GlassCard";
import StatCards from "@/components/StatCards";
import TargetRail from "@/components/TargetRail";
import DetailDrawer from "@/components/DetailDrawer";
import { useOreCompassData } from "@/lib/useOreCompassData";
import type { TargetProperties } from "@/lib/contract";

// maplibre-gl touches `window` as soon as it's instantiated, so the map component can only
// ever run in the browser - `ssr: false` skips trying to render it on the server. This has
// to happen in a Client Component (this file, "use client" above); Next.js errors if you
// try it from a Server Component. See node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md.
const CommandMap = dynamic(() => import("@/components/CommandMap"), { ssr: false });

export default function Home() {
  const [workspace, setWorkspace] = useState<"explore" | "protect">("explore");
  const [selectedRank, setSelectedRank] = useState<number | null>(null);
  const { status, error, manifest, targets, mines, validation } = useOreCompassData();

  // Derive the selected target's properties for the drawer
  const selectedTarget: TargetProperties | null =
    selectedRank !== null && targets
      ? ((targets.features
          .map((f) => f.properties as unknown as TargetProperties)
          .find((t) => t.rank === selectedRank)) ?? null)
      : null;

  function handleSelect(rank: number) {
    // Clicking the same card again deselects (closes the drawer)
    setSelectedRank((prev) => (prev === rank ? null : rank));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      <TopNav workspace={workspace} onWorkspaceChange={setWorkspace} />

      <main style={{ flex: 1, minHeight: 0, position: "relative", margin: "0 16px 16px" }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 20,
            overflow: "hidden",
            border: "1px solid var(--glass-border)",
          }}
        >
          {status === "ready" && manifest && targets && mines ? (
            <CommandMap manifest={manifest} targets={targets} mines={mines} />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "grid",
                placeItems: "center",
                color: "var(--ink-dim)",
                fontFamily: "monospace",
                fontSize: 13,
              }}
            >
              {status === "error" ? `error: ${error}` : "loading belt_sausar fixture…"}
            </div>
          )}
        </div>

        {/* Floating headline: what the model claims, sourced from the same validation
            report the old dashboard's Validation tab reads. */}
        <div style={{ position: "absolute", top: 20, left: 20, maxWidth: 340 }}>
          <GlassCard style={{ padding: "22px 24px" }}>
            <div style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-dim)" }}>
              AI-Powered · Sausar Belt
            </div>
            <h1 style={{ fontSize: 30, lineHeight: 1.08, margin: "8px 0 0", fontWeight: 700 }}>
              Where to survey next
            </h1>
          </GlassCard>
        </div>

        {/* Stat cards: hidden when drawer is open (drawer occupies same top-right area) */}
        {status === "ready" && validation && !selectedTarget && (
          <div style={{ position: "absolute", top: 20, right: 20, width: 210 }}>
            <StatCards validation={validation} />
          </div>
        )}

        {/* Detail drawer — Evidence & Validation panels for the selected target */}
        {selectedTarget && validation && (
          <DetailDrawer
            target={selectedTarget}
            validation={validation}
            onClose={() => setSelectedRank(null)}
          />
        )}

        {/* Ranked-target rail, bottom - one card per target, ScoreRing for its fused score. */}
        {status === "ready" && targets && (
          <div style={{ position: "absolute", left: 20, right: 20, bottom: 20 }}>
            <TargetRail
              targets={targets}
              selectedRank={selectedRank}
              onSelect={handleSelect}
            />
          </div>
        )}
      </main>
    </div>
  );
}
