"use client";

// New-project wizard - docs/issues/09-project-workspace-flow.md §2.
//
// Split into steps because the follow-up questions genuinely diverge: someone chasing a
// production shortfall this month should never be walked through reserve-discovery questions
// to get there, and vice versa. One long form would ask everybody everything.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import GlassCard from "@/components/GlassCard";
import RequireSession from "@/components/RequireSession";
import { useOreCompassData } from "@/lib/useOreCompassData";
import { createProject, useSession } from "@/lib/projectStore";
import { deriveZones, leasePresets } from "@/lib/aiZones";
import { isoDate } from "@/lib/aiSchedule";
import type { LatLonBounds } from "@/lib/contract";
import type { ProductionTarget, ProjectMode } from "@/lib/projectTypes";

const MODES: Array<{ id: ProjectMode; title: string; blurb: string }> = [
  {
    id: "discover",
    title: "Find new reserves here",
    blurb: "You have an area and want to know where to survey next. Output is a ranked zone map.",
  },
  {
    id: "produce",
    title: "Hit a production target",
    blurb: "You have an operating mine and a monthly tonnage to make. Output is a day-by-day schedule.",
  },
  {
    id: "both",
    title: "Both",
    blurb: "Rank the ground and plan the month against it. Discovery questions come first.",
  },
];

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
  const [benches, setBenches] = useState("Bench 2, Bench 3, Bench 5");

  const presets = useMemo(() => leasePresets(mines), [mines]);
  const needsTarget = mode !== "discover";
  const wantsZones = mode !== "produce";

  // Live preview of what the AOI will actually yield, shown on the AOI step. An empty result
  // is a real answer and the wizard says so rather than letting the user find out later.
  const previewZones = useMemo(
    () => (targets && wantsZones ? deriveZones({ bbox, targets, mines }) : []),
    [targets, mines, bbox, wantsZones],
  );

  const steps = needsTarget ? ["Purpose", "Area", "Target"] : ["Purpose", "Area", "Review"];

  function create() {
    if (!targets || !session) return;
    const target: ProductionTarget | null = needsTarget
      ? {
          tonnes: Number(tonnes) || 0,
          gradePct: Number(gradePct) || 0,
          periodStart,
          periodDays: Number(periodDays) || 26,
          benches: benches
            .split(",")
            .map((b) => b.trim())
            .filter(Boolean),
        }
      : null;
    const project = createProject({
      name: name.trim() || `${aoiName} project`,
      mode,
      aoiName,
      bbox,
      target,
      owner: session.name,
      targets,
      mines,
    });
    router.push(`/projects/${project.id}`);
  }

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <AppHeader crumbs={[{ label: "Projects", href: "/projects" }, { label: "New project" }]} />

      <main style={{ flex: 1, padding: "0 24px 32px" }}>
        <div style={{ maxWidth: 780, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
            {steps.map((s, i) => (
              <span key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                {i < steps.length - 1 && (
                  <span style={{ color: "var(--ink-dim)", display: "flex" }}>
                    <ChevronRight size={14} />
                  </span>
                )}
              </span>
            ))}
          </div>

          {/* ---------------------------------------------------------------- step 1 */}
          {step === 0 && (
            <GlassCard style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
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
            </GlassCard>
          )}

          {/* ---------------------------------------------------------------- step 2 */}
          {step === 1 && (
            <GlassCard style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
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
            </GlassCard>
          )}

          {/* ---------------------------------------------------------------- step 3 */}
          {step === 2 && (
            <GlassCard style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
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

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                    <label style={labelStyle}>
                      Target tonnes
                      <input type="number" value={tonnes} onChange={(e) => setTonnes(e.target.value)} style={inputStyle} />
                    </label>
                    <label style={labelStyle}>
                      Required grade (% Mn)
                      <input type="number" value={gradePct} onChange={(e) => setGradePct(e.target.value)} style={inputStyle} />
                    </label>
                    <label style={labelStyle}>
                      Period starts
                      <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} style={inputStyle} />
                    </label>
                    <label style={labelStyle}>
                      Working days
                      <input type="number" value={periodDays} onChange={(e) => setPeriodDays(e.target.value)} style={inputStyle} />
                    </label>
                  </div>

                  <label style={labelStyle}>
                    Benches in rotation (comma separated)
                    <input value={benches} onChange={(e) => setBenches(e.target.value)} style={inputStyle} />
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

              <div style={{ fontSize: 12, color: "var(--ink-dim)", lineHeight: 1.6 }}>
                Have old borehole logs or production registers? Create the project, then drop them on
                its <strong>Data</strong> tab — the parser proposes a column mapping and imports
                nothing until you confirm it.
              </div>

              <Nav
                onBack={() => setStep(1)}
                onNext={create}
                nextLabel={status === "ready" ? "Create project" : "loading fixture…"}
                nextDisabled={status !== "ready"}
              />
            </GlassCard>
          )}
        </div>
      </main>
    </div>
  );
}

function Nav({
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      {onBack && (
        <button type="button" onClick={onBack} style={secondaryBtn}>
          Back
        </button>
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        style={{ ...primaryBtn, opacity: nextDisabled ? 0.45 : 1, cursor: nextDisabled ? "not-allowed" : "pointer" }}
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
