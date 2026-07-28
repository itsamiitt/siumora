import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { TOTP_DIGITS, stepUpValid } from "@siumora/core";
import {
  markSessionStepUp,
  removeTotp,
  startTotpEnrolment,
  totpState,
  verifyTotpCode,
} from "@siumora/db";

import { audit, requireAdmin } from "../lib/auth.ts";

/**
 * Admin second factor.
 *
 * Deliberately not on the customer sign-in. A shopper who loses access to their
 * authenticator loses their order history, and the value of the account does not
 * justify that; an operator can move parcels, book money and erase people, and
 * theirs does.
 *
 * Enrolment is two steps — start, then confirm with a code — so an operator who
 * scans a code that does not work is not locked out by their own enrolment.
 * Nothing is enforced until confirmation.
 */

const codeSchema = z.object({
  // Long enough for a recovery code, which is what somebody types when the
  // phone is gone.
  code: z.string().trim().min(TOTP_DIGITS).max(24),
});

export async function registerTwoFactorRoutes(server: FastifyInstance) {
  /** Whether this operator has a second factor, and how many codes are left. */
  server.get("/admin/2fa", async (request, reply) => {
    const viewer = await requireAdmin(request, reply);
    if (!viewer) return;

    reply.header("Cache-Control", "no-store");
    return {
      ...(await totpState(server.db, viewer.customer.id)),
      // Whether *this session* is stepped up, which is the thing the dashboard
      // needs to decide between "set up" and "verify".
      steppedUp: stepUpValid(viewer.twoFactorAt),
      configured: server.totpKey !== undefined,
    };
  });

  /**
   * Begin enrolment.
   *
   * Returns the secret and the recovery codes once and never again. Storing
   * them anywhere they could be shown twice would make them a second copy of
   * the factor rather than a backup for it.
   */
  server.post("/admin/2fa/enrol", async (request, reply) => {
    const viewer = await requireAdmin(request, reply);
    if (!viewer) return;

    if (!server.totpKey) {
      // The secret is sealed with a key from the environment. Without one it
      // would be a plaintext column, which is worse than no second factor
      // because it looks like one.
      return reply.code(503).send({
        error: "not_configured",
        message:
          "TOTP_ENCRYPTION_KEY is not set, so a second factor cannot be stored safely.",
      });
    }

    const started = await startTotpEnrolment(
      server.db,
      viewer.customer.id,
      viewer.customer.phone,
      server.totpKey,
    );

    if ("alreadyEnrolled" in started) {
      // Never replaced silently: anyone with a live session could otherwise
      // swap the second factor for their own.
      return reply.code(409).send({
        error: "already_enrolled",
        message: "Remove the existing second factor before enrolling again.",
      });
    }

    reply.header("Cache-Control", "no-store");
    return started;
  });

  /** Finish enrolment by proving the app actually holds the secret. */
  server.post("/admin/2fa/confirm", async (request, reply) => {
    const viewer = await requireAdmin(request, reply);
    if (!viewer) return;
    if (!server.totpKey) return reply.code(503).send({ error: "not_configured" });

    const { code } = codeSchema.parse(request.body);
    const result = await verifyTotpCode(
      server.db,
      viewer.customer.id,
      code,
      server.totpKey,
      { confirming: true },
    );

    if (!result.ok) {
      return reply.code(400).send({ error: "invalid_code", reason: result.reason });
    }

    // Confirming steps this session up too — the operator has just proved it.
    await markSessionStepUp(server.db, viewer.sessionId);
    await audit(request, viewer, "auth.admin_signin", {
      subject: "2fa.enrolled",
    });

    reply.header("Cache-Control", "no-store");
    return { ok: true };
  });

  /** Step this session up. */
  server.post("/admin/2fa/verify", async (request, reply) => {
    const viewer = await requireAdmin(request, reply);
    if (!viewer) return;
    if (!server.totpKey) return reply.code(503).send({ error: "not_configured" });

    const { code } = codeSchema.parse(request.body);
    const result = await verifyTotpCode(
      server.db,
      viewer.customer.id,
      code,
      server.totpKey,
    );

    if (!result.ok) {
      return reply.code(400).send({ error: "invalid_code", reason: result.reason });
    }

    await markSessionStepUp(server.db, viewer.sessionId);
    await audit(request, viewer, "auth.admin_signin", {
      subject: result.usedRecoveryCode ? "2fa.recovery" : "2fa.verified",
    });

    reply.header("Cache-Control", "no-store");
    return { ok: true, usedRecoveryCode: result.usedRecoveryCode };
  });

  /**
   * Remove the second factor.
   *
   * Requires a current code, not merely a live session. Otherwise a stolen
   * session removes the factor and the theft is complete — which is precisely
   * what the factor was there to prevent.
   */
  server.delete("/admin/2fa", async (request, reply) => {
    const viewer = await requireAdmin(request, reply);
    if (!viewer) return;
    if (!server.totpKey) return reply.code(503).send({ error: "not_configured" });

    const { code } = codeSchema.parse(request.body);
    const result = await verifyTotpCode(
      server.db,
      viewer.customer.id,
      code,
      server.totpKey,
    );

    if (!result.ok) {
      return reply.code(400).send({ error: "invalid_code", reason: result.reason });
    }

    await removeTotp(server.db, viewer.customer.id);
    await audit(request, viewer, "auth.admin_signin", { subject: "2fa.removed" });

    reply.header("Cache-Control", "no-store");
    return { ok: true };
  });
}
