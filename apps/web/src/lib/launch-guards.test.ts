import assert from "node:assert/strict";
import { test } from "node:test";

import { assertLaunchReady, launchProblems } from "./launch-guards.ts";

const CONTACT = {
  NEXT_PUBLIC_LEGAL_NAME: "Siumora Jewels Private Limited",
  NEXT_PUBLIC_LEGAL_ADDRESS: "12 Example Lane, Mumbai 400001",
  NEXT_PUBLIC_SUPPORT_EMAIL: "care@example.com",
  NEXT_PUBLIC_SUPPORT_PHONE: "+91 90000 00000",
  NEXT_PUBLIC_GRIEVANCE_OFFICER: "A. Officer",
  NEXT_PUBLIC_GRIEVANCE_EMAIL: "grievance@example.com",
};

const PROD_OK = {
  APP_ENV: "production",
  SITE_PHASE: "storefront",
  COMMERCE_BACKEND: "medusa",
  MEDUSA_URL: "https://api.siumora.com",
  MEDUSA_ADMIN_URL: "https://api.siumora.com",
  MEDUSA_PUBLISHABLE_KEY: "pk_live",
  NEXT_PUBLIC_SITE_URL: "https://siumora.com",
  CLIENT_IP_SECRET: "c".repeat(32),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAA",
  NEXT_PUBLIC_SENTRY_DSN: "https://key@o1.ingest.sentry.io/1",
  ...CONTACT,
  NEXT_PUBLIC_LEGAL_ENTITY_TYPE: "private-limited",
  NEXT_PUBLIC_GSTIN: "27ABCDE1234F1Z5",
  NEXT_PUBLIC_CIN: "U12345MH2026PTC000001",
};

test("anything but production checks nothing — CI, E2E and preview builds keep working", () => {
  assert.deepEqual(launchProblems({}), []);
  assert.deepEqual(launchProblems({ APP_ENV: "staging" }), []);
  assert.deepEqual(launchProblems({ NODE_ENV: "production" }), []);
});

test("a typo'd APP_ENV is refused rather than read as development", () => {
  assert.match(launchProblems({ APP_ENV: "prod" })[0]!, /APP_ENV must be/);
});

test("a complete production storefront passes", () => {
  assert.deepEqual(launchProblems(PROD_OK), []);
  assert.doesNotThrow(() => assertLaunchReady(PROD_OK));
});

test("sale stays closed without the GSTIN", () => {
  const problems = launchProblems({ ...PROD_OK, NEXT_PUBLIC_GSTIN: "" });
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /GSTIN or CIN\/LLPIN is missing/);
});

test("coming-soon may go to reviewers with the contact block alone", () => {
  const env = {
    ...PROD_OK,
    NEXT_PUBLIC_GSTIN: "",
    NEXT_PUBLIC_CIN: "",
    SITE_PHASE: "coming-soon",
    COMING_SOON_PREVIEW_PASSWORD: "0427",
    COMING_SOON_PREVIEW_SECRET: "s".repeat(32),
  };
  assert.deepEqual(launchProblems(env), []);
  assert.match(
    launchProblems({ ...env, COMING_SOON_PREVIEW_PASSWORD: "12345" }).join("\n"),
    /COMING_SOON_PREVIEW_PASSWORD/,
  );
});

test("an empty contact block is refused even before sale", () => {
  const problems = launchProblems({ ...PROD_OK, NEXT_PUBLIC_GRIEVANCE_OFFICER: "" });
  assert.match(problems.join("\n"), /legal contact block is incomplete/);
});

test("production refuses Fastify, localhost and missing secrets — all named at once", () => {
  const problems = launchProblems({
    ...PROD_OK,
    COMMERCE_BACKEND: "fastify",
    MEDUSA_URL: "http://localhost:9000",
    NEXT_PUBLIC_SITE_URL: "http://siumora.com",
    CLIENT_IP_SECRET: "short",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
    NEXT_PUBLIC_SENTRY_DSN: "",
  });
  const text = problems.join("\n");
  for (const expected of [
    /COMMERCE_BACKEND=fastify/,
    /MEDUSA_URL points at localhost/,
    /NEXT_PUBLIC_SITE_URL must be the public https origin/,
    /CLIENT_IP_SECRET/,
    /NEXT_PUBLIC_TURNSTILE_SITE_KEY/,
    /NEXT_PUBLIC_SENTRY_DSN/,
  ]) {
    assert.match(text, expected);
  }
  assert.throws(() => assertLaunchReady({ ...PROD_OK, MEDUSA_URL: "" }), /production storefront refused:\n {2}- MEDUSA_URL/);
});
