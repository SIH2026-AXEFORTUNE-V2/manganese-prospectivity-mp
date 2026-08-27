// DetailDrawer — slide-over panel showing Evidence and Validation tabs for a selected target.
// Positioned as an absolute overlay on the right side of the map container, consistent with
// the other floating GlassCard panels (StatCards top-right, headline top-left).
// Uses CSS transitions so the panel animates in/out rather than hard-cutting.

"use client";

import { useState } from "react";
import GlassCard from "./GlassCard";
import EvidencePanel from "./EvidencePanel";
import ValidationPanel from "./ValidationPanel";
import type { TargetProperties, ValidationReport } from "@/lib/contract";

type Tab = "evidence" | "validation";

interface DetailDrawerProps {
  target: TargetProperties;
  validation: ValidationReport;
  onClose: () => void;
}

export default function DetailDrawer({
  target,
  validation,
  onClose,
}: DetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<Tab>("evidence");

  return (
    <div
      style={{
        position: "absolute",
        top: 20,
        right: 20,
        bottom: 20,
        width: 360,
        display: "flex",
        flexDirection: "column",
        gap: 0,
        // Stack above StatCards (which are also top-right but only ~210px wide)
        zIndex: 10,
        // Slide in from the right
        animation: "drawerSlideIn 0.22s cubic-bezier(0.22, 1, 0.36, 1) both",
      }}
    >
      <style>{`
        @keyframes drawerSlideIn {
          from { opacity: 0; transform: translateX(24px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      <GlassCard
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          overflow: "hidden",
          padding: 0,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px 0",
            borderBottom: "1px solid var(--rule)",
            paddingBottom: 0,
          }}
        >
          {/* Title row */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 14,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--ink-dim)",
                }}
              >
                Target detail
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
                #{String(target.rank).padStart(2, "0")} ·{" "}
                <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 400 }}>
                  {target.lat.toFixed(3)}°N {target.lon.toFixed(3)}°E
                </span>
              </div>
            </div>
            <button
              id={`drawer-close-btn`}
              onClick={onClose}
              aria-label="Close detail panel"
              style={{
                background: "var(--rule)",
                border: "none",
                borderRadius: 999,
                width: 32,
                height: 32,
                cursor: "pointer",
                fontSize: 16,
                color: "var(--ink)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "var(--glass-border)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "var(--rule)")
              }
            >
              ×
            </button>
          </div>

          {/* Tab bar */}
          <div style={{ display: "flex", gap: 0 }}>
            {(["evidence", "validation"] as Tab[]).map((tab) => (
              <button
                key={tab}
                id={`drawer-tab-${tab}`}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1,
                  padding: "9px 0",
                  border: "none",
                  borderBottom:
                    activeTab === tab
                      ? "2px solid var(--accent-lime)"
                      : "2px solid transparent",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: activeTab === tab ? 700 : 400,
                  color: activeTab === tab ? "var(--ink)" : "var(--ink-dim)",
                  textTransform: "capitalize",
                  letterSpacing: "0.03em",
                  transition: "color 0.15s, border-color 0.15s",
                }}
              >
                {tab === "evidence" ? "Evidence" : "Validation"}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable body */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px",
          }}
        >
          {activeTab === "evidence" ? (
            <EvidencePanel target={target} />
          ) : (
            <ValidationPanel validation={validation} />
          )}
        </div>
      </GlassCard>
    </div>
  );
}
