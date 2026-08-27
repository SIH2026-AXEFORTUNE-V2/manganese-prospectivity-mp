"use client";

// Raw uploads -> training rows - docs/issues/09-project-workspace-flow.md §6.

import { useParams } from "next/navigation";
import { Boxes, Circle } from "lucide-react";
import DataImportPanel from "@/components/DataImportPanel";
import DataSourcesPanel, { ProvenanceTables } from "@/components/DataSourcesPanel";
import { saveImportedLogs, useProject } from "@/lib/projectStore";

export default function ProjectDataPage() {
  const params = useParams<{ id: string }>();
  const { project } = useProject(params?.id ?? null);
  if (!project) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1360 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(280px, 1fr)", gap: 16, alignItems: "start" }}>
        <DataImportPanel
          uploads={project.uploads}
          onImport={(logs, record) => saveImportedLogs(project.id, logs, record)}
        />
        <DataSourcesPanel />
      </div>

      <div>
        <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700 }}>Data provenance</h3>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--ink-dim)" }}>
          Source and availability of the data used in the pipeline and modelling.
        </p>
        <ProvenanceTables />
      </div>

      <DataFooterBar />
    </div>
  );
}

function DataFooterBar() {
  const now = new Date();
  const lastRun = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 10,
        padding: "12px 4px 0",
        borderTop: "1px solid var(--rule)",
        fontSize: 11.5,
        color: "var(--ink-dim)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <img src="/logo.png" alt="" width={20} height={20} style={{ borderRadius: 5 }} />
        <strong style={{ color: "var(--ink)", fontWeight: 700 }}>MOIL LTD.</strong> — Balaghat Division
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Boxes size={12} /> Powered by Sentinel-2, SRTM, GSI Bhukosh
        </span>
        <span>Pipeline v2.4.1</span>
        <span>Last run: {lastRun}, 10:30 AM IST</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--good)", fontWeight: 600 }}>
          <Circle size={7} fill="var(--good)" color="var(--good)" /> All systems operational
        </span>
      </div>
    </div>
  );
}
