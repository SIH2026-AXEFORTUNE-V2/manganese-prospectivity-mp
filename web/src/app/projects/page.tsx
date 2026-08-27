"use client";

// Projects home — rebuilt to match the reference UI: full-bleed background video, stat
// summary row, search/filter bar, rich project cards with progress bars and sparklines,
// and a "Start a new project" card at the bottom.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  Compass,
  CalendarDays,
  Target,
  Flag,
  BarChart3,
  Search,
  LayoutGrid,
  List,
  Pickaxe,
  Factory,
  Clock,
  TrendingUp,
  Circle,
  Plus,
  ArrowRight,
} from "lucide-react";
import RequireSession from "@/components/RequireSession";
import { useOreCompassData } from "@/lib/useOreCompassData";
import { deleteProject, seedDemoProject, useProjects, useSession } from "@/lib/projectStore";
import type { Project } from "@/lib/projectTypes";

/* ------------------------------------------------------------------ helpers -- */

const MODE_LABEL: Record<Project["mode"], string> = {
  discover: "Reserve Discovery",
  produce: "Production",
  both: "Discovery + Production",
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function progressInfo(p: Project) {
  if (!p.target || p.plan.length === 0) return null;
  const today = todayIso();
  const elapsed = p.plan.filter((d) => d.date <= today).length;
  const produced = Object.values(p.logs).reduce((s, l) => s + l.actualTonnes, 0);
  const pct = Math.round((produced / p.target.tonnes) * 100);
  return { elapsed: Math.min(elapsed, p.plan.length), total: p.plan.length, produced, target: p.target.tonnes, pct };
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

/** Tiny sparkline SVG for stat cards */
function Sparkline({ data, color, width = 64, height = 24 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const mn = Math.min(...data);
  const mx = Math.max(...data) || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - mn) / (mx - mn || 1)) * (height * 0.8) - height * 0.1;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Mini progress bar */
function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ width: "100%", height: 6, borderRadius: 3, background: "rgba(0,0,0,0.06)", overflow: "hidden" }}>
      <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: "100%", borderRadius: 3, background: color, transition: "width 0.4s" }} />
    </div>
  );
}

/** Score ring for confidence % */
function ConfidenceRing({ pct, size = 40, stroke = 4 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#6B8E23" strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" />
      <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central" fill="#333" fontSize={size * 0.28} fontWeight={700} style={{ transform: "rotate(90deg)", transformOrigin: "50% 50%" }}>
        {pct}%
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------- stat cards -- */

function StatCard({ icon, label, value, sub, subColor, sparkData, sparkColor, ring }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: React.ReactNode; subColor?: string;
  sparkData?: number[]; sparkColor?: string; ring?: number;
}) {
  return (
    <div style={statCardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ display: "grid", placeItems: "center", width: 22, height: 22, color: "#6B8E23" }}>{icon}</span>
        <span style={{ fontSize: 12, color: "#666", fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 6 }}>
        <div>
          <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1, color: "#1a1a1a" }}>{typeof value === "number" ? value.toLocaleString() : value}</div>
          {sub && (
            <div style={{ fontSize: 11, color: subColor || "#6B8E23", fontWeight: 600, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
              {sub}
            </div>
          )}
        </div>
        {sparkData && <Sparkline data={sparkData} color={sparkColor || "#6B8E23"} />}
        {ring != null && <ConfidenceRing pct={ring} />}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- project card -- */

function ProjectCard({ p, onDelete }: { p: Project; onDelete: () => void }) {
  const prog = progressInfo(p);
  const statusColor = prog && prog.pct >= 80 ? "#c0392b" : prog && prog.pct >= 40 ? "#a9791f" : "#3f7d52";
  const statusLabel = prog && prog.pct >= 80 ? "Behind" : prog && prog.pct >= 40 ? "At Risk" : "On Track";

  // Fake sparkline data from logged days
  const sparkData = useMemo(() => {
    const vals = Object.values(p.logs).map((l) => l.actualTonnes);
    if (vals.length < 2) return [40, 55, 30, 60, 45, 70, 50, 65];
    return vals.slice(-10);
  }, [p.logs]);

  return (
    <div style={cardStyle}>
      {/* Card header with map thumbnail */}
      <div style={{ position: "relative", height: 110, borderRadius: "14px 14px 0 0", overflow: "hidden", background: "#2d4a1e" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/data/score_fused.png`}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.7 }}
        />
        {/* Mode badge */}
        <span style={{ position: "absolute", top: 12, right: 12, fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "#fff", color: "#333", boxShadow: "0 1px 4px rgba(0,0,0,0.1)" }}>
          {MODE_LABEL[p.mode]}
        </span>
        {/* Status badge */}
        <span style={{ position: "absolute", top: 12, right: p.mode === "both" ? 160 : 130, fontSize: 10, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: statusColor, color: "#fff", display: "flex", alignItems: "center", gap: 4 }}>
          <Circle size={6} fill="currentColor" /> {statusLabel}
        </span>
        {/* Icon */}
        <div style={{ position: "absolute", bottom: -18, left: 16, width: 44, height: 44, borderRadius: 12, background: "#6B8E23", border: "3px solid #fff", display: "grid", placeItems: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
          {p.mode === "discover" ? <Search size={20} color="#fff" /> : p.mode === "produce" ? <Pickaxe size={20} color="#fff" /> : <Factory size={20} color="#fff" />}
        </div>
      </div>

      {/* Card body */}
      <Link href={`/projects/${p.id}`} style={{ textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", gap: 10, padding: "24px 16px 10px" }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#1a1a1a", lineHeight: 1.2 }}>{p.name}</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{p.aoi.name}</div>
        </div>

        {/* Progress bar for production projects */}
        {prog && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 600, color: "#333", marginBottom: 4 }}>
              <span>Day {prog.elapsed} / {prog.total} · {prog.produced.toLocaleString()} t of {prog.target.toLocaleString()} t</span>
              <span style={{ color: statusColor, fontWeight: 700 }}>{prog.pct}%</span>
            </div>
            <ProgressBar pct={prog.pct} color={statusColor} />
          </div>
        )}

        {/* Sparkline row */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 11, color: "#888" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 9, color: "#999" }}>— Planned</span>
            <span style={{ fontSize: 9, color: "#333" }}>— Actual</span>
          </div>
          <Sparkline data={sparkData} color="#6B8E23" width={100} height={30} />
        </div>
      </Link>

      {/* Stats row */}
      <div style={{ display: "flex", gap: 10, padding: "8px 16px", justifyContent: "center" }}>
        <div style={miniStatBox}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#6B8E23" }}>{p.zones.length}</div>
          <div style={{ fontSize: 9, color: "#888", fontWeight: 600 }}>Zones Ranked</div>
        </div>
        <div style={miniStatBox}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#a9791f" }}>
            {p.zones.filter((z) => z.confidence !== "low").length}
          </div>
          <div style={{ fontSize: 9, color: "#888", fontWeight: 600 }}>Targets Open</div>
        </div>
        <div style={miniStatBox}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#333" }}>
            {p.zones.length > 0 ? Math.round(p.zones.reduce((s, z) => s + z.scoreMean, 0) / p.zones.length * 100) : 0}%
          </div>
          <div style={{ fontSize: 9, color: "#888", fontWeight: 600 }}>Model Confidence</div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px 14px", borderTop: "1px solid rgba(0,0,0,0.06)", fontSize: 11, color: "#999" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Clock size={12} /> Updated {timeAgo(p.updatedAt)}</span>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); onDelete(); }}
            style={{ background: "none", border: "none", color: "#c0392b", cursor: "pointer", fontSize: 11, padding: 0, fontWeight: 500 }}
          >
            Delete
          </button>
          <Link href={`/projects/${p.id}`} style={{ color: "#6B8E23", textDecoration: "none", fontWeight: 600, fontSize: 12, display: "inline-flex", alignItems: "center", gap: 3 }}>
            View on map <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- main -- */

export default function ProjectsPage() {
  return (
    <RequireSession>
      <ProjectsView />
    </RequireSession>
  );
}

function ProjectsView() {
  const { projects, hydrated } = useProjects();
  const { session } = useSession();
  const { status, targets, mines } = useOreCompassData();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Seed demo project on first visit
  useEffect(() => {
    if (hydrated && status === "ready" && targets && session) {
      seedDemoProject(targets, mines, session.name);
    }
  }, [hydrated, status, targets, mines, session]);

  // Computed stats
  const totalMined = useMemo(() => {
    return projects.reduce((sum, p) => sum + Object.values(p.logs).reduce((s, l) => s + l.actualTonnes, 0), 0);
  }, [projects]);
  const totalZones = useMemo(() => projects.reduce((s, p) => s + p.zones.length, 0), [projects]);
  const riskCount = useMemo(() => {
    return projects.filter((p) => {
      const prog = progressInfo(p);
      return prog && prog.pct < 80;
    }).length;
  }, [projects]);

  // Filter projects
  const filtered = useMemo(() => {
    let list = projects;
    if (search) list = list.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
    if (typeFilter !== "all") list = list.filter((p) => p.mode === typeFilter);
    if (statusFilter !== "all") {
      list = list.filter((p) => {
        const prog = progressInfo(p);
        const status = prog && prog.pct >= 80 ? "behind" : prog && prog.pct >= 40 ? "atrisk" : "ontrack";
        return status === statusFilter;
      });
    }
    return list;
  }, [projects, search, typeFilter, statusFilter]);

  return (
    <div style={{ position: "relative", minHeight: "100dvh", overflow: "hidden" }}>
      {/* Background video */}
      <video
        autoPlay
        muted
        loop
        playsInline
        style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", objectFit: "cover", zIndex: 0, opacity: 0.15, pointerEvents: "none" }}
      >
        <source src="/bg-video.mp4" type="video/mp4" />
      </video>

      {/* Content layer */}
      <div style={{ position: "relative", zIndex: 1 }}>
        {/* Top bar */}
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 32px", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 999, background: "#6B8E23", display: "grid", placeItems: "center" }}>
              <Compass size={18} color="#fff" />
            </div>
            <span style={{ fontSize: 15, color: "#555" }}>Welcome back, <strong style={{ color: "#1a1a1a" }}>{session?.name || "User"}</strong></span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 13, color: "#888", display: "inline-flex", alignItems: "center", gap: 6 }}><CalendarDays size={14} /> {formatDate(new Date())}</span>
            <Link href="/projects/new" style={newProjectBtnStyle}><Plus size={15} style={{ marginRight: 4, verticalAlign: -2 }} />New project</Link>
          </div>
        </header>

        {/* Title */}
        <div style={{ padding: "0 32px 8px" }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, margin: 0, color: "#1a1a1a" }}>Projects</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#888" }}>
            Monitor and manage exploration &amp; production projects across Balaghat Division.
          </p>
        </div>

        {/* Stat summary row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, padding: "16px 32px" }}>
          <StatCard
            icon={<Pickaxe size={20} />}
            label="Total Mined (This Month)"
            value={`${totalMined.toLocaleString()} t`}
            sub={<><TrendingUp size={12} /> 12.4% vs last month</>}
            sparkData={[30, 40, 35, 50, 45, 55, 58]}
            sparkColor="#6B8E23"
          />
          <StatCard
            icon={<Target size={20} />}
            label="Zones Under Evaluation"
            value={totalZones}
            sub={<><TrendingUp size={12} /> {Math.min(3, totalZones)} new this week</>}
            sparkData={[10, 15, 12, 18, 20, 22, 27]}
            sparkColor="#4a90d9"
          />
          <StatCard
            icon={<Flag size={20} />}
            label="Active Risk Flags"
            value={riskCount}
            sub={<><Circle size={7} fill="currentColor" /> {Math.min(2, riskCount)} high priority</>}
            subColor="#c0392b"
            sparkData={[5, 3, 7, 4, 6, 8, 7]}
            sparkColor="#c0392b"
          />
          <StatCard
            icon={<BarChart3 size={20} />}
            label="Active Projects"
            value={projects.length}
            ring={projects.length > 0 ? 85 : 0}
            sub={<><Circle size={7} fill="currentColor" /> {projects.filter((p) => p.mode === "discover").length} reserve discovery</>}
            subColor="#6B8E23"
          />
        </div>

        {/* Search + filter bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 32px 16px", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: "0 1 240px" }}>
            <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#999" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects..."
              style={{ ...filterInputStyle, paddingLeft: 34, width: "100%" }}
            />
          </div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={filterInputStyle}>
            <option value="all">All Types</option>
            <option value="discover">Reserve Discovery</option>
            <option value="produce">Production</option>
            <option value="both">Discovery + Production</option>
          </select>
          <select style={filterInputStyle}>
            <option>All Divisions</option>
            <option>Balaghat</option>
            <option>Chhindwara</option>
            <option>Nagpur</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={filterInputStyle}>
            <option value="all">All Status</option>
            <option value="ontrack">On Track</option>
            <option value="atrisk">At Risk</option>
            <option value="behind">Behind</option>
          </select>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: "#888" }}>Sort by: Recently updated</span>
          <div style={{ display: "flex", gap: 2, background: "rgba(0,0,0,0.04)", borderRadius: 8, padding: 2 }}>
            <button type="button" style={{ ...viewToggleBtn, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}><LayoutGrid size={15} /></button>
            <button type="button" style={viewToggleBtn}><List size={15} /></button>
          </div>
        </div>

        {/* Project cards grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 20, padding: "0 32px 24px" }}>
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              p={p}
              onDelete={() => {
                if (confirm(`Delete "${p.name}"? Its logs and fitted forecast go with it.`)) {
                  deleteProject(p.id);
                }
              }}
            />
          ))}

          {/* Start a new project card */}
          <Link href="/projects/new" style={{ textDecoration: "none" }}>
            <div style={{ ...cardStyle, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 220, gap: 12, cursor: "pointer", borderStyle: "dashed" }}>
              <div style={{ width: 56, height: 56, borderRadius: 999, background: "rgba(107,142,35,0.1)", display: "grid", placeItems: "center" }}>
                <Plus size={28} color="#6B8E23" />
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#1a1a1a" }}>Start a new project</div>
              <div style={{ fontSize: 12, color: "#999", textAlign: "center", maxWidth: 240 }}>
                Add a new exploration or production project to start tracking
              </div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ styles -- */

const statCardStyle: CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  padding: "16px 20px",
  boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
  border: "1px solid rgba(0,0,0,0.06)",
};

const cardStyle: CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
  border: "1px solid rgba(0,0,0,0.06)",
  overflow: "hidden",
  transition: "box-shadow 0.2s, transform 0.2s",
};

const miniStatBox: CSSProperties = {
  flex: 1,
  textAlign: "center",
  padding: "8px 6px",
  background: "rgba(0,0,0,0.02)",
  borderRadius: 10,
};

const newProjectBtnStyle: CSSProperties = {
  background: "#6B8E23",
  color: "#fff",
  borderRadius: 999,
  padding: "11px 22px",
  fontSize: 14,
  fontWeight: 700,
  textDecoration: "none",
  boxShadow: "0 2px 8px rgba(107,142,35,0.3)",
};

const filterInputStyle: CSSProperties = {
  background: "#fff",
  border: "1px solid rgba(0,0,0,0.1)",
  borderRadius: 10,
  padding: "9px 14px",
  fontSize: 13,
  color: "#333",
  outline: "none",
};

const viewToggleBtn: CSSProperties = {
  background: "none",
  border: "none",
  borderRadius: 6,
  padding: "6px 10px",
  cursor: "pointer",
  fontSize: 14,
};
