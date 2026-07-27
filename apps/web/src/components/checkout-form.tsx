"use client";

import { useEffect, useState } from "react";

import {
  evaluateCod,
  scoreAddress,
  scoreRto,
  type AddressQuality,
  type CodDecision,
} from "@siumora/core";
import {
  INDIAN_STATES,
  formatPaise,
  isValidPincode,
  normalisePincodeInput,
} from "@siumora/in-locale";
import { Button, MicroLabel } from "@siumora/ui";

import { checkServiceability } from "@/lib/serviceability";

/**
 * Single-page checkout, mobile-first.
 *
 * Ordered phone → address → delivery → payment, matching plan/04. The delivery
 * promise and any COD fee are shown before the payment step, because a cost
 * that appears after a method is chosen is the friction the whole flow exists
 * to remove.
 */
export type PaymentMethod = "upi" | "card" | "netbanking" | "cod";

export function CheckoutForm({ subtotal }: { subtotal: number }) {
  const [phone, setPhone] = useState("");
  const [pincode, setPincode] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("upi");
  const [cod, setCod] = useState<CodDecision | null>(null);
  const [addressLine, setAddressLine] = useState("");
  const [addressQuality, setAddressQuality] = useState<AddressQuality | null>(null);
  const [delivery, setDelivery] = useState<string | null>(null);

  const pincodeValid = isValidPincode(pincode);

  useEffect(() => {
    if (!pincodeValid) {
      setCod(null);
      setDelivery(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const service = await checkServiceability(pincode);
      if (cancelled) return;

      setDelivery(service.serviceable ? service.estimatedDays : null);

      // Real RTO scoring from what the customer has actually entered. The
      // address is scored as typed, so an incomplete one tightens COD before
      // the order is placed rather than after the parcel comes back.
      const quality = scoreAddress({
        line1: addressLine,
        landmark: "",
        city: "",
        stateCode,
        pincode,
      });

      const risk = scoreRto({
        paymentMethod: "cod",
        orderValue: subtotal,
        addressScore: quality.score,
        // OTP verification happens after this step, so treat the phone as
        // unverified while scoring.
        phoneVerified: false,
        isNewCustomer: true,
      });

      setAddressQuality(quality);
      setCod(
        evaluateCod({
          subtotal,
          pincodeCodServiceable: service.codAvailable,
          rtoRisk: risk.risk,
        }),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [pincode, pincodeValid, subtotal, addressLine, stateCode]);

  // A pincode change can withdraw COD while it is selected. Fall back to UPI
  // rather than leaving an unavailable method chosen.
  useEffect(() => {
    if (method === "cod" && cod && !cod.available) setMethod("upi");
  }, [cod, method]);

  const phoneValid = /^[6-9]\d{9}$/.test(phone);
  const canPay = phoneValid && pincodeValid && stateCode !== "";

  return (
    <form
      className="space-y-10"
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <Section step="1" title="Contact">
        <Field label="Phone number" htmlFor="phone">
          <div className="flex">
            <span className="flex h-11 items-center border border-r-0 border-ink/20 px-3 text-sm text-ink-muted">
              +91
            </span>
            <input
              id="phone"
              value={phone}
              onChange={(e) =>
                setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
              }
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="98765 43210"
              className="h-11 w-full border border-ink/20 px-3 text-sm outline-none focus:border-mulberry"
            />
          </div>
          {phone.length > 0 && !phoneValid && (
            <p className="mt-1.5 text-xs text-mulberry">
              Enter a 10-digit mobile number.
            </p>
          )}
        </Field>
      </Section>

      <Section step="2" title="Delivery address">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pincode" htmlFor="pincode">
            <input
              id="pincode"
              value={pincode}
              onChange={(e) => setPincode(normalisePincodeInput(e.target.value))}
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="400001"
              className="h-11 w-full border border-ink/20 px-3 text-sm outline-none focus:border-mulberry"
            />
          </Field>

          <Field label="State" htmlFor="state">
            <select
              id="state"
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value)}
              className="h-11 w-full border border-ink/20 bg-transparent px-3 text-sm outline-none focus:border-mulberry"
            >
              <option value="">Select a state</option>
              {INDIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Address" htmlFor="address" className="mt-4">
          <textarea
            id="address"
            rows={3}
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
            autoComplete="street-address"
            placeholder="Flat, building, street, area"
            className="w-full border border-ink/20 p-3 text-sm outline-none focus:border-mulberry"
          />
          {/* Surfaced as help, not as an error: the order is still allowed,
              but a thin address quietly costs COD eligibility. */}
          {addressQuality && addressQuality.needsReview && addressLine.length > 0 && (
            <p className="mt-1.5 text-xs text-ink-muted">
              Add {addressQuality.issues[0]?.toLowerCase()} so the courier can
              find you.
            </p>
          )}
        </Field>

        {delivery && (
          <p className="mt-3 text-sm text-ink-muted">
            Delivery in <span className="text-ink">{delivery} days</span>
          </p>
        )}
      </Section>

      <Section step="3" title="Payment">
        <div className="space-y-2.5">
          <PaymentOption
            value="upi"
            selected={method}
            onSelect={setMethod}
            title="UPI"
            note="PhonePe, Google Pay, Paytm — pay in one tap"
          />
          <PaymentOption
            value="card"
            selected={method}
            onSelect={setMethod}
            title="Card"
            note="Credit or debit · No-Cost EMI available"
          />
          <PaymentOption
            value="netbanking"
            selected={method}
            onSelect={setMethod}
            title="Netbanking"
            note="All major banks"
          />
          <PaymentOption
            value="cod"
            selected={method}
            onSelect={setMethod}
            disabled={!cod?.available}
            title="Cash on delivery"
            note={
              !pincodeValid
                ? "Enter a pincode to check"
                : cod?.available
                  ? cod.fee > 0
                    ? `${formatPaise(cod.fee)} handling fee`
                    : "No handling fee"
                  : (cod?.reason ?? "Not available")
            }
          />
        </div>

        {/* Nudge to prepaid only when it actually saves money. */}
        {method === "cod" && cod?.available && cod.fee > 0 && (
          <p className="mt-4 border border-mulberry/25 bg-mulberry/[0.04] p-3 text-sm">
            Pay online and save {formatPaise(cod.fee)} — plus faster dispatch.
          </p>
        )}

        {method === "cod" && cod?.verification === "otp" && (
          <p className="mt-3 text-xs text-ink-muted">
            We will send a WhatsApp message to confirm this order.
          </p>
        )}

        {method === "cod" && cod?.verification === "partial-payment" && (
          <p className="mt-3 text-xs text-ink-muted">
            This order needs a {formatPaise(cod.partialPayment)} advance to
            confirm. The rest is paid on delivery.
          </p>
        )}
      </Section>

      <div>
        <Button size="lg" type="submit" className="w-full" disabled={!canPay}>
          {method === "cod" ? "Place order" : "Pay now"}
        </Button>
        {/* The gateway is not connected yet; saying so beats a button that
            silently does nothing. */}
        <p className="mt-2 text-center text-xs text-ink-faint">
          Razorpay is not connected yet — no payment is taken.
        </p>
      </div>
    </form>
  );
}

function Section({
  step,
  title,
  children,
}: {
  step: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-3 border-b border-[var(--color-rule)] pb-3">
        <span className="font-display text-xl font-light text-mulberry">
          {step}
        </span>
        <MicroLabel>{title}</MicroLabel>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm text-ink-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function PaymentOption({
  value,
  selected,
  onSelect,
  title,
  note,
  disabled,
}: {
  value: PaymentMethod;
  selected: PaymentMethod;
  onSelect: (v: PaymentMethod) => void;
  title: string;
  note: string;
  disabled?: boolean;
}) {
  const active = selected === value;

  return (
    <label
      className={[
        "flex cursor-pointer items-start gap-3 border p-4 transition-colors",
        disabled
          ? "cursor-not-allowed border-ink/10 text-ink-faint"
          : active
            ? "border-mulberry bg-mulberry/[0.04]"
            : "border-ink/20 hover:border-ink/40",
      ].join(" ")}
    >
      <input
        type="radio"
        name="payment"
        value={value}
        checked={active}
        disabled={disabled}
        onChange={() => onSelect(value)}
        className="mt-1 accent-[#6B2942]"
      />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-ink-muted">{note}</span>
      </span>
    </label>
  );
}
