/**
 * POST /store/siumora-auth/otp — request a sign-in code.
 *
 * The code itself is issued by the phone-otp auth provider (per-number
 * cooldown, codes per window, TTL — core's OtpPolicy from settings). This
 * route puts the abuse controls that need more than one number in view in
 * front of it (auth plan phase 1), cheapest first:
 *
 *   1. Turnstile, when TURNSTILE_SECRET_KEY is set (lib/turnstile.ts).
 *   2. Codes per origin per hour, across all numbers — the Fastify
 *      OTP_MAX_SENDS_PER_IP (setting otp_max_sends_per_ip_hour).
 *   3. Codes per number per day (otp_max_sends_per_day).
 *   4. The site's daily SMS budget (otp_daily_sms_cap): once spent, the
 *      provider sends WhatsApp only — sign-in keeps working where WhatsApp
 *      does, and an SMS-pumping attack stops costing money.
 *
 * The response keeps the Fastify /auth/otp envelope (maskedPhone,
 * expiresAt, delivery, and the code only under OTP_ECHO in development)
 * plus `channel` and `channels`, so the storefront can say "sent on
 * WhatsApp" and offer "Send by SMS instead". Like every other step, nothing
 * here reveals whether the number already has an account.
 *
 * Store routes sit behind Medusa's publishable-key middleware, so callers
 * send x-publishable-api-key like any other /store request.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IAuthModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { normalisePhone } from "@siumora/core";

import { underCap } from "../../../../lib/counters";
import { eventSecret, logAuthEvent, pgOf } from "../../../../lib/customer-signin";
import { sharedCounters } from "../../../../lib/redis";
import { verifyTurnstile } from "../../../../lib/turnstile";
import { phoneKey } from "../../../../modules/customer-session/session";
import type { PhoneOtpAuthenticationResponse } from "../../../../modules/phone-auth/service";
import { settingsCache } from "../../../../modules/settings/cache";
import { readSettings, type SqlClient as SettingsSqlClient } from "../../../../modules/settings/read";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function refuseRateLimited(res: MedusaResponse, message: string, retryAfterSeconds: number): void {
  res.header("Retry-After", String(retryAfterSeconds));
  res.status(429).json({ error: "rate_limited", message, retryAfterSeconds });
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawPhone = typeof body.phone === "string" ? body.phone.trim() : "";

  // Same shape gate as the Fastify phoneSchema (min 6, max 20) — anything
  // else is refused before the provider spends work on it.
  const phone = rawPhone.length >= 6 && rawPhone.length <= 20 ? normalisePhone(rawPhone) : undefined;
  if (!phone) {
    res.status(400).json({
      error: "invalid_phone",
      message: "Enter a 10-digit Indian mobile number.",
    });
    return;
  }
  const channel = body.channel === "sms" || body.channel === "whatsapp" ? body.channel : undefined;

  const turnstile = await verifyTurnstile(body.turnstileToken, req.ip, process.env, fetch, (error) =>
    console.error("turnstile unreachable, failing open:", error instanceof Error ? error.message : error),
  );
  if (!turnstile.ok) {
    await logAuthEvent(req, { type: "turnstile_failed", detail: { reason: turnstile.reason } }, phone);
    res.status(400).json({
      error: "challenge_failed",
      message: "Please complete the check and try again.",
    });
    return;
  }

  const settings = await settingsCache(() =>
    readSettings(pgOf(req) as unknown as SettingsSqlClient),
  ).get();
  const counters = sharedCounters();
  // The exact address, as the Fastify cap keys it — not the /24 the event
  // log keeps. Indian mobile carriers put many shoppers behind one CGNAT
  // block, and a cap per /24 would lock a whole neighbourhood out.
  const origin = req.ip ?? "unknown";

  const perIp = await underCap(counters, `otp:ip:${origin}`, settings.otpMaxSendsPerIpHour, HOUR_MS);
  if (!perIp.allowed) {
    await logAuthEvent(req, { type: "otp_rate_limited", detail: { cap: "ip_hour" } }, phone);
    refuseRateLimited(res, "Too many sign-in attempts from this connection.", perIp.retryAfterSeconds);
    return;
  }

  const numberKey = phoneKey(phone, eventSecret());
  const perDay = await underCap(counters, `otp:phone:${numberKey}`, settings.otpMaxSendsPerDay, DAY_MS);
  if (!perDay.allowed) {
    await logAuthEvent(req, { type: "otp_rate_limited", detail: { cap: "phone_day" } }, phone);
    refuseRateLimited(
      res,
      "Too many codes sent to this number today. Try again tomorrow.",
      perDay.retryAfterSeconds,
    );
    return;
  }

  // The SMS budget is counted per send that could go by SMS. Over budget,
  // the provider simply drops SMS from its channels for this send.
  const smsBudget = await underCap(counters, "otp:sms:day", settings.otpDailySmsCap, DAY_MS);

  const auth = req.scope.resolve<IAuthModuleService>(Modules.AUTH);
  const result = (await auth.authenticate("phone-otp", {
    url: "/store/siumora-auth/otp",
    headers: req.headers as Record<string, string>,
    query: (req.query ?? {}) as Record<string, string>,
    body: { phone, ...(channel ? { channel } : {}), allowSms: smsBudget.allowed ? "true" : "false" },
    protocol: req.protocol,
  })) as PhoneOtpAuthenticationResponse;

  // Challenge issued: answer in the Fastify contract's shape. The code field
  // exists only when the provider runs under the explicit OTP_ECHO flag.
  if (result.success && result.otp) {
    const sent = result.otp.delivery === "sent";
    await logAuthEvent(
      req,
      {
        type: result.otp.delivery === "send_failed" ? "otp_send_failed" : sent ? "otp_sent" : "otp_requested",
        channel: result.otp.channel ?? null,
        ...(channel ? { detail: { asked: channel, smsBudget: smsBudget.allowed } } : {}),
      },
      phone,
    );
    res.status(200).json({ ok: true, ...result.otp });
    return;
  }

  switch (result.errorCode) {
    case "invalid_phone":
      res.status(400).json({ error: "invalid_phone", message: result.error });
      return;
    case "sign_in_unavailable":
      res.status(503).json({
        error: "sign_in_unavailable",
        message: result.error,
      });
      return;
    case "rate_limited": {
      await logAuthEvent(req, { type: "otp_rate_limited", detail: { cap: "phone_window" } }, phone);
      refuseRateLimited(res, result.error ?? "Too many codes.", result.retryAfterSeconds ?? 60);
      return;
    }
    default:
      // Unknown provider failure (metadata write, module error). Not a 5xx
      // masquerade: the message is already customer-safe.
      res.status(400).json({
        error: "auth_error",
        message: result.error ?? "Sign-in failed.",
      });
  }
}
