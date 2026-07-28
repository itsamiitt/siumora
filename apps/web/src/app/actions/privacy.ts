"use server";

import { revalidatePath } from "next/cache";

import { ApiError } from "@siumora/sdk";

import { apiAs } from "@/lib/session";

/**
 * Data-principal rights, as server actions.
 *
 * The export travels through the server rather than the browser calling the API
 * directly, because the session token lives in an HTTP-only cookie and is meant
 * to stay there. The file is built here and handed to the client as a string it
 * can save.
 */

export interface ExportResult {
  ok: boolean;
  /** The export, already serialised. Saved by the browser, never rendered. */
  json?: string;
  message?: string;
}

export async function exportMyData(): Promise<ExportResult> {
  try {
    const data = await (await apiAs()).exportMyData();
    return { ok: true, json: JSON.stringify(data, null, 2) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { ok: false, message: "Sign in to download your data." };
    }
    return { ok: false, message: "Could not build the file. Try again shortly." };
  }
}

export interface ErasureResult {
  ok: boolean;
  erased?: boolean;
  /** Why it could not run yet, in words the person can act on. */
  pendingBecause?: string;
  resolveBy?: string;
  message?: string;
}

export async function requestErasure(): Promise<ErasureResult> {
  try {
    const result = await (await apiAs()).requestErasure();

    // The account is gone, so anything cached against it must go too.
    if (result.erased) revalidatePath("/account");

    return {
      ok: true,
      erased: result.erased,
      ...(result.pendingBecause ? { pendingBecause: result.pendingBecause } : {}),
      resolveBy: result.resolveBy,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { ok: false, message: "Sign in to make this request." };
    }
    return { ok: false, message: "Could not record the request. Try again shortly." };
  }
}
