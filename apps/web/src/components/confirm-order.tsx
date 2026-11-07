"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@siumora/ui";

import { confirmCodOrder } from "@/app/actions/order";

/**
 * Stand-in for the WhatsApp confirmation reply.
 *
 * In production the customer taps a button in a WhatsApp template and the
 * webhook drives this transition. The button exists here so the lifecycle can
 * be exercised without a Meta Business account, and it says what it is rather
 * than pretending a message was sent.
 *
 * The button itself is the customer's real way to confirm until WhatsApp is
 * wired, so it stays everywhere; only the "not connected" note is dev-only
 * (`simulated`), and production gets plain customer copy instead.
 */
export function ConfirmOrder({
  orderNumber,
  simulated,
}: {
  orderNumber: string;
  simulated: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-8 border border-accent-ink/25 bg-accent/[0.04] p-5 text-center">
      <p className="text-sm text-content-muted">
        {simulated
          ? "WhatsApp is not connected in this environment. Confirm here to continue the order."
          : "Confirm your cash on delivery order here and we will start packing it."}
      </p>
      <Button
        size="sm"
        className="mt-3"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await confirmCodOrder(orderNumber);
            if (result.ok) router.refresh();
            else setError(result.message ?? "Could not confirm.");
          })
        }
      >
        {pending ? "Confirming…" : "Confirm order"}
      </Button>
      {error && <p className="mt-2 text-xs text-accent-ink">{error}</p>}
    </div>
  );
}
