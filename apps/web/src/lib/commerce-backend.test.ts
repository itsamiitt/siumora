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

const MEDUSA = { MEDUSA_URL: "http://127.0.0.1:9000", MEDUSA_PUBLISHABLE_KEY: "pk_test" };

test("unset COMMERCE_BACKEND defaults to medusa — the launch path (plan 16 Phase J)", () => {
  assert.ok(createCommerceClient({ ...ENV, ...MEDUSA }) instanceof MedusaClient);
});

test("fastify is still selectable by name until it is retired", () => {
  const client = createCommerceClient({ ...ENV, COMMERCE_BACKEND: "fastify" });
  assert.ok(client instanceof SiumoraClient);
  assert.deepEqual(client, createClient({ ...ENV }));
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
