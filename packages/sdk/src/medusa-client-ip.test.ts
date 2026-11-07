import assert from "node:assert/strict";
import { test } from "node:test";

import { MedusaClient } from "./medusa.ts";

// The clientIpHeaders hook: per-shopper calls carry the storefront's signed
// client-IP headers; cached reads carry none; a failing hook never fails the call.

function recording() {
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
    return new Response(JSON.stringify({ reminders: true, products: [], count: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { impl, seen };
}

const IP_HEADERS = { "x-siumora-client-ip": "203.0.113.9", "x-siumora-client-ip-sig": "ab".repeat(32) };

test("an uncached call carries the client-IP headers, and withToken keeps the hook", async () => {
  const { impl, seen } = recording();
  const client = new MedusaClient({
    baseUrl: "http://m",
    publishableKey: "pk",
    fetch: impl,
    clientIpHeaders: async () => IP_HEADERS,
  });
  await client.setCartReminders("cart_1", { phone: "9876543210", consent: true });
  await client.withToken("sst_x").setCartReminders("cart_1", { phone: "9876543210", consent: false });
  for (const call of seen) {
    assert.equal(call.headers["x-siumora-client-ip"], "203.0.113.9");
    assert.equal(call.headers["x-siumora-client-ip-sig"], "ab".repeat(32));
  }
  assert.equal(seen.length, 2);
});

test("a hook that throws sends the request without the headers", async () => {
  const { impl, seen } = recording();
  const client = new MedusaClient({
    baseUrl: "http://m",
    publishableKey: "pk",
    fetch: impl,
    clientIpHeaders: () => {
      throw new Error("outside a request scope");
    },
  });
  await client.setCartReminders("cart_1", { phone: "9876543210", consent: true });
  assert.equal(seen[0]!.headers["x-siumora-client-ip"], undefined);
});
