"use client";

// Flips <html data-theme="light|dark">. The default ("system") means no attribute at all -
// see globals.css, which then falls back to prefers-color-scheme. This component only ever
// writes an *explicit* choice once the person clicks it.

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Choice = "light" | "dark";

function currentChoice(): Choice {
  const stored = typeof window !== "undefined" ? localStorage.getItem("ore-compass-theme") : null;
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>("dark");

  useEffect(() => {
    setChoice(currentChoice());
  }, []);

  function toggle() {
    const next: Choice = choice === "dark" ? "light" : "dark";
    setChoice(next);
    localStorage.setItem("ore-compass-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle light/dark theme"
      style={{
        background: "var(--chip-dark)",
        color: "var(--chip-dark-ink)",
        border: "none",
        borderRadius: 999,
        width: 34,
        height: 34,
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
      }}
    >
      {choice === "dark" ? <Moon size={15} /> : <Sun size={15} />}
    </button>
  );
}
