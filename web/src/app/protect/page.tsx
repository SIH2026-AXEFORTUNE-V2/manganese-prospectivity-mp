"use client";

import { useState } from "react";
import TopNav from "@/components/TopNav";
import { useOreCompassData } from "@/lib/useOreCompassData";
import MinePortfolioGrid from "@/components/MinePortfolioGrid";
import GlassCard from "@/components/GlassCard";

export default function ProtectLane() {
  const [workspace, setWorkspace] = useState<"explore" | "protect">("protect");
  const { status, error, risk } = useOreCompassData();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      <TopNav workspace={workspace} onWorkspaceChange={setWorkspace} />

      <main style={{ flex: 1, minHeight: 0, padding: "0 16px 16px", overflowY: "auto" }}>
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            paddingTop: 16,
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div>
              <div
                style={{
                  fontSize: 12,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--ink-dim)",
                }}
              >
                Portfolio Monitoring
              </div>
              <h1 style={{ fontSize: 30, lineHeight: 1.08, margin: "8px 0 0", fontWeight: 700 }}>
                Climate Risk Tiers
              </h1>
            </div>
            
            <GlassCard
              style={{
                padding: "8px 12px",
                border: "1px solid var(--warn)",
                background: "color-mix(in srgb, var(--warn) 10%, transparent)",
              }}
            >
              <div style={{ fontSize: 12, color: "var(--warn)", fontWeight: 600 }}>
                ⚠️ Rule-based signal, not a trained forecast
              </div>
            </GlassCard>
          </div>

          {status === "ready" && risk ? (
            <MinePortfolioGrid mines={risk} />
          ) : (
            <div
              style={{
                width: "100%",
                padding: 40,
                textAlign: "center",
                color: "var(--ink-dim)",
                fontFamily: "monospace",
                fontSize: 13,
              }}
            >
              {status === "error" ? `error: ${error}` : "loading climate risk fixture…"}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
