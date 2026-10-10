import "server-only";

import { cookies } from "next/headers";

import { api } from "./api";
import { AB_COOKIE, parseBucket, signInVariant, type SignInVariant } from "./experiments";

/**
 * What a sign-in form should offer this browser (auth plan phase 4): phone
 * always, and "Continue with Google" when it is switched on AND this
 * browser's A/B bucket falls in the Google share. A failed read is
 * phone-only — sign-in must never wait on an experiment.
 */
export async function signInOptions(
  next: string,
): Promise<{ variant?: SignInVariant; googleHref?: string }> {
  try {
    const methods = await api().getSignInMethods();
    // No experiment running: no arm to report.
    if (!methods.google) return {};
    const bucket = parseBucket((await cookies()).get(AB_COOKIE)?.value);
    const variant = signInVariant(bucket, methods);
    return variant === "google"
      ? { variant, googleHref: `/auth/google/start?next=${encodeURIComponent(next)}` }
      : { variant };
  } catch {
    return {};
  }
}
