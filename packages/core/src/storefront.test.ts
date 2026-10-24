import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_STOREFRONT, isStorefrontContent } from "./storefront.ts";

test("accepts complete content and rejects unsafe destinations or secret-shaped extras", () => {
  assert.equal(isStorefrontContent(DEFAULT_STOREFRONT), true);
  assert.equal(isStorefrontContent({ ...DEFAULT_STOREFRONT, image: "https://cdn.example.com/hero.webp" }), true);
  assert.equal(isStorefrontContent({ ...DEFAULT_STOREFRONT, image: "http://localhost:9000/static/hero.webp" }), true);
  assert.equal(isStorefrontContent({ ...DEFAULT_STOREFRONT, image: "http://untrusted.example.com/hero.webp" }), false);
  for (const buttonHref of ["javascript:alert(1)", "//example.com", "/\\example.com", "https://example.com"]) {
    assert.equal(isStorefrontContent({ ...DEFAULT_STOREFRONT, buttonHref }), false);
  }
  assert.equal(isStorefrontContent({ ...DEFAULT_STOREFRONT, image: "data:image/svg+xml,unsafe" }), false);
  assert.equal(isStorefrontContent({ ...DEFAULT_STOREFRONT, RESEND_API_KEY: "secret" }), false);
  assert.equal(isStorefrontContent({ title: "Incomplete" }), false);
});
