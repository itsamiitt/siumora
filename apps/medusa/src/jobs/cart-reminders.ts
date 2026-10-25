import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { issueToken, tokenSecret } from "../lib/signed-token";
import { reminderDecision } from "../modules/outbox/compose";
import { dueReminders, enqueueNotification, settleReminder, type SqlClient } from "../modules/outbox/data";
import { readSettings, type SqlClient as SettingsSqlClient } from "../modules/settings/read";

/**
 * Cart reminders (plan 16 B22): every ten minutes, the opted-in carts whose
 * delay has passed get their one WhatsApp, through the outbox like every
 * other message (the worker sends it; quiet hours hold it till morning).
 *
 * Only for a shopper who ticked the box at checkout step 1, only while the
 * operator has reminders switched on, and never for a cart that was checked
 * out, emptied, or is still being worked on (touched within the delay —
 * reminderDecision). The event key is the cart, so a sweep that overlaps
 * another can only ever queue one message per cart. The link opens the
 * bag on whichever phone taps it, signed and good for seven days.
 */

const RESUME_TTL_SECONDS = 7 * 24 * 3600;

interface CartRead {
  id: string;
  completed_at?: unknown;
  updated_at: string | Date;
  items?: Array<{
    title?: string | null;
    product_title?: string | null;
    quantity?: unknown;
    updated_at?: string | Date | null;
  } | null> | null;
}

export default async function cartReminders(container: MedusaContainer): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as { error(message: string): void };
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlClient;
  const settings = await readSettings(pg as unknown as SettingsSqlClient).catch(() => undefined);
  if (!settings?.cartRecoveryEnabled) return;

  const now = new Date();
  const due = await dueReminders(pg, new Date(now.getTime() - settings.cartRecoveryDelayMinutes * 60_000));
  if (due.length === 0) return;

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "completed_at", "updated_at", "items.*"],
    filters: { id: due.map((row) => row.cart_id) },
  });
  const carts = new Map((data as CartRead[]).map((cart) => [cart.id, cart]));
  const storefront = (process.env.STOREFRONT_URL ?? "http://localhost:3000").replace(/\/+$/, "");

  for (const row of due) {
    try {
      const cart = carts.get(row.cart_id);
      const decision = reminderDecision(
        cart && {
          completedAt: cart.completed_at,
          // A line edit may not touch the cart row, so the latest of both.
          updatedAt: new Date(
            Math.max(
              new Date(cart.updated_at).getTime(),
              ...(cart.items ?? []).map((item) => (item?.updated_at ? new Date(item.updated_at).getTime() : 0)),
            ),
          ),
          items: (cart.items ?? []).filter(Boolean).map((item) => ({
            title: item!.product_title ?? item!.title ?? "",
            quantity: Number(JSON.parse(JSON.stringify(item!.quantity ?? 0))),
          })),
        },
        { consentedAt: new Date(row.consented_at), now, delayMinutes: settings.cartRecoveryDelayMinutes },
      );
      if (decision.kind === "wait") continue;
      if (decision.kind === "skip") {
        await settleReminder(pg, row.id, "skipped", decision.reason);
        continue;
      }

      const token = issueToken("cart_resume", { cart: row.cart_id }, RESUME_TTL_SECONDS, tokenSecret());
      const outcome = await enqueueNotification(
        pg,
        {
          eventKey: `cart_reminder:${row.cart_id}`,
          templateKey: "cart_reminder",
          recipient: row.phone,
          variables: { items: decision.items, link: `${storefront}/cart/resume?t=${token}` },
          orderId: null,
          consented: true,
        },
        now,
      );
      await settleReminder(pg, row.id, outcome.queued ? "queued" : "skipped", outcome.queued ? undefined : outcome.reason);
    } catch (error) {
      // One bad row must not stop the sweep; it stays waiting for the next.
      logger.error(`cart reminders: ${row.cart_id} — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export const config = {
  name: "siumora-cart-reminders",
  schedule: "*/10 * * * *",
};
