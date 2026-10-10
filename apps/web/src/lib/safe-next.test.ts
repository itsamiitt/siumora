import assert from "node:assert/strict";
import { test } from "node:test";

import { safeNext } from "./safe-next.ts";

test("same-site paths pass through, query and all", () => {
  assert.equal(safeNext("/checkout"), "/checkout");
  assert.equal(safeNext("/orders/SIU-00001?key=abc"), "/orders/SIU-00001?key=abc");
});

test("anything that leaves the site falls back to the account page", () => {
  for (const hostile of [
    "//evil.com",
    "/\\evil.com",
    "/\tevil.com",
    "/%09/evil.com",
    "/\t/evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "evil.com",
    "",
    null,
    undefined,
  ]) {
    const out = safeNext(hostile);
    assert.ok(out.startsWith("/") && !out.startsWith("//") && !out.startsWith("/\\"), `${String(hostile)} → ${out}`);
    assert.equal(new URL(out, "https://siumora.com").origin, "https://siumora.com", String(hostile));
  }
});
