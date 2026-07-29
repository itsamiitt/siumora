import assert from "node:assert/strict";
import { test } from "node:test";

import nextConfig from "../../next.config.ts";

/**
 * Pins the CSP allowlist (eng review OV-1).
 *
 * The header is deliberately locked down; every third-party host on it was
 * placed there for a stated reason. This test is the review step for the next
 * host: adding one means editing this file, which means saying why.
 */

async function csp(): Promise<string> {
  const groups = await nextConfig.headers!();
  for (const group of groups) {
    const header = group.headers.find(
      (h) => h.key === "Content-Security-Policy",
    );
    if (header) return header.value;
  }
  throw new Error("no Content-Security-Policy header configured");
}

function directive(policy: string, name: string): string {
  const found = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `) || part === name);
  assert.ok(found, `CSP is missing the ${name} directive`);
  return found!;
}

test("script-src names its hosts exactly — no wildcards", async () => {
  const policy = await csp();
  assert.equal(
    directive(policy, "script-src"),
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://checkout.razorpay.com https://connect.facebook.net",
  );
});

test("the payment modal's iframe hosts are allowed, per-host", async () => {
  const policy = await csp();
  assert.equal(
    directive(policy, "frame-src"),
    "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com",
  );
});

test("connect-src carries analytics, payments and the pixel, nothing wider", async () => {
  const policy = await csp();
  assert.equal(
    directive(policy, "connect-src"),
    "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com https://api.razorpay.com https://lumberjack.razorpay.com https://www.facebook.com",
  );
});

test("no directive carries a scheme-wide https: source except images", async () => {
  const policy = await csp();
  for (const part of policy.split(";").map((p) => p.trim())) {
    if (part.startsWith("img-src")) continue; // product CDNs vary; images cannot script
    assert.ok(
      !/\shttps:(\s|$)/.test(part),
      `${part} allows any https host — the allowlist exists to prevent exactly this`,
    );
  }
});

test("the clickjacking and injection backstops stay locked", async () => {
  const policy = await csp();
  assert.equal(directive(policy, "frame-ancestors"), "frame-ancestors 'none'");
  assert.equal(directive(policy, "object-src"), "object-src 'none'");
  assert.equal(directive(policy, "base-uri"), "base-uri 'none'");
});
