import type { NextConfig } from "next";

/**
 * Content Security Policy.
 *
 * Every directive is locked down except `script-src`, which keeps
 * `'unsafe-inline'`. That is a deliberate, stated trade rather than an
 * oversight: Next streams its flight data as inline `<script>` tags whose
 * contents differ per render, so the only way to allow them is a per-request
 * nonce — and a per-request nonce forces every route dynamic, which is exactly
 * the Partial Prerendering this storefront is built around (plan/02 §1).
 *
 * What remains is still worth having. `script-src` still names its hosts, so
 * the classic injected `<script src="//evil">` is refused; `object-src`,
 * `base-uri` and `form-action` close the redirect and base-tag tricks that
 * `'unsafe-inline'` does nothing about; and `frame-ancestors` ends clickjacking
 * outright. Moving to a nonce is a one-line middleware away the day the
 * prerender budget stops mattering.
 */
const CSP = [
  "default-src 'self'",
  // 'unsafe-eval' is absent: nothing here compiles code at runtime, and its
  // absence is what stops a JSON payload becoming an execution path.
  // checkout.razorpay.com serves Checkout.js — per-host, never a wildcard
  // (eng review OV-1). Meta Pixel hosts arrive with the tags work, not before.
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://checkout.razorpay.com",
  // Tailwind v4 emits a stylesheet, but React inlines style attributes for
  // view transitions and the same nonce problem applies.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // lumberjack is Checkout.js's telemetry beacon; blocked, every payment
  // attempt logs a console error that reads like a failure.
  "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com https://api.razorpay.com https://lumberjack.razorpay.com",
  // The payment modal is an iframe to the provider; default-src 'self' would
  // refuse it and the Pay button would open nothing.
  "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Frame-ancestors already covers this; the header is here for the proxies and
  // scanners that still only read the old one.
  { key: "X-Frame-Options", value: "DENY" },
  // Full URL to our own origin, bare origin to anyone else — an order
  // confirmation URL carries an access key in the query string.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // Microphone is allowed on the same origin: voice search asks for it.
    value: "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  /**
   * Applied to every route.
   *
   * In `headers()` rather than middleware so they survive on statically
   * prerendered responses and cost nothing per request — middleware would run
   * on each one, to set values that never change.
   */
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },

  // Naming the framework and its version on every response only helps somebody
  // matching the site against a list of known advisories.
  poweredByHeader: false,

  // Workspace packages ship TypeScript source, so Next compiles them itself.
  transpilePackages: ["@siumora/ui", "@siumora/core", "@siumora/in-locale"],

  images: {
    // AVIF first, WebP fallback — the PDP image budget in plan/02-frontend
    // depends on this ordering.
    formats: ["image/avif", "image/webp"],
  },

  // React Compiler is on per plan/02-frontend §1. Top-level in Next 16 —
  // it moved out of `experimental`.
  reactCompiler: true,

  // Cache Components: a static shell from the edge with dynamic holes streamed,
  // per plan/02-frontend §1. Top-level in 16.2 — it moved out of `experimental`,
  // which the build had been warning about on every run.
  cacheComponents: true,

  experimental: {
    // Cross-route View Transitions, so the product plate travels from the grid
    // to the detail page instead of cutting.
    viewTransition: true,
  },
};

export default nextConfig;
