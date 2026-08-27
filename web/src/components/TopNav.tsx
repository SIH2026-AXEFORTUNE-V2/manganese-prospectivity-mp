// Wordmark + workspace switch + theme toggle, echoing the reference's top bar (logo,
// search, avatar). Explore/Protect is a pill toggle here, same pattern as the reference's
// "Junior / Middle / Senior" segmented control - the active segment gets the lime chip.
// Also includes the 3D Balaghat Cutaway view link (Issue #8).

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";

export default function TopNav({
  workspace,
  onWorkspaceChange,
}: {
  workspace: "explore" | "protect";
  onWorkspaceChange: (w: "explore" | "protect") => void;
}) {
  const pathname = usePathname();
  const isCutaway = pathname === "/cutaway";

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 24px",
        gap: 20,
      }}
    >
      <Link
        href="/projects"
        title="Back to projects"
        style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: 10 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size static
            wordmark icon, not worth next/image's responsive-loading machinery */}
        <img src="/logo.png" alt="" width={24} height={24} style={{ borderRadius: 6 }} />
        <strong style={{ fontSize: 17, letterSpacing: "0.01em" }}>ORE COMPASS</strong>
      </Link>

      <div
        style={{
          display: "flex",
          background: "var(--glass)",
          border: "1px solid var(--glass-border)",
          backdropFilter: "blur(16px)",
          borderRadius: 999,
          padding: 4,
          gap: 4,
        }}
      >
        <Link
          href="/atlas"
          onClick={() => onWorkspaceChange("explore")}
          style={{
            textDecoration: "none",
            borderRadius: 999,
            padding: "8px 18px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            background: !isCutaway && workspace === "explore" ? "var(--accent-lime)" : "transparent",
            color: !isCutaway && workspace === "explore" ? "var(--chip-dark)" : "var(--ink)",
            transition: "all 0.18s ease",
            display: "inline-block",
          }}
        >
          Explore Map
        </Link>
        <Link
          href="/cutaway"
          style={{
            textDecoration: "none",
            borderRadius: 999,
            padding: "8px 18px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            background: isCutaway ? "var(--accent-lime)" : "transparent",
            color: isCutaway ? "var(--chip-dark)" : "var(--ink)",
            transition: "all 0.18s ease",
            display: "inline-block",
          }}
        >
          Balaghat Cutaway (3D)
        </Link>
        <Link
          href="/protect"
          onClick={() => onWorkspaceChange("protect")}
          style={{
            textDecoration: "none",
            border: "none",
            borderRadius: 999,
            padding: "8px 18px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            background: !isCutaway && workspace === "protect" ? "var(--accent-lime)" : "transparent",
            color: !isCutaway && workspace === "protect" ? "var(--chip-dark)" : "var(--ink)",
            transition: "all 0.18s ease",
            display: "inline-block",
          }}
        >
          Protect
        </Link>
      </div>

      <ThemeToggle />
    </header>
  );
}
