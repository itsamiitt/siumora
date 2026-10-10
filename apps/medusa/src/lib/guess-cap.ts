import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { phoneKey } from "../modules/customer-session/session";
import { underCap } from "./counters";
import { eventSecret } from "./customer-signin";
import { sharedCounters } from "./redis";

/**
 * Code guesses per NUMBER, across every IP (security review). The provider
 * locks a code after its wrong-guess limit, but its counter is a
 * read-modify-write on JSON metadata: a burst of parallel guesses from many
 * addresses could each read the same count. This cap is an atomic Redis
 * counter in front of it — 10 guesses per number per 15 minutes, whatever
 * the route (sign-in, step-up, phone change) — so the race cannot buy more
 * than a handful of extra tries.
 */
export const GUESSES_PER_NUMBER = 10;
const WINDOW_MS = 15 * 60_000;

export async function withinGuessCap(
  req: MedusaRequest,
  res: MedusaResponse,
  phone: string,
): Promise<boolean> {
  const decision = await underCap(
    sharedCounters(),
    `otp:guess:${phoneKey(phone, eventSecret())}`,
    GUESSES_PER_NUMBER,
    WINDOW_MS,
  );
  if (decision.allowed) return true;
  res.header("Retry-After", String(decision.retryAfterSeconds));
  res.status(429).json({
    error: "rate_limited",
    message: "Too many tries for this number. Wait a few minutes and ask for a new code.",
    retryAfterSeconds: decision.retryAfterSeconds,
  });
  return false;
}
