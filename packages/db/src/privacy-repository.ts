import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import {
  REDACTED,
  RETENTION_NOTICE,
  blockedReason,
  erasedPhone,
  isErasable,
  redactAddress,
  slaFor,
  type PrivacyRequestKind,
  type PrivacyRequestStatus,
  type ShippingAddress,
} from "@siumora/core";

import type { Database } from "./client.ts";
import {
  codRemittances,
  consentLog,
  customers,
  ndrEvents,
  notificationPreferences,
  notifications,
  orderLines,
  orders,
  privacyRequests,
  returnRequests,
  sessions,
  trackingEvents,
} from "./schema.ts";

/**
 * Access and erasure.
 *
 * The policy — what may be erased, what must be kept and under which law —
 * lives in `@siumora/core/dpdp` where it can be argued with. This is the part
 * that touches rows.
 *
 * Erasure runs in one transaction. A half-erased person is the worst of both
 * outcomes: the data is still there and nobody can tell which parts.
 */

export type PrivacyRequestRow = typeof privacyRequests.$inferSelect;

export interface CustomerExport {
  readonly generatedAt: string;
  readonly customer: {
    id: string;
    phone: string;
    name: string;
    email: string | null;
    createdAt: Date;
  };
  readonly orders: unknown[];
  readonly returns: unknown[];
  readonly deliveryAttempts: unknown[];
  readonly sessions: unknown[];
  readonly consent: unknown[];
  readonly codCollections: unknown[];
  /** What is kept regardless, and the law that requires it. */
  readonly retained: typeof RETENTION_NOTICE;
}

/**
 * Everything held about one person.
 *
 * Sessions are exported as metadata only. The token is what *is* the session,
 * and handing it back in a file the person may forward to support turns a
 * privacy right into an account takeover.
 */
export async function exportCustomerData(
  db: Database,
  customerId: string,
): Promise<CustomerExport | undefined> {
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId));
  if (!customer) return undefined;

  const ownOrders = await db
    .select()
    .from(orders)
    .where(eq(orders.customerId, customerId))
    .orderBy(desc(orders.placedAt));

  const orderIds = ownOrders.map((order) => order.id);
  const orderNumbers = ownOrders.map((order) => order.number);

  const [lines, returns, attempts, ownSessions, consent, collections] =
    await Promise.all([
      orderIds.length
        ? db.select().from(orderLines).where(inArray(orderLines.orderId, orderIds))
        : [],
      orderIds.length
        ? db
            .select()
            .from(returnRequests)
            .where(inArray(returnRequests.orderId, orderIds))
        : [],
      orderIds.length
        ? db.select().from(ndrEvents).where(inArray(ndrEvents.orderId, orderIds))
        : [],
      db
        .select({
          id: sessions.id,
          createdAt: sessions.createdAt,
          expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .where(eq(sessions.customerId, customerId)),
      // Consent is logged against the checkout event id, which is the only
      // handle a guest has. Joining through the orders is how it is found again.
      ownOrders.length
        ? db
            .select()
            .from(consentLog)
            .where(
              inArray(
                consentLog.subjectId,
                ownOrders.map((order) => order.eventId),
              ),
            )
        : [],
      orderNumbers.length
        ? db
            .select()
            .from(codRemittances)
            .where(inArray(codRemittances.orderNumber, orderNumbers))
        : [],
    ]);

  const linesByOrder = new Map<string, unknown[]>();
  for (const line of lines) {
    const bucket = linesByOrder.get(line.orderId) ?? [];
    bucket.push(line);
    linesByOrder.set(line.orderId, bucket);
  }

  return {
    generatedAt: new Date().toISOString(),
    customer: {
      id: customer.id,
      phone: customer.phone,
      name: customer.name,
      email: customer.email,
      createdAt: customer.createdAt,
    },
    orders: ownOrders.map((order) => ({
      ...order,
      // The access key authorises reading the order. In an export it is a
      // credential, and an export is a file people email around.
      accessKey: undefined,
      lines: linesByOrder.get(order.id) ?? [],
    })),
    returns,
    deliveryAttempts: attempts,
    sessions: ownSessions,
    consent,
    codCollections: collections,
    retained: RETENTION_NOTICE,
  };
}

export interface OpenRequestResult {
  readonly request: PrivacyRequestRow;
  /** True when this returned an existing open request rather than a new one. */
  readonly existing: boolean;
}

/**
 * Record a request.
 *
 * Asking twice is impatience, not a second right: a duplicate returns the open
 * request unchanged, so the clock keeps running from when it was actually made
 * rather than resetting every time somebody taps the button again.
 */
export async function openPrivacyRequest(
  db: Database,
  input: {
    customerId: string;
    subjectPhone: string;
    kind: PrivacyRequestKind;
    now?: Date;
  },
): Promise<OpenRequestResult> {
  const now = input.now ?? new Date();
  const sla = slaFor(now);

  const created = await db
    .insert(privacyRequests)
    .values({
      customerId: input.customerId,
      subjectPhone: input.subjectPhone,
      kind: input.kind,
      receivedAt: now,
      acknowledgeBy: sla.acknowledgeBy,
      resolveBy: sla.resolveBy,
    })
    .onConflictDoNothing()
    .returning();

  if (created[0]) return { request: created[0], existing: false };

  const [open] = await db
    .select()
    .from(privacyRequests)
    .where(
      and(
        eq(privacyRequests.subjectPhone, input.subjectPhone),
        eq(privacyRequests.kind, input.kind),
        inArray(privacyRequests.status, ["received", "acknowledged"]),
      ),
    );

  // The unique index is partial, so a conflict means an open one exists.
  return { request: open as PrivacyRequestRow, existing: true };
}

/** Unfinished requests, soonest deadline first. */
export async function openPrivacyRequests(
  db: Database,
  limit = 100,
): Promise<PrivacyRequestRow[]> {
  return db
    .select()
    .from(privacyRequests)
    .where(inArray(privacyRequests.status, ["received", "acknowledged"]))
    .orderBy(asc(privacyRequests.resolveBy))
    .limit(limit);
}

export async function setPrivacyRequestStatus(
  db: Database,
  id: string,
  status: PrivacyRequestStatus,
  options: { note?: string; now?: Date } = {},
): Promise<PrivacyRequestRow | undefined> {
  const now = options.now ?? new Date();
  const finished = status === "completed" || status === "refused";

  const [updated] = await db
    .update(privacyRequests)
    .set({
      status,
      completedAt: finished ? now : null,
      ...(options.note ? { note: options.note } : {}),
    })
    .where(eq(privacyRequests.id, id))
    .returning();

  return updated;
}

export interface ErasureResult {
  readonly erased: boolean;
  /** Why not, when it did not run. */
  readonly reason?: string;
  readonly ordersRedacted: number;
  readonly sessionsRevoked: number;
  /** Outbox rows kept as delivery history, with the person scrubbed out. */
  readonly notificationsRedacted: number;
  /** Preference rows keyed on the erased number, deleted outright. */
  readonly preferencesDeleted: number;
}

/**
 * Redact a person, keeping the statutory record.
 *
 * Refuses while any order is still moving: a parcel in transit needs an address
 * to arrive at and a phone for the courier to ring, and erasing mid-flight
 * strands the goods and the money both.
 *
 * The customer row survives with a token in place of the phone. Deleting it
 * would orphan the orders that reference it, and those orders are the invoice
 * trail section 36 of the CGST Act requires be kept for six years.
 */
export async function eraseCustomer(
  db: Database,
  customerId: string,
  now: Date = new Date(),
): Promise<ErasureResult> {
  return db.transaction(async (tx) => {
    const [customer] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, customerId));

    if (!customer) {
      return {
        erased: false,
        reason: "No such customer.",
        ordersRedacted: 0,
        sessionsRevoked: 0,
        notificationsRedacted: 0,
        preferencesDeleted: 0,
      };
    }

    const ownOrders = await tx
      .select()
      .from(orders)
      .where(eq(orders.customerId, customerId));

    const blocked = blockedReason(ownOrders.map((order) => order.status));
    if (blocked) {
      return {
        erased: false,
        reason: blocked,
        ordersRedacted: 0,
        sessionsRevoked: 0,
        notificationsRedacted: 0,
        preferencesDeleted: 0,
      };
    }

    for (const order of ownOrders) {
      if (!isErasable(order.status)) continue;
      await tx
        .update(orders)
        .set({
          address: redactAddress(order.address as ShippingAddress),
          // A tracking identifier that outlives the person it tracked.
          gaClientId: null,
        })
        .where(eq(orders.id, order.id));
    }

    // The hashed identifiers in a queued conversion are still identifiers, and
    // a queue drained after an erasure would send them.
    if (ownOrders.length > 0) {
      await tx
        .update(trackingEvents)
        .set({ payload: null, status: "skipped" })
        .where(
          and(
            inArray(
              trackingEvents.orderId,
              ownOrders.map((order) => order.id),
            ),
            inArray(trackingEvents.status, ["pending", "sending"]),
          ),
        );
    }

    // A notification is two things at once: a delivery record — which template
    // went out against which order, and whether it arrived — and the person it
    // went to. The record stays, the way the redacted orders stay; the person
    // goes. Recipient takes the same marker the address fields take, and the
    // rendered variables (a first name, an order number, a tracking id) are
    // emptied — a retry that can no longer render is exactly right, because
    // there is nobody left to message. Rows still waiting their turn are
    // skipped outright: a worker draining the queue after the erasure would
    // otherwise ring "[erased]".
    const orderIds = ownOrders.map((order) => order.id);
    const scrubbedNotifications = await tx
      .update(notifications)
      .set({
        recipient: REDACTED,
        variables: {},
        status: sql`CASE WHEN ${notifications.status} IN ('pending', 'sending') THEN 'skipped' ELSE ${notifications.status} END`,
      })
      .where(
        or(
          eq(notifications.customerId, customerId),
          eq(notifications.recipient, customer.phone),
          ...(orderIds.length > 0
            ? [inArray(notifications.orderId, orderIds)]
            : []),
        ),
      )
      .returning({ id: notifications.id });

    // The preference row is keyed on the number itself, and after this
    // transaction that number is nobody. Deleted rather than redacted: a
    // consent flag attached to a redacted key protects no one, and preferences
    // carry no statutory retention. Rows keyed to other numbers — a delivery
    // contact's own opt-out, say — are that person's wish, not this one's, and
    // stay.
    const droppedPreferences = await tx
      .delete(notificationPreferences)
      .where(eq(notificationPreferences.recipient, customer.phone))
      .returning({ recipient: notificationPreferences.recipient });

    const revoked = await tx
      .delete(sessions)
      .where(eq(sessions.customerId, customerId))
      .returning({ id: sessions.id });

    await tx
      .update(customers)
      .set({
        phone: erasedPhone(customerId),
        name: "",
        email: null,
        erasedAt: now,
      })
      .where(eq(customers.id, customerId));

    return {
      erased: true,
      ordersRedacted: ownOrders.length,
      sessionsRevoked: revoked.length,
      notificationsRedacted: scrubbedNotifications.length,
      preferencesDeleted: droppedPreferences.length,
    };
  });
}

/** Customers whose data is still intact, for the admin count. */
export async function unerasedCustomerCount(db: Database): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customers)
    .where(isNull(customers.erasedAt));
  return row?.count ?? 0;
}
