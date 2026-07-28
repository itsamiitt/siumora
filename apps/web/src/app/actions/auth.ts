"use server";

import { revalidatePath } from "next/cache";

import { normalisePhone } from "@siumora/core";
import { ApiError } from "@siumora/sdk";

import { api } from "@/lib/api";
import { apiAs, endSession, sessionToken, startSession } from "@/lib/session";

/**
 * Sign-in.
 *
 * The token never crosses into client JavaScript: `verifyCode` puts it straight
 * into an HTTP-only cookie and returns only what the form needs to render. A
 * token in a `useState` would be readable by any script on the page.
 */

export interface RequestCodeResult {
  ok: boolean;
  maskedPhone?: string;
  message?: string;
  /**
   * Present only where no WhatsApp/DLT sender is configured. The form shows it
   * with an explicit notice rather than pretending a message was sent.
   */
  developmentCode?: string;
  retryAfterSeconds?: number;
}

export async function requestCode(phone: string): Promise<RequestCodeResult> {
  // Checked here as well as in the API so an obvious typo does not cost a
  // network round trip — the API is still the one that decides.
  if (!normalisePhone(phone)) {
    return { ok: false, message: "Enter a 10-digit Indian mobile number." };
  }

  try {
    const issued = await api().requestOtp(phone);
    return {
      ok: true,
      maskedPhone: issued.maskedPhone,
      ...(issued.code ? { developmentCode: issued.code } : {}),
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        ok: false,
        message: error.message,
        ...(error.status === 429 ? { retryAfterSeconds: 60 } : {}),
      };
    }
    return { ok: false, message: "Could not send a code just now." };
  }
}

export interface VerifyCodeResult {
  ok: boolean;
  isAdmin?: boolean;
  claimedOrders?: number;
  message?: string;
}

export async function verifyCode(
  phone: string,
  code: string,
): Promise<VerifyCodeResult> {
  try {
    const session = await api().verifyOtp(phone, code);
    await startSession(session.token, session.expiresAt);

    // The header, the account page and the ops link all change once someone is
    // signed in, so the whole layout is stale.
    revalidatePath("/", "layout");

    return {
      ok: true,
      isAdmin: session.isAdmin,
      claimedOrders: session.claimedOrders,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof ApiError ? error.message : "Could not verify that code.",
    };
  }
}

export async function signOut(): Promise<void> {
  const token = await sessionToken();
  if (token) {
    try {
      await (await apiAs()).signOut();
    } catch {
      // The cookie is cleared regardless. A session the server could not be
      // told about will expire on its own; leaving the cookie in place would
      // look to the customer like sign-out simply did not work.
    }
  }

  await endSession();
  revalidatePath("/", "layout");
}

export async function signOutEverywhere(): Promise<{ ok: boolean; revoked: number }> {
  try {
    const result = await (await apiAs()).signOutEverywhere();
    await endSession();
    revalidatePath("/", "layout");
    return result;
  } catch {
    await endSession();
    revalidatePath("/", "layout");
    return { ok: false, revoked: 0 };
  }
}

export async function saveProfile(input: {
  name?: string;
  email?: string;
}): Promise<{ ok: boolean; message?: string }> {
  try {
    await (await apiAs()).updateProfile(input);
    revalidatePath("/account");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof ApiError ? error.message : "Could not save those details.",
    };
  }
}
