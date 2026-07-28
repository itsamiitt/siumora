"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  NDR_REASON_LABELS,
  ndrState,
  type NdrAction,
  type NdrReason,
} from "@siumora/core";
import { Button, MicroLabel } from "@siumora/ui";

import { answerNdr } from "@/app/actions/returns";

const ACTION_LABEL: Record<NdrAction, string> = {
  reattempt: "Try again",
  update_address: "Update my address",
  cancel: "Cancel the order",
};

/**
 * Failed-delivery recovery.
 *
 * Answered in one tap, because the window is short and the alternative is the
 * parcel going back. In production this arrives as WhatsApp buttons; the
 * on-site version is the same three choices.
 *
 * The remaining attempts are stated plainly. "One attempt left" is what makes
 * someone reply; a vague "we could not deliver" does not.
 */
export function NdrRecovery({
  orderNumber,
  attempts,
  reason,
}: {
  orderNumber: string;
  attempts: number;
  reason: NdrReason;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const state = ndrState(attempts, reason);

  return (
    <div className="mt-8 border border-accent-ink/30 bg-accent/[0.04] p-5">
      <MicroLabel tone="mulberry">Delivery did not go through</MicroLabel>

      <p className="mt-2.5 text-sm">
        {NDR_REASON_LABELS[reason]}.{" "}
        {state.exhausted ? (
          <span className="text-content-muted">
            The courier cannot try again, so the parcel is on its way back to us.
          </span>
        ) : (
          <span className="text-content-muted">
            {state.attemptsRemaining === 1
              ? "One attempt left."
              : `${state.attemptsRemaining} attempts left.`}{" "}
            Tell us what to do and we will pass it to the courier.
          </span>
        )}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {state.suggestedActions.map((action, index) => (
          <Button
            key={action}
            // The first suggestion is the one most likely to work for this
            // failure reason, so it gets the primary treatment.
            variant={index === 0 && action !== "cancel" ? "primary" : "secondary"}
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const result = await answerNdr(orderNumber, action);
                if (result.ok) router.refresh();
                else setError(result.message ?? "Could not send that.");
              })
            }
          >
            {ACTION_LABEL[action]}
          </Button>
        ))}
      </div>

      {error && (
        <p aria-live="polite" className="mt-3 text-xs text-accent-ink">
          {error}
        </p>
      )}
    </div>
  );
}
