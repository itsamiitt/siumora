"use client";

import { useEffect, useState } from "react";

import { MicroLabel } from "@siumora/ui";

/**
 * Light / dark switch.
 *
 * Three states, not two: "system" is the default and stays the default until
 * someone actively chooses otherwise. A toggle that silently pins a theme on
 * first render overrides a preference the visitor already expressed to their
 * operating system.
 */

export type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "siumora.theme";

/**
 * Applied before paint by the inline script in the layout, and again here on
 * every change, so the two can never disagree about what the attribute means.
 */
function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

export function ThemeToggle() {
  // Starts undefined: the server does not know the visitor's choice, and
  // rendering a guess would make the button flip after hydration.
  const [choice, setChoice] = useState<ThemeChoice | undefined>();

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    setChoice(stored === "light" || stored === "dark" ? stored : "system");
  }, []);

  function pick(next: ThemeChoice) {
    setChoice(next);
    apply(next);
    if (next === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, next);
  }

  function cycle() {
    const resolved =
      choice === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : choice;
    pick(resolved === "dark" ? "light" : "dark");
  }

  return (
    <button
      type="button"
      onClick={cycle}
      // Labelled rather than icon-only: a sun/moon glyph is ambiguous about
      // whether it shows the current state or the one you would switch to.
      aria-label="Switch between light and dark"
      title={choice === "system" ? "Following your system setting" : undefined}
      className="transition-colors hover:text-accent-ink"
      suppressHydrationWarning
    >
      <MicroLabel>
        {choice === undefined ? "Theme" : choice === "dark" ? "Light" : "Dark"}
      </MicroLabel>
    </button>
  );
}

/**
 * Runs before the first paint, so a dark-theme visitor never sees an ivory
 * flash. Inlined in the document head: a module in the bundle would already be
 * too late.
 */
export const THEME_SCRIPT = `
try {
  var t = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
} catch (e) {}
`.trim();
