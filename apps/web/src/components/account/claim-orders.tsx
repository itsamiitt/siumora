"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { formatPaise } from "@siumora/in-locale";
import type { ClaimableOrder } from "@siumora/sdk";
import { Button, MicroLabel } from "@siumora/ui";

import { claimOrders } from "@/app/actions/account";

/**
 * "Is this your order?" (auth plan phase 2).
 *
 * Orders placed as a guest on this phone are offered, not attached: Indian
 * carriers recycle numbers, and the person holding one today is not always
 * the person who ordered on it last year. Each order shows only what lets
 * its owner recognise it — number, date, pieces, total, city.
 */
export function ClaimOrders({ orders }: { orders: ClaimableOrder[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(orders.map((order) => order.number)));
  const [message, setMessage] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (orders.length === 0 || dismissed) return null;

  return (
    <section
      aria-labelledby="claim-heading"
      className="mt-10 border border-accent-ink/25 bg-accent/[0.04] p-5"
    >
      <h2 id="claim-heading">
        <MicroLabel>Is this your order?</MicroLabel>
      </h2>
      <p className="mt-2 text-sm text-content-muted">
        {orders.length === 1 ? "An order was" : `${orders.length} orders were`} placed on this
        number without signing in. Add the ones that are yours to your account.
      </p>

      <ul className="mt-4 space-y-2">
        {orders.map((order) => (
          <li key={order.number}>
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={chosen.has(order.number)}
                onChange={(event) =>
                  setChosen((previous) => {
                    const next = new Set(previous);
                    if (event.target.checked) next.add(order.number);
                    else next.delete(order.number);
                    return next;
                  })
                }
                className="mt-1"
              />
              <span>
                <span className="font-medium">{order.number}</span> ·{" "}
                {new Date(order.placedAt).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}{" "}
                · {order.itemCount} {order.itemCount === 1 ? "piece" : "pieces"} ·{" "}
                {formatPaise(order.total)}
                {order.city ? ` · ${order.city}` : ""}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Button
          size="sm"
          disabled={pending || chosen.size === 0}
          onClick={() =>
            startTransition(async () => {
              const result = await claimOrders([...chosen]);
              if (!result.ok) {
                setMessage(result.message ?? "Could not add those orders.");
                return;
              }
              setMessage(null);
              router.refresh();
            })
          }
        >
          {pending ? "Adding…" : "Yes, add to my account"}
        </Button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="min-h-11 text-sm text-content-muted underline-offset-4 hover:underline"
        >
          Not mine
        </button>
      </div>
      {message && (
        <p role="alert" className="mt-3 text-sm text-accent-ink">
          {message}
        </p>
      )}
    </section>
  );
}
