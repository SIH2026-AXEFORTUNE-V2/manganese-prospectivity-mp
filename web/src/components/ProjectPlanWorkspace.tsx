"use client";

// ProjectPlanWorkspace: Production Target Planning & AI Scheduling Engine
//
// Matches ORE COMPASS / Projects / <project> UI:
// 1. Set a production target form (Tonnes, Grade % Mn, Starts Date, Duration Days, Benches).
// 2. Interactive Schedule Generator with visual Bench Gantt Timeline & Grade Distribution Curves.
// 3. One-Click "Export Schedule as Image (PNG)" canvas generator.
// 4. AI Suggestions Sidebar with survey guidance and reserve retraining pipeline queue.
// 5. Multi-Tab Navigation: Zones, Plan, Calendar, Data, Learning.

import { useState, useRef, useId } from "react";
import Link from "next/link";
import ThemeToggle from "./ThemeToggle";
import GlassCard from "./GlassCard";

interface ProductionPlanState {
  targetTonnes: number;
  gradePct: number;
  startDate: string;
  days: number;
  benches: string;
  generated: boolean;
}

interface ScheduleDay {
  dayNumber: number;
  dateStr: string;
  plannedTonnes: number;
  bench1Tonnes: number;
  bench2Tonnes: number;
  expectedGrade: number;
  status: "scheduled" | "active" | "completed";
}

export default function ProjectPlanWorkspace({
  projectId = "prj_mtbxjq1z_rgxho",
  projectName = "tamil nadu",
}: {
  projectId?: string;
  projectName?: string;
}) {
  const [activeTab, setActiveTab] = useState<"zones" | "plan" | "calendar" | "data" | "learning">("plan");

  // Form State matching screenshot
  const [planState, setPlanState] = useState<ProductionPlanState>({
    targetTonnes: 12000,
    gradePct: 34,
    startDate: "2026-08-28",
    days: 26,
    benches: "Bench 2, Bench 3",
    generated: true,
  });

  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const scheduleCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Compute daily schedule days
  const dailyTarget = Math.round(planState.targetTonnes / Math.max(1, planState.days));
  const benchList = planState.benches.split(",").map((b) => b.trim()).filter(Boolean);

  const scheduleDays: ScheduleDay[] = Array.from({ length: planState.days }, (_, i) => {
    const d = new Date(planState.startDate || "2026-08-28");
    d.setDate(d.getDate() + i);
    const dateFormatted = d.toISOString().split("T")[0];
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const factor = isWeekend ? 0.75 : 1.05;
    const dayTonnes = Math.round(dailyTarget * factor);
    const b1 = Math.round(dayTonnes * 0.55);
    const b2 = dayTonnes - b1;
    const gradeVariation = (Math.sin(i * 0.8) * 0.9).toFixed(1);
    const expectedGrade = parseFloat((planState.gradePct + parseFloat(gradeVariation)).toFixed(1));

    return {
      dayNumber: i + 1,
      dateStr: dateFormatted,
      plannedTonnes: dayTonnes,
      bench1Tonnes: b1,
      bench2Tonnes: b2,
      expectedGrade,
      status: i === 0 ? "active" : i < 0 ? "completed" : "scheduled",
    };
  });

  // Export Schedule as Image (PNG) function using HTML Canvas
  const handleExportAsImage = () => {
    setIsExporting(true);

    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 800;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Background gradient
    const bgGradient = ctx.createLinearGradient(0, 0, 1200, 800);
    bgGradient.addColorStop(0, "#0e0f0c");
    bgGradient.addColorStop(1, "#1b1c16");
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, 1200, 800);

    // Decorative glass frame
    ctx.strokeStyle = "rgba(200, 255, 61, 0.25)";
    ctx.lineWidth = 2;
    ctx.strokeRect(20, 20, 1160, 760);

    // Header Title
    ctx.fillStyle = "#c8ff3d";
    ctx.font = "bold 24px system-ui, sans-serif";
    ctx.fillText("🧭 ORE COMPASS · PRODUCTION PLAN & SCHEDULE", 50, 70);

    ctx.fillStyle = "#edefe7";
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillText(`Project: ${projectName.toUpperCase()} (${projectId}) | Target: ${planState.targetTonnes.toLocaleString()} Tonnes @ ${planState.gradePct}% Mn`, 50, 105);

    // KPI Summary Boxes
    const kpis = [
      { label: "TARGET TONNES", val: `${planState.targetTonnes.toLocaleString()} t` },
      { label: "TARGET GRADE", val: `${planState.gradePct}% Mn` },
      { label: "SCHEDULE DURATION", val: `${planState.days} Days` },
      { label: "DAILY EXTRACTION", val: `~${dailyTarget} t/day` },
      { label: "ACTIVE BENCHES", val: planState.benches },
    ];

    kpis.forEach((kpi, idx) => {
      const x = 50 + idx * 225;
      ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
      ctx.fillRect(x, 130, 210, 70);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
      ctx.strokeRect(x, 130, 210, 70);

      ctx.fillStyle = "#9aa08c";
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.fillText(kpi.label, x + 15, 155);

      ctx.fillStyle = "#c8ff3d";
      ctx.font = "bold 18px monospace, sans-serif";
      ctx.fillText(kpi.val, x + 15, 185);
    });

    // Schedule Timeline Chart
    ctx.fillStyle = "rgba(20, 21, 15, 0.6)";
    ctx.fillRect(50, 220, 1100, 250);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.strokeRect(50, 220, 1100, 250);

    ctx.fillStyle = "#edefe7";
    ctx.font = "bold 15px system-ui, sans-serif";
    ctx.fillText("📊 Daily Bench Extraction Schedule (Tonnes/Day)", 70, 250);

    // Bar chart rendering
    const maxBarTonnes = Math.max(...scheduleDays.map((d) => d.plannedTonnes), 600);
    const barWidth = Math.min(32, (1000 - scheduleDays.length * 4) / scheduleDays.length);

    scheduleDays.slice(0, 26).forEach((day, idx) => {
      const bx = 70 + idx * (barWidth + 6);
      const barHeight = (day.plannedTonnes / maxBarTonnes) * 130;
      const by = 420 - barHeight;

      // Bench 1 part
      const b1Height = (day.bench1Tonnes / day.plannedTonnes) * barHeight;
      ctx.fillStyle = "#c8ff3d";
      ctx.fillRect(bx, by, barWidth, b1Height);

      // Bench 2 part
      ctx.fillStyle = "rgba(200, 255, 61, 0.5)";
      ctx.fillRect(bx, by + b1Height, barWidth, barHeight - b1Height);

      // Day label
      ctx.fillStyle = "#9aa08c";
      ctx.font = "10px monospace, sans-serif";
      ctx.fillText(`D${day.dayNumber}`, bx, 440);
    });

    // Legend
    ctx.fillStyle = "#c8ff3d";
    ctx.fillRect(800, 240, 14, 14);
    ctx.fillStyle = "#edefe7";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText("Bench 2 (~55%)", 822, 252);

    ctx.fillStyle = "rgba(200, 255, 61, 0.5)";
    ctx.fillRect(950, 240, 14, 14);
    ctx.fillStyle = "#edefe7";
    ctx.fillText("Bench 3 (~45%)", 972, 252);

    // AI Suggestions Section in Image
    ctx.fillStyle = "rgba(20, 21, 15, 0.6)";
    ctx.fillRect(50, 490, 1100, 240);
    ctx.strokeStyle = "rgba(200, 255, 61, 0.2)";
    ctx.strokeRect(50, 490, 1100, 240);

    ctx.fillStyle = "#c8ff3d";
    ctx.font = "bold 14px system-ui, sans-serif";
    ctx.fillText("🤖 AI EXPLORATION & RESERVE INSIGHTS", 70, 520);

    ctx.fillStyle = "#edefe7";
    ctx.font = "bold 14px system-ui, sans-serif";
    ctx.fillText("Survey Zone A first — Dongri Buzurg S block · 21 km", 70, 550);

    ctx.fillStyle = "#9aa08c";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText("• Medium grade band (28–33% Mn), 1.51–2.8 Mt over 157 ha, medium confidence. Fused score 0.688, rank 7 in pipeline.", 70, 575);
    ctx.fillText("• Reserve Retraining Queue: Production records from open benches feed offline Python ML validation loops.", 70, 600);
    ctx.fillText("• Grade Consistency: Predicted blend variance ±0.8% Mn across scheduled extraction window.", 70, 625);

    // Footer Timestamp & Brand
    ctx.fillStyle = "#5b6154";
    ctx.font = "11px monospace, sans-serif";
    ctx.fillText(`Generated on ${new Date().toUTCString()} · Ore Compass Mining Intelligence System`, 50, 755);

    // Convert Canvas to downloadable PNG image
    setTimeout(() => {
      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `Ore_Compass_Production_Plan_${projectName}_${planState.startDate}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setIsExporting(false);
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3000);
    }, 400);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh", background: "var(--bg)" }}>
      {/* Top Header matching user screenshot */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 24px",
          borderBottom: "1px solid var(--glass-border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🧭</span>
          <Link href="/" style={{ textDecoration: "none", color: "inherit", fontWeight: 700, fontSize: 16 }}>
            ORE COMPASS
          </Link>
          <span style={{ color: "var(--ink-dim)" }}>/</span>
          <span style={{ color: "var(--ink-dim)", fontSize: 14 }}>Projects</span>
          <span style={{ color: "var(--ink-dim)" }}>/</span>
          <strong style={{ fontSize: 14 }}>{projectName}</strong>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link
            href="/"
            style={{
              textDecoration: "none",
              color: "var(--ink)",
              fontSize: 13,
              fontWeight: 600,
              padding: "6px 14px",
              borderRadius: 999,
              background: "var(--glass)",
              border: "1px solid var(--glass-border)",
            }}
          >
            Atlas
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink-dim)" }}>
            <span
              style={{
                display: "inline-grid",
                placeItems: "center",
                width: 26,
                height: 26,
                borderRadius: 999,
                background: "var(--chip-dark)",
                color: "var(--chip-dark-ink)",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              DE
            </span>
            <span>Sign out</span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      {/* Main Workspace Layout */}
      <main style={{ flex: 1, padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Navigation Tabs (Zones, Plan, Calendar, Data, Learning) */}
        <div style={{ display: "flex", gap: 8 }}>
          {(["zones", "plan", "calendar", "data", "learning"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                border: "none",
                borderRadius: 999,
                padding: "8px 20px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                textTransform: "capitalize",
                background: activeTab === tab ? "var(--accent-lime)" : "var(--glass)",
                color: activeTab === tab ? "var(--chip-dark)" : "var(--ink)",
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: activeTab === tab ? "transparent" : "var(--glass-border)",
                transition: "all 0.18s ease",
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content Area: Left Main Form + Right AI Suggestions */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, alignItems: "start" }}>
          {/* LEFT: PLAN TAB CONTENT */}
          {activeTab === "plan" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Form Card matching screenshot */}
              <GlassCard style={{ padding: "24px 28px" }}>
                <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 6px" }}>
                  Set a production target
                </h2>
                <p style={{ fontSize: 13, color: "var(--ink-dim)", margin: "0 0 20px", lineHeight: 1.45 }}>
                  Saving regenerates the schedule. Day logs are keyed by date and survive — days that fall outside
                  the new period simply stop pairing with a plan.
                </p>

                {/* Form Input Grid */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                    gap: 16,
                    marginBottom: 16,
                  }}
                >
                  {/* Target Tonnes */}
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: "var(--ink-dim)", marginBottom: 6 }}>
                      Target tonnes
                    </label>
                    <input
                      type="number"
                      value={planState.targetTonnes}
                      onChange={(e) => setPlanState({ ...planState, targetTonnes: Number(e.target.value) })}
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        background: "rgba(255, 255, 255, 0.4)",
                        border: "1px solid var(--glass-border)",
                        borderRadius: 10,
                        fontSize: 14,
                        fontFamily: "monospace",
                        color: "var(--ink)",
                        outline: "none",
                      }}
                    />
                  </div>

                  {/* Grade (% Mn) */}
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: "var(--ink-dim)", marginBottom: 6 }}>
                      Grade (% Mn)
                    </label>
                    <input
                      type="number"
                      value={planState.gradePct}
                      onChange={(e) => setPlanState({ ...planState, gradePct: Number(e.target.value) })}
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        background: "rgba(255, 255, 255, 0.4)",
                        border: "1px solid var(--glass-border)",
                        borderRadius: 10,
                        fontSize: 14,
                        fontFamily: "monospace",
                        color: "var(--ink)",
                        outline: "none",
                      }}
                    />
                  </div>

                  {/* Starts Date */}
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: "var(--ink-dim)", marginBottom: 6 }}>
                      Starts
                    </label>
                    <input
                      type="date"
                      value={planState.startDate}
                      onChange={(e) => setPlanState({ ...planState, startDate: e.target.value })}
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        background: "rgba(255, 255, 255, 0.4)",
                        border: "1px solid var(--glass-border)",
                        borderRadius: 10,
                        fontSize: 14,
                        color: "var(--ink)",
                        outline: "none",
                      }}
                    />
                  </div>

                  {/* Days */}
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: "var(--ink-dim)", marginBottom: 6 }}>
                      Days
                    </label>
                    <input
                      type="number"
                      value={planState.days}
                      onChange={(e) => setPlanState({ ...planState, days: Number(e.target.value) })}
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        background: "rgba(255, 255, 255, 0.4)",
                        border: "1px solid var(--glass-border)",
                        borderRadius: 10,
                        fontSize: 14,
                        fontFamily: "monospace",
                        color: "var(--ink)",
                        outline: "none",
                      }}
                    />
                  </div>
                </div>

                {/* Benches (comma separated) */}
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: "block", fontSize: 12, color: "var(--ink-dim)", marginBottom: 6 }}>
                    Benches (comma separated)
                  </label>
                  <input
                    type="text"
                    value={planState.benches}
                    onChange={(e) => setPlanState({ ...planState, benches: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      background: "rgba(255, 255, 255, 0.4)",
                      border: "1px solid var(--glass-border)",
                      borderRadius: 10,
                      fontSize: 14,
                      color: "var(--ink)",
                      outline: "none",
                    }}
                  />
                </div>

                {/* Actions: Generate Schedule + Export as Image */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => setPlanState({ ...planState, generated: true })}
                    style={{
                      border: "none",
                      borderRadius: 999,
                      padding: "10px 24px",
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: "pointer",
                      background: "var(--accent-lime)",
                      color: "var(--chip-dark)",
                      boxShadow: "0 4px 14px rgba(200,255,61,0.3)",
                      transition: "all 0.18s ease",
                    }}
                  >
                    Generate schedule
                  </button>

                  <button
                    type="button"
                    onClick={handleExportAsImage}
                    disabled={isExporting}
                    style={{
                      border: "1px solid var(--glass-border)",
                      borderRadius: 999,
                      padding: "10px 20px",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      background: "var(--glass)",
                      color: "var(--ink)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "all 0.18s ease",
                    }}
                  >
                    <span>📷</span>
                    <span>{isExporting ? "Generating PNG Image…" : "Export Schedule as Image"}</span>
                  </button>

                  {exportSuccess && (
                    <span style={{ fontSize: 12, color: "var(--good)", fontWeight: 600 }}>
                      ✓ High-res Image Downloaded!
                    </span>
                  )}
                </div>
              </GlassCard>

              {/* GENERATED SCHEDULE VISUALIZATION & GANTT TIMELINE */}
              {planState.generated && (
                <GlassCard style={{ padding: "24px 28px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-dim)", fontWeight: 600 }}>
                        Active Operational Schedule
                      </div>
                      <h3 style={{ fontSize: 18, fontWeight: 700, margin: "4px 0 0" }}>
                        26-Day Bench Extraction Timeline
                      </h3>
                    </div>
                    <div style={{ display: "flex", gap: 12 }}>
                      <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                        Daily Target: <strong style={{ color: "var(--accent-lime)", fontFamily: "monospace" }}>{dailyTarget} t/day</strong>
                      </span>
                      <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                        Grade Target: <strong style={{ color: "var(--accent-lime)", fontFamily: "monospace" }}>{planState.gradePct}% Mn</strong>
                      </span>
                    </div>
                  </div>

                  {/* Interactive Gantt / Daily Extraction Bar Visualizer */}
                  <div
                    style={{
                      background: "rgba(20, 21, 15, 0.4)",
                      border: "1px solid var(--glass-border)",
                      borderRadius: 14,
                      padding: "16px 20px",
                      marginBottom: 20,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--ink-dim)", marginBottom: 12 }}>
                      <span>DAY 1 ({planState.startDate})</span>
                      <span>DAY {planState.days} SCHEDULE COMPLETION</span>
                    </div>

                    <div style={{ display: "flex", gap: 4, height: 90, alignItems: "flex-end" }}>
                      {scheduleDays.map((day) => {
                        const maxTonnes = dailyTarget * 1.2;
                        const heightPct = Math.min(100, Math.max(25, (day.plannedTonnes / maxTonnes) * 100));
                        return (
                          <div
                            key={day.dayNumber}
                            title={`Day ${day.dayNumber} (${day.dateStr}): ${day.plannedTonnes}t @ ${day.expectedGrade}% Mn`}
                            style={{
                              flex: 1,
                              display: "flex",
                              flexDirection: "column",
                              justifyContent: "flex-end",
                              height: "100%",
                            }}
                          >
                            <div
                              style={{
                                height: `${heightPct}%`,
                                background:
                                  day.dayNumber === 1
                                    ? "var(--accent-lime)"
                                    : "rgba(200, 255, 61, 0.45)",
                                borderRadius: "4px 4px 0 0",
                                transition: "all 0.2s ease",
                                cursor: "pointer",
                              }}
                            />
                            <span style={{ fontSize: 9, color: "var(--ink-dim)", textAlign: "center", marginTop: 4 }}>
                              {day.dayNumber % 4 === 1 ? `D${day.dayNumber}` : ""}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 11, color: "var(--ink-dim)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--accent-lime)" }} />
                        <span>Bench 2 Extraction (~55%)</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: "rgba(200, 255, 61, 0.45)" }} />
                        <span>Bench 3 Extraction (~45%)</span>
                      </div>
                    </div>
                  </div>

                  {/* Day-by-Day Log Table */}
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--glass-border)", textAlign: "left", color: "var(--ink-dim)" }}>
                          <th style={{ padding: "8px 12px" }}>Day</th>
                          <th style={{ padding: "8px 12px" }}>Date</th>
                          <th style={{ padding: "8px 12px" }}>Planned Tonnes</th>
                          <th style={{ padding: "8px 12px" }}>Bench 2 / Bench 3</th>
                          <th style={{ padding: "8px 12px" }}>Expected Grade</th>
                          <th style={{ padding: "8px 12px" }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scheduleDays.slice(0, 8).map((day) => (
                          <tr key={day.dayNumber} style={{ borderBottom: "1px solid var(--glass-border)" }}>
                            <td style={{ padding: "10px 12px", fontWeight: 600 }}>Day {day.dayNumber}</td>
                            <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "var(--ink-dim)" }}>
                              {day.dateStr}
                            </td>
                            <td style={{ padding: "10px 12px", fontFamily: "monospace", fontWeight: 600 }}>
                              {day.plannedTonnes} t
                            </td>
                            <td style={{ padding: "10px 12px", color: "var(--ink-dim)" }}>
                              {day.bench1Tonnes} t / {day.bench2Tonnes} t
                            </td>
                            <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "var(--accent-lime)" }}>
                              {day.expectedGrade}% Mn
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <span
                                style={{
                                  padding: "3px 8px",
                                  borderRadius: 999,
                                  fontSize: 11,
                                  fontWeight: 600,
                                  background:
                                    day.status === "active"
                                      ? "rgba(200, 255, 61, 0.2)"
                                      : "rgba(255, 255, 255, 0.08)",
                                  color: day.status === "active" ? "var(--accent-lime)" : "var(--ink-dim)",
                                }}
                              >
                                {day.status.toUpperCase()}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ fontSize: 11, color: "var(--ink-dim)", textAlign: "center", marginTop: 12 }}>
                      Showing initial 8 days of {planState.days}-day operational schedule. Full schedule saved to project store.
                    </div>
                  </div>
                </GlassCard>
              )}
            </div>
          )}

          {/* OTHER TABS: ZONES / CALENDAR / DATA / LEARNING */}
          {activeTab === "zones" && (
            <GlassCard style={{ padding: "24px 28px" }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>Mining Extraction Zones</h2>
              <p style={{ fontSize: 13, color: "var(--ink-dim)", margin: "0 0 16px" }}>
                Target reserve blocks mapped across the project area.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  { name: "Zone A — Dongri Buzurg S Block", tonnes: "2.1 Mt", grade: "31.5% Mn", area: "157 ha", score: "0.688" },
                  { name: "Zone B — Balaghat East Ridge", tonnes: "3.4 Mt", grade: "34.2% Mn", area: "210 ha", score: "0.742" },
                  { name: "Zone C — Ukwa Extension", tonnes: "1.8 Mt", grade: "29.8% Mn", area: "125 ha", score: "0.615" },
                ].map((zone) => (
                  <div
                    key={zone.name}
                    style={{
                      background: "rgba(20, 21, 15, 0.4)",
                      border: "1px solid var(--glass-border)",
                      borderRadius: 12,
                      padding: "14px 18px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <strong style={{ color: "var(--accent-lime)", display: "block" }}>{zone.name}</strong>
                      <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>Area: {zone.area} · Fused Score: {zone.score}</span>
                    </div>
                    <div style={{ textAlign: "right", fontFamily: "monospace" }}>
                      <div style={{ fontWeight: 700 }}>{zone.tonnes}</div>
                      <div style={{ fontSize: 12, color: "var(--accent-lime)" }}>{zone.grade}</div>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          {activeTab === "calendar" && (
            <GlassCard style={{ padding: "24px 28px" }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>Operational Calendar</h2>
              <p style={{ fontSize: 13, color: "var(--ink-dim)", margin: "0 0 16px" }}>
                Shift scheduling, blasting windows, and haulage targets.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, textAlign: "center" }}>
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div key={d} style={{ fontSize: 11, color: "var(--ink-dim)", padding: 6, fontWeight: 600 }}>{d}</div>
                ))}
                {Array.from({ length: 28 }, (_, i) => (
                  <div
                    key={i}
                    style={{
                      background: i < 26 ? "rgba(200, 255, 61, 0.08)" : "rgba(255,255,255,0.03)",
                      border: "1px solid var(--glass-border)",
                      borderRadius: 8,
                      padding: "10px 4px",
                      fontSize: 12,
                      color: i < 26 ? "var(--ink)" : "var(--ink-dim)",
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{i + 1}</div>
                    {i < 26 && <div style={{ fontSize: 9, color: "var(--accent-lime)", marginTop: 2 }}>{dailyTarget}t</div>}
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          {activeTab === "data" && (
            <GlassCard style={{ padding: "24px 28px" }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>Assay & Geotechnical Data</h2>
              <p style={{ fontSize: 13, color: "var(--ink-dim)", margin: "0 0 16px" }}>
                Core drill assay logs and moisture sensor telemetry.
              </p>
              <div style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.6 }}>
                • Bench 2 Core Samples: 34.4% Mn average (SiO₂: 8.2%, Fe: 5.1%)<br />
                • Bench 3 Core Samples: 33.6% Mn average (SiO₂: 9.0%, Fe: 4.8%)<br />
                • Average Soil Moisture: 14.2% across active pit benches
              </div>
            </GlassCard>
          )}

          {activeTab === "learning" && (
            <GlassCard style={{ padding: "24px 28px" }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>Model Learning Queue</h2>
              <p style={{ fontSize: 13, color: "var(--ink-dim)", margin: "0 0 16px" }}>
                Offline reserve retraining records and block outcome tracking.
              </p>
              <div style={{ padding: "14px 18px", background: "rgba(200, 255, 61, 0.08)", border: "1px solid rgba(200, 255, 61, 0.25)", borderRadius: 12, fontSize: 13 }}>
                <strong>No block outcomes recorded yet</strong>
                <p style={{ margin: "6px 0 0", color: "var(--ink-dim)", fontSize: 12, lineHeight: 1.5 }}>
                  The reserve map only learns when a block the model called is actually drilled or mined. Daily production from an already-open bench does not move it. Reserve retraining runs offline in the Python pipeline.
                </p>
              </div>
            </GlassCard>
          )}

          {/* RIGHT SIDEBAR: AI SUGGESTIONS (matching screenshot) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Suggestions Header */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--ink-dim)", textTransform: "uppercase" }}>
                AI SUGGESTIONS
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
                The plan ahead — not results
              </div>
            </div>

            {/* AI Suggestion Card 1 */}
            <GlassCard style={{ padding: "18px 20px" }}>
              <h4 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: "var(--ink)" }}>
                Survey Zone A first — Dongri Buzurg S block · 21 km
              </h4>
              <p style={{ fontSize: 12, color: "var(--ink-dim)", margin: "0 0 10px", lineHeight: 1.45 }}>
                medium grade band (28–33% Mn), 1.51–2.8 Mt over 157 ha, medium confidence.
              </p>
              <div style={{ fontSize: 11, color: "var(--accent-lime)", fontStyle: "italic" }}>
                Fused score 0.688, rank 7 in the pipeline's ranked targets.
              </div>
            </GlassCard>

            {/* AI Suggestion Card 2 */}
            <GlassCard style={{ padding: "18px 20px" }}>
              <h4 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: "var(--ink)" }}>
                No block outcomes recorded yet
              </h4>
              <p style={{ fontSize: 12, color: "var(--ink-dim)", margin: 0, lineHeight: 1.45 }}>
                The reserve map only learns when a block the model called is actually drilled or mined. Daily production
                from an already-open bench does not move it, and the app will not pretend otherwise.
              </p>
              <div style={{ marginTop: 10, fontSize: 11, color: "var(--ink-dim)", fontStyle: "italic", borderTop: "1px solid var(--glass-border)", paddingTop: 8 }}>
                Reserve retraining runs offline in the Python pipeline; these records are its input queue.
              </div>
            </GlassCard>

            {/* Quick Export Image Action Card */}
            <GlassCard style={{ padding: "16px 18px", background: "rgba(200, 255, 61, 0.06)", borderColor: "rgba(200, 255, 61, 0.25)" }}>
              <strong style={{ fontSize: 13, display: "block", color: "var(--accent-lime)", marginBottom: 4 }}>
                📸 Visual Snapshot Ready
              </strong>
              <p style={{ fontSize: 11, color: "var(--ink-dim)", margin: "0 0 10px", lineHeight: 1.4 }}>
                Export this production target, timeline schedule, and AI recommendations as a shareable high-res PNG image.
              </p>
              <button
                type="button"
                onClick={handleExportAsImage}
                style={{
                  width: "100%",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  background: "var(--accent-lime)",
                  color: "var(--chip-dark)",
                  cursor: "pointer",
                }}
              >
                Download Schedule Image (PNG)
              </button>
            </GlassCard>
          </div>
        </div>
      </main>
    </div>
  );
}
