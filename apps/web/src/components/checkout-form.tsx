"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { track, mintEventId, gaClientId } from "@siumora/analytics/client";

import type { CodDecision } from "@siumora/core";
import { isValidGstin } from "@siumora/core/gstin";
import {
  INDIAN_STATES,
  formatPaise,
  isValidPincode,
  normalisePincodeInput,
} from "@siumora/in-locale";
import { Button, MicroLabel } from "@siumora/ui";

import { submitOrder } from "@/app/actions/order";
import { quoteCheckout } from "@/app/actions/checkout";
import { openRazorpayCheckout } from "@/lib/razorpay-checkout";


/**
 * Single-page checkout, mobile-first.
 *
 * Ordered phone → address → delivery → payment, matching plan/04. The delivery
 * promise and any COD fee are shown before the payment step, because a cost
 * that appears after a method is chosen is the friction the whole flow exists
 * to remove.
 */
export type PaymentMethod = "upi" | "card" | "netbanking" | "cod";

export function CheckoutForm({
  subtotal,
  razorpayConfigured = false,
}: {
  subtotal: number;
  razorpayConfigured?: boolean;
}) {
  const [phone, setPhone] = useState("");
  const [pincode, setPincode] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("upi");
  const [cod, setCod] = useState<CodDecision | null>(null);
  const [addressLine, setAddressLine] = useState("");
  const [addressQuality, setAddressQuality] = useState<{
    score: number;
    issues: string[];
    needsReview: boolean;
  } | null>(null);
  const [delivery, setDelivery] = useState<string | null>(null);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [business, setBusiness] = useState(false);
  const [gstin, setGstin] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [placing, startPlacing] = useTransition();
  const router = useRouter();

  const pincodeValid = isValidPincode(pincode);
  const gstinValid = isValidGstin(gstin);

  useEffect(() => {
    if (!pincodeValid) {
      setCod(null);
      setDelivery(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      // The API decides serviceability, address quality, the RTO band and the
      // COD fee together, from the address as typed. None of that belongs in
      // the browser, where a customer could edit the fee to zero.
      const quote = await quoteCheckout({
        pincode,
        address: addressLine,
        city,
        stateCode,
        // Sent so the API can tell whether this is the number the shopper
        // proved at sign-in — a verified number changes the COD terms.
        phone,
      });
      if (cancelled) return;

      setDelivery(quote.serviceable ? quote.estimatedDays : null);
      setAddressQuality(quote.addressQuality);
      setCod(quote.cod);
      setPhoneVerified(quote.phoneVerified);
    })();

    return () => {
      cancelled = true;
    };
  }, [pincode, pincodeValid, subtotal, addressLine, stateCode, city, phone]);

  // A pincode change can withdraw COD while it is selected. Fall back to UPI
  // rather than leaving an unavailable method chosen.
  useEffect(() => {
    if (method === "cod" && cod && !cod.available) setMethod("upi");
  }, [cod, method]);

  const phoneValid = /^[6-9]\d{9}$/.test(phone);
  // A GSTIN that is present must be right. Sending a mistyped one denies the
  // buyer their input credit, which is worse than not asking.
  const canPay =
    phoneValid && pincodeValid && stateCode !== "" && (!business || gstinValid);

  return (
    <form
      className="space-y-10"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canPay || placing) return;
        setError(null);

        startPlacing(async () => {
          // Minted here and persisted on the order so the browser purchase
          // pixel and the server-side send share one id and dedupe.
          const eventId = mintEventId();

          track("add_payment_info", {
            event_id: mintEventId(),
            currency: "INR",
            value: subtotal / 100,
            payment_type: method,
            items: [],
          });

          const result = await submitOrder({
            address: {
              name: name.trim() || "Customer",
              phone: phone,
              line1: addressLine,
              city: city.trim(),
              stateCode,
              pincode,
            },
            paymentMethod: method,
            requiresCodConfirmation:
              method === "cod" && cod?.verification !== "none",
            eventId,
            // Captured here because the server cannot see the cookie, and GA4
            // will not accept a server event without it.
            gaClientId: gaClientId(),
            ...(business && gstinValid ? { buyerGstin: gstin } : {}),
            codFee: method === "cod" ? (cod?.fee ?? 0) : 0,
          });

          if (result.ok && result.orderNumber) {
            if (result.razorpay) {
              // The modal collects the payment; the signed webhook and the
              // recon sweep confirm it. Paid or dismissed, the order page is
              // the next stop — it renders whatever the server knows is true.
              await openRazorpayCheckout({
                keyId: result.razorpay.keyId,
                orderId: result.razorpay.orderId,
                amountPaise: result.razorpay.amountPaise,
                contact: phone,
                ...(name.trim() ? { name: name.trim() } : {}),
              });
            }
            router.push(`/orders/${result.orderNumber}`);
          } else {
            setError(result.message ?? "Could not place the order.");
          }
        });
      }}
    >
      <Section step="1" title="Contact">
        <Field label="Full name" htmlFor="name" className="mb-4">
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            placeholder="Asha Menon"
            className="h-11 w-full border border-content/20 px-3 text-sm outline-none focus:border-accent-ink"
          />
        </Field>

        <Field label="Phone number" htmlFor="phone">
          <div className="flex">
            <span className="flex h-11 items-center border border-r-0 border-content/20 px-3 text-sm text-content-muted">
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
              className="h-11 w-full border border-content/20 px-3 text-sm outline-none focus:border-accent-ink"
            />
          </div>
          {phone.length > 0 && !phoneValid && (
            <p className="mt-1.5 text-xs text-accent-ink">
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
              className="h-11 w-full border border-content/20 px-3 text-sm outline-none focus:border-accent-ink"
            />
          </Field>

          <Field label="State" htmlFor="state">
            <select
              id="state"
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value)}
              className="h-11 w-full border border-content/20 bg-transparent px-3 text-sm outline-none focus:border-accent-ink"
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

        <Field label="City" htmlFor="city" className="mt-4">
          <input
            id="city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            autoComplete="address-level2"
            placeholder="Mumbai"
            className="h-11 w-full border border-content/20 px-3 text-sm outline-none focus:border-accent-ink"
          />
        </Field>

        <Field label="Address" htmlFor="address" className="mt-4">
          <textarea
            id="address"
            rows={3}
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
            autoComplete="street-address"
            placeholder="Flat, building, street, area"
            className="w-full border border-content/20 p-3 text-sm outline-none focus:border-accent-ink"
          />
          {/* Surfaced as help, not as an error: the order is still allowed,
              but a thin address quietly costs COD eligibility. */}
          {addressQuality && addressQuality.needsReview && addressLine.length > 0 && (
            <p className="mt-1.5 text-xs text-content-muted">
              Add {addressQuality.issues[0]?.toLowerCase()} so the courier can
              find you.
            </p>
          )}
        </Field>

        {delivery && (
          <p className="mt-3 text-sm text-content-muted">
            Delivery in <span className="text-content">{delivery} days</span>
          </p>
        )}

        {/* Behind a toggle rather than always on screen: most orders are not
            B2B, and a GSTIN field on every checkout is a question almost
            nobody needs to answer. */}
        <div className="mt-6 border-t border-[var(--color-rule)] pt-5">
          {business ? (
            <Field label="GSTIN" htmlFor="gstin">
              <input
                id="gstin"
                value={gstin}
                onChange={(event) => setGstin(event.target.value.toUpperCase())}
                maxLength={15}
                autoComplete="off"
                placeholder="27AAPFU0939F1ZV"
                aria-invalid={gstin.length === 15 && !gstinValid}
                className="h-11 w-full border border-content/20 px-3 font-mono text-sm tracking-wide outline-none focus:border-accent-ink"
              />
              <p className="mt-2 text-xs text-content-muted">
                {gstin.length === 15 && !gstinValid ? (
                  // Checked in the browser too, so a typo is caught while the
                  // field is still in front of the person who can fix it.
                  <span className="text-accent-ink">
                    That GSTIN does not look right — check the last character.
                  </span>
                ) : (
                  "We will put this on the invoice so you can claim input credit."
                )}
              </p>
            </Field>
          ) : (
            <button
              type="button"
              onClick={() => setBusiness(true)}
              className="text-sm text-content-muted underline-offset-4 hover:text-accent-ink hover:underline"
            >
              Buying for a business?
            </button>
          )}
        </div>
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
          <p className="mt-4 border border-accent-ink/25 bg-accent/[0.04] p-3 text-sm">
            Pay online and save {formatPaise(cod.fee)} — plus faster dispatch.
          </p>
        )}

        {method === "cod" && cod?.verification === "otp" && (
          <p className="mt-3 text-xs text-content-muted">
            We will send a WhatsApp message to confirm this order.
          </p>
        )}

        {method === "cod" && cod?.verification === "partial-payment" && (
          <p className="mt-3 text-xs text-content-muted">
            This order needs a {formatPaise(cod.partialPayment)} advance to
            confirm. The rest is paid on delivery.
          </p>
        )}

        {/* Terms that differ between visits need a reason on screen, or a fee
            that quietly appears reads as a mistake. */}
        {phoneVerified ? (
          <p className="mt-3 text-xs text-content-faint">
            This number is verified on your account.
          </p>
        ) : (
          phoneValid && (
            <p className="mt-3 text-xs text-content-faint">
              <Link
                href="/signin?next=/checkout"
                className="border-b border-content/40 pb-0.5 hover:border-accent-ink hover:text-accent-ink"
              >
                Sign in
              </Link>{" "}
              with this number for better cash-on-delivery terms.
            </p>
          )
        )}
      </Section>

      <div>
        <Button
          size="lg"
          type="submit"
          className="w-full"
          disabled={!canPay || placing}
        >
          {placing
            ? "Placing…"
            : method === "cod"
              ? "Place order"
              : "Pay now"}
        </Button>

        {error && (
          <p aria-live="polite" className="mt-2 text-center text-xs text-accent-ink">
            {error}
          </p>
        )}

        {/* Tell the truth about money either way: a secure-payment line when
            the provider is live, and an explicit no-payment note when it is
            not — implying a payment was taken is worse than admitting none was. */}
        <p className="mt-2 text-center text-xs text-content-faint">
          {razorpayConfigured
            ? "Payments are processed securely by Razorpay. COD orders pay on delivery."
            : "Razorpay is not connected — the order is recorded, no payment is taken."}
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
        <span className="font-display text-xl font-light text-accent-ink">
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
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm text-content-muted">
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
          ? "cursor-not-allowed border-content/10 text-content-faint"
          : active
            ? "border-accent-ink bg-accent/[0.04]"
            : "border-content/20 hover:border-content/40",
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
        <span className="mt-0.5 block text-xs text-content-muted">{note}</span>
      </span>
    </label>
  );
}
