"use client";

import type { CodDecision } from "@siumora/core";
import { formatPaise } from "@siumora/in-locale";
import { CheckoutStep, RadioCard } from "@siumora/ui";

export type PaymentMethod = "upi" | "card" | "netbanking" | "cod";

/**
 * Step 3 — how to pay (plan 16 Phase C).
 *
 * UPI first and preselected — it is how most Indian shoppers pay, and the
 * one tap is the fastest finish. Cash on delivery says its fee on the
 * option, before it is chosen, and the total moves the moment it is; when
 * COD is withheld the option stays, faint, with the reason, rather than
 * vanishing. When online payment is not connected the prepaid options are
 * not offered at all — offering a method that will be refused is worse
 * than not offering it.
 */
export function PaymentStep({
  state,
  method,
  onMethod,
  prepaidOffered,
  cod,
  pincodeKnown,
  onEdit,
}: {
  state: "open" | "done" | "upcoming";
  method: PaymentMethod;
  onMethod: (method: PaymentMethod) => void;
  prepaidOffered: boolean;
  cod: CodDecision | null;
  pincodeKnown: boolean;
  onEdit: () => void;
}) {
  const codNote = !pincodeKnown
    ? "Enter a pincode to check"
    : cod?.available
      ? cod.fee > 0
        ? "Pay in cash or UPI when it arrives"
        : "Pay in cash or UPI when it arrives · no fee"
      : (cod?.reason ?? "Not available for this address");

  return (
    <CheckoutStep step={3} title="Payment" state={state} onEdit={onEdit}>
      <div className="space-y-2.5">
        {prepaidOffered && (
          <>
            <RadioCard
              name="payment"
              value="upi"
              checked={method === "upi"}
              onSelect={() => onMethod("upi")}
              title="UPI"
              note="Google Pay, PhonePe, Paytm — pay in one tap"
              aside="Recommended"
            />
            <RadioCard
              name="payment"
              value="card"
              checked={method === "card"}
              onSelect={() => onMethod("card")}
              title="Card"
              note="Credit or debit · EMI where your bank offers it"
            />
            <RadioCard
              name="payment"
              value="netbanking"
              checked={method === "netbanking"}
              onSelect={() => onMethod("netbanking")}
              title="Netbanking"
              note="All major banks"
            />
          </>
        )}
        <RadioCard
          name="payment"
          value="cod"
          checked={method === "cod"}
          disabled={!cod?.available}
          onSelect={() => onMethod("cod")}
          title="Cash on delivery"
          note={codNote}
          {...(cod?.available && cod.fee > 0 ? { aside: `+${formatPaise(cod.fee)}` } : {})}
        />
      </div>

      {!prepaidOffered && (
        <p className="mt-3 text-xs text-content-muted">
          Online payment is not switched on yet — cash on delivery only for now.
        </p>
      )}

      {/* Nudge to prepaid only when it actually saves money. */}
      {prepaidOffered && method === "cod" && cod?.available && cod.fee > 0 && (
        <p className="mt-4 border border-accent-ink/25 bg-accent/[0.04] p-3 text-sm">
          Pay online and save {formatPaise(cod.fee)} — plus faster dispatch.
        </p>
      )}
      {method === "cod" && cod?.verification === "otp" && (
        <p className="mt-3 text-xs text-content-muted">We will send a WhatsApp message to confirm this order.</p>
      )}
      {method === "cod" && cod?.verification === "partial-payment" && (
        <p className="mt-3 text-xs text-content-muted">
          This order needs a {formatPaise(cod.partialPayment)} advance to confirm. The rest is paid on delivery.
        </p>
      )}
    </CheckoutStep>
  );
}
