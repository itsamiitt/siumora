import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IAuthModuleService, ICustomerModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { setAuthAppMetadataWorkflow } from "@medusajs/medusa/core-flows";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { normalisePhone } from "@siumora/core";

import { customerFromParams } from "../../../../../../lib/admin-customer";
import { loadCustomer, pgOf } from "../../../../../../lib/customer-signin";
import { auditAction, requireOperator } from "../../../../../../lib/operator-gate";
import { readSecurity, revokeAllSessions, setBlocked } from "../../../../../../modules/customer-session/data";
import { reassignOrders, type SqlClient as OwnershipSqlClient } from "../../../../../../modules/siumora-order/ownership";
import { mergeWishlists, type SqlClient as WishlistSqlClient } from "../../../../../../modules/wishlist/store";

/**
 * POST /admin/siumora/customers/:id/merge { intoCustomerId } — fold a
 * duplicate account into the one the person keeps (auth plan phase 3):
 * an old number's account into the new number's, typically.
 *
 * Moves the orders and the wishlist, points the duplicate's sign-in
 * identities at the kept account (so either number now signs in there),
 * ends the duplicate's sessions and marks it merged — blocked, with the
 * kept account's id on record — rather than deleting it: its row is what
 * the audit entry and any old order reference point to. Ops lead only.
 */
export const AUTHENTICATE = false;

const WISHLIST_KEY = "siumora_wishlist_id";

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "customers:admin");
  if (!operator) return;
  const source = await customerFromParams(req, res);
  if (!source) return;

  const rawTarget = (req.body as { intoCustomerId?: unknown } | undefined)?.intoCustomerId;
  const targetId = typeof rawTarget === "string" ? rawTarget.trim() : "";
  if (!/^cus_[A-Za-z0-9]{10,40}$/.test(targetId) || targetId === source.id) {
    res.status(400).json({ error: "invalid_request", message: "intoCustomerId: another customer's id." });
    return;
  }
  const target = await loadCustomer(req, targetId);
  if (!target) {
    res.status(404).json({ error: "not_found", message: "The account to merge into does not exist." });
    return;
  }
  const pg = pgOf(req);
  const [sourceState, targetState] = await Promise.all([readSecurity(pg, source.id), readSecurity(pg, target.id)]);
  if (sourceState.mergedInto) {
    res.status(409).json({ error: "already_merged", message: `Already merged into ${sourceState.mergedInto}.` });
    return;
  }
  if (targetState.mergedInto || targetState.blockedAt) {
    res.status(409).json({ error: "target_unavailable", message: "The account to merge into is blocked or merged." });
    return;
  }

  // ── Orders ──
  const orders = await reassignOrders(pg as unknown as OwnershipSqlClient, source.id, target.id);

  // ── Wishlist ──
  const customers = req.scope.resolve<ICustomerModuleService>(Modules.CUSTOMER);
  const [sourceFull, targetFull] = await Promise.all([
    customers.retrieveCustomer(source.id, { select: ["id", "metadata"] }),
    customers.retrieveCustomer(target.id, { select: ["id", "metadata"] }),
  ]);
  const sourceList = sourceFull.metadata?.[WISHLIST_KEY];
  const targetList = targetFull.metadata?.[WISHLIST_KEY];
  if (typeof sourceList === "string") {
    if (typeof targetList === "string") {
      await mergeWishlists(pg as unknown as WishlistSqlClient, sourceList, targetList);
    } else {
      await customers.updateCustomers(target.id, {
        metadata: { ...(targetFull.metadata ?? {}), [WISHLIST_KEY]: sourceList },
      });
    }
  }

  // ── Sign-in identities: the duplicate's number now opens the kept account.
  const auth = req.scope.resolve<IAuthModuleService>(Modules.AUTH);
  const identityIds = new Set<string>();
  const sourcePhone = normalisePhone(source.phone ?? "") as string | undefined;
  if (sourcePhone) {
    for (const provider of await auth.listProviderIdentities({ entity_id: sourcePhone, provider: "phone-otp" })) {
      if (provider.auth_identity_id) identityIds.add(provider.auth_identity_id);
    }
  }
  const google = sourceFull.metadata?.siumora_google_identity;
  if (typeof google === "string") identityIds.add(google);
  for (const identityId of identityIds) {
    const identity = await auth.retrieveAuthIdentity(identityId);
    if (identity.app_metadata?.customer_id !== source.id) continue;
    await setAuthAppMetadataWorkflow(req.scope).run({
      input: { authIdentityId: identityId, actorType: "customer", value: null },
    });
    await setAuthAppMetadataWorkflow(req.scope).run({
      input: { authIdentityId: identityId, actorType: "customer", value: target.id },
    });
  }

  // ── The duplicate itself: signed out and marked, not deleted. ──
  const now = new Date();
  const revoked = await revokeAllSessions(pg, { customerId: source.id, reason: "merged", now });
  await setBlocked(pg, {
    customerId: source.id,
    blocked: true,
    reason: `merged into ${target.id}`,
    by: operator.contact,
    now,
    mergedInto: target.id,
  });

  await auditAction(req, operator, "customer.merge", {
    subject: source.id,
    detail: { into: target.id, orders, identities: identityIds.size, revoked },
  });
  res.json({ ok: true, orders, identities: identityIds.size, revoked });
}
