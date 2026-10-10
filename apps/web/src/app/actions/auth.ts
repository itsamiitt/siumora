"use server";

import { revalidatePath } from "next/cache";

import { normalisePhone } from "@siumora/core";
import { ApiError, type DeviceSession, type OtpChannel } from "@siumora/sdk";

import { api } from "@/lib/api";
import { apiAs, currentViewer, endSession, sessionToken, startSession } from "@/lib/session";

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
  /** Machine-readable refusal, for the funnel event and the challenge reset. */
  error?: string;
  /**
   * Present only where no WhatsApp/DLT sender is configured. The form shows it
   * with an explicit notice rather than pretending a message was sent.
   */
  developmentCode?: string;
  retryAfterSeconds?: number;
  delivery?: "sent" | "send_failed" | "not_configured";
  /** Which channel the code went out on. */
  channel?: OtpChannel;
  /** Every channel the backend can send on — "Send by SMS instead" needs sms. */
  channels?: OtpChannel[];
}

export async function requestCode(
  phone: string,
  options: { channel?: OtpChannel; turnstileToken?: string } = {},
): Promise<RequestCodeResult> {
  // Checked here as well as in the API so an obvious typo does not cost a
  // network round trip — the API is still the one that decides.
  if (!normalisePhone(phone)) {
    return { ok: false, error: "invalid_phone", message: "Enter a 10-digit Indian mobile number." };
  }

  try {
    const issued = await api().requestOtp(phone, options);
    return {
      ok: true,
      maskedPhone: issued.maskedPhone,
      delivery: issued.delivery,
      ...(issued.channel ? { channel: issued.channel } : {}),
      ...(issued.channels ? { channels: issued.channels } : {}),
      ...(issued.code ? { developmentCode: issued.code } : {}),
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        ok: false,
        error: error.code,
        message: error.message,
        ...(error.status === 429 ? { retryAfterSeconds: 60 } : {}),
      };
    }
    return { ok: false, error: "error", message: "Could not send a code just now." };
  }
}

export interface VerifyCodeResult {
  ok: boolean;
  isAdmin?: boolean;
  claimedOrders?: number;
  message?: string;
  error?: string;
  attemptsRemaining?: number;
}

export async function verifyCode(phone: string, code: string): Promise<VerifyCodeResult> {
  try {
    const session = await api().verifyOtp(phone, code);
    // Operator sessions are a fixed 12 hours; a customer's rolls (Medusa).
    await startSession(session.token, session.expiresAt, { rolling: !session.isAdmin });

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
      error: error instanceof ApiError ? error.code : "error",
      message: error instanceof ApiError ? error.message : "Could not verify that code.",
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
}): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    await (await apiAs()).updateProfile(input);
    revalidatePath("/account");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof ApiError ? error.code : "error",
      message:
        error instanceof ApiError ? error.message : "Could not save those details.",
    };
  }
}

// ── Devices (account → Security) ─────────────────────────────────────────

export async function listDevices(): Promise<{ ok: boolean; sessions: DeviceSession[]; message?: string }> {
  try {
    return { ok: true, sessions: await (await apiAs()).listSessions() };
  } catch (error) {
    return {
      ok: false,
      sessions: [],
      message: error instanceof ApiError ? error.message : "Could not load your devices.",
    };
  }
}

export async function revokeDevice(id: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const result = await (await apiAs()).revokeSession(id);
    if (result.current) {
      // Signing this very device out from the list is a sign-out.
      await endSession();
      revalidatePath("/", "layout");
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : "Could not sign that device out." };
  }
}

// ── Step-up (StepUpGate) ─────────────────────────────────────────────────

/**
 * Send a code to the signed-in account's own number. The number is read on
 * the server from the session, never taken from the browser: a step-up
 * proves the account holder is present, so it cannot target another phone.
 */
export async function requestStepUpCode(
  options: { channel?: OtpChannel; turnstileToken?: string } = {},
): Promise<RequestCodeResult> {
  const viewer = await currentViewer();
  if (!viewer) return { ok: false, error: "not_signed_in", message: "Sign in to continue." };
  return requestCode(viewer.customer.phone, options);
}

export async function confirmStepUp(code: string): Promise<VerifyCodeResult> {
  try {
    await (await apiAs()).stepUp(code);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof ApiError ? error.code : "error",
      message: error instanceof ApiError ? error.message : "Could not verify that code.",
    };
  }
}
