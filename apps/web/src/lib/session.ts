import "server-only";

import { cookies } from "next/headers";

import type { AccountCustomer, SiumoraClient } from "@siumora/sdk";

import { api } from "./api";

/**
 * The signed-in shopper.
 *
 * The session token lives in an HTTP-only cookie and never reaches client
 * JavaScript, so an injected script cannot read it and a cross-site request
 * cannot be made to carry it. Everything that needs the token therefore runs on
 * the server: a Server Action, a Route Handler, or a page render.
 */

const SESSION_COOKIE = "siumora_session";

/** Order numbers to their access keys, for orders placed before signing in. */
const ORDER_KEYS_COOKIE = "siumora_order_keys";

/** Access keys kept in the cookie. Enough to cover a browsing session. */
const MAX_REMEMBERED_ORDERS = 20;

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** The API client, carrying the session token when there is one. */
export async function apiAs(): Promise<SiumoraClient> {
  const token = await sessionToken();
  return token ? api().withToken(token) : api();
}

export interface Viewer {
  readonly customer: AccountCustomer;
  readonly isAdmin: boolean;
}

/**
 * Who is signed in, or `undefined`.
 *
 * A failed or expired session reads as signed out rather than throwing: an API
 * hiccup should show a sign-in prompt, not an error page.
 */
export async function currentViewer(): Promise<Viewer | undefined> {
  const token = await sessionToken();
  if (!token) return undefined;

  try {
    const session = await api().withToken(token).getSession();
    if (!session.signedIn) return undefined;
    return { customer: session.customer, isAdmin: session.isAdmin };
  } catch {
    return undefined;
  }
}

/** Only callable from a Server Action or Route Handler. */
export async function startSession(token: string, expiresAt: string) {
  const store = await cookies();
  const maxAge = Math.max(
    60,
    Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
  );

  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

async function readOrderKeys(): Promise<Record<string, string>> {
  const raw = (await cookies()).get(ORDER_KEYS_COOKIE)?.value;
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    // A malformed cookie is not worth an error page; it only means the guest
    // will need their order link instead.
    return {};
  }
}

/** The access key for a guest order, if this browser placed it. */
export async function orderAccessKey(number: string): Promise<string | undefined> {
  return (await readOrderKeys())[number];
}

/**
 * Remember the key handed back at checkout.
 *
 * Without it a guest could not reopen their own order — the API refuses to
 * serve one on the order number alone, because the numbers are a sequence
 * anybody could walk.
 */
export async function rememberOrderKey(number: string, accessKey: string) {
  const existing = await readOrderKeys();
  const entries = [
    [number, accessKey] as const,
    ...Object.entries(existing).filter(([key]) => key !== number),
  ].slice(0, MAX_REMEMBERED_ORDERS);

  (await cookies()).set(ORDER_KEYS_COOKIE, JSON.stringify(Object.fromEntries(entries)), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
}
