"use client";

import React, { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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

const RAW = [45, 89, 95, 44, 30, 85, 76, 99, 83, 95, 38, 5, 85, 75, 86, 100, 67, 44, 69, 69, 75, 74, 97, 77, 5, 15];
const CLRS = ['','','','orange','orange','','','','','','','red','','','','','','','orange','','','','','','orange','dim'];
const CT = ['d-gray','d-green','d-green','d-green','d-today','d-orange','d-orange','d-green','d-green','d-green','d-orange','d-orange','d-green','d-green','d-green','d-green','d-green','d-green','d-red','d-green','d-green','d-green','d-green','d-green','d-orange','d-green','d-green','d-orange','d-gray','d-empty'];
const CS = ['','P:136','P:285','P:270','Monsoon','P:133','P:145','P:268','P:285','P:285','Monsoon','Mainte.','A:256','P:229','P:297','A:250','P:285','A:114','Blast Rsk','A:256','P:225','P:258','A:321','P:202','P:208','P:208','P:225','Blast Rsk','Rest Day',''];
const MN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DC = ['d-green','d-orange','d-red','d-gray','d-empty'];

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
  const [periodStart, setPeriodStart] = useState("2026-08-28");
  const [periodDays, setPeriodDays] = useState("26");
  const [benches, setBenches] = useState<string[]>(["Bench 2", "Bench 3", "Bench 5"]);
  const [benchInput, setBenchInput] = useState("");

  const [cY, setCY] = useState(2026);
  const [cM, setCM] = useState(8); // Sept (0-indexed)

  const [toastMsg, setToastMsg] = useState("");
  const [showToast, setShowToast] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // For cycling colors in the calendar
  const [dayColors, setDayColors] = useState<Record<number, string>>({});

  const presets = useMemo(() => leasePresets(mines), [mines]);
  const needsTarget = mode !== "discover";
  const wantsZones = mode !== "produce";

  const previewZones = useMemo(
    () => (targets && wantsZones ? deriveZones({ bbox, targets, mines }) : []),
    [targets, mines, bbox, wantsZones],
  );

  const steps = needsTarget ? ["Purpose", "Area", "Target"] : ["Purpose", "Area", "Review"];

  function triggerToast(msg: string) {
    setToastMsg(msg);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  }

  function create() {
    if (!targets || !session) return;
    setIsCreating(true);
    
    setTimeout(() => {
      triggerToast("Project created! Opening workspace...");
      const target: ProductionTarget | null = needsTarget
        ? {
            tonnes: Number(tonnes) || 0,
            gradePct: Number(gradePct) || 0,
            periodStart,
            periodDays: Number(periodDays) || 26,
            benches,
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
      setTimeout(() => {
        router.push(`/projects/${project.id}`);
      }, 1000);
    }, 1200);
  }

  // Derived calculations
  const tVal = Math.max(100, Number(tonnes) || 0);
  const dVal = Math.max(1, Math.min(90, Number(periodDays) || 1));
  const avg = dVal > 0 ? (tVal / dVal).toFixed(1) : "0.0";
  const coverage = Math.min(100, Math.round((dVal / 30) * 100));

  const maxBars = Math.min(dVal, 26);
  const yM = Math.ceil((tVal / maxBars) * 1.4 / 100) * 100 || 100;
  
  function handleDates(e: React.ChangeEvent<HTMLInputElement>, isStart: boolean) {
    const v = e.target.value;
    let sStr = isStart ? v : periodStart;
    let eStr = isStart ? periodEnd() : v;
    if (isStart) setPeriodStart(sStr);
    
    const s = new Date(sStr);
    const end = new Date(eStr);
    if (!isNaN(s.getTime()) && !isNaN(end.getTime())) {
      const diff = Math.max(0, Math.round((end.getTime() - s.getTime()) / 86400000));
      const w = Math.max(1, Math.round(diff * 0.72));
      setPeriodDays(String(w));
    }
  }

  function periodEnd() {
    const d = new Date(periodStart);
    if (isNaN(d.getTime())) return "";
    d.setDate(d.getDate() + Math.round(Number(periodDays) / 0.72));
    return d.toISOString().split("T")[0];
  }

  function handleBenchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = benchInput.trim().replace(/,$/, '');
      if (!v) return;
      if (!benches.includes(v)) setBenches([...benches, v]);
      setBenchInput("");
    }
    if (e.key === 'Backspace' && !benchInput && benches.length > 0) {
      setBenches(benches.slice(0, -1));
    }
  }

  function removeBench(b: string) {
    setBenches(benches.filter(x => x !== b));
  }

  const cycleColor = (dateIdx: number, defaultColor: string) => {
    setDayColors(prev => {
      const current = prev[dateIdx] || defaultColor;
      const curIdx = DC.indexOf(current);
      const nextColor = curIdx >= 0 ? DC[(curIdx + 1) % DC.length] : 'd-green';
      return { ...prev, [dateIdx]: nextColor };
    });
  };

  return (
    <div className="glass-theme-wrapper">
      <div className="map-bg"></div>
      <nav className="topnav">
        <div className="topnav-left">
          <div className="brand-logo">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="2" y="2" width="9" height="9" rx="1.5"/>
              <rect x="13" y="2" width="9" height="9" rx="1.5"/>
              <rect x="2" y="13" width="9" height="9" rx="1.5"/>
              <rect x="13" y="13" width="9" height="9" rx="1.5"/>
            </svg>
          </div>
          <span className="brand-name">ORE COMPASS</span>
          <span className="bc-sep">/</span><span className="bc-item">Projects</span>
          <span className="bc-sep">/</span><span className="bc-current">New project</span>
        </div>
        <div className="topnav-center">
          {steps.map((s, i) => (
            <React.Fragment key={s}>
              {i > 0 && <span className="step-arrow">&#8250;</span>}
              <button 
                className={`step-pill ${i < step ? "done" : i === step ? "active" : ""}`}
                onClick={() => {
                  if (i < step) setStep(i);
                }}
              >
                {i < step ? <>&#10003; {s}</> : <><span className="snum">{i + 1}</span> {s}</>}
              </button>
            </React.Fragment>
          ))}
        </div>
        <div className="topnav-right">
          <button className="nav-btn" onClick={() => triggerToast('Opening Atlas view...')}>Atlas</button>
          <div className="avatar av-de">DE</div>
          <button className="nav-btn" onClick={() => triggerToast('Signing out...')}>Sign out</button>
          <div className="avatar av-ir">IR</div>
        </div>
      </nav>

      <div className="page-content">
        <aside className="sidebar">
          <div className="sidebar-head">
            <div className="sidebar-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
              </svg>
            </div>
            <h3>Project Summary</h3>
          </div>
          <p className="sb-subtitle">Configure targets, timelines and production requirements.</p>
          <div className="sb-rows">
            <div className="sb-row">
              <div className="sb-row-icon">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
                </svg>
              </div>
              <div><div className="sb-label">Project</div><div className="sb-value">{name || aoiName || "New project"}</div></div>
            </div>
            <div className="sb-row">
              <div className="sb-row-icon">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              </div>
              <div><div className="sb-label">Purpose</div><div className="sb-value" style={{fontSize:11}}>{MODES.find(m => m.id === mode)?.title}</div></div>
            </div>
            <div className="sb-row">
              <div className="sb-row-icon">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 000 20M2 12h20"/>
                </svg>
              </div>
              <div><div className="sb-label">Area</div><div className="sb-value accent">{aoiName}</div></div>
            </div>
            <hr className="sb-divider"/>
            <div className="sb-row">
              <div className="sb-row-icon">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
                </svg>
              </div>
              <div>
                <div className="sb-label">Period</div>
                <div className="sb-value" style={{fontSize:11}}>
                  {new Date(periodStart).toLocaleDateString('en-GB',{day:'numeric',month:'short'})} - {new Date(periodEnd()).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
                </div>
              </div>
            </div>
            <hr className="sb-divider"/>
          </div>
          {step === 2 && needsTarget && (
            <>
              <div className="kpi-card"><div className="kpi-label">Target Tonnes</div><div className="kpi-val">{Number(tonnes).toLocaleString()}</div><div className="kpi-sub">total for period</div></div>
              <div className="kpi-card"><div className="kpi-label">Daily Average</div><div className="kpi-val">{avg}</div><div className="kpi-sub">tonnes / working day</div></div>
              <div className="kpi-card"><div className="kpi-label">Required Grade</div><div className="kpi-val">{gradePct}%</div><div className="kpi-sub">Mn content target</div></div>
            </>
          )}
        </aside>

        <main className="center-panel">
          {step === 0 && (
            <>
              <h2>What are you here for?</h2>
              <p className="center-desc">The questions after this differ by answer, so this one comes first.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                {MODES.map((m) => (
                  <button
                    key={m.id} type="button" onClick={() => setMode(m.id)}
                    style={{
                      textAlign: "left", background: "rgba(255,255,255,0.05)",
                      border: `1.5px solid ${mode === m.id ? "var(--lime)" : "rgba(255,255,255,0.1)"}`,
                      borderRadius: 12, padding: 14, cursor: "pointer", color: "#fff", transition: "all .2s"
                    }}
                  >
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: mode === m.id ? "var(--lime)" : "#fff" }}>{m.title}</div>
                    <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.45)", marginTop: 4 }}>{m.blurb}</div>
                  </button>
                ))}
              </div>
              <div className="form-group" style={{ maxWidth: 400 }}>
                <label className="form-label">Project name</label>
                <div className="field">
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Balaghat North — Q3" />
                </div>
              </div>
              <div className="actions" style={{ marginTop: 'auto' }}>
                <button className="btn-create" onClick={() => setStep(1)}>Choose the area</button>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h2>Which ground?</h2>
              <p className="center-desc">Pick a known lease, or set the bounding box directly.</p>
              
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">Known lease</label>
                <select
                  value={aoiName}
                  onChange={(e) => {
                    const p = presets.find((x) => `${x.name} lease` === e.target.value);
                    setAoiName(e.target.value);
                    if (p) setBbox(p.bbox);
                  }}
                  style={{
                    background: "rgba(0,0,0,0.5)", border: "1.5px solid rgba(255,255,255,0.1)", 
                    borderRadius: 10, padding: "9px 12px", color: "#fff", outline: "none", fontSize: 13.5
                  }}
                >
                  <option value="Custom area">Custom area (set bounds below)</option>
                  {presets.map((p) => <option key={p.name} value={`${p.name} lease`}>{p.name}</option>)}
                </select>
              </div>

              <div className="form-grid-2" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
                {(['West', 'South', 'East', 'North'] as const).map((edge, i) => (
                  <div className="form-group" key={edge}>
                    <label className="form-label">{edge}</label>
                    <div className="field" style={{ padding: "6px 10px" }}>
                      <input type="number" step="0.01" value={bbox[i]} onChange={(e) => {
                        const next = [...bbox] as LatLonBounds;
                        next[i] = Number(e.target.value);
                        setBbox(next);
                        setAoiName(n => n === "Custom area" ? n : "Custom area");
                      }} />
                    </div>
                  </div>
                ))}
              </div>

              {wantsZones && (
                <div className="info-banner" style={{ marginTop: 16 }}>
                  <span className="icon">&#9432;</span>
                  {status !== "ready" ? (
                    <p>loading ranked targets…</p>
                  ) : previewZones.length === 0 ? (
                    <p style={{ color: "var(--warn)" }}>No ranked target falls inside these bounds. Widen the box or pick another lease.</p>
                  ) : (
                    <p><strong>{previewZones.length} ranked zone(s)</strong> inside these bounds — {previewZones.slice(0, 3).map(z => `${z.placeName} (${z.gradeBand})`).join(", ")}{previewZones.length > 3 ? ", …" : ""}</p>
                  )}
                </div>
              )}

              <div className="actions" style={{ marginTop: 'auto' }}>
                <button className="btn-back" onClick={() => setStep(0)}>Back</button>
                <button className="btn-create" onClick={() => setStep(2)}>{needsTarget ? "Set the target" : "Review"}</button>
              </div>
            </>
          )}

          {step === 2 && needsTarget && (
            <>
              <h2>What has to come out?</h2>
              <p className="center-desc">The schedule is generated from this &mdash; tonnage spread across the period in proportion to each day&rsquo;s usable capacity, with monsoon and maintenance days carrying less.</p>

              <div className="form-grid-3">
                <div className="form-group">
                  <label className="form-label">Target Tonnes</label>
                  <div className="field"><input type="number" value={tonnes} onChange={e => setTonnes(e.target.value)} /><span className="unit">t</span></div>
                  <div className="avg-note">Avg. {avg} t/day</div>
                </div>
                <div className="form-group">
                  <label className="form-label">Required Grade</label>
                  <div className="field"><input type="number" value={gradePct} onChange={e => setGradePct(e.target.value)} /><span className="unit">% Mn</span></div>
                  <div className="calc-note">Range: 0-100%</div>
                </div>
                <div className="form-group">
                  <label className="form-label">Target Period</label>
                  <div className="date-field"><input className="date-input" type="date" value={periodStart} onChange={e => handleDates(e, true)} /><span className="date-sep">to</span><input className="date-input" type="date" value={periodEnd()} onChange={e => handleDates(e, false)} /></div>
                  <div className="calc-note">Calculated: {dVal} Working Days</div>
                </div>
              </div>

              <div className="slider-row">
                <div className="slider-label-row"><span className="slider-label">Grade Slider &mdash; % Mn</span><span className="slider-val">{gradePct}%</span></div>
                <input type="range" min="0" max="100" value={gradePct} onChange={e => setGradePct(e.target.value)} />
              </div>
              <div className="slider-row">
                <div className="slider-label-row"><span className="slider-label">Target Tonnes</span><span className="slider-val">{Number(tonnes).toLocaleString()} t</span></div>
                <input type="range" min="1000" max="100000" step="500" value={tonnes} onChange={e => setTonnes(e.target.value)} />
              </div>

              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Working Days</label>
                  <div className="field"><input type="number" value={periodDays} onChange={e => setPeriodDays(e.target.value)} /><span className="unit">days</span></div>
                </div>
                <div className="form-group">
                  <label className="form-label">Grade (% Mn)</label>
                  <div className="field"><input type="number" value={gradePct} onChange={e => setGradePct(e.target.value)} /><span className="unit">%</span></div>
                  <div className="calc-note">0-100%</div>
                </div>
              </div>

              <div className="benches-section">
                <div className="benches-label">Benches in Rotation</div>
                <div className="benches-field" onClick={() => document.getElementById('bench-input')?.focus()}>
                  {benches.map(b => (
                    <span key={b} className="bench-tag">{b} <span className="x" onClick={(e) => { e.stopPropagation(); removeBench(b); }}>&#215;</span></span>
                  ))}
                  <input className="bench-input" id="bench-input" type="text" placeholder="Type bench name + Enter..." value={benchInput} onChange={e => setBenchInput(e.target.value)} onKeyDown={handleBenchKey} />
                </div>
              </div>

              <div className="info-banner">
                <span className="icon">&#9432;</span>
                <p>Have old borehole logs or production registers? Create the project, then drop them on its <a href="#" onClick={e => { e.preventDefault(); triggerToast('Data tab opens after project creation'); }}>Data tab</a> &mdash; the parser proposes a column mapping and imports nothing until you confirm it.</p>
              </div>

              <div className="actions">
                <button className="btn-back" onClick={() => setStep(1)}>Back</button>
                <button className="btn-draft" onClick={() => triggerToast('Draft saved!')}>Save as draft</button>
                <button className="btn-create" disabled={isCreating} onClick={create}>
                  {isCreating ? "Creating..." : "Create project"}
                </button>
              </div>
            </>
          )}

          {step === 2 && !needsTarget && (
            <>
              <h2>Ready</h2>
              <p className="center-desc">{previewZones.length} zone(s) will be ranked for {aoiName}. You can add a production target later from the project&rsquo;s Plan tab.</p>
              <div className="actions" style={{ marginTop: 'auto' }}>
                <button className="btn-back" onClick={() => setStep(1)}>Back</button>
                <button className="btn-create" disabled={isCreating || status !== 'ready'} onClick={create}>
                  {isCreating ? "Creating..." : status !== 'ready' ? "loading fixture..." : "Create project"}
                </button>
              </div>
            </>
          )}
        </main>

        <aside className="right-panel">
          <div className="rp-head"><h3>Live Schedule Preview</h3><div className="live-badge"><div className="live-dot"></div> Live</div></div>
          
          <div>
            <div className="cal-header">
              <button className="cal-nav" onClick={() => { if(cM===0) { setCM(11); setCY(cY-1); } else setCM(cM-1); }}>&#8249;</button>
              <span className="cal-month">{MN[cM]} {cY}</span>
              <button className="cal-nav" onClick={() => { if(cM===11) { setCM(0); setCY(cY+1); } else setCM(cM+1); }}>&#8250;</button>
            </div>
            <table className="cal-grid">
              <thead><tr><th>Su</th><th>Mo</th><th>Tu</th><th>We</th><th>Th</th><th>Fr</th><th>Sa</th></tr></thead>
              <tbody>
                {(() => {
                  const fd = new Date(cY, cM, 1).getDay();
                  const dim = new Date(cY, cM + 1, 0).getDate();
                  const rows = [];
                  let date = 1;
                  let pc = new Date(cY, cM, 0).getDate() - fd + 1;
                  for (let r = 0; r < 6; r++) {
                    const cells = [];
                    for (let c2 = 0; c2 < 7; c2++) {
                      if (r === 0 && c2 < fd) {
                        cells.push(<td key={c2}><div className="cal-day d-gray"><span className="day-num">{pc++}</span></div></td>);
                      } else if (date > dim) {
                        cells.push(<td key={c2}><div className="cal-day d-empty"><span className="day-num">{date - dim}</span></div></td>);
                        date++;
                      } else {
                        const idx = date - 1;
                        const dColor = dayColors[idx] || (CT[idx] || 'd-green');
                        const s2 = CS[idx];
                        const clickDate = date; // capture
                        cells.push(
                          <td key={c2}>
                            <div className={`cal-day ${dColor}`} onClick={() => cycleColor(clickDate - 1, CT[clickDate - 1] || 'd-green')} title={`${MN[cM]} ${clickDate}`}>
                              <span className="day-num">{clickDate}</span>
                              {s2 && <span className="day-sub">{s2}</span>}
                            </div>
                          </td>
                        );
                        date++;
                      }
                    }
                    rows.push(<tr key={r}>{cells}</tr>);
                    if (date > dim && r >= 3) break;
                  }
                  return rows;
                })()}
              </tbody>
            </table>
          </div>

          <div className="progress-section">
            <div className="progress-label-row"><span className="progress-label">Period Coverage</span><span className="progress-pct">{coverage}%</span></div>
            <div className="progress-track"><div className="progress-fill" style={{width: `${coverage}%`}}></div></div>
          </div>

          <div className="chart-section">
            <div className="chart-title-row"><span className="chart-title">Daily Tonnes (t)</span><span className="chart-total">{Number(tonnes).toLocaleString()} t total</span></div>
            <div className="bar-chart">
              <div className="y-axis">
                <div className="y-label">0</div>
                <div className="y-label">{Math.round(yM*1/3)}</div>
                <div className="y-label">{Math.round(yM*2/3)}</div>
                <div className="y-label">{yM}</div>
              </div>
              {Array.from({length: maxBars}).map((_, i) => {
                const p = RAW[i % RAW.length];
                const c = CLRS[i % CLRS.length];
                return (
                  <div key={i} className={`bar ${c}`} style={{ height: `${p}%` }}></div>
                );
              })}
            </div>
            <div className="x-axis">
              {Array.from({length: maxBars}).map((_, i) => (
                <div key={i} className="x-label">{(i === 0 || (i+1)%5===0) ? (i+1) : ''}</div>
              ))}
            </div>
          </div>
          <p className="preview-note">Updates live as you change values above</p>
        </aside>
      </div>
      
      <div className={`toast ${showToast ? 'show' : ''}`}><span>{toastMsg}</span></div>

      <style dangerouslySetInnerHTML={{ __html: `
        :root { --lime:#b8e04a; --lime-dark:#8faf2a; --lime-glow:rgba(184,224,74,0.25); --good:#4dbd7a; --warn:#e89430; --danger:#e05555; --glass-panel:rgba(12,15,18,0.72); --panel-border:rgba(255,255,255,0.12); --radius:14px; }
        .glass-theme-wrapper { position: fixed; inset: 0; font-family: Inter, sans-serif; color: #f0f2f0; font-size: 13px; z-index: 50; }
        .map-bg { position: fixed; inset: 0; z-index: -1; background-image: url("/media_bg.jpg"); background-size: cover; background-position: center; }
        .map-bg::after { content: ""; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(5,8,12,0.78) 0%, rgba(8,12,18,0.60) 50%, rgba(5,10,15,0.70) 100%); }
        
        .topnav { position: relative; z-index: 100; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; height: 50px; background: rgba(8,12,18,0.82); backdrop-filter: blur(16px); border-bottom: 1px solid rgba(255,255,255,0.08); }
        .topnav-left { display: flex; align-items: center; gap: 8px; }
        .brand-logo { width: 30px; height: 30px; background: linear-gradient(135deg, #1e2a10, #3d5a1e); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: var(--lime); box-shadow: 0 0 10px rgba(184,224,74,0.2); }
        .brand-name { font-weight: 800; font-size: 14px; letter-spacing: 0.04em; color: #fff; }
        .bc-sep { color: rgba(255,255,255,0.25); } .bc-item { color: rgba(255,255,255,0.5); font-size: 12.5px; } .bc-current { color: rgba(255,255,255,0.85); font-weight: 600; font-size: 12.5px; }
        .topnav-center { position: absolute; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 6px; }
        .step-pill { display: flex; align-items: center; gap: 5px; padding: 5px 14px; border-radius: 99px; font-size: 12px; font-weight: 600; cursor: pointer; border: none; font-family: Inter, sans-serif; transition: all .2s; background: transparent; color: rgba(255,255,255,0.5); }
        .step-pill.done { background: rgba(77,189,122,0.15); color: var(--good); border: 1px solid rgba(77,189,122,0.3); }
        .step-pill.active { background: var(--lime); color: #0e1012; box-shadow: 0 0 16px var(--lime-glow); }
        .step-pill.active .snum { background: rgba(0,0,0,0.2); width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; }
        .step-arrow { color: rgba(255,255,255,0.2); font-size: 15px; }
        .topnav-right { display: flex; align-items: center; gap: 8px; }
        .nav-btn { padding: 5px 14px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; font-size: 12.5px; color: rgba(255,255,255,0.7); cursor: pointer; transition: all .18s; }
        .nav-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
        .avatar { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; cursor: pointer; border: 1.5px solid rgba(255,255,255,0.15); }
        .av-de { background: #2a3a5a; color: #7aa0db; } .av-ir { background: #5a2a2a; color: #db7a7a; }
        
        .page-content { position: relative; z-index: 1; height: calc(100vh - 50px); display: flex; gap: 12px; padding: 14px 16px; overflow: hidden; }
        .sidebar { width: 192px; flex-shrink: 0; background: var(--glass-panel); backdrop-filter: blur(20px); border: 1px solid var(--panel-border); border-radius: var(--radius); padding: 14px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
        .sidebar-head { display: flex; align-items: center; gap: 8px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.07); }
        .sidebar-icon { width: 28px; height: 28px; background: rgba(184,224,74,0.12); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: var(--lime); }
        .sidebar-head h3 { font-size: 12.5px; font-weight: 700; color: #fff; margin:0;}
        .sb-subtitle { font-size: 10.5px; color: rgba(255,255,255,0.35); line-height: 1.4; margin:0;}
        .sb-rows { display: flex; flex-direction: column; gap: 8px; } .sb-row { display: flex; gap: 8px; align-items: flex-start; }
        .sb-row-icon { width: 18px; flex-shrink: 0; display: flex; justify-content: center; padding-top: 2px; color: rgba(255,255,255,0.3); }
        .sb-label { font-size: 10px; color: rgba(255,255,255,0.35); line-height: 1.2; font-weight: 500; }
        .sb-value { font-size: 11.5px; color: rgba(255,255,255,0.8); font-weight: 500; line-height: 1.3; } .sb-value.accent { color: var(--lime); }
        .sb-divider { border: none; border-top: 1px solid rgba(255,255,255,0.06); margin:0;}
        
        .kpi-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
        .kpi-label { font-size: 9.5px; color: rgba(255,255,255,0.35); font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; }
        .kpi-val { font-size: 18px; font-weight: 800; color: var(--lime); line-height: 1.1; } .kpi-sub { font-size: 10px; color: rgba(255,255,255,0.35); }
        
        .center-panel { flex: 1; background: var(--glass-panel); backdrop-filter: blur(20px); border: 1px solid var(--panel-border); border-radius: var(--radius); padding: 18px 22px 16px; display: flex; flex-direction: column; gap: 0; overflow-y: auto; min-width: 0; }
        .center-panel h2 { font-size: 22px; font-weight: 800; color: #fff; margin:0 0 5px; letter-spacing: -0.01em; }
        .center-desc { font-size: 12px; color: rgba(255,255,255,0.45); line-height: 1.6; margin:0 0 18px; }
        .form-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px 16px; margin-bottom: 14px; }
        .form-grid-2 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px 16px; margin-bottom: 14px; }
        .form-group { display: flex; flex-direction: column; gap: 5px; }
        .form-label { font-size: 11px; color: rgba(255,255,255,0.45); font-weight: 600; display: flex; align-items: center; gap: 5px; letter-spacing: 0.03em; text-transform: uppercase; }
        
        .field { display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.05); border: 1.5px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 8px 12px; transition: border-color .18s, box-shadow .18s; }
        .field:focus-within { border-color: var(--lime); box-shadow: 0 0 0 3px rgba(184,224,74,0.12); }
        .field input, .field select { border: none; outline: none; background: transparent; font-family: Inter, sans-serif; font-size: 14px; font-weight: 600; color: #fff; width: 100%; min-width: 0; }
        .field select option { color: #000; }
        .field .unit { font-size: 11.5px; color: rgba(255,255,255,0.35); white-space: nowrap; flex-shrink: 0; }
        .date-field { display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.05); border: 1.5px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 7px 10px; transition: border-color .18s; }
        .date-field:focus-within { border-color: var(--lime); box-shadow: 0 0 0 3px rgba(184,224,74,0.12); }
        .date-input { border: none; outline: none; background: transparent; font-family: Inter, sans-serif; font-size: 13px; font-weight: 600; color: #fff; width: 95px; }
        .date-input::-webkit-calendar-picker-indicator { filter: invert(0.6); cursor: pointer; }
        .date-sep { font-size: 12px; color: rgba(255,255,255,0.25); }
        .calc-note, .avg-note { font-size: 10.5px; color: rgba(255,255,255,0.3); margin-top: 2px; }
        
        .slider-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
        .slider-label-row { display: flex; justify-content: space-between; align-items: center; }
        .slider-label { font-size: 11px; color: rgba(255,255,255,0.45); font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
        .slider-val { font-size: 14px; font-weight: 800; color: var(--lime); background: rgba(184,224,74,0.1); padding: 2px 9px; border-radius: 6px; }
        input[type=range] { -webkit-appearance: none; width: 100%; height: 5px; background: rgba(255,255,255,0.1); border-radius: 99px; outline: none; cursor: pointer; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--lime); box-shadow: 0 0 8px var(--lime-glow); cursor: pointer; transition: transform .15s; }
        input[type=range]::-webkit-slider-thumb:active { transform: scale(1.3); }
        
        .benches-section { margin-bottom: 14px; }
        .benches-label { font-size: 11px; color: rgba(255,255,255,0.45); font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 6px; }
        .benches-field { background: rgba(255,255,255,0.05); border: 1.5px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 8px 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 40px; cursor: text; transition: border-color .18s; }
        .benches-field:focus-within { border-color: var(--lime); box-shadow: 0 0 0 3px rgba(184,224,74,0.1); }
        .bench-tag { display: flex; align-items: center; gap: 5px; background: rgba(184,224,74,0.12); border: 1px solid rgba(184,224,74,0.25); border-radius: 6px; padding: 3px 9px; font-size: 12px; font-weight: 600; color: var(--lime); animation: tagPop .2s ease; }
        @keyframes tagPop { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
        .bench-tag .x { cursor: pointer; color: rgba(184,224,74,0.5); font-size: 14px; line-height: 1; transition: color .15s; }
        .bench-tag .x:hover { color: var(--lime); }
        .bench-input { border: none; outline: none; background: transparent; font-family: Inter, sans-serif; font-size: 12px; color: rgba(255,255,255,0.7); min-width: 90px; flex: 1; }
        
        .info-banner { background: rgba(77,189,122,0.08); border: 1px solid rgba(77,189,122,0.2); border-radius: 10px; padding: 10px 12px; display: flex; gap: 8px; align-items: flex-start; margin-bottom: 16px; }
        .info-banner .icon { font-size: 14px; flex-shrink: 0; padding-top: 1px; }
        .info-banner p { font-size: 11.5px; color: rgba(255,255,255,0.5); line-height: 1.55; margin:0;}
        .info-banner a { color: var(--lime); font-weight: 600; text-decoration: none; }
        
        .actions { display: flex; align-items: center; gap: 10px; margin-top: auto; }
        .btn-back, .btn-draft { padding: 9px 18px; background: rgba(255,255,255,0.05); border: 1.5px solid rgba(255,255,255,0.12); border-radius: 99px; font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.6); cursor: pointer; transition: all .18s; }
        .btn-back:hover, .btn-draft:hover { background: rgba(255,255,255,0.09); color: #fff; }
        .btn-create { margin-left: auto; padding: 10px 26px; background: var(--lime); border: none; border-radius: 99px; font-size: 13.5px; font-weight: 800; color: #0e1012; cursor: pointer; box-shadow: 0 0 20px rgba(184,224,74,0.35); transition: all .18s; }
        .btn-create:hover { background: #c8f060; box-shadow: 0 0 28px rgba(184,224,74,0.5); transform: translateY(-1px); }
        .btn-create:active { transform: translateY(0); }
        .btn-create:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
        
        .right-panel { width: 270px; flex-shrink: 0; background: var(--glass-panel); backdrop-filter: blur(20px); border: 1px solid var(--panel-border); border-radius: var(--radius); padding: 14px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; }
        .rp-head { display: flex; justify-content: space-between; align-items: center; }
        .rp-head h3 { font-size: 13px; font-weight: 700; color: #fff; margin:0; }
        .live-badge { display: flex; align-items: center; gap: 5px; font-size: 10px; color: var(--good); font-weight: 600; }
        .live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--good); animation: pulse 1.6s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.4); } }
        
        .cal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .cal-month { font-size: 12.5px; font-weight: 700; color: rgba(255,255,255,0.85); }
        .cal-nav { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: rgba(255,255,255,0.5); font-size: 14px; cursor: pointer; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; border:none; }
        .cal-nav:hover { background: rgba(255,255,255,0.12); color: #fff; }
        .cal-grid { width: 100%; border-collapse: separate; border-spacing: 2px; }
        .cal-grid th { font-size: 9.5px; font-weight: 600; color: rgba(255,255,255,0.3); text-align: center; padding-bottom: 4px; }
        .cal-day { border-radius: 6px; padding: 2px 1px; cursor: pointer; min-height: 34px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 1px; transition: transform .1s; }
        .cal-day:hover { transform: scale(1.08); }
        .day-num { font-size: 10.5px; font-weight: 700; line-height: 1.4; } .day-sub { font-size: 7.5px; font-weight: 500; line-height: 1.2; white-space: nowrap; }
        .d-empty { background: transparent; } .d-empty .day-num { color: rgba(255,255,255,0.15); }
        .d-gray { background: rgba(255,255,255,0.07); } .d-gray .day-num { color: rgba(255,255,255,0.4); } .d-gray .day-sub { color: rgba(255,255,255,0.25); }
        .d-green { background: rgba(77,189,122,0.2); border: 1px solid rgba(77,189,122,0.3); } .d-green .day-num { color: #7adba0; } .d-green .day-sub { color: rgba(122,219,160,0.7); }
        .d-orange { background: rgba(232,148,48,0.2); border: 1px solid rgba(232,148,48,0.3); } .d-orange .day-num { color: #f0a848; } .d-orange .day-sub { color: rgba(240,168,72,0.7); }
        .d-red { background: rgba(224,85,85,0.25); border: 1px solid rgba(224,85,85,0.4); } .d-red .day-num { color: #ff8888; } .d-red .day-sub { color: rgba(255,136,136,0.7); }
        .d-today { background: var(--lime); } .d-today .day-num { color: #0e1012; font-weight: 800; }
        
        .progress-section { display: flex; flex-direction: column; gap: 5px; }
        .progress-label-row { display: flex; justify-content: space-between; align-items: center; }
        .progress-label { font-size: 10px; color: rgba(255,255,255,0.35); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
        .progress-pct { font-size: 11px; font-weight: 700; color: var(--lime); }
        .progress-track { height: 5px; background: rgba(255,255,255,0.08); border-radius: 99px; overflow: hidden; }
        .progress-fill { height: 100%; background: linear-gradient(90deg, var(--lime-dark), var(--lime)); border-radius: 99px; transition: width .5s ease; }
        
        .chart-section { display: flex; flex-direction: column; gap: 4px; }
        .chart-title-row { display: flex; justify-content: space-between; align-items: center; }
        .chart-title { font-size: 10px; color: rgba(255,255,255,0.35); text-transform: uppercase; font-weight: 600; letter-spacing: 0.04em; }
        .chart-total { font-size: 11px; font-weight: 700; color: var(--lime); }
        .bar-chart { display: flex; align-items: flex-end; gap: 1.5px; height: 72px; position: relative; padding-left: 26px; }
        .y-axis { position: absolute; left: 0; top: 0; bottom: 0; display: flex; flex-direction: column-reverse; justify-content: space-between; width: 24px; }
        .y-label { font-size: 7.5px; color: rgba(255,255,255,0.2); text-align: right; line-height: 1; }
        .bar { flex: 1; background: #4dbd7a; border-radius: 2px 2px 0 0; min-width: 3px; transition: height .5s, opacity .15s; }
        .bar.orange { background: var(--warn); } .bar.red { background: var(--danger); } .bar.dim { background: rgba(77,189,122,0.3); }
        .x-axis { display: flex; padding-left: 26px; gap: 1.5px; margin-top: 2px; }
        .x-label { flex: 1; text-align: center; font-size: 7px; color: rgba(255,255,255,0.2); }
        
        .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(80px); background: rgba(14,20,28,0.95); border: 1px solid rgba(77,189,122,0.3); border-radius: 12px; padding: 12px 20px; font-size: 13px; color: rgba(255,255,255,0.85); font-weight: 600; box-shadow: 0 8px 32px rgba(0,0,0,0.4); z-index: 500; transition: transform .35s, opacity .35s; opacity: 0; }
        .toast.show { transform: translateX(-50%) translateY(0); opacity: 1; pointer-events: none; }
      `}} />
    </div>
  );
}
