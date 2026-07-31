import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { EXPORT_SCOPE, RETENTION_NOTICE, UNATTRIBUTED_TABLES } from "@siumora/core";
import {
  eraseCustomer,
  exportCustomerData,
  openPrivacyRequest,
  openPrivacyRequests,
  setPrivacyRequestStatus,
} from "@siumora/db";

import { audit, requireCustomer, requirePermission } from "../lib/auth.ts";

/**
 * Data-principal rights (DPDP Act 2023, plan/11 §5).
 *
 * Access is immediate — the person is signed in, the data is theirs, and making
 * them wait thirty days for a file the database can produce in a second would
 * be theatre. Erasure is a request, because it cannot always be granted at
 * once: an order in transit still needs an address to arrive at.
 *
 * Every route here is scoped to the caller's own record. There is no endpoint
 * that exports somebody else, at any privilege level — an admin can see that a
 * request exists and complete it, which is what the deadline needs, and cannot
 * pull an arbitrary person's file.
 */

export async function registerPrivacyRoutes(server: FastifyInstance) {
  /**
   * Everything held about the signed-in person.
   *
   * Downloaded rather than rendered: it is a file to keep, and a page that
   * shows it is a page that can be shoulder-surfed.
   */
  server.get("/account/data", async (request, reply) => {
    const viewer = await requireCustomer(request, reply);
    if (!viewer) return;

    const data = await exportCustomerData(server.db, viewer.customer.id);
    if (!data) return reply.code(404).send({ error: "not_found" });

    reply.header("Cache-Control", "no-store");
    reply.header(
      "Content-Disposition",
      `attachment; filename="siumora-data-${data.generatedAt.slice(0, 10)}.json"`,
    );
    return { ...data, scope: EXPORT_SCOPE, notAttributed: UNATTRIBUTED_TABLES };
  });

  /** What is collected and what is kept. Public: a notice nobody can read is not one. */
  server.get("/privacy/scope", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=3600");
    return { scope: EXPORT_SCOPE, retained: RETENTION_NOTICE };
  });

  /**
   * Ask for erasure.
   *
   * Recorded and then attempted immediately. When every order has settled it
   * completes on the spot, which is the honest answer; when one has not, the
   * request stays open with the reason attached and an operator finishes it.
   */
  server.post("/account/erasure", async (request, reply) => {
    const viewer = await requireCustomer(request, reply);
    if (!viewer) return;

    const { request: record, existing } = await openPrivacyRequest(server.db, {
      customerId: viewer.customer.id,
      subjectPhone: viewer.customer.phone,
      kind: "erasure",
    });

    const result = await eraseCustomer(server.db, viewer.customer.id);

    if (result.erased) {
      await setPrivacyRequestStatus(server.db, record.id, "completed");
    } else if (result.reason) {
      // Left open, not refused: it will become possible when the parcels land.
      await setPrivacyRequestStatus(server.db, record.id, "acknowledged", {
        note: result.reason,
      });
    }

    reply.header("Cache-Control", "no-store");
    return {
      requestId: record.id,
      // A person who taps twice gets the original deadline, not a fresh one.
      alreadyOpen: existing,
      erased: result.erased,
      ...(result.reason ? { pendingBecause: result.reason } : {}),
      resolveBy: record.resolveBy,
      retained: RETENTION_NOTICE,
    };
  });

  /** The queue, with the deadline attached. Reading it is the point. */
  server.get("/admin/privacy-requests", async (request, reply) => {
    const viewer = await requirePermission(request, reply, "privacy:write");
    if (!viewer) return;

    reply.header("Cache-Control", "no-store");
    return { requests: await openPrivacyRequests(server.db) };
  });

  /**
   * Run an erasure an operator has judged ready.
   *
   * Runs the same check as the customer path rather than trusting the operator:
   * an override that erases a live order's address strands a parcel, and the
   * person who would have to sort that out is the one clicking the button.
   */
  server.post("/admin/privacy-requests/:id/complete", async (request, reply) => {
    const viewer = await requirePermission(request, reply, "privacy:write");
    if (!viewer) return;

    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const [record] = await openPrivacyRequests(server.db).then((rows) =>
      rows.filter((row) => row.id === id),
    );

    if (!record) return reply.code(404).send({ error: "not_found" });
    if (!record.customerId) {
      return reply.code(409).send({
        error: "no_subject",
        message: "The account behind this request is already gone.",
      });
    }

    const result = await eraseCustomer(server.db, record.customerId);

    if (!result.erased) {
      await setPrivacyRequestStatus(server.db, record.id, "acknowledged", {
        ...(result.reason ? { note: result.reason } : {}),
      });
      return reply.code(409).send({ error: "not_yet", message: result.reason });
    }

    await setPrivacyRequestStatus(server.db, record.id, "completed");
    // The one irreversible action in the system. A record of who ran it is the
    // difference between an erasure and a disappearance.
    await audit(request, viewer, "privacy.erase", {
      subject: record.id,
      detail: {
        ordersRedacted: result.ordersRedacted,
        notificationsRedacted: result.notificationsRedacted,
        preferencesDeleted: result.preferencesDeleted,
      },
    });

    reply.header("Cache-Control", "no-store");
    return result;
  });
}
