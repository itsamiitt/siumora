import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  ADMIN_SESSION_TTL_SECONDS,
  OTP_LENGTH,
  OTP_SEND_WINDOW_SECONDS,
  SESSION_TTL_SECONDS,
  evaluateOtpRequest,
  isAdminPhone,
  maskPhone,
  normalisePhone,
} from "@siumora/core";
import {
  claimGuestOrders,
  createOtpChallenge,
  createSession,
  eq,
  otpSendsFromIp,
  recentOtpSends,
  revokeAllSessions,
  revokeSession,
  schema,
  upsertCustomer,
  verifyOtpChallenge,
} from "@siumora/db";

import { requireCustomer, resolveViewer, tokenFrom } from "../lib/auth.ts";

/**
 * Phone sign-in.
 *
 * Nothing here confirms whether a number is already a customer, at either step.
 * A response that differed would turn this endpoint into a way to test whether
 * a given person shops here — and the list of numbers to test is the leaked
 * database everyone already has.
 */

/** Codes one origin may request in the window, across all numbers. */
const OTP_MAX_SENDS_PER_IP = 20;

const phoneSchema = z.object({ phone: z.string().min(6).max(20) });

const verifySchema = z.object({
  phone: z.string().min(6).max(20),
  code: z.string().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`)),
});

export async function registerAuthRoutes(server: FastifyInstance) {
  /**
   * Issue a code.
   *
   * Returns the same shape whether or not the number has an account. The only
   * thing that changes the reply is the throttle.
   */
  server.post("/auth/otp", async (request, reply) => {
    const body = phoneSchema.parse(request.body);
    const phone = normalisePhone(body.phone);

    if (!phone) {
      return reply.code(400).send({
        error: "invalid_phone",
        message: "Enter a 10-digit Indian mobile number.",
      });
    }

    if (!server.otp && server.config.otpEcho !== true) {
      // No approved messaging channel and no explicit development echo.
      // Refusing is the honest answer: issuing a code nobody can receive would
      // look like sign-in working and fail at the second step every time.
      return reply.code(503).send({
        error: "sign_in_unavailable",
        message: "Sign-in is not connected in this environment yet.",
      });
    }

    const now = new Date();

    const fromIp = await otpSendsFromIp(
      server.db,
      request.ip,
      OTP_SEND_WINDOW_SECONDS,
      now,
    );
    if (fromIp >= OTP_MAX_SENDS_PER_IP) {
      reply.header("Retry-After", String(OTP_SEND_WINDOW_SECONDS));
      return reply.code(429).send({
        error: "rate_limited",
        message: "Too many sign-in attempts from this connection.",
        retryAfterSeconds: OTP_SEND_WINDOW_SECONDS,
      });
    }

    const sentAt = await recentOtpSends(
      server.db,
      phone,
      OTP_SEND_WINDOW_SECONDS,
      now,
    );
    const decision = evaluateOtpRequest({ now, sentAt });
    if (!decision.allowed) {
      reply.header("Retry-After", String(decision.retryAfterSeconds));
      return reply.code(429).send({
        error: "rate_limited",
        message: decision.reason,
        retryAfterSeconds: decision.retryAfterSeconds,
      });
    }

    const issued = await createOtpChallenge(server.db, {
      phone,
      ip: request.ip,
      now,
    });

    // Synchronous, in the request — the outbox polls every fifteen seconds
    // and nobody waits fifteen seconds at a sign-in form. The channel was
    // resolved at boot: WhatsApp when its template is approved, else DLT SMS.
    let delivery: "sent" | "send_failed" | "not_configured" = "not_configured";
    if (server.otp) {
      const outcome = await server.otp.send(phone, issued.code);
      delivery = outcome.ok ? "sent" : "send_failed";
      if (!outcome.ok) {
        // The caller can retry; the code stays valid. Loud in the log because
        // a failing OTP channel is every sign-in on the site.
        request.log?.error?.(
          { channel: server.otp.channel, error: outcome.error },
          "otp send failed",
        );
      }
    }

    return {
      ok: true,
      maskedPhone: maskPhone(phone),
      expiresAt: issued.expiresAt.toISOString(),
      delivery,
      // Echoed only under the explicit development flag, never merely because
      // a provider happens to be missing.
      ...(server.config.otpEcho === true ? { code: issued.code } : {}),
    };
  });

  /** Exchange a code for a session. */
  server.post("/auth/verify", async (request, reply) => {
    const body = verifySchema.parse(request.body);
    const phone = normalisePhone(body.phone);

    if (!phone) {
      return reply.code(400).send({
        error: "invalid_phone",
        message: "Enter a 10-digit Indian mobile number.",
      });
    }

    const result = await verifyOtpChallenge(server.db, {
      phone,
      code: body.code,
    });

    if (result.status !== "verified") {
      // One message for every failure mode. Distinguishing "expired" from
      // "wrong" tells an attacker which half of the problem to work on.
      const retryable = result.status === "mismatch";
      return reply.code(retryable ? 401 : 410).send({
        error: retryable ? "wrong_code" : "code_unusable",
        message: retryable
          ? "That code is not right."
          : "That code has expired. Ask for a new one.",
        ...(retryable ? { attemptsRemaining: result.attemptsRemaining } : {}),
      });
    }

    const customer = await upsertCustomer(server.db, phone);
    const admin = isAdminPhone(phone, server.adminPhones);

    // Orders placed as a guest on this number become theirs. Without this the
    // account page is empty for someone who has been buying here for months.
    const claimed = await claimGuestOrders(server.db, customer.id, phone);

    const session = await createSession(server.db, {
      customerId: customer.id,
      // An operator session can read every customer's address, so it is short.
      ttlSeconds: admin ? ADMIN_SESSION_TTL_SECONDS : SESSION_TTL_SECONDS,
      userAgent: String(request.headers["user-agent"] ?? ""),
    });

    return {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      isAdmin: admin,
      claimedOrders: claimed,
      customer: {
        id: customer.id,
        phone: customer.phone,
        maskedPhone: maskPhone(customer.phone),
        name: customer.name,
        email: customer.email,
      },
    };
  });

  /** Who is signed in. Anonymous is a normal answer, not an error. */
  server.get("/auth/session", async (request, reply) => {
    const viewer = await resolveViewer(request);
    reply.header("Cache-Control", "no-store");

    if (!viewer) return { signedIn: false as const };

    return {
      signedIn: true as const,
      isAdmin: viewer.isAdmin,
      customer: {
        id: viewer.customer.id,
        phone: viewer.customer.phone,
        maskedPhone: maskPhone(viewer.customer.phone),
        name: viewer.customer.name,
        email: viewer.customer.email,
      },
    };
  });

  server.post("/auth/signout", async (request, reply) => {
    const token = tokenFrom(request);
    if (token) await revokeSession(server.db, token);
    // Idempotent: signing out twice, or without a session, is a success.
    return reply.code(200).send({ ok: true });
  });

  /** Sign out of every device — what someone does after losing a phone. */
  server.post("/auth/signout-everywhere", async (request, reply) => {
    const viewer = await requireCustomer(request, reply);
    if (!viewer) return;

    const revoked = await revokeAllSessions(server.db, viewer.customer.id);
    return { ok: true, revoked };
  });

  server.patch("/auth/profile", async (request, reply) => {
    const viewer = await requireCustomer(request, reply);
    if (!viewer) return;

    const body = z
      .object({
        name: z.string().max(120).optional(),
        email: z.email().max(200).optional(),
      })
      .parse(request.body);

    const [updated] = await server.db
      .update(schema.customers)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
      })
      .where(eq(schema.customers.id, viewer.customer.id))
      .returning();

    return {
      ok: true,
      customer: {
        id: updated!.id,
        phone: updated!.phone,
        maskedPhone: maskPhone(updated!.phone),
        name: updated!.name,
        email: updated!.email,
      },
    };
  });
}
