import "server-only";

import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";

import { clientIpHeaders } from "./client-ip";
import { createCommerceClient, type CommerceClient } from "./commerce-backend";

/**
 * The commerce API client, shared across a server process.
 *
 * Built once and cached: constructing one per request is cheap but the
 * repeated environment validation is noise, and a single instance makes the
 * connection reuse obvious.
 *
 * COMMERCE_BACKEND selects the transport (see commerce-backend.ts); a bad or
 * premature value throws here, at construction, on the first api() call.
 *
 * The one client serves every request, so the shopper's IP is read per call
 * (the SDK calls the hook for uncached requests only): Medusa's per-IP limits
 * and OTP caps then count the shopper, not this server (lib/client-ip.ts).
 * Outside a request scope headers() throws, and the call goes without.
 */
const globalForApi = globalThis as typeof globalThis & {
  __siumoraApi?: CommerceClient;
};

async function forwardedClientIp(): Promise<Record<string, string> | undefined> {
  const secret = process.env.CLIENT_IP_SECRET;
  if (!secret) return undefined;
  return clientIpHeaders(await headers(), secret);
}

/**
 * A published product the storefront had to leave out — live in the admin,
 * invisible to every shopper. Fingerprinted per product so Sentry raises
 * one issue each instead of one event per page render.
 */
function reportSkippedProduct({ handle, reason }: { handle: string; reason: string }): void {
  Sentry.captureMessage(`Product "${handle}" is hidden from the storefront: ${reason}`, {
    level: "warning",
    fingerprint: ["catalog-skipped-product", handle],
    tags: { area: "catalog", product: handle },
  });
}

export function api(): CommerceClient {
  return (globalForApi.__siumoraApi ??= createCommerceClient(process.env, {
    clientIpHeaders: forwardedClientIp,
    onSkippedProduct: reportSkippedProduct,
  }));
}
