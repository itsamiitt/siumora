import assert from "node:assert/strict";
import { test } from "node:test";

import { createClient, SiumoraClient } from "@siumora/sdk";

import { createCommerceClient } from "./commerce-backend.ts";

/**
 * The COMMERCE_BACKEND seam (Track M M1). Same philosophy as apps/e2e's
 * E2E_BACKEND refusal: until M1 lands the Medusa transport, `medusa` must
 * refuse loudly at construction rather than silently serving Fastify, so a
 * premature cutover flip can never look green while running the wrong
 * backend. The default path must stay byte-for-byte today's client.
 */

const ENV = { API_URL: "http://127.0.0.1:4000" };

test("unset COMMERCE_BACKEND defaults to fastify — today's client, unchanged", () => {
  const client = createCommerceClient({ ...ENV });
  assert.ok(client instanceof SiumoraClient);
  assert.deepEqual(client, createClient({ ...ENV }));
});

test("explicit fastify constructs the same client as the default", () => {
  assert.deepEqual(
    createCommerceClient({ ...ENV, COMMERCE_BACKEND: "fastify" }),
    createCommerceClient({ ...ENV }),
  );
});

test("medusa refuses until M1 lands the transport", () => {
  assert.throws(
    () => createCommerceClient({ ...ENV, COMMERCE_BACKEND: "medusa" }),
    /not servable until M1/,
  );
});

test("an unknown backend is named, alongside the two allowed values", () => {
  assert.throws(
    () => createCommerceClient({ ...ENV, COMMERCE_BACKEND: "shopify" }),
    /COMMERCE_BACKEND must be fastify\|medusa, got "shopify"/,
  );
});
