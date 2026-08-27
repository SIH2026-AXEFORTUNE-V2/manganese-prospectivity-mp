"use client";

// New-project wizard - docs/issues/09-project-workspace-flow.md §2.
//
// Split into steps because the follow-up questions genuinely diverge: someone chasing a
// production shortfall this month should never be walked through reserve-discovery questions
// to get there, and vice versa. One long form would ask everybody everything.
//
// Full desktop-width, three-rail layout on the Target step: a running Project Summary on the
// left (state readout, never a second source of truth), the step's own form in the middle, and
// a live preview of the schedule that target would generate on the right - see
// SchedulePreviewPanel, which just calls the same generatePlan() the Plan tab uses once the
// project exists.

import { useMemo, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, X } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import GlassCard from "@/components/GlassCard";
import RequireSession from "@/components/RequireSession";
import ProjectSummarySidebar from "@/components/ProjectSummarySidebar";
import SchedulePreviewPanel from "@/components/SchedulePreviewPanel";
import { useOreCompassData } from "@/lib/useOreCompassData";
import { createProject, useSession } from "@/lib/projectStore";
import { deriveZones, leasePresets } from "@/lib/aiZones";
import { addDays, isoDate } from "@/lib/aiSchedule";
import type { LatLonBounds } from "@/lib/contract";
import type { ProductionTarget, ProjectMode } from "@/lib/projectTypes";

const MODES: Array<{ id: ProjectMode; title: string; blurb: string; summary: string }> = [
  {
    id: "discover",
    title: "Find new reserves here",
    blurb: "You have an area and want to know where to survey next. Output is a ranked zone map.",
    summary: "Reserve discovery",
  },
  {
    id: "produce",
    title: "Hit a production target",
    blurb: "You have an operating mine and a monthly tonnage to make. Output is a day-by-day schedule.",
    summary: "Production planning",
  },
  {
    id: "both",
    title: "Both",
    blurb: "Rank the ground and plan the month against it. Discovery questions come first.",
    summary: "Balanced production & inventory planning",
  },
];

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function NewProjectPage() {
  return (
    <RequireSession>
      <NewProjectWizard />
    </RequireSession>
  );
}

function NewProjectWizard() {
  const router = useRouter();
  const { session } = useSession();
  const { status, targets, mines } = useOreCompassData();

  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<ProjectMode>("both");
  const [name, setName] = useState("");
  const [aoiName, setAoiName] = useState("Custom area");
  const [bbox, setBbox] = useState<LatLonBounds>([79.9, 21.5, 80.6, 22.1]);

  const [tonnes, setTonnes] = useState("12000");
  const [gradePct, setGradePct] = useState("34");
  const [periodStart, setPeriodStart] = useState(isoDate(new Date()));
  const [periodDays, setPeriodDays] = useState("26");
  const [benchList, setBenchList] = useState<string[]>(["Bench 2", "Bench 3", "Bench 5"]);

  const presets = useMemo(() => leasePresets(mines), [mines]);
  const needsTarget = mode !== "discover";
  const wantsZones = mode !== "produce";

  const periodEnd = useMemo(() => addDays(periodStart, Math.max(1, Number(periodDays) || 1) - 1), [periodStart, periodDays]);

  const liveTarget: ProductionTarget | null = needsTarget
    ? {
        tonnes: Number(tonnes) || 0,
        gradePct: Number(gradePct) || 0,
        periodStart,
        periodDays: Number(periodDays) || 26,
        benches: benchList.length > 0 ? benchList : ["Bench 1"],
      }
    : null;

  // Live preview of what the AOI will actually yield, shown on the AOI step. An empty result
  // is a real answer and the wizard says so rather than letting the user find out later.
  const previewZones = useMemo(
    () => (targets && wantsZones ? deriveZones({ bbox, targets, mines }) : []),
    [targets, mines, bbox, wantsZones],
  );

  const steps = needsTarget ? ["Purpose", "Area", "Target"] : ["Purpose", "Area", "Review"];

  function create() {
    if (!targets || !session) return;
    const project = createProject({
      name: name.trim() || `${aoiName} project`,
      mode,
      aoiName,
      bbox,
      target: liveTarget,
      owner: session.name,
      targets,
      mines,
    });
    router.push(`/projects/${project.id}`);
  }

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <AppHeader crumbs={[{ label: "Projects", href: "/projects" }, { label: "New project" }]} />

      <main style={{ flex: 1, padding: "0 28px 32px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
          {steps.map((s, i) => (
            <span key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {i < step ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 12px 4px 6px",
                    borderRadius: 999,
                    background: "var(--glass)",
                    border: "1px solid var(--glass-border)",
                    fontWeight: 600,
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: "var(--good)",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Check size={11} />
                  </span>
                  {s}
                </span>
              ) : (
                <span
                  style={{
                    padding: "4px 12px",
                    borderRadius: 999,
                    background: i === step ? "var(--chip-dark)" : "transparent",
                    color: i === step ? "var(--accent-lime)" : "var(--ink-dim)",
                    border: i === step ? "none" : "1px solid var(--glass-border)",
                    fontWeight: 600,
                  }}
                >
                  {i + 1}. {s}
                </span>
              )}
              {i < steps.length - 1 && (
                <span style={{ color: "var(--ink-dim)", display: "flex" }}>
                  <ChevronRight size={14} />
                </span>
              )}
            </span>
          ))}
        </div>

        <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
          <ProjectSummarySidebar
            name={name}
            purposeLabel={MODES.find((m) => m.id === mode)?.summary ?? ""}
            aoiName={aoiName}
            target={
              needsTarget
                ? {
                    tonnes: Number(tonnes) || 0,
                    gradePct: Number(gradePct) || 0,
                    periodStart,
                    periodDays: Number(periodDays) || 0,
                    periodStartLabel: formatDate(periodStart),
                    periodEndLabel: formatDate(periodEnd),
                  }
                : null
            }
          />

          <GlassCard style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16, flex: "1 1 460px", minWidth: 340 }}>
            {/* ---------------------------------------------------------------- step 1 */}
            {step === 0 && (
              <>
                <div>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>What are you here for?</h2>
                  <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-dim)" }}>
                    The questions after this differ by answer, so this one comes first.
                  </p>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {MODES.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMode(m.id)}
                      style={{
                        textAlign: "left",
                        background: "var(--glass)",
                        border: `1px solid ${mode === m.id ? "var(--accent-lime)" : "var(--glass-border)"}`,
                        borderRadius: 12,
                        padding: 14,
                        cursor: "pointer",
                        color: "var(--ink)",
                      }}
                    >
                      <div style={{ fontSize: 14.5, fontWeight: 700 }}>{m.title}</div>
                      <div style={{ fontSize: 12.5, color: "var(--ink-dim)", marginTop: 4 }}>{m.blurb}</div>
                    </button>
                  ))}
                </div>

                <label style={labelStyle}>
                  Project name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Balaghat North — Q3"
                    style={inputStyle}
                  />
                </label>

                <Nav onNext={() => setStep(1)} nextLabel="Choose the area" />
              </>
            )}

            {/* ---------------------------------------------------------------- step 2 */}
            {step === 1 && (
              <>
                <div>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Which ground?</h2>
                  <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-dim)" }}>
                    Pick a known lease, or set the bounding box directly.
                  </p>
                </div>

                <label style={labelStyle}>
                  Known lease
                  <select
                    value={aoiName}
                    onChange={(e) => {
                      const p = presets.find((x) => `${x.name} lease` === e.target.value);
                      setAoiName(e.target.value);
                      if (p) setBbox(p.bbox);
                    }}
                    style={inputStyle}
                  >
                    <option value="Custom area">Custom area (set bounds below)</option>
                    {presets.map((p) => (
                      <option key={p.name} value={`${p.name} lease`}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                  {(["West", "South", "East", "North"] as const).map((edge, i) => (
                    <label key={edge} style={labelStyle}>
                      {edge}
                      <input
                        type="number"
                        step="0.01"
                        value={bbox[i]}
                        onChange={(e) => {
                          const next = [...bbox] as LatLonBounds;
                          next[i] = Number(e.target.value);
                          setBbox(next);
                          setAoiName((n) => (n === "Custom area" ? n : "Custom area"));
                        }}
                        style={inputStyle}
                      />
                    </label>
                  ))}
                </div>

                {wantsZones && (
                  <div
                    style={{
                      border: "1px solid var(--glass-border)",
                      borderRadius: 12,
                      padding: 14,
                      fontSize: 13,
                      lineHeight: 1.55,
                    }}
                  >
                    {status !== "ready" ? (
                      <span style={{ color: "var(--ink-dim)" }}>loading ranked targets…</span>
                    ) : previewZones.length === 0 ? (
                      <span style={{ color: "var(--warn)" }}>
                        No ranked target falls inside these bounds. That is a real answer — the model
                        surfaced nothing here — so the project will open with an empty zone list rather
                        than the nearest few pretending to be coverage. Widen the box or pick another lease.
                      </span>
                    ) : (
                      <>
                        <strong>{previewZones.length} ranked zone(s)</strong> inside these bounds —{" "}
                        {previewZones
                          .slice(0, 3)
                          .map((z) => `${z.placeName} (${z.gradeBand})`)
                          .join(", ")}
                        {previewZones.length > 3 ? ", …" : ""}
                      </>
                    )}
                  </div>
                )}

                <Nav
                  onBack={() => setStep(0)}
                  onNext={() => setStep(2)}
                  nextLabel={needsTarget ? "Set the target" : "Review"}
                />
              </>
            )}

            {/* ---------------------------------------------------------------- step 3 */}
            {step === 2 && (
              <>
                {needsTarget ? (
                  <>
                    <div>
                      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>What has to come out?</h2>
                      <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-dim)" }}>
                        The schedule is generated from this: tonnage spread across the period in
                        proportion to each day&rsquo;s usable capacity, with monsoon and maintenance days
                        carrying less.
                      </p>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1fr) minmax(120px, 1fr) minmax(200px, 1.7fr)", gap: 10 }}>
                      <label style={labelStyle}>
                        Target tonnes
                        <input type="number" value={tonnes} onChange={(e) => setTonnes(e.target.value)} style={inputStyle} />
                        <span style={hintStyle}>Avg {(Number(tonnes) / Math.max(1, Number(periodDays) || 1)).toFixed(1)} t/day</span>
                      </label>
                      <label style={labelStyle}>
                        Required grade (% Mn)
                        <input type="number" value={gradePct} onChange={(e) => setGradePct(e.target.value)} style={inputStyle} />
                        <span style={hintStyle}>0–100%</span>
                      </label>
                      <label style={labelStyle}>
                        Target Period
                        <div style={{ ...inputStyle, display: "flex", alignItems: "center", gap: 6, padding: "6px 8px" }}>
                          <input
                            type="date"
                            value={periodStart}
                            onChange={(e) => setPeriodStart(e.target.value)}
                            style={dateSubInput}
                          />
                          <span style={{ color: "var(--ink-dim)", fontSize: 12, flexShrink: 0 }}>to</span>
                          <input type="date" value={periodEnd} disabled style={{ ...dateSubInput, opacity: 0.6 }} />
                        </div>
                        <span style={hintStyle}>(Calculated: {periodDays || 0} Working Days)</span>
                      </label>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                      <label style={labelStyle}>
                        Required grade (% Mn)
                        <input type="number" value={gradePct} onChange={(e) => setGradePct(e.target.value)} style={inputStyle} />
                        <span style={hintStyle}>0–100%</span>
                      </label>
                      <label style={labelStyle}>
                        Working days
                        <input type="number" value={periodDays} onChange={(e) => setPeriodDays(e.target.value)} style={inputStyle} />
                      </label>
                    </div>

                    <label style={labelStyle}>
                      Benches in rotation (comma separated)
                      <ChipInput values={benchList} onChange={setBenchList} placeholder="Add benches…" />
                    </label>
                  </>
                ) : (
                  <div>
                    <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Ready</h2>
                    <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.6 }}>
                      {previewZones.length} zone(s) will be ranked for {aoiName}. You can add a production
                      target later from the project&rsquo;s Plan tab — the calendar and the forecast appear
                      the moment you do.
                    </p>
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    fontSize: 12,
                    color: "var(--ink-dim)",
                    lineHeight: 1.6,
                    background: "color-mix(in srgb, var(--good) 12%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--good) 30%, transparent)",
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  Have old borehole logs or production registers? Create the project, then drop them on
                  its <strong>Data</strong> tab — the parser proposes a column mapping and imports
                  nothing until you confirm it.
                </div>

                <Nav
                  onBack={() => setStep(1)}
                  onNext={create}
                  nextLabel={status === "ready" ? "Create project" : "loading fixture…"}
                  nextDisabled={status !== "ready"}
                  extra={
                    <button type="button" style={secondaryBtn}>
                      Save as draft
                    </button>
                  }
                />
              </>
            )}
          </GlassCard>

          {step === 2 && liveTarget && <SchedulePreviewPanel target={liveTarget} />}
        </div>
      </main>
    </div>
  );
}

function ChipInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div
      style={{
        ...inputStyle,
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        padding: 8,
        alignItems: "center",
      }}
    >
      {values.map((v) => (
        <span
          key={v}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            background: "var(--chip-dark)",
            color: "var(--chip-dark-ink)",
            borderRadius: 999,
            padding: "4px 6px 4px 10px",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {v}
          <button
            type="button"
            onClick={() => onChange(values.filter((x) => x !== v))}
            aria-label={`Remove ${v}`}
            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", display: "flex", padding: 0 }}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={placeholder}
        style={{ flex: "1 1 100px", minWidth: 100, border: "none", background: "transparent", outline: "none", fontSize: 13.5, color: "var(--ink)" }}
      />
    </div>
  );
}

function Nav({
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
  extra,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      {onBack && (
        <button type="button" onClick={onBack} style={secondaryBtn}>
          Back
        </button>
      )}
      {extra}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        style={{ ...primaryBtn, marginLeft: "auto", opacity: nextDisabled ? 0.45 : 1, cursor: nextDisabled ? "not-allowed" : "pointer" }}
      >
        {nextLabel}
      </button>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 5,
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--ink-dim)",
};

const hintStyle: React.CSSProperties = {
  fontSize: 10.5,
  color: "var(--ink-dim)",
  fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  background: "var(--glass)",
  border: "1px solid var(--glass-border)",
  borderRadius: 9,
  padding: "9px 11px",
  fontSize: 13.5,
  color: "var(--ink)",
  fontWeight: 400,
  width: "100%",
};

const dateSubInput: React.CSSProperties = {
  border: "none",
  background: "transparent",
  outline: "none",
  fontSize: 13,
  color: "var(--ink)",
  flex: 1,
  minWidth: 0,
};

const primaryBtn: React.CSSProperties = {
  background: "var(--accent-lime)",
  color: "var(--chip-dark)",
  border: "none",
  borderRadius: 999,
  padding: "10px 20px",
  fontSize: 13.5,
  fontWeight: 700,
};

const secondaryBtn: React.CSSProperties = {
  background: "var(--glass)",
  border: "1px solid var(--glass-border)",
  borderRadius: 999,
  padding: "10px 18px",
  fontSize: 13,
  color: "var(--ink)",
  cursor: "pointer",
};
