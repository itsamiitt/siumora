"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { MicroLabel } from "@siumora/ui";

import { PincodeChecker } from "./pincode-checker";
import { COLLECTION_NAV } from "./site-navigation";
import { ThemeToggle } from "./theme-toggle";

const UTILITIES = [
  { href: "/search", label: "Search" },
  { href: "/wishlist", label: "Saved" },
  { href: "/account", label: "Account" },
];

/** The small-screen navigation stays out of the tab order while closed. */
export function MobileMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const firstLink = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1280px)");
    const onChange = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!open) return;
    firstLink.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-controls="mobile-site-menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="ml-auto flex min-h-11 items-center px-2 text-content-muted hover:text-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink xl:hidden"
      >
        <MicroLabel>Menu</MicroLabel>
      </button>

      <div
        id="mobile-site-menu"
        ref={panel}
        hidden={!open}
        className="absolute inset-x-0 top-full max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-[var(--color-rule)] bg-ground px-5 pb-6 pt-3 shadow-lg xl:hidden"
      >
        {open && (
          <nav aria-label="Mobile navigation" className="mx-auto max-w-6xl">
            <p className="py-2"><MicroLabel>Collections</MicroLabel></p>
            {COLLECTION_NAV.map((item, index) => (
              <Link
                key={item.href}
                ref={index === 0 ? firstLink : undefined}
                href={item.href}
                aria-current={pathname === item.href ? "page" : undefined}
                onClick={() => setOpen(false)}
                className="block min-h-11 border-b border-[var(--color-rule)] py-3 text-sm text-content hover:text-accent-ink focus-visible:outline-2 focus-visible:outline-accent-ink"
              >
                {item.label}
              </Link>
            ))}

            <p className="pt-6 pb-2"><MicroLabel>Explore</MicroLabel></p>
            {UTILITIES.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={pathname === item.href ? "page" : undefined}
                onClick={() => setOpen(false)}
                className="block min-h-11 border-b border-[var(--color-rule)] py-3 text-sm text-content hover:text-accent-ink focus-visible:outline-2 focus-visible:outline-accent-ink"
              >
                {item.label}
              </Link>
            ))}

            <div className="pt-5">
              <PincodeChecker inline />
              <div className="mt-5"><ThemeToggle /></div>
            </div>
          </nav>
        )}
      </div>
    </>
  );
}
