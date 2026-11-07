import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { clientIpFrom, clientIpHeaders } from "./client-ip.ts";

const reader = (values: Record<string, string>) => ({
  get: (name: string) => values[name] ?? null,
});

test("the first x-forwarded-for hop is the shopper; x-real-ip is the fallback", () => {
  assert.equal(clientIpFrom(reader({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })), "203.0.113.9");
  assert.equal(clientIpFrom(reader({ "x-real-ip": "198.51.100.4" })), "198.51.100.4");
  assert.equal(clientIpFrom(reader({})), undefined);
});

test("the headers carry the IP and its HMAC under the shared secret", () => {
  const sent = clientIpHeaders(reader({ "x-forwarded-for": "203.0.113.9" }), "secret")!;
  assert.equal(sent["x-siumora-client-ip"], "203.0.113.9");
  assert.equal(
    sent["x-siumora-client-ip-sig"],
    createHmac("sha256", "secret").update("203.0.113.9").digest("hex"),
  );
});

test("without a secret or an IP nothing is sent", () => {
  assert.equal(clientIpHeaders(reader({ "x-forwarded-for": "203.0.113.9" }), undefined), undefined);
  assert.equal(clientIpHeaders(reader({}), "secret"), undefined);
});
