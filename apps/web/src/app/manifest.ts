import type { MetadataRoute } from "next";

import { SITE } from "@siumora/seo";

/**
 * Web app manifest.
 *
 * Installability earns free re-engagement on Android, where a large share of
 * Indian traffic lands and where an icon on the home screen outperforms any
 * push channel we would otherwise pay for.
 *
 * Icons come from brand-kit/02-icons. `maskable` is declared separately from
 * `any` because Android crops a maskable icon to whatever shape the launcher
 * uses — declaring the same file as both puts the mark's clear space at the
 * mercy of a circle mask.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Siumora",
    short_name: "Siumora",
    description: SITE.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "en-IN",
    // Kagaz Ivory. The dark theme reassigns the page ground but not this: the
    // splash a visitor sees before any CSS runs should be the brand's own.
    background_color: "#F7F3EA",
    theme_color: "#F7F3EA",
    categories: ["shopping", "lifestyle"],
    icons: [
      { src: "/icons/favicon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/favicon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        // The app icon has the clear space a launcher mask needs; the plain
        // favicon does not, and would have its petals cut off.
        src: "/icons/siumora-appicon-ink-1024.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Your orders", url: "/account" },
      { name: "Saved", url: "/wishlist" },
    ],
  };
}
