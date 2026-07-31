import assert from "node:assert/strict";
import { test } from "node:test";

import { createClient, SiumoraClient } from "@siumora/sdk";
import { MedusaClient } from "@siumora/sdk/medusa";

import { createCommerceClient } from "./commerce-backend.ts";

/**
 * The COMMERCE_BACKEND seam (Track M M1). Same philosophy as apps/e2e's
 * E2E_BACKEND refusal: `medusa` constructs the real transport when its
 * configuration is present and refuses loudly when it is not, so a flipped
 * environment can never quietly keep serving the wrong backend. The default
 * path must stay byte-for-byte today's client.
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

test("medusa constructs the M1 transport when configured", () => {
  const client = createCommerceClient({
    ...ENV,
    COMMERCE_BACKEND: "medusa",
    MEDUSA_URL: "http://127.0.0.1:9000",
    MEDUSA_PUBLISHABLE_KEY: "pk_test",
  });
  assert.ok(client instanceof MedusaClient);
});

test("medusa without its configuration refuses at construction, by name", () => {
  assert.throws(
    () => createCommerceClient({ ...ENV, COMMERCE_BACKEND: "medusa" }),
    /MEDUSA_URL and MEDUSA_PUBLISHABLE_KEY/,
  );
});

test("an unknown backend is named, alongside the two allowed values", () => {
  assert.throws(
    () => createCommerceClient({ ...ENV, COMMERCE_BACKEND: "shopify" }),
    /COMMERCE_BACKEND must be fastify\|medusa, got "shopify"/,
  );
});
