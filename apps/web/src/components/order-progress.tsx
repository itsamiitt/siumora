"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { OrderStatus } from "@siumora/core";
import { Button, MicroLabel } from "@siumora/ui";

import { advanceOrderStatus } from "@/app/actions/returns";

const LABEL: Partial<Record<OrderStatus, string>> = {
  confirmed: "Confirm",
  processing: "Mark packed",
  shipped: "Mark shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Mark delivered",
  ndr: "Delivery failed",
  rto: "Returned to origin",
  cancelled: "Cancel",
  returned: "Mark returned",
};

/**
 * Courier-webhook stand-in.
 *
 * Shiprocket drives these transitions in production. The control exists so the
 * lifecycle — and returns, which only open after delivery — can be exercised
 * without a courier account, and it says exactly that rather than posing as a
 * customer-facing feature.
 */
export function OrderProgress({
  orderNumber,
  next,
}: {
  orderNumber: string;
  next: OrderStatus[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (next.length === 0) return null;

  return (
    <div className="mt-8 border border-dashed border-ink/20 p-5">
      <MicroLabel>Courier simulation</MicroLabel>
      <p className="mt-2 text-xs text-ink-muted">
        Shiprocket is not connected. These move the order the way the courier
        webhook would.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {next.map((status) => (
          <Button
            key={status}
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const result = await advanceOrderStatus(orderNumber, status);
                if (result.ok) router.refresh();
                else setError(result.message ?? "Could not move the order.");
              })
            }
          >
            {LABEL[status] ?? status}
          </Button>
        ))}
      </div>

      {error && <p className="mt-3 text-xs text-mulberry">{error}</p>}
    </div>
  );
}
