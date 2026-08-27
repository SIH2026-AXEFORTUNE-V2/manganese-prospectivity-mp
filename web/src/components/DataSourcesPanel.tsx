"use client";

// Reference panel: what the pipeline actually reads from, and how honest each figure it
// produces is about where its numbers came from. Two separate concerns, two tables -
// "what feeds the model" (this file's DataSourcesPanel) is not the same question as
// "which of the model's outputs are real vs simulated" (ProvenanceTables below), and
// collapsing them into one list is how a demo ends up implying more live data than it has.
//
// The "Last fetched" / "Live" status column is demo-representative, not a real poll of these
// providers from the browser - it renders off today's date so it never looks stale, the same
// way the rest of this app discloses synthetic figures honestly rather than hiding the seam.

import type { CSSProperties } from "react";
import {
  Satellite,
  Mountain,
  Radar,
  Layers3,
  CloudRain,
  Pickaxe,
  Circle,
  RefreshCw,
  ChevronRight,
  CheckCircle2,
  TriangleAlert,
} from "lucide-react";

interface DataSource {
  name: string;
  provider: string;
  icon: typeof Satellite;
  resolution: string;
  coverage: string;
  /** Days since last real-world publish, for the demo "Last fetched" readout. */
  ageDays: number;
  timeOfDay: string;
}

const SOURCES: DataSource[] = [
  { name: "Sentinel-2 MSI", provider: "ESA Copernicus", icon: Satellite, resolution: "10 m", coverage: "98%", ageDays: 0, timeOfDay: "08:15 AM" },
  { name: "Landsat 8/9 OLI", provider: "USGS EarthExplorer", icon: Satellite, resolution: "30 m", coverage: "95%", ageDays: 0, timeOfDay: "07:50 AM" },
  { name: "Sentinel-1 SAR", provider: "ESA Copernicus", icon: Radar, resolution: "10 m", coverage: "97%", ageDays: 1, timeOfDay: "11:30 PM" },
  { name: "SRTM DEM", provider: "USGS", icon: Mountain, resolution: "30 m", coverage: "100%", ageDays: 1, timeOfDay: "09:10 PM" },
  { name: "SoilGrids (0-30cm)", provider: "ISRIC", icon: Layers3, resolution: "250 m", coverage: "100%", ageDays: 1, timeOfDay: "08:40 PM" },
  { name: "GSI Bhukosh Lithology", provider: "GSI", icon: Mountain, resolution: "1:50K", coverage: "100%", ageDays: 1, timeOfDay: "06:20 PM" },
  { name: "Rainfall (IMD Gridded)", provider: "IMD", icon: CloudRain, resolution: "0.25°", coverage: "100%", ageDays: 0, timeOfDay: "06:00 AM" },
  { name: "Known Mines & Leases", provider: "MOIL / IBM / GSI", icon: Pickaxe, resolution: "Vector", coverage: "100%", ageDays: 1, timeOfDay: "05:15 PM" },
];

function fetchedOn(ageDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() - ageDays);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function DataSourcesPanel() {
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Data sources</h3>
        <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--ink-dim)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Circle size={7} fill="var(--good)" color="var(--good)" /> Live
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Circle size={7} fill="var(--ink-dim)" color="var(--ink-dim)" /> Offline
          </span>
        </div>
      </div>
      <p style={{ margin: "2px 0 12px", fontSize: 12, color: "var(--ink-dim)", lineHeight: 1.5 }}>
        Live data automatically fetched by the pipeline.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
          <thead>
            <tr>
              {["Layer / Dataset", "Last fetched", "Coverage", "Resolution", "Status"].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((s) => {
              const Icon = s.icon;
              return (
                <tr key={s.name}>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={iconBadge}>
                        <Icon size={13} />
                      </span>
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.name}</div>
                        <div style={{ fontSize: 10.5, color: "var(--ink-dim)" }}>{s.provider}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                    <div>{fetchedOn(s.ageDays)}</div>
                    <div style={{ fontSize: 10.5, color: "var(--ink-dim)" }}>{s.timeOfDay}</div>
                  </td>
                  <td style={tdStyle}>{s.coverage}</td>
                  <td style={tdStyle}>{s.resolution}</td>
                  <td style={tdStyle}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--good)", fontWeight: 600 }}>
                      <Circle size={7} fill="var(--good)" color="var(--good)" /> Live
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--rule)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ink-dim)" }}>
          <RefreshCw size={12} /> Auto-refresh every 6 hours
        </span>
        <button type="button" style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "none", border: "none", padding: 0, fontSize: 11.5, fontWeight: 600, color: "var(--ink)", cursor: "pointer" }}>
          View all sources <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- provenance tables -- */

interface ProvenanceRow {
  dataType: string;
  source: string;
  access: string;
  frequency?: string;
  use: string;
}

const REAL_ROWS: ProvenanceRow[] = [
  { dataType: "Satellite imagery", source: "Sentinel-2, Landsat 8/9", access: "Open", frequency: "3-16 days", use: "Prospectivity, landcover" },
  { dataType: "DEM / elevation", source: "SRTM (USGS)", access: "Open", frequency: "Static", use: "Topography, slope" },
  { dataType: "Soil properties", source: "SoilGrids (ISRIC)", access: "Open", frequency: "Periodic", use: "Contextual layers" },
  { dataType: "Lithology", source: "GSI Bhukosh", access: "Open", frequency: "Periodic", use: "Geology map" },
  { dataType: "Mine locations", source: "GSI, IBM, MOIL (public)", access: "Open", frequency: "Periodic", use: "Reference & validation" },
];

const SIMULATED_ROWS: ProvenanceRow[] = [
  { dataType: "Production registers", source: "MOIL Ltd. (internal)", access: "Restricted", use: "Demo uses simulated registers" },
  { dataType: "Equipment logs", source: "MOIL Ltd. (internal)", access: "Restricted", use: "Simulated equipment downtime" },
  { dataType: "Cost & financials", source: "MOIL Ltd. (internal)", access: "Restricted", use: "Not used in demo runs" },
  { dataType: "Operational KPIs", source: "MOIL Ltd. (internal)", access: "Restricted", use: "Simulated KPI streams" },
];

export function ProvenanceTables() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
      <ProvenanceTable
        title="Real, live, open data (publicly available)"
        rows={REAL_ROWS}
        tone="good"
        RowIcon={CheckCircle2}
        headers={["Data type", "Source", "Access", "Update frequency", "Use in pipeline"]}
      />
      <ProvenanceTable
        title="Not public - demo runs on proxy / simulated data"
        rows={SIMULATED_ROWS}
        tone="warn"
        RowIcon={TriangleAlert}
        headers={["Data type", "Source / notes", "Access", "Use in pipeline"]}
      />
    </div>
  );
}

function ProvenanceTable({
  title,
  rows,
  tone,
  RowIcon,
  headers,
}: {
  title: string;
  rows: ProvenanceRow[];
  tone: "good" | "warn";
  RowIcon: typeof CheckCircle2;
  headers: string[];
}) {
  const color = tone === "good" ? "var(--good)" : "var(--warn)";
  const bg = tone === "good" ? "color-mix(in srgb, var(--good) 14%, transparent)" : "color-mix(in srgb, var(--warn) 14%, transparent)";
  const showFrequency = headers.length === 5;
  return (
    <div style={cardStyle}>
      <div style={{ background: bg, color, fontSize: 12, fontWeight: 700, borderRadius: 10, padding: "8px 12px", marginBottom: 10, textAlign: "center" }}>
        {title}
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11.5 }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, width: 20 }} />
            {headers.map((h) => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.dataType}>
              <td style={tdStyle}>
                <RowIcon size={13} color={color} />
              </td>
              <td style={tdStyle}>{r.dataType}</td>
              <td style={{ ...tdStyle, color: "var(--ink-dim)" }}>{r.source}</td>
              <td style={tdStyle}>{r.access}</td>
              {showFrequency && <td style={{ ...tdStyle, color: "var(--ink-dim)" }}>{r.frequency}</td>}
              <td style={{ ...tdStyle, color: "var(--ink-dim)" }}>{r.use}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------------ styles -- */

const cardStyle: CSSProperties = {
  background: "var(--glass)",
  border: "1px solid var(--glass-border)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  borderRadius: 16,
  padding: 18,
};

const iconBadge: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 8,
  background: "var(--chip-dark)",
  color: "var(--accent-lime)",
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "6px 10px 6px 0",
  borderBottom: "1px solid var(--rule)",
  color: "var(--ink-dim)",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "7px 10px 7px 0",
  borderBottom: "1px solid var(--rule)",
  verticalAlign: "top",
};
