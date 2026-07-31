import "server-only";

import { SiumoraClient } from "@siumora/sdk";

import { createCommerceClient } from "./commerce-backend";

/**
 * The commerce API client, shared across a server process.
 *
 * Built once and cached: constructing one per request is cheap but the
 * repeated environment validation is noise, and a single instance makes the
 * connection reuse obvious.
 *
 * COMMERCE_BACKEND selects the transport (see commerce-backend.ts); a bad or
 * premature value throws here, at construction, on the first api() call.
 */
const globalForApi = globalThis as typeof globalThis & {
  __siumoraApi?: SiumoraClient;
};

export function api(): SiumoraClient {
  return (globalForApi.__siumoraApi ??= createCommerceClient());
}
