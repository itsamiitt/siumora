import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_LOCALE,
  LIVE_LOCALES,
  LOCALES,
  alternates,
  dictionary,
  isLive,
} from "./i18n.ts";

test("serves the launch dictionary by default", () => {
  assert.equal(dictionary().product.addToBag, "Add to bag");
  assert.equal(dictionary(DEFAULT_LOCALE).nav.bag, "Bag");
});

test("declares hi-IN without claiming it is live", () => {
  assert.ok(LOCALES.includes("hi-IN"));
  assert.equal(isLive("hi-IN"), false);
  assert.equal(isLive("en-IN"), true);
});

test("advertises hreflang only for locales that are actually served", () => {
  // An hreflang for a page that would serve English is a broken alternate, and
  // lands a Hindi speaker on the page they were trying to leave.
  const links = alternates("/products/petal-studs", "https://siumora.com");
  assert.deepEqual(Object.keys(links).sort(), ["en-IN", "x-default"]);
  assert.equal(links["en-IN"], "https://siumora.com/products/petal-studs");
  assert.equal(links["x-default"], "https://siumora.com/products/petal-studs");
});

test("tolerates a path given without its leading slash", () => {
  const links = alternates("cart", "https://siumora.com");
  assert.equal(links["x-default"], "https://siumora.com/cart");
});

test("every declared locale has a dictionary", () => {
  for (const locale of LOCALES) {
    assert.ok(dictionary(locale).nav.search, locale);
  }
});

test("the live list is a subset of the declared list", () => {
  for (const locale of LIVE_LOCALES) {
    assert.ok(LOCALES.includes(locale), locale);
  }
});
