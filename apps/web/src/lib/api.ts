import "server-only";

import { createClient, SiumoraClient } from "@siumora/sdk";

/**
 * The commerce API client, shared across a server process.
 *
 * Built once and cached: constructing one per request is cheap but the
 * repeated environment validation is noise, and a single instance makes the
 * connection reuse obvious.
 */
const globalForApi = globalThis as typeof globalThis & {
  __siumoraApi?: SiumoraClient;
};

export function api(): SiumoraClient {
  return (globalForApi.__siumoraApi ??= createClient());
}
