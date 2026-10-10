/**
 * POST /store/siumora/me/wishlist { wishlistId? } — tie this browser's
 * wishlist to the signed-in account (auth plan phase 2, plan/13 S06).
 *
 * Wishlists stay keyed by the opaque uuid the storefront keeps in its
 * cookie (they work signed out); the account remembers its own list's id in
 * customer metadata. On sign-in:
 *
 * - the account has no list yet → this browser's list becomes the account's;
 * - the account has one → this browser's pieces are folded into it, and the
 *   storefront switches its cookie to the account's id.
 *
 * Answers { wishlistId } — the id the browser should hold from now on, or
 * null when neither side has a list. A list on a new device therefore shows
 * up the moment its owner signs in there.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { ICustomerModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

import { requireSession } from "../../../../../lib/customer-guard";
import { pgOf } from "../../../../../lib/customer-signin";
import { mergeWishlists, type SqlClient } from "../../../../../modules/wishlist/store";
import { isWellFormedWishlistId } from "../../../../../modules/wishlist/wishlist";

const METADATA_KEY = "siumora_wishlist_id";

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const session = requireSession(req, res);
  if (!session) return;

  const raw = (req.body as { wishlistId?: unknown } | undefined)?.wishlistId;
  if (raw !== undefined && raw !== null && (typeof raw !== "string" || !isWellFormedWishlistId(raw))) {
    res.status(400).json({ error: "invalid_request", message: "wishlistId: expected a uuid" });
    return;
  }
  const browserId = typeof raw === "string" ? raw : undefined;

  const customers = req.scope.resolve<ICustomerModuleService>(Modules.CUSTOMER);
  const customer = await customers.retrieveCustomer(session.customerId, { select: ["id", "metadata"] });
  const metadata = (customer.metadata ?? {}) as Record<string, unknown>;
  const stored = typeof metadata[METADATA_KEY] === "string" ? (metadata[METADATA_KEY] as string) : undefined;
  const accountId = stored && isWellFormedWishlistId(stored) ? stored : undefined;

  if (!accountId) {
    if (browserId) {
      await customers.updateCustomers(session.customerId, {
        metadata: { ...metadata, [METADATA_KEY]: browserId },
      });
    }
    res.json({ wishlistId: browserId ?? null, merged: 0 });
    return;
  }

  const merged = browserId
    ? await mergeWishlists(pgOf(req) as unknown as SqlClient, browserId, accountId)
    : 0;
  res.json({ wishlistId: accountId, merged });
}
