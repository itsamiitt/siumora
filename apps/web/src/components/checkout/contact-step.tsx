"use client";

import { Button, CheckoutStep, Field, TextInput } from "@siumora/ui";

/**
 * Step 1 — the phone, first (plan 16 Phase C; the Kwik order).
 *
 * The field says why it is asked for (Baymard: 14% abandon over an
 * unexplained phone field). Verifying is offered, never forced: it is one
 * code, and it is what unlocks cash on delivery and the saved addresses —
 * so it is asked for here, quietly, instead of as a surprise at Pay.
 */
export function ContactStep({
  state,
  phone,
  onPhone,
  onBlur,
  error,
  verified,
  onVerify,
  reminders,
  onContinue,
  onEdit,
}: {
  state: "open" | "done" | "upcoming";
  phone: string;
  onPhone: (value: string) => void;
  onBlur: () => void;
  error: string | undefined;
  verified: boolean;
  onVerify: () => void;
  /** The cart-reminder opt-in (plan 16 B22) — present only when the store offers it. */
  reminders?: { checked: boolean; onChange: (checked: boolean) => void };
  onContinue: () => void;
  onEdit: () => void;
}) {
  const valid = /^[6-9]\d{9}$/.test(phone);
  return (
    <CheckoutStep
      step={1}
      title="Contact"
      state={state}
      onEdit={onEdit}
      summary={
        <>
          +91 {phone.slice(0, 5)} {phone.slice(5)}
          {verified && <span className="text-accent-ink"> · Verified</span>}
        </>
      }
    >
      <Field
        label="Mobile number"
        htmlFor="phone"
        error={error}
        hint="For delivery updates on WhatsApp. Never shared, never spammed."
      >
        <div className="flex">
          <span className="flex h-12 items-center border border-r-0 border-content/20 px-3 text-sm text-content-muted">
            +91
          </span>
          <TextInput
            id="phone"
            value={phone}
            onChange={(event) => {
              // A pasted "+91 98765 43210" keeps its local ten digits.
              const digits = event.target.value.replace(/\D/g, "");
              const local = digits.length > 10 && digits.startsWith("91") ? digits.slice(2) : digits;
              onPhone(local.slice(0, 10));
            }}
            onBlur={onBlur}
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="98765 43210"
            invalid={Boolean(error)}
            hasMessage
          />
        </div>
      </Field>

      {/* DPDP: asked, never assumed — unticked until the shopper ticks it,
          and the purpose is the whole sentence. */}
      {reminders && (
        <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 text-sm text-content-muted">
          <input
            type="checkbox"
            checked={reminders.checked}
            onChange={(event) => reminders.onChange(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent-ink)]"
          />
          <span>If I leave before ordering, send me one WhatsApp with a link back to my bag.</span>
        </label>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <Button variant="secondary" onClick={onContinue}>
          Continue
        </Button>
        {verified ? (
          <span className="text-sm text-accent-ink">This number is verified.</span>
        ) : (
          valid && (
            <button
              type="button"
              onClick={onVerify}
              className="min-h-11 text-left text-sm text-content-muted underline-offset-4 hover:text-accent-ink hover:underline"
            >
              Verify with a code — unlocks cash on delivery and your saved addresses
            </button>
          )
        )}
      </div>
    </CheckoutStep>
  );
}
