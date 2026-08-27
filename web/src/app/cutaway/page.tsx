"use client";

// Route: /cutaway
//
// Standalone underground Cesium 3D cutaway view for Balaghat Mine.
// Loaded via next/dynamic with ssr: false to prevent WebGL/window SSR conflicts.

import dynamic from "next/dynamic";
import TopNav from "@/components/TopNav";
import { useState } from "react";

const CesiumCutaway = dynamic(() => import("@/components/CesiumCutaway"), {
  ssr: false,
  loading: () => (
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
      Loading Cesium 3D Engine…
    </div>
  ),
});

export default function CutawayPage() {
  const [workspace, setWorkspace] = useState<"explore" | "protect">("explore");

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
          <CesiumCutaway />
        </div>
      </main>
    </div>
  );
}
