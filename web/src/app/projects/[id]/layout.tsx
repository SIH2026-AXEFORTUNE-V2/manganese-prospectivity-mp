"use client";

// Shell for one project: header crumb + the tab row every project screen shares.
// Client-side because the project itself lives in localStorage (see lib/projectStore.ts),
// so `params` is read with useParams() rather than awaited on the server.

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import type { ReactNode } from "react";
import AppHeader from "@/components/AppHeader";
import GlassCard from "@/components/GlassCard";
import RequireSession from "@/components/RequireSession";
import { useProject } from "@/lib/projectStore";

const TABS = [
  { seg: "", label: "Zones" },
  { seg: "plan", label: "Plan" },
  { seg: "calendar", label: "Calendar" },
  { seg: "data", label: "Data" },
  { seg: "learning", label: "Learning" },
];

export default function ProjectLayout({ children }: { children: ReactNode }) {
  return (
    <RequireSession>
      <Shell>{children}</Shell>
    </RequireSession>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const id = params?.id ?? null;
  const { project, hydrated } = useProject(id);

  const base = `/projects/${id}`;
  const activeSeg = pathname === base ? "" : (pathname?.slice(base.length + 1).split("/")[0] ?? "");

  if (hydrated && !project) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
        <AppHeader crumbs={[{ label: "Projects", href: "/projects" }, { label: "Not found" }]} />
        <main style={{ padding: 24 }}>
          <GlassCard style={{ padding: 24, maxWidth: 560, fontSize: 13.5, lineHeight: 1.6 }}>
            No project with that id in this browser. Projects live in local storage, so a link
            shared from another machine won&rsquo;t resolve here.{" "}
            <Link href="/projects" style={{ color: "var(--ink)" }}>
              Back to projects
            </Link>
            .
          </GlassCard>
        </main>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <AppHeader
        crumbs={[{ label: "Projects", href: "/projects" }, { label: project?.name ?? "…" }]}
      />

      <div style={{ padding: "0 24px", display: "flex", gap: 6, flexWrap: "wrap" }}>
        {TABS.map((t) => {
          const href = t.seg ? `${base}/${t.seg}` : base;
          const active = activeSeg === t.seg;
          return (
            <Link
              key={t.label}
              href={href}
              style={{
                textDecoration: "none",
                borderRadius: 999,
                padding: "7px 16px",
                fontSize: 13,
                fontWeight: 600,
                background: active ? "var(--accent-lime)" : "var(--glass)",
                color: active ? "var(--chip-dark)" : "var(--ink)",
                border: `1px solid ${active ? "transparent" : "var(--glass-border)"}`,
              }}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      <main style={{ flex: 1, minHeight: 0, padding: "16px 24px 28px" }}>{children}</main>
    </div>
  );
}
