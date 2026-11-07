"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { gaClientId, getConsent, mintEventId, track } from "@siumora/analytics/client";
import { adsAllowed, analyticsAllowed } from "@siumora/analytics";
import type { CartLine } from "@siumora/core";
import { isValidGstin } from "@siumora/core/gstin";
import type { PaymentFlow, QuotedTotals, SavedAddress } from "@siumora/sdk";
import { formatPaise, isValidPincode } from "@siumora/in-locale";
import { Button, TrustRow } from "@siumora/ui";

import { saveReminderChoice } from "@/app/actions/checkout";
import { completePayment, submitOrder } from "@/app/actions/order";
import { SignInSheet } from "@/components/auth/auth-sheet";
import { notifyCartChanged } from "@/components/cart-badge";
import {
  FIELD_ID,
  analyticsItems,
  deliveryErrors,
  firstInvalid,
  phoneError,
  type CheckoutField,
  type FieldErrors,
} from "@/lib/checkout-rules";
import { openRazorpayCheckout } from "@/lib/razorpay-checkout";

import { CheckoutSummary, CollapsedSummary } from "./checkout-summary";
import { CouponField } from "./coupon-field";
import { ContactStep } from "./contact-step";
import { DeliveryStep, type AddressDraft } from "./delivery-step";
import { PaymentStep, type PaymentMethod } from "./payment-step";
import { useCheckoutQuote } from "./use-checkout-quote";

/**
 * Single-page checkout, mobile-first (plan 16 Phase C).
 *
 * Three steps in the order the Indian one-click checkouts use — phone, then
 * address, then pay — each collapsing to a line once done. One button, pinned
 * to the bottom on a phone, carries the page: Continue, Continue to payment,
 * then Pay; Enter does the same, never jumping ahead to Pay. The summary and
 * the Pay label always show the server's total for the chosen method
 * (rule R6): the COD fee and inter-state GST appear when they apply, never
 * after Pay. Pay is never a dead grey button: pressed with something
 * missing, it says what, opens that step and puts focus on the field.
 *
 * Prepaid money moves one of two ways, by backend (plan 16 Phase B):
 * payment-first (Medusa) opens Razorpay before any order exists, so a
 * closed modal costs nothing and Pay again reuses the same payment;
 * order-first (Fastify, frozen) places a pending order and lets the
 * webhook confirm it.
 */

type Step = 1 | 2 | 3;

const PHONE_STEP_FIELDS: readonly CheckoutField[] = ["phone"];

export function CheckoutForm({
  lines,
  initialTotals,
  initialCoupons = [],
  giftMessageOffered = false,
  remindersOffered = false,
  razorpayConfigured,
  paymentFlow,
  savedAddresses = [],
  viewerPhone,
}: {
  lines: readonly CartLine[];
  /** The server's prepaid, intra-state total — shown until the first quote lands. */
  initialTotals: QuotedTotals;
  /** Coupon codes already on the cart (plan 16 B19). */
  initialCoupons?: readonly string[];
  /** The store offers a gift message (plan 16 B21). */
  giftMessageOffered?: boolean;
  /** The store offers the cart-reminder opt-in (plan 16 B22). */
  remindersOffered?: boolean;
  razorpayConfigured: boolean;
  paymentFlow: PaymentFlow;
  /** The signed-in shopper's address book, offered first. */
  savedAddresses?: SavedAddress[];
  /** The signed-in shopper's number, as the default delivery phone. */
  viewerPhone?: string;
}) {
  const router = useRouter();
  const preferred = savedAddresses.find((address) => address.isDefault) ?? savedAddresses[0];

  const [phone, setPhone] = useState(preferred?.phone ?? viewerPhone ?? "");
  const [savedId, setSavedId] = useState<string | null>(preferred?.id ?? null);
  const [draft, setDraft] = useState<AddressDraft>(() => ({
    name: preferred?.name ?? "",
    pincode: preferred?.pincode ?? "",
    stateCode: preferred?.stateCode ?? "",
    city: preferred?.city ?? "",
    line1: preferred?.line1 ?? "",
    line2: preferred?.line2 ?? "",
    landmark: "",
  }));
  // Prepaid is offered unless this is the payment-first backend without
  // Razorpay connected — there, it would only be refused.
  const prepaidOffered = paymentFlow === "order-first" || razorpayConfigured;
  const [method, setMethod] = useState<PaymentMethod>(prepaidOffered ? "upi" : "cod");
  const [business, setBusiness] = useState(false);
  const [gstin, setGstin] = useState("");
  const [step, setStep] = useState<Step>(() =>
    phoneError(preferred?.phone ?? viewerPhone ?? "") ? 1 : preferred ? 3 : 2,
  );
  const [touched, setTouched] = useState<ReadonlySet<CheckoutField>>(new Set());
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"verify" | "stepup" | null>(null);
  const [verifiedHere, setVerifiedHere] = useState(false);
  const resumeAfterVerify = useRef(false);
  const [placing, startPlacing] = useTransition();

  // A pincode checked on the bag or a product page is already known: start
  // from it rather than asking twice (PincodeChecker keeps it).
  useEffect(() => {
    if (draft.pincode) return;
    try {
      const remembered = window.localStorage.getItem("siumora.pincode");
      if (remembered && isValidPincode(remembered)) {
        setDraft((current) => (current.pincode ? current : { ...current, pincode: remembered }));
      }
    } catch {
      // Storage can be disabled; the shopper types it instead.
    }
    // Mount-only: a pincode the shopper clears must stay cleared.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Gift message and cart reminders (plan 16 B21, B22) ─────────────────
  const [giftMessage, setGiftMessage] = useState("");
  const [giftError, setGiftError] = useState<string | undefined>(undefined);
  const [remindMe, setRemindMe] = useState(false);

  // ── Coupons (plan 16 B19) ───────────────────────────────────────────────
  // The server applies the code; the page then re-reads the cart (the lines
  // and the pre-quote totals carry the discount) and the quote re-runs.
  const [coupons, setCoupons] = useState<string[]>(() => [...initialCoupons]);
  const [couponRound, setCouponRound] = useState(0);
  const onCoupons = (next: string[]) => {
    setCoupons(next);
    setCouponRound((round) => round + 1);
    router.refresh();
  };
  // Rendered in both summaries (folded on mobile, beside the steps on
  // desktop), so each gets its own field id.
  const couponField = (id: string) => <CouponField id={id} coupons={coupons} onChange={onCoupons} />;

  // ── The quote: promise, COD terms, totals ───────────────────────────────
  const { quote, loading: quoteLoading } = useCheckoutQuote({
    refresh: couponRound,
    pincode: draft.pincode,
    address: [draft.line1, draft.line2].filter(Boolean).join(", "),
    city: draft.city,
    stateCode: draft.stateCode,
    phone,
  });
  const cod = quote?.cod ?? null;
  const verified = verifiedHere || Boolean(quote?.phoneVerified) || (viewerPhone !== undefined && viewerPhone === phone);

  // A pincode change can withdraw COD while it is chosen. Fall back to the
  // first method still on offer rather than leaving an unavailable one.
  useEffect(() => {
    if (method === "cod" && cod && !cod.available && prepaidOffered) setMethod("upi");
  }, [cod, method, prepaidOffered]);

  // The bag changed under the quote (another tab, a price correction): say
  // so, and refresh the lines the summary shows.
  const firstVersion = useRef<string | null>(null);
  useEffect(() => {
    const version = quote?.cartVersion;
    if (!version) return;
    if (firstVersion.current === null) {
      firstVersion.current = version;
    } else if (version !== firstVersion.current) {
      firstVersion.current = version;
      setNotice("Your bag changed since you opened checkout — the totals below are up to date.");
      router.refresh();
    }
  }, [quote?.cartVersion, router]);

  const totals: QuotedTotals =
    (method === "cod" ? quote?.totals?.cod : quote?.totals?.prepaid) ?? quote?.totals?.prepaid ?? initialTotals;
  const interState = quote?.totals?.interState ?? false;
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  // ── Validation ──────────────────────────────────────────────────────────
  const errors: FieldErrors = useMemo(() => {
    const phoneProblem = phoneError(phone);
    return {
      ...(phoneProblem ? { phone: phoneProblem } : {}),
      ...deliveryErrors(draft),
      ...serverErrors,
    };
  }, [phone, draft, serverErrors]);
  const shown = (field: CheckoutField) => (touched.has(field) ? errors[field] : undefined);
  const shownErrors: FieldErrors = Object.fromEntries(
    (Object.keys(errors) as CheckoutField[]).filter((field) => touched.has(field)).map((field) => [field, errors[field]]),
  );
  const touch = (...fields: CheckoutField[]) =>
    setTouched((current) => new Set([...current, ...fields]));

  /** Open the step holding `field` and put focus on it once it renders. */
  function focusField(field: CheckoutField) {
    setStep(PHONE_STEP_FIELDS.includes(field) ? 1 : 2);
    if (field !== "phone") setSavedId(null);
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => document.getElementById(FIELD_ID[field])?.focus()),
    );
  }

  // ── Analytics: the funnel plan/08 names ─────────────────────────────────
  const items = useMemo(() => analyticsItems(lines), [lines]);
  const begun = useRef(false);
  useEffect(() => {
    if (begun.current || items.length === 0) return;
    begun.current = true;
    track("begin_checkout", {
      event_id: mintEventId(),
      currency: "INR",
      value: initialTotals.total / 100,
      items,
    });
  }, [items, initialTotals.total]);
  const shippingSent = useRef(false);
  function deliveryDone() {
    if (shippingSent.current || items.length === 0) return;
    shippingSent.current = true;
    track("add_shipping_info", {
      event_id: mintEventId(),
      currency: "INR",
      value: totals.total / 100,
      shipping_tier: "standard",
      items,
    });
  }

  // ── Step transitions ────────────────────────────────────────────────────
  function continueFromContact() {
    touch("phone");
    if (errors.phone) return focusField("phone");
    setError(null);
    // Recorded now, not at Pay: the reminder is for the shopper who never
    // gets there. Unticked sends a withdrawal, so changing one's mind works.
    if (remindersOffered) void saveReminderChoice(phone, remindMe);
    setStep(2);
  }

  /** What stops the shopper leaving the delivery step, or nothing. */
  function deliveryBlocker(): { message: string; field?: CheckoutField } | undefined {
    const field = firstInvalid(errors);
    if (field) return { message: errors[field]!, field };
    if (quote && !quote.serviceable) return { message: `We don't deliver to ${draft.pincode} yet.`, field: "pincode" };
    if (business && !isValidGstin(gstin)) return { message: "Check the GSTIN, or untick buying for a business." };
    return undefined;
  }

  /** What stops the order: delivery first, then the method. */
  function blocker(): { message: string; field?: CheckoutField } | undefined {
    const stop = deliveryBlocker();
    if (stop) return stop;
    if (method === "cod" && cod && !cod.available) return { message: cod.reason ?? "Cash on delivery is not available here." };
    return undefined;
  }

  function continueFromDelivery() {
    touch("phone", "name", "pincode", "stateCode", "city", "line1");
    const stop = deliveryBlocker();
    if (stop?.field) return focusField(stop.field);
    if (stop) {
      // The GSTIN has no CheckoutField of its own; say it here, not at Pay.
      setError(stop.message);
      document.getElementById("gstin")?.focus();
      return;
    }
    setError(null);
    deliveryDone();
    setStep(3);
  }

  /** The one action: Continue, Continue to payment, then Pay. Enter does the same. */
  function primaryAction() {
    if (placing) return;
    if (step === 1) continueFromContact();
    else if (step === 2) continueFromDelivery();
    else placeNow();
  }

  function pickSaved(address: SavedAddress | null) {
    setServerErrors({});
    if (!address) {
      setSavedId(null);
      return;
    }
    setSavedId(address.id);
    setPhone((current) => (current ? current : address.phone));
    setDraft({
      name: address.name,
      pincode: address.pincode,
      stateCode: address.stateCode,
      city: address.city,
      line1: address.line1,
      line2: address.line2 ?? "",
      landmark: "",
    });
  }

  function chooseMethod(next: PaymentMethod) {
    setMethod(next);
    setError(null);
    // COD will ask to verify this number: ask now, while the shopper is
    // choosing, instead of as a surprise after Pay.
    if (next === "cod" && quote?.codNeedsVerification && !verified && !phoneError(phone)) {
      setSheet("verify");
    }
  }

  // ── Placing the order ───────────────────────────────────────────────────
  function placeNow() {
    setError(null);
    setNotice(null);
    touch("phone", "name", "pincode", "stateCode", "city", "line1");
    const stop = blocker();
    if (stop) {
      setError(stop.message);
      if (stop.field) focusField(stop.field);
      return;
    }

    startPlacing(async () => {
      // Minted here and persisted on the order so the browser purchase
      // pixel and the server-side send share one id and dedupe. It is also
      // the idempotency key: a double tap cannot place two orders.
      const eventId = mintEventId();
      // A saved address starts on Payment and never passes through
      // "Continue to payment" — the funnel step still happened.
      deliveryDone();
      track("add_payment_info", {
        event_id: mintEventId(),
        currency: "INR",
        value: totals.total / 100,
        payment_type: method,
        items,
      });

      const result = await submitOrder({
        address: {
          name: draft.name.trim(),
          phone,
          line1: draft.line1.trim(),
          ...(draft.line2.trim() ? { line2: draft.line2.trim() } : {}),
          ...(draft.landmark.trim() ? { landmark: draft.landmark.trim() } : {}),
          city: draft.city.trim(),
          stateCode: draft.stateCode,
          pincode: draft.pincode,
        },
        paymentMethod: method,
        requiresCodConfirmation: method === "cod" && cod?.verification !== "none",
        eventId,
        // Captured here because the server cannot see the cookie, and GA4
        // will not accept a server event without it.
        gaClientId: gaClientId(),
        // Only both yeses widen what the server conversion may carry.
        consent: adsAllowed(getConsent()) && analyticsAllowed(getConsent()) ? "full" : "default",
        ...(business && isValidGstin(gstin) ? { buyerGstin: gstin } : {}),
        ...(giftMessageOffered && giftMessage.trim() ? { giftMessage: giftMessage.trim() } : {}),
        codFee: method === "cod" ? (cod?.fee ?? 0) : 0,
      });

      if (result.ok && result.payFirst && result.razorpay) {
        // Payment-first: no order exists yet and the bag is untouched.
        const outcome = await openRazorpayCheckout({
          keyId: result.razorpay.keyId,
          orderId: result.razorpay.orderId,
          amountPaise: result.razorpay.amountPaise,
          contact: phone,
          ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
        });
        if (outcome.kind === "paid") {
          const placed = await completePayment({ paymentMethod: method, razorpay: outcome.proof, eventId });
          if (placed.ok && placed.orderNumber) {
            notifyCartChanged(0);
            router.push(`/orders/${placed.orderNumber}`);
          } else {
            setError(placed.message ?? "We could not confirm the order.");
          }
        } else {
          setError(
            outcome.kind === "dismissed"
              ? "Payment not completed. Nothing was charged — press Pay to try again."
              : "The payment window could not open. Check your connection and try again.",
          );
        }
      } else if (result.ok && result.orderNumber) {
        if (result.razorpay) {
          // Order-first: the modal collects the payment; the signed webhook
          // and the recon sweep confirm it. The order page renders whatever
          // the server knows is true.
          await openRazorpayCheckout({
            keyId: result.razorpay.keyId,
            orderId: result.razorpay.orderId,
            amountPaise: result.razorpay.amountPaise,
            contact: phone,
            ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
          });
        }
        notifyCartChanged(0);
        router.push(`/orders/${result.orderNumber}`);
      } else if (result.error === "verify_phone") {
        // COD needs the delivery number verified; once it is, carry on
        // placing — the shopper already pressed Pay.
        resumeAfterVerify.current = true;
        setSheet("verify");
      } else if (result.error === "step_up_required") {
        setSheet("stepup");
      } else {
        if (result.fields && "giftMessage" in result.fields) {
          setGiftError(String(result.fields.giftMessage));
          setStep(2);
        }
        if (result.fields) {
          const fields = result.fields as FieldErrors;
          setServerErrors(fields);
          const field = firstInvalid(fields);
          if (field) focusField(field);
        }
        setError(result.message ?? "Could not place the order.");
      }
    });
  }

  // The bar speaks only for the step in front of the shopper: field errors
  // sit under their fields, and a later step's problems wait for that step.
  const barMessage = error ?? (step === 3 && touched.size > 0 ? blocker()?.message : undefined);
  const actionLabel = placing
    ? "Placing…"
    : step === 1
      ? "Continue"
      : step === 2
        ? "Continue to payment"
        : method === "cod"
          ? `Place order · ${formatPaise(totals.total)}`
          : `Pay ${formatPaise(totals.total)}`;
  const stepState = (n: Step) => (step === n ? "open" : step > n ? "done" : "upcoming");

  return (
    <>
      <div className="grid gap-10 lg:grid-cols-[1fr_24rem] lg:gap-16">
        <div>
          <CollapsedSummary total={totals.total}>
            <CheckoutSummary
              lines={lines}
              totals={totals}
              interState={interState}
              itemCount={itemCount}
              coupon={couponField("coupon-mobile")}
            />
          </CollapsedSummary>

          {notice && (
            <p role="status" className="mt-6 border border-accent-ink/25 bg-accent/[0.04] p-3 text-sm">
              {notice}
            </p>
          )}

          <form
            className="mt-6 lg:mt-0"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              primaryAction();
            }}
          >
            <ContactStep
              state={stepState(1)}
              phone={phone}
              onPhone={(value) => {
                setPhone(value);
                setServerErrors(({ phone: _, ...rest }) => rest);
              }}
              onBlur={() => phone.length > 0 && touch("phone")}
              error={shown("phone")}
              verified={verified}
              onVerify={() => setSheet("verify")}
              {...(remindersOffered ? { reminders: { checked: remindMe, onChange: setRemindMe } } : {})}
              onEdit={() => {
                setError(null);
                setStep(1);
              }}
            />
            <DeliveryStep
              state={stepState(2)}
              draft={draft}
              onDraft={(patch) => {
                setDraft((current) => ({ ...current, ...patch }));
                setServerErrors((current) => {
                  const next = { ...current };
                  for (const key of Object.keys(patch)) delete next[key as CheckoutField];
                  return next;
                });
              }}
              errors={shownErrors}
              onBlur={(field) => touch(field)}
              quote={isValidPincode(draft.pincode) ? quote : null}
              quoteLoading={quoteLoading}
              savedAddresses={savedAddresses}
              savedId={savedId}
              onPickSaved={pickSaved}
              business={business}
              onBusiness={setBusiness}
              gstin={gstin}
              onGstin={setGstin}
              {...(giftMessageOffered
                ? {
                    gift: {
                      message: giftMessage,
                      onMessage: (value: string) => {
                        setGiftMessage(value);
                        setGiftError(undefined);
                      },
                      error: giftError,
                    },
                  }
                : {})}
              onEdit={() => {
                setError(null);
                setStep(2);
              }}
            />
            <PaymentStep
              state={stepState(3)}
              method={method}
              onMethod={chooseMethod}
              prepaidOffered={prepaidOffered}
              cod={cod}
              pincodeKnown={isValidPincode(draft.pincode)}
              onEdit={() => setStep(3)}
            />

            {/* The one action, pinned to the bottom of a phone screen while
                the form scrolls — thumb's reach, clear of the home indicator.
                Its label follows the step; there is never a second button. */}
            <div className="sticky bottom-0 z-10 -mx-5 border-t border-[var(--color-rule)] bg-ground px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 lg:static lg:mx-0 lg:mt-8 lg:border-0 lg:p-0">
              <p aria-live="polite" className={barMessage ? "mb-2 text-sm text-accent-ink" : "sr-only"}>
                {barMessage}
              </p>
              <Button size="lg" type="submit" className="w-full" disabled={placing}>
                {actionLabel}
              </Button>
            </div>
            {/* Out of the sticky bar: on a phone it would wrap to two lines
                and eat the screen the keyboard has not already taken. */}
            <TrustRow
              className="mt-4 justify-center"
              items={[
                {
                  label:
                    method === "cod"
                      ? "Pay when it arrives"
                      : paymentFlow === "order-first" && !razorpayConfigured
                        ? "Razorpay not connected — no payment is taken"
                        : "Secured by Razorpay",
                },
                { label: "GST invoice" },
                { label: "7-day returns" },
                { label: "Gift-wrapped" },
              ]}
            />
          </form>
        </div>

        <aside className="hidden lg:sticky lg:top-28 lg:block lg:self-start">
          <div className="border border-[var(--color-rule)] p-6">
            <CheckoutSummary
              lines={lines}
              totals={totals}
              interState={interState}
              itemCount={itemCount}
              coupon={couponField("coupon")}
            />
          </div>
        </aside>
      </div>

      <SignInSheet
        open={sheet === "verify"}
        onClose={() => {
          resumeAfterVerify.current = false;
          setSheet(null);
        }}
        title="Verify your number"
        intro="One code to this number — no password. It unlocks cash on delivery and your saved addresses."
        surface="checkout_cod"
        initialPhone={phone}
        lockPhone
        onDone={() => {
          setSheet(null);
          setVerifiedHere(true);
          if (resumeAfterVerify.current) {
            resumeAfterVerify.current = false;
            placeNow();
          } else {
            // Signed in now: the page re-reads the session and address book.
            router.refresh();
          }
        }}
      />
      <SignInSheet
        open={sheet === "stepup"}
        onClose={() => setSheet(null)}
        title="Confirm it's you"
        intro="This order goes to a new address, so we ask for a fresh code before cash on delivery."
        mode="stepup"
        surface="checkout_stepup"
        {...(phone ? { maskedPhone: `${phone.slice(0, 2)}••••${phone.slice(-4)}` } : {})}
        onDone={() => {
          setSheet(null);
          placeNow();
        }}
      />
    </>
  );
}
