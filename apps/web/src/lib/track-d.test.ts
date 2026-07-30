import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * The Track-D page is plain HTML with no build step, so this is its only
 * automated check: the brand's forbidden words stay out, the opt-in CTA and
 * the voice line stay in, and nobody ships the placeholder thinking it is a
 * phone number.
 */

const PAGE_URL = new URL("../../../../track-d/index.html", import.meta.url);

const FORBIDDEN = [
  "bridal",
  "trousseau",
  "dowry",
  "investment",
  "luxury",
  "exclusive",
  "premium",
  "treat yourself",
  "girl boss",
];

test("the Track-D page keeps the brand voice", async () => {
  const html = (await readFile(fileURLToPath(PAGE_URL), "utf8"))
    .toLowerCase()
    .replace(/\s+/g, " ");

  for (const word of FORBIDDEN) {
    assert.ok(!html.includes(word), `forbidden word on the page: "${word}"`);
  }

  assert.ok(html.includes("something given, something kept."), "the voice line");
  assert.ok(html.includes("wa.me/"), "the WhatsApp opt-in CTA");
  assert.ok(
    html.includes("never become the whatsapp cloud api / waba sender"),
    "the Track-D number rule must stay stated where the number is filled in",
  );
});
