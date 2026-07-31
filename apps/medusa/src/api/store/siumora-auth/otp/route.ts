/**
 * POST /store/siumora-auth/otp — request a sign-in code.
 *
 * The verify step uses Medusa's built-in auth route
 * (POST /auth/customer/phone-otp), which mints the JWT. The request step
 * cannot: the built-in route can only answer 200 {location} for a
 * non-token outcome, and the storefront needs the Fastify-shaped payload —
 * maskedPhone, expiresAt, delivery, and (under OTP_ECHO in development) the
 * code itself. This route calls the same provider through the auth module
 * and surfaces that payload, with the same status mapping as
 * apps/api/src/routes/auth.ts.
 *
 * Store routes sit behind Medusa's publishable-key middleware, so callers
 * send x-publishable-api-key like any other /store request.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IAuthModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

import type { PhoneOtpAuthenticationResponse } from "../../../../modules/phone-auth/service.ts";

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";

  // Same shape gate as the Fastify phoneSchema (min 6, max 20) — anything
  // else is refused before the provider spends work on it.
  if (phone.length < 6 || phone.length > 20) {
    res.status(400).json({
      error: "invalid_phone",
      message: "Enter a 10-digit Indian mobile number.",
    });
    return;
  }

  const auth = req.scope.resolve<IAuthModuleService>(Modules.AUTH);
  const result = (await auth.authenticate("phone-otp", {
    url: req.url,
    headers: req.headers as Record<string, string>,
    query: (req.query ?? {}) as Record<string, string>,
    body: { phone },
    protocol: req.protocol,
  })) as PhoneOtpAuthenticationResponse;

  // Challenge issued: answer in the Fastify contract's shape. The code field
  // exists only when the provider runs under the explicit OTP_ECHO flag.
  if (result.success && result.otp) {
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
      const retryAfterSeconds = result.retryAfterSeconds ?? 60;
      res.header("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        error: "rate_limited",
        message: result.error,
        retryAfterSeconds,
      });
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
