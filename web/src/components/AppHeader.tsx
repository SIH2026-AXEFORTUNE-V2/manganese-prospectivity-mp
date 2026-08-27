"use client";

// Header for the project workspace (login -> projects -> project). The atlas routes
// (/atlas, /protect, /cutaway) keep their own TopNav with the lane switch; this one carries
// the project breadcrumb and the session chip instead.

import Link from "next/link";
import type { ReactNode } from "react";
import ThemeToggle from "./ThemeToggle";
import { useSession } from "@/lib/projectStore";

export default function AppHeader({
  crumbs = [],
  actions,
}: {
  /** Breadcrumb trail, last item is the current page and is not linked. */
  crumbs?: Array<{ label: string; href?: string }>;
  actions?: ReactNode;
}) {
  const { session, signOut } = useSession();

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 24px",
        gap: 20,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <Link
          href="/projects"
          style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: 10 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size static
              wordmark icon, same call as TopNav makes */}
          <img src="/logo.png" alt="" width={24} height={24} style={{ borderRadius: 6 }} />
          <strong style={{ fontSize: 17, letterSpacing: "0.01em" }}>ORE COMPASS</strong>
        </Link>

        {crumbs.length > 0 && (
          <nav style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, fontSize: 13 }}>
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{ color: "var(--ink-dim)" }}>/</span>
                {c.href ? (
                  <Link href={c.href} style={{ color: "var(--ink-dim)", textDecoration: "none" }}>
                    {c.label}
                  </Link>
                ) : (
                  <span
                    style={{
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: 260,
                    }}
                  >
                    {c.label}
                  </span>
                )}
              </span>
            ))}
          </nav>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {actions}
        <Link
          href="/atlas"
          style={{
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--ink)",
            border: "1px solid var(--glass-border)",
            borderRadius: 999,
            padding: "8px 14px",
          }}
        >
          Atlas
        </Link>
        {session && (
          <button
            type="button"
            onClick={signOut}
            title={`${session.name} · ${session.org} — sign out`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "var(--glass)",
              border: "1px solid var(--glass-border)",
              borderRadius: 999,
              padding: "6px 12px 6px 6px",
              cursor: "pointer",
              color: "var(--ink)",
              fontSize: 13,
            }}
          >
            <span
              style={{
                width: 24,
                height: 24,
                borderRadius: 999,
                background: "var(--chip-dark)",
                color: "var(--accent-lime)",
                display: "grid",
                placeItems: "center",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {session.name.slice(0, 2).toUpperCase()}
            </span>
            Sign out
          </button>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}
