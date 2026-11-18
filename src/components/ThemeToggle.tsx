"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const KEY = "theme";

/** The theme in effect now: the viewer's pick (html data-theme) or else the computer's setting. */
function current(): Theme {
  const picked = document.documentElement.dataset.theme;
  if (picked === "light" || picked === "dark") return picked;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Light / dark switch (top right of every page). The choice is remembered in this browser. */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null); // null until mounted (avoids a hydration mismatch)

  useEffect(() => {
    setTheme(current());
    // follow the computer's setting while the viewer hasn't picked one
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (!document.documentElement.dataset.theme) setTheme(current()); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggle = () => {
    const next: Theme = current() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch { /* storage unavailable — still switches for this visit */ }
    setTheme(next);
  };

  const label = theme === "dark" ? "Light mode" : "Dark mode";
  return (
    <button type="button" className={`themeToggle ${className}`} onClick={toggle}
      aria-label={theme ? `Switch to ${label.toLowerCase()}` : "Switch theme"} title={theme ? `Switch to ${label.toLowerCase()}` : undefined}>
      <span aria-hidden>{theme === "dark" ? "☀️" : "🌙"}</span>{theme ? label : "Theme"}
    </button>
  );
}

/** Runs before the page paints, so a saved choice never flashes the other theme first. */
export const THEME_SCRIPT =
  `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
