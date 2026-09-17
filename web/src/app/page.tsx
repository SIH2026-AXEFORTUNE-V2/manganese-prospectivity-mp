"use client";

// Entry point. Signed in -> the projects list; not signed in -> the sign-in screen.
//
// The map that used to live here is now /atlas: it is a reference view of the whole belt,
// not a home screen. A planner opens this product to work on a project, and the flow starts
// at that list (docs/issues/09-project-workspace-flow.md §1).

import { useState } from "react";
import dynamic from "next/dynamic";
import TopNav from "@/components/TopNav";
import GlassCard from "@/components/GlassCard";
import StatCards from "@/components/StatCards";
import TargetRail from "@/components/TargetRail";
import { useOreCompassData } from "@/lib/useOreCompassData";

// maplibre-gl touches `window` as soon as it's instantiated, so the map component can only
// ever run in the browser - `ssr: false` skips trying to render it on the server. This has
// to happen in a Client Component (this file, "use client" above); Next.js errors if you
// try it from a Server Component. See node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md.
const CommandMap = dynamic(() => import("@/components/CommandMap"), { ssr: false });
// Same browser-only rule as CommandMap - three.js/WebGL touch `window` on import.
const EarthGlobe = dynamic(() => import("@/components/EarthGlobe"), { ssr: false });

export default function Home() {
  const [workspace, setWorkspace] = useState<"explore" | "protect">("explore");
  // Which centerpiece fills the map area: the breathing globe or the georeferenced
  // belt map. Globe is the default; the switch below flips it.
  const [view, setView] = useState<"globe" | "map">("globe");
  const [selectedRank, setSelectedRank] = useState<number | null>(null);
  const { status, error, manifest, targets, mines, validation } = useOreCompassData();

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
          {view === "globe" ? (
            <EarthGlobe />
          ) : status === "ready" && manifest && targets && mines ? (
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

        {/* Globe / Map switch - same pill pattern as the TopNav workspace toggle. */}
        <div
          style={{
            position: "absolute",
            top: 20,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            gap: 4,
            padding: 4,
            borderRadius: 999,
            background: "var(--glass)",
            border: "1px solid var(--glass-border)",
            backdropFilter: "blur(16px)",
          }}
        >
          {(["globe", "map"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                border: "none",
                borderRadius: 999,
                padding: "6px 16px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                textTransform: "capitalize",
                background: view === v ? "var(--accent-lime)" : "transparent",
                color: view === v ? "var(--chip-dark)" : "var(--ink)",
              }}
            >
              {v}
            </button>
          ))}
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

        {/* Stat cards, top-right - held-out percentile / negative controls / p-value. */}
        {status === "ready" && validation && (
          <div style={{ position: "absolute", top: 20, right: 20, width: 210 }}>
            <StatCards validation={validation} />
          </div>
        )}

        {/* Ranked-target rail, bottom - one card per target, ScoreRing for its fused score. */}
        {status === "ready" && targets && (
          <div style={{ position: "absolute", left: 20, right: 20, bottom: 20 }}>
            <TargetRail targets={targets} selectedRank={selectedRank} onSelect={setSelectedRank} />
          </div>
        )}
      </main>
    </div>
  );
}
