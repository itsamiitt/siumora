import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyTurnstile } from "./turnstile.ts";

const ON = { TURNSTILE_SECRET_KEY: "0x-secret" };

function answering(body: unknown, status = 200) {
  const calls: Array<{ url: string; body: string }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: String(init.body) });
    return { ok: status < 300, status, json: async () => body };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("off without a secret: nothing is checked", async () => {
  const { impl, calls } = answering({ success: false });
  assert.deepEqual(await verifyTurnstile(undefined, "1.2.3.4", {}, impl), { ok: true, skipped: true });
  assert.equal(calls.length, 0);
});

test("on: a missing token refuses without calling Cloudflare", async () => {
  const { impl, calls } = answering({ success: true });
  assert.deepEqual(await verifyTurnstile("", "1.2.3.4", ON, impl), { ok: false, reason: "missing" });
  assert.equal(calls.length, 0);
});

test("on: Cloudflare's verdict decides, with the client IP passed along", async () => {
  const pass = answering({ success: true });
  assert.deepEqual(await verifyTurnstile("tok", "1.2.3.4", ON, pass.impl), { ok: true, skipped: false });
  assert.match(pass.calls[0]!.body, /remoteip=1.2.3.4/);

  const fail = answering({ success: false, "error-codes": ["invalid-input-response"] });
  assert.deepEqual(await verifyTurnstile("tok", "1.2.3.4", ON, fail.impl), { ok: false, reason: "rejected" });
});

test("on: a Cloudflare outage fails open and is reported", async () => {
  const { impl } = answering({}, 503);
  let reported = false;
  const outcome = await verifyTurnstile("tok", undefined, ON, impl, () => {
    reported = true;
  });
  assert.deepEqual(outcome, { ok: true, skipped: true });
  assert.equal(reported, true);
});
