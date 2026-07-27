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
 */
export function ConfirmOrder({ orderNumber }: { orderNumber: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-8 border border-mulberry/25 bg-mulberry/[0.04] p-5 text-center">
      <p className="text-sm text-ink-muted">
        WhatsApp is not connected in this environment. Confirm here to continue
        the order.
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
      {error && <p className="mt-2 text-xs text-mulberry">{error}</p>}
    </div>
  );
}
