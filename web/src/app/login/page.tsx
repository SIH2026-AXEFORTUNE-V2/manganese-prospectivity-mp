"use client";

// Step 1 of the flow: sign in, then land on the projects list.
// docs/issues/09-project-workspace-flow.md §1.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import GlassCard from "@/components/GlassCard";
import ThemeToggle from "@/components/ThemeToggle";
import { useSession } from "@/lib/projectStore";

export default function LoginPage() {
  const { session, hydrated, signIn } = useSession();
  const router = useRouter();
  const [name, setName] = useState("");
  const [org, setOrg] = useState("MOIL Ltd — Balaghat Division");

  useEffect(() => {
    if (hydrated && session) router.replace("/projects");
  }, [hydrated, session, router]);

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size wordmark */}
          <img src="/logo.png" alt="" width={24} height={24} style={{ borderRadius: 6 }} />
          <strong style={{ fontSize: 17, letterSpacing: "0.01em" }}>ORE COMPASS</strong>
        </div>
        <ThemeToggle />
      </div>

      <main style={{ flex: 1, display: "grid", placeItems: "center", padding: 24 }}>
        <GlassCard style={{ padding: 32, width: "min(440px, 100%)", display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--ink-dim)",
              }}
            >
              Manganese exploration & production planning
            </div>
            <h1 style={{ fontSize: 28, margin: "8px 0 0", fontWeight: 700, lineHeight: 1.1 }}>Sign in</h1>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              signIn(name.trim(), org.trim() || "—");
              router.push("/projects");
            }}
            style={{ display: "flex", flexDirection: "column", gap: 14 }}
          >
            <label style={labelStyle}>
              Your name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. R. Deshmukh"
                autoFocus
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Organisation / division
              <input value={org} onChange={(e) => setOrg(e.target.value)} style={inputStyle} />
            </label>
            <button
              type="submit"
              disabled={!name.trim()}
              style={{
                background: "var(--accent-lime)",
                color: "var(--chip-dark)",
                border: "none",
                borderRadius: 999,
                padding: "11px 18px",
                fontSize: 14,
                fontWeight: 700,
                cursor: name.trim() ? "pointer" : "not-allowed",
                opacity: name.trim() ? 1 : 0.45,
              }}
            >
              Continue to projects
            </button>
          </form>

          <p style={{ margin: 0, fontSize: 11.5, color: "var(--ink-dim)", lineHeight: 1.55 }}>
            This is a session label, not authentication. Ore Compass has no backend — the
            pipeline writes files and this app reads them, so there is nothing here to log into.
            Your name is stored in this browser only, to own the projects you create.
          </p>
        </GlassCard>
      </main>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  color: "var(--ink-dim)",
};

const inputStyle: React.CSSProperties = {
  background: "var(--glass)",
  border: "1px solid var(--glass-border)",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 14,
  color: "var(--ink)",
  fontWeight: 400,
};
