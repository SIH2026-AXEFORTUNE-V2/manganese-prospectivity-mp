"use client";

// Raw register in, training rows out, with the confirm step in between -
// docs/issues/09-project-workspace-flow.md §6.

import { useState } from "react";
import type { CSSProperties } from "react";
import {
  UploadCloud,
  FileText,
  FileSpreadsheet,
  Info,
  Download,
  Inbox,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import GlassCard from "./GlassCard";
import {
  buildLogs,
  FIELD_LABELS,
  IMPORT_FIELDS,
  parseCsv,
  REQUIRED_FIELDS,
  SAMPLE_CSV,
  suggestMapping,
  type ImportField,
  type Mapping,
  type ParsedCsv,
} from "@/lib/csvImport";
import { DELAY_REASON_LABELS, type DayLog, type UploadRecord } from "@/lib/projectTypes";

export default function DataImportPanel({
  uploads,
  onImport,
}: {
  uploads: UploadRecord[];
  onImport: (logs: DayLog[], record: UploadRecord) => void;
}) {
  const [filename, setFilename] = useState<string>("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [done, setDone] = useState<string | null>(null);

  function ingest(name: string, text: string) {
    const p = parseCsv(text);
    setFilename(name);
    setParsed(p);
    setMapping(suggestMapping(p.headers));
    setDone(null);
  }

  async function onFile(file: File) {
    ingest(file.name, await file.text());
  }

  const result = parsed ? buildLogs(parsed, mapping) : null;
  const missingRequired = REQUIRED_FIELDS.filter((f) => !mapping[f]);
  const canImport = !!result && result.logs.length > 0 && missingRequired.length === 0;
  const latest = uploads.length > 0 ? uploads[uploads.length - 1] : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* --------------------------------------------------------- upload card -- */}
      <GlassCard style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Upload a production register</h3>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.5, maxWidth: 640 }}>
            Drop a CSV export of your daily production register (equipment log) to import and
            validate. The mapping is proposed automatically and you can confirm before saving.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(200px, 1fr)", gap: 14 }}>
          {/* dropzone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) void onFile(f);
            }}
            style={{
              border: "1.5px dashed var(--glass-border)",
              borderRadius: 14,
              padding: "28px 20px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
            }}
          >
            <UploadCloud size={34} color="var(--accent-lime)" style={{ marginBottom: 6 }} />
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              Drag & drop your file here, or{" "}
              <label style={{ color: "var(--accent-lime)", textDecoration: "underline", cursor: "pointer" }}>
                browse
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onFile(f);
                  }}
                />
              </label>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
              Supports CSV, XLSX · Max file size 50 MB
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <span style={formatChip}>
                <FileText size={13} color="var(--good)" /> CSV
              </span>
              <span style={formatChip}>
                <FileSpreadsheet size={13} color="var(--good)" /> XLSX
              </span>
            </div>
            <button type="button" onClick={() => ingest("sample-register.csv", SAMPLE_CSV)} style={{ ...smallBtn, marginTop: 12 }}>
              or try the sample register
            </button>
          </div>

          {/* expected schema */}
          <div style={{ background: "rgba(20,21,15,0.03)", border: "1px solid var(--glass-border)", borderRadius: 14, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700 }}>
              Expected schema <Info size={13} color="var(--ink-dim)" />
            </div>
            <p style={{ margin: "6px 0 8px", fontSize: 11.5, color: "var(--ink-dim)", lineHeight: 1.5 }}>
              Production register expects the following columns:
            </p>
            <div
              style={{
                background: "var(--chip-dark)",
                color: "var(--chip-dark-ink)",
                borderRadius: 10,
                padding: "10px 12px",
                fontFamily: "monospace",
                fontSize: 11.5,
                lineHeight: 1.9,
              }}
            >
              {IMPORT_FIELDS.map((f) => (
                <div key={f}>{f}</div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => ingest("sample-register.csv", SAMPLE_CSV)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                marginTop: 10,
                background: "none",
                border: "none",
                padding: 0,
                color: "var(--accent-lime)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Download template <Download size={12} />
            </button>
          </div>
        </div>

        {/* -------------------------------------------------- confirm mapping -- */}
        {parsed && parsed.headers.length > 0 && (
          <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Confirm the column mapping</h3>
              <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                {filename} · {parsed.rows.length} data rows · {parsed.headers.length} columns
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
              {IMPORT_FIELDS.map((field: ImportField) => (
                <label key={field} style={labelStyle}>
                  {FIELD_LABELS[field]}
                  {REQUIRED_FIELDS.includes(field) && <span style={{ color: "var(--critical)" }}> *</span>}
                  <select
                    value={mapping[field] ?? ""}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, [field]: e.target.value === "" ? undefined : e.target.value }))
                    }
                    style={inputStyle}
                  >
                    <option value="">— not in this file —</option>
                    {parsed.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            {missingRequired.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--warn)" }}>
                Still needed: {missingRequired.map((f) => FIELD_LABELS[f]).join(", ")}.
              </div>
            )}

            {result && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  Preview — {result.logs.length} day{result.logs.length === 1 ? "" : "s"} ready
                  {result.skipped.length > 0 && `, ${result.skipped.length} row(s) skipped`}
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 520 }}>
                    <thead>
                      <tr>
                        {["Date", "Tonnes", "Grade", "Delays read"].map((h) => (
                          <th key={h} style={thStyle}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.logs.slice(0, 6).map((l) => (
                        <tr key={l.date}>
                          <td style={tdStyle}>{l.date}</td>
                          <td style={tdStyle}>{l.actualTonnes.toLocaleString()}</td>
                          <td style={tdStyle}>{l.actualGradePct || "—"}</td>
                          <td style={tdStyle}>
                            {l.delays.length === 0
                              ? "—"
                              : l.delays
                                  .map(
                                    (d) =>
                                      `${DELAY_REASON_LABELS[d.reason]} ${d.startHour}–${d.endHour}h (${d.machineId})`,
                                  )
                                  .join("; ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {result.skipped.length > 0 && (
                  <details style={{ fontSize: 11.5, color: "var(--ink-dim)" }}>
                    <summary style={{ cursor: "pointer" }}>Why {result.skipped.length} row(s) were skipped</summary>
                    <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                      {result.skipped.slice(0, 12).map((s, i) => (
                        <li key={i}>
                          row {s.row}: {s.why}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div style={{ fontSize: 11.5, color: "var(--ink-dim)", lineHeight: 1.5 }}>
                  Free-text delay reasons are matched to the fixed reason list on import; anything
                  unrecognised becomes &ldquo;Other&rdquo; rather than entering the model as a new
                  category nobody defined.
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                type="button"
                disabled={!canImport}
                onClick={() => {
                  if (!result || !canImport) return;
                  onImport(result.logs, {
                    id: `upl_${Date.now().toString(36)}`,
                    filename,
                    rows: parsed.rows.length,
                    accepted: result.logs.length,
                    uploadedAt: new Date().toISOString(),
                    mapping: Object.fromEntries(
                      Object.entries(mapping).filter(([, v]) => !!v) as Array<[string, string]>,
                    ),
                  });
                  setDone(`${result.logs.length} day(s) imported from ${filename}.`);
                  setParsed(null);
                }}
                style={{ ...primaryBtn, opacity: canImport ? 1 : 0.45, cursor: canImport ? "pointer" : "not-allowed" }}
              >
                Confirm mapping & import
              </button>
              <button type="button" onClick={() => setParsed(null)} style={smallBtn}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {done && (
          <div style={{ padding: 12, borderRadius: 10, background: "color-mix(in srgb, var(--good) 12%, transparent)", fontSize: 13, color: "var(--good)" }}>
            {done} The production forecast was refit against them.
          </div>
        )}
      </GlassCard>

      {/* ------------------------------------------------------ import history -- */}
      <GlassCard style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Import history</h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-dim)" }}>
            View your recent imports and their status.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(240px, 1.1fr)", gap: 14, alignItems: "stretch" }}>
          {/* left: count / empty state */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 20, textAlign: "center" }}>
            <span style={inboxBadge}>
              <Inbox size={22} color="var(--ink-dim)" />
            </span>
            {uploads.length === 0 ? (
              <>
                <div style={{ fontSize: 14, fontWeight: 700 }}>No imports yet</div>
                <div style={{ fontSize: 12, color: "var(--ink-dim)", lineHeight: 1.5, maxWidth: 280 }}>
                  Once you upload a file, it will appear here with validation status, row count
                  and mapping details.
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {uploads.length} import{uploads.length === 1 ? "" : "s"} on file
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-dim)", lineHeight: 1.5, maxWidth: 280 }}>
                  {uploads.reduce((s, u) => s + u.accepted, 0).toLocaleString()} day-rows accepted across
                  every upload so far.
                </div>
              </>
            )}
          </div>

          {/* right: latest import preview (real if present, illustrative example otherwise) */}
          <ImportPreviewCard upload={latest} />
        </div>
      </GlassCard>
    </div>
  );
}

/* ------------------------------------------------------------- preview card -- */

function ImportPreviewCard({ upload }: { upload: UploadRecord | null }) {
  const example = !upload;
  // Illustrative placeholder shown before any real file has been imported - clearly labelled
  // as an example, not a claim that this data exists yet.
  const display = upload ?? {
    id: "example",
    filename: "production_register_jan.csv",
    rows: 12842,
    accepted: 12840,
    uploadedAt: new Date().toISOString(),
    mapping: {},
  };
  const anomalies = display.rows - display.accepted;
  const anomalyPct = display.rows > 0 ? ((anomalies / display.rows) * 100).toFixed(2) : "0.00";
  const mappedCount = Object.keys(display.mapping).length;

  return (
    <div style={{ border: "1px solid var(--glass-border)", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {example ? "Preview of a completed import" : "Most recent import"}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 8, background: "color-mix(in srgb, var(--good) 15%, transparent)", display: "grid", placeItems: "center", flexShrink: 0 }}>
          <FileText size={16} color="var(--good)" />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {display.filename}
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-dim)" }}>
            {new Date(display.uploadedAt).toLocaleString()}
          </div>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--good)", background: "color-mix(in srgb, var(--good) 14%, transparent)", borderRadius: 999, padding: "3px 9px", flexShrink: 0 }}>
          <CheckCircle2 size={11} /> Validated
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, borderTop: "1px solid var(--rule)", paddingTop: 10 }}>
        <Stat label="Rows" value={display.rows.toLocaleString()} />
        <Stat label="Anomalies" value={`${anomalies} (${anomalyPct}%)`} tone={anomalies > 0 ? "var(--warn)" : "var(--good)"} />
        <Stat label="Mapping" value={example ? "Confirmed" : `${mappedCount} field${mappedCount === 1 ? "" : "s"}`} tone="var(--good)" />
      </div>

      <button
        type="button"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "none",
          border: "none",
          padding: 0,
          fontSize: 12,
          fontWeight: 600,
          color: "var(--ink)",
          cursor: example ? "default" : "pointer",
        }}
      >
        View mapping <ChevronRight size={14} />
      </button>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--ink-dim)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: tone ?? "var(--ink)", fontFamily: "monospace" }}>{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------------ styles -- */

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--ink-dim)",
};

const inputStyle: CSSProperties = {
  background: "var(--glass)",
  border: "1px solid var(--glass-border)",
  borderRadius: 8,
  padding: "7px 9px",
  fontSize: 13,
  color: "var(--ink)",
  fontWeight: 400,
  width: "100%",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "6px 12px 6px 0",
  borderBottom: "1px solid var(--rule)",
  color: "var(--ink-dim)",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "6px 12px 6px 0",
  borderBottom: "1px solid var(--rule)",
  verticalAlign: "top",
};

const smallBtn: CSSProperties = {
  background: "var(--glass)",
  border: "1px solid var(--glass-border)",
  borderRadius: 999,
  padding: "5px 12px",
  fontSize: 11.5,
  color: "var(--ink)",
  cursor: "pointer",
};

const primaryBtn: CSSProperties = {
  background: "var(--accent-lime)",
  color: "var(--chip-dark)",
  border: "none",
  borderRadius: 999,
  padding: "9px 18px",
  fontSize: 13,
  fontWeight: 700,
};

const formatChip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "1px solid var(--glass-border)",
  background: "var(--bg)",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 600,
};

const inboxBadge: CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 999,
  background: "rgba(20,21,15,0.05)",
  display: "grid",
  placeItems: "center",
};
