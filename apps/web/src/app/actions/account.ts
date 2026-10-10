"use server";

import { revalidatePath } from "next/cache";

import { ApiError } from "@siumora/sdk";

import { apiAs } from "@/lib/session";

/**
 * The account pages' writes (auth plan phase 2). Every one runs on the
 * server with the session cookie; refusals come back with their code so the
 * page can react — `step_up_required` opens the confirm-it's-you sheet.
 */

export interface ActionResult {
  ok: boolean;
  message?: string;
  error?: string;
}

function refusal(error: unknown, fallback: string): ActionResult {
  return {
    ok: false,
    error: error instanceof ApiError ? error.code : "error",
    message: error instanceof ApiError ? error.message : fallback,
  };
}

/** "Yes, these are mine" — claim guest orders placed on this phone. */
export async function claimOrders(numbers: string[]): Promise<ActionResult & { claimed?: number }> {
  try {
    const result = await (await apiAs()).claimOrders(numbers);
    revalidatePath("/account");
    return { ok: true, claimed: result.claimed };
  } catch (error) {
    return refusal(error, "Could not add those orders.");
  }
}

export async function deleteAddress(id: string): Promise<ActionResult> {
  try {
    await (await apiAs()).deleteAddress(id);
    revalidatePath("/account/addresses");
    return { ok: true };
  } catch (error) {
    return refusal(error, "Could not remove that address.");
  }
}

/**
 * Move the account to a new number. `code` is the one sent to the NEW
 * number; the API also wants a fresh step-up on the current one.
 */
export async function changePhone(
  phone: string,
  code: string,
): Promise<ActionResult & { maskedPhone?: string; signedOutDevices?: number }> {
  try {
    const result = await (await apiAs()).changePhone(phone, code);
    revalidatePath("/", "layout");
    return { ok: true, maskedPhone: result.maskedPhone, signedOutDevices: result.signedOutDevices };
  } catch (error) {
    return refusal(error, "Could not change your number.");
  }
}

/** Send a verification link to the account's email (phase 4). */
export async function requestEmailVerification(): Promise<ActionResult & { alreadyVerified?: boolean }> {
  try {
    const result = await (await apiAs()).requestEmailVerification();
    return { ok: true, alreadyVerified: result.alreadyVerified };
  } catch (error) {
    return refusal(error, "Could not send the link just now.");
  }
}

/** The link's landing page confirms here — needs no session. */
export async function verifyEmail(token: string): Promise<ActionResult> {
  try {
    await (await apiAs()).verifyEmail(token);
    revalidatePath("/account/profile");
    return { ok: true };
  } catch (error) {
    return refusal(error, "That link didn't work. Send a new one from your profile.");
  }
}
