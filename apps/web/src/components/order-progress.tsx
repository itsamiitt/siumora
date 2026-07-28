"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { NdrReason, OrderStatus } from "@siumora/core";
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

  function fire(status: OrderStatus, ndrReason?: NdrReason) {
    start(async () => {
      setError(null);
      const result = await advanceOrderStatus(orderNumber, status, ndrReason);
      if (result.ok) router.refresh();
      else setError(result.message ?? "Could not move the order.");
    });
  }

  if (next.length === 0) return null;

  return (
    <div className="mt-8 border border-dashed border-content/20 p-5">
      <MicroLabel>Courier simulation</MicroLabel>
      <p className="mt-2 text-xs text-content-muted">
        Shiprocket is not connected. These move the order the way the courier
        webhook would.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {/* Two NDR reasons, because they lead to different recovery advice:
            a missed call is worth another attempt, a bad address is not. */}
        {next.includes("ndr") && (
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => fire("ndr", "customer_unavailable")}
            >
              Failed · nobody home
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => fire("ndr", "address_incomplete")}
            >
              Failed · bad address
            </Button>
          </>
        )}

        {next.filter((s) => s !== "ndr").map((status) => (
          <Button
            key={status}
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => fire(status)}
          >
            {LABEL[status] ?? status}
          </Button>
        ))}
      </div>

      {error && <p className="mt-3 text-xs text-accent-ink">{error}</p>}
    </div>
  );
}
