"use client";

// Entry point. Signed in -> the projects list; not signed in -> the sign-in screen.
//
// The map that used to live here is now /atlas: it is a reference view of the whole belt,
// not a home screen. A planner opens this product to work on a project, and the flow starts
// at that list (docs/issues/09-project-workspace-flow.md §1).

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/projectStore";

export default function Home() {
  const { session, hydrated } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!hydrated) return;
    router.replace(session ? "/projects" : "/login");
  }, [hydrated, session, router]);

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        color: "var(--ink-dim)",
        fontFamily: "monospace",
        fontSize: 13,
      }}
    >
      loading Ore Compass…
    </div>
  );
}
