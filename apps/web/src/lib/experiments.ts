/**
 * The sign-in A/B test (auth plan phase 4): Google sign-in shown to a share
 * of shoppers, phone-only to the rest, judged on checkout completion — not
 * on clicks on the Google button, which would only measure curiosity.
 *
 * Each browser gets a stable bucket 0–99 in a cookie (set by proxy.ts on
 * its first request). The variant is derived from the bucket and the
 * current share, so moving the share from 50% to 80% keeps everyone in
 * buckets 0–49 where they were and only moves 50–79 — nobody flips back
 * and forth between visits.
 *
 * No `server-only`: pure, and runnable under node --test.
 */

export const AB_COOKIE = "siumora_ab";
export const AB_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

export type SignInVariant = "google" | "phone";

export function parseBucket(value: string | undefined): number | undefined {
  if (!value || !/^\d{1,2}$/.test(value)) return undefined;
  const bucket = Number(value);
  return bucket >= 0 && bucket <= 99 ? bucket : undefined;
}

export function newBucket(random: () => number = Math.random): number {
  return Math.min(99, Math.floor(random() * 100));
}

export function signInVariant(
  bucket: number | undefined,
  methods: { google: boolean; googlePercent: number },
): SignInVariant {
  if (!methods.google || bucket === undefined) return "phone";
  return bucket < methods.googlePercent ? "google" : "phone";
}
