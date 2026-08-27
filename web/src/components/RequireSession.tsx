"use client";

// Gate for every project-workspace route.
//
// This checks a *session label*, not a credential — there is no backend to authenticate
// against, so nothing here is security and the UI must never imply it is. It exists so the
// projects list has an owner and a "last updated by" line, and so the demo opens on a sign-in
// screen the way the real product would.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useSession } from "@/lib/projectStore";

export default function RequireSession({ children }: { children: ReactNode }) {
  const { session, hydrated } = useSession();
  const router = useRouter();

  useEffect(() => {
    // Wait for localStorage to land before deciding - redirecting on the pre-hydration
    // snapshot would bounce a signed-in user straight back to the sign-in screen.
    if (hydrated && !session) router.replace("/login");
  }, [hydrated, session, router]);

  if (!hydrated || !session) {
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
        {hydrated ? "redirecting to sign in…" : "loading workspace…"}
      </div>
    );
  }

  return <>{children}</>;
}
