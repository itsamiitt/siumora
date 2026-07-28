#!/usr/bin/env node
/**
 * Placeholder catalogue art.
 *
 * These are not photographs and are not pretending to be. Until there is a
 * shoot, each product is drawn in the brand's own language — the Petal & Kernel
 * geometry on a Blush Mist plate — so the storefront can be built and judged
 * against real layout instead of grey boxes.
 *
 * Three views per product, because a gallery with one image cannot be tested
 * and because the second and third answer questions a shopper actually asks:
 *
 *   front   the piece, centred, at catalogue scale
 *   detail  the kernel close up — where the accent is, and how the strokes meet
 *   scale   the piece drawn at its real width against a rule, so size is legible
 *
 * Run: node tooling/catalog-art.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../apps/web/public/catalog",
);

const W = 1200;
const H = 1500;

const INK = "#1C1917";
const MULBERRY = "#6B2942";
const BLUSH = "#EBDDD8";

/**
 * Per-product geometry, carried over verbatim from the first generation so the
 * front views do not shift under anyone who already has them cached.
 *
 * `widthMm` is the real width of the piece and drives the dimension view.
 */
const PRODUCTS = [
  { handle: "petal-studs", radius: 60, centres: [[400, 560], [800, 560]], widthMm: 11, wear: "at the ear" },
  { handle: "kernel-pendant", radius: 100, centres: [[600, 520]], widthMm: 18, wear: "at the throat" },
  { handle: "jaali-hoops", radius: 75, centres: [[430, 600], [770, 600]], widthMm: 32, wear: "at the ear" },
  { handle: "tuesday-band", radius: 87.5, centres: [[600, 560]], widthMm: 6, wear: "on the hand" },
];

/** The mark: four circles on the axes of a square, kernel dead centre. */
function motif(cx, cy, r, { stroke = INK, kernel = MULBERRY, opacity = 0.85 } = {}) {
  // Guideline ratios are all expressed against x, the mark's grid width. The
  // kit sets circle diameter at 0.5x, so x is 4r — not 2r, which would halve
  // every stroke.
  const x = 4 * r;
  const width = (x * 0.0075).toFixed(2);
  const kernelR = ((x * 0.167) / 2).toFixed(1);

  return (
    `<g fill="none" stroke="${stroke}" stroke-width="${width}" opacity="${opacity}">` +
    // Centres sit at ±r from the middle — the quarter points of the grid, as
    // in the construction diagram. Offsetting by r/2 collapses the petals.
    `<circle cx="${cx}" cy="${cy - r}" r="${r}"/>` +
    `<circle cx="${cx + r}" cy="${cy}" r="${r}"/>` +
    `<circle cx="${cx}" cy="${cy + r}" r="${r}"/>` +
    `<circle cx="${cx - r}" cy="${cy}" r="${r}"/>` +
    `</g>` +
    `<circle cx="${cx}" cy="${cy}" r="${kernelR}" fill="${kernel}"/>`
  );
}

/** The wordmark caption, tracked per the guidelines. Never near the mark. */
function caption(y = 1380, opacity = 0.4) {
  return (
    `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="Jost,sans-serif" ` +
    `font-size="30" letter-spacing="12" fill="${INK}" opacity="${opacity}">SIUMORA</text>`
  );
}

function svg(body, { ground = BLUSH } = {}) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<rect width="${W}" height="${H}" fill="${ground}"/>${body}</svg>`
  );
}

function front({ radius, centres }) {
  return svg(
    centres.map(([cx, cy]) => motif(cx, cy, radius)).join("") + caption(),
  );
}

/**
 * The kernel, close up.
 *
 * Drawn at four times catalogue scale and cropped, which is what a macro shot
 * of this piece would show: the accent, and how the four strokes cross.
 */
function detail({ radius }) {
  const r = radius * 4;
  return svg(
    motif(W / 2, H / 2 - 80, r, { opacity: 0.7 }) + caption(1420, 0.28),
  );
}

/**
 * The dimension view.
 *
 * A drawn hand or ear would be an illustration, and a bad one — it would tell a
 * shopper how well we draw, not how big the piece is. A measured callout is
 * what a jeweller's own spec sheet carries, and it is the actual answer to the
 * only question this view exists for.
 *
 * The mark is drawn at the product's real width against a scaled rule, so the
 * proportion on screen is the proportion in the hand.
 */
function dimension({ widthMm, wear }) {
  // A working area 40mm across. Every piece in the range fits inside it, so
  // they stay comparable to each other across the catalogue.
  const SPAN_MM = 40;
  const usable = 640;
  const perMm = usable / SPAN_MM;
  const cx = W / 2;
  const cy = 640;

  // Mark width is 4r (circle diameter is 0.5x), so r is a quarter of the piece.
  const r = (widthMm * perMm) / 4;

  const half = (widthMm * perMm) / 2;
  // The mark's full height is 4r, so it reaches `half` above and below centre.
  // The callout clears that rather than being placed at a fixed offset, which
  // put the dimension line inside the bottom circle on the wider pieces.
  const callout = cy + half + 90;
  const ruleY = callout + 130;

  const ticks = Array.from({ length: SPAN_MM / 5 + 1 }, (_, i) => {
    const x = cx - usable / 2 + i * 5 * perMm;
    return `<line x1="${x.toFixed(1)}" y1="${ruleY}" x2="${x.toFixed(1)}" y2="${ruleY + 14}" stroke="${INK}" stroke-width="2" opacity="0.35"/>`;
  }).join("");

  return svg(
    // The piece, at size.
    motif(cx, cy, r) +
      // Extension lines down to the callout, the way a spec drawing marks a
      // dimension rather than writing a number beside a picture.
      `<g stroke="${INK}" stroke-width="2" opacity="0.35" fill="none">` +
      `<line x1="${cx - half}" y1="${cy + half + 20}" x2="${cx - half}" y2="${callout + 20}"/>` +
      `<line x1="${cx + half}" y1="${cy + half + 20}" x2="${cx + half}" y2="${callout + 20}"/>` +
      `<line x1="${cx - half}" y1="${callout}" x2="${cx + half}" y2="${callout}"/>` +
      `</g>` +
      `<text x="${cx}" y="${callout - 20}" text-anchor="middle" font-family="Jost,sans-serif" ` +
      `font-size="34" fill="${MULBERRY}">${widthMm} mm</text>` +
      // The rule, so the callout is checkable rather than asserted.
      `<line x1="${cx - usable / 2}" y1="${ruleY}" x2="${cx + usable / 2}" y2="${ruleY}" stroke="${INK}" stroke-width="2" opacity="0.35"/>` +
      ticks +
      `<text x="${cx}" y="${ruleY + 56}" text-anchor="middle" font-family="Jost,sans-serif" ` +
      `font-size="24" letter-spacing="4" fill="${INK}" opacity="0.45">` +
      `${SPAN_MM} MM · WORN ${wear.toUpperCase()}</text>` +
      caption(1420, 0.28),
  );
}

mkdirSync(OUT, { recursive: true });

for (const product of PRODUCTS) {
  for (const [view, draw] of [
    ["", front],
    ["-detail", detail],
    ["-scale", dimension],
  ]) {
    const file = join(OUT, `${product.handle}${view}.svg`);
    writeFileSync(file, draw(product));
    console.log(`wrote ${file.replace(/.*\/public/, "public")}`);
  }
}
