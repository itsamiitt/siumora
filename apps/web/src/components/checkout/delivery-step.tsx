"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { SavedAddress } from "@siumora/sdk";
import { isValidGstin } from "@siumora/core/gstin";
import {
  INDIAN_STATES,
  isValidPincode,
  normalisePincodeInput,
  stateByCode,
} from "@siumora/in-locale";
import { CheckoutStep, Field, RadioCard, TextInput, cn, inputClassName } from "@siumora/ui";

import { checkPincode, type QuoteResult } from "@/app/actions/checkout";
import { arrivalBy, formatArrival, type CheckoutField, type FieldErrors } from "@/lib/checkout-rules";

/**
 * Step 2 — where it is going (plan 16 Phase C).
 *
 * Pincode first: it fills the city and state (the serviceability row knows
 * both) and answers the two questions that decide whether to go on — can it
 * reach me, and by when. A pincode the courier does not serve says so here,
 * not after Pay. A saved address is one tap and hides the form.
 */

export interface AddressDraft {
  name: string;
  pincode: string;
  stateCode: string;
  city: string;
  line1: string;
  line2: string;
  landmark: string;
}

const SHOWN_SAVED = 2;

export function DeliveryStep({
  state,
  draft,
  onDraft,
  errors,
  onBlur,
  quote,
  quoteLoading,
  savedAddresses,
  savedId,
  onPickSaved,
  business,
  onBusiness,
  gstin,
  onGstin,
  gift,
  onEdit,
}: {
  state: "open" | "done" | "upcoming";
  draft: AddressDraft;
  onDraft: (patch: Partial<AddressDraft>) => void;
  errors: FieldErrors;
  onBlur: (field: CheckoutField) => void;
  quote: QuoteResult | null;
  quoteLoading: boolean;
  savedAddresses: readonly SavedAddress[];
  savedId: string | null;
  onPickSaved: (address: SavedAddress | null) => void;
  business: boolean;
  onBusiness: (on: boolean) => void;
  gstin: string;
  onGstin: (value: string) => void;
  /** The gift message (plan 16 B21) — present only when the store offers it. */
  gift?: { message: string; onMessage: (value: string) => void; error?: string | undefined };
  onEdit: () => void;
}) {
  const [showAllSaved, setShowAllSaved] = useState(false);
  const [lookup, setLookup] = useState<{ pincode: string; serviceable: boolean } | null>(null);
  // City and state are only filled in when empty or filled by us before —
  // never over what the shopper typed.
  const autofilled = useRef<{ city: string; stateCode: string }>({ city: "", stateCode: "" });
  // The lookup answers later than the keystroke that asked: compare against
  // what is in the fields when it lands, not when it was sent.
  const latest = useRef(draft);
  latest.current = draft;

  const { pincode } = draft;
  useEffect(() => {
    if (!isValidPincode(pincode) || savedId) return;
    let cancelled = false;
    void checkPincode(pincode).then((row) => {
      if (cancelled) return;
      setLookup({ pincode, serviceable: row.serviceable });
      const patch: Partial<AddressDraft> = {};
      if (row.city && (latest.current.city === "" || latest.current.city === autofilled.current.city)) {
        patch.city = row.city;
        autofilled.current.city = row.city;
      }
      if (row.stateCode && (latest.current.stateCode === "" || latest.current.stateCode === autofilled.current.stateCode)) {
        patch.stateCode = row.stateCode;
        autofilled.current.stateCode = row.stateCode;
      }
      if (Object.keys(patch).length > 0) onDraft(patch);
    });
    return () => {
      cancelled = true;
    };
    // Looked up when the pincode changes; the draft is read, not watched.
  }, [pincode, savedId]);

  const serviceable = quote ? quote.serviceable : lookup?.pincode === pincode ? lookup.serviceable : undefined;
  const arrival = quote?.serviceable ? arrivalBy(quote.estimatedDays, new Date()) : undefined;
  const stateName = stateByCode(draft.stateCode)?.name;
  const gstinValid = isValidGstin(gstin);
  const saved = savedAddresses.find((address) => address.id === savedId);
  const visibleSaved = showAllSaved ? savedAddresses : savedAddresses.slice(0, SHOWN_SAVED);

  const promise =
    !isValidPincode(pincode) ? null : serviceable === false ? (
      <p className="mt-3 text-sm text-accent-ink" role="status">
        We don&apos;t deliver to {pincode} yet. Try another pincode, or{" "}
        <Link href="/shipping" className="underline underline-offset-4">see where we ship</Link>.
      </p>
    ) : arrival ? (
      <p className="mt-3 text-sm" role="status">
        Arrives by <span className="font-medium">{formatArrival(arrival)}</span>
        {quoteLoading && <span className="text-content-faint"> · checking…</span>}
      </p>
    ) : null;

  return (
    <CheckoutStep
      step={2}
      title="Delivery"
      state={state}
      onEdit={onEdit}
      summary={
        <>
          {draft.name} · {[draft.line1, draft.line2].filter(Boolean).join(", ")}, {draft.city} {draft.pincode}
          {arrival && <span className="block">Arrives by {formatArrival(arrival)}</span>}
        </>
      }
    >
      {savedAddresses.length > 0 && (
        <fieldset className="mb-6">
          <legend className="mb-2 text-sm text-content-muted">Deliver to a saved address</legend>
          <div className="space-y-2">
            {visibleSaved.map((address) => (
              <RadioCard
                key={address.id}
                name="saved-address"
                value={address.id}
                checked={savedId === address.id}
                onSelect={() => onPickSaved(address)}
                title={address.name}
                note={[address.line1, address.line2, address.city, address.pincode].filter(Boolean).join(", ")}
                {...(address.isDefault ? { aside: "Default" } : {})}
              />
            ))}
            {savedAddresses.length > SHOWN_SAVED && !showAllSaved && (
              <button
                type="button"
                onClick={() => setShowAllSaved(true)}
                className="min-h-11 text-sm text-content-muted underline-offset-4 hover:text-accent-ink hover:underline"
              >
                Show all {savedAddresses.length} addresses
              </button>
            )}
            <RadioCard
              name="saved-address"
              value="new"
              checked={savedId === null}
              onSelect={() => onPickSaved(null)}
              title="A new address"
            />
          </div>
        </fieldset>
      )}

      {saved ? (
        <div className="text-sm">
          {promise}
          <button
            type="button"
            onClick={() => onPickSaved(null)}
            className="mt-2 min-h-11 text-content-muted underline-offset-4 hover:text-accent-ink hover:underline"
          >
            Edit this address
          </button>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Pincode"
              htmlFor="pincode"
              error={errors.pincode}
              {...(stateName && draft.city && serviceable !== false
                ? { hint: `${draft.city}, ${stateName}` }
                : {})}
            >
              <TextInput
                id="pincode"
                value={pincode}
                onChange={(event) => onDraft({ pincode: normalisePincodeInput(event.target.value) })}
                onBlur={() => onBlur("pincode")}
                inputMode="numeric"
                autoComplete="postal-code"
                placeholder="400001"
                invalid={Boolean(errors.pincode)}
                hasMessage={Boolean(errors.pincode || (stateName && draft.city))}
              />
            </Field>
            <Field label="State" htmlFor="state" error={errors.stateCode}>
              <select
                id="state"
                value={draft.stateCode}
                onChange={(event) => onDraft({ stateCode: event.target.value })}
                onBlur={() => onBlur("stateCode")}
                autoComplete="address-level1"
                aria-invalid={errors.stateCode ? true : undefined}
                className={inputClassName}
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
          {promise}

          <Field label="City" htmlFor="city" error={errors.city} className="mt-4">
            <TextInput
              id="city"
              value={draft.city}
              onChange={(event) => onDraft({ city: event.target.value })}
              onBlur={() => onBlur("city")}
              autoComplete="address-level2"
              placeholder="Mumbai"
              invalid={Boolean(errors.city)}
              hasMessage={Boolean(errors.city)}
            />
          </Field>
          <Field label="Full name" htmlFor="name" error={errors.name} className="mt-4">
            <TextInput
              id="name"
              value={draft.name}
              onChange={(event) => onDraft({ name: event.target.value })}
              onBlur={() => onBlur("name")}
              autoComplete="name"
              placeholder="Asha Menon"
              invalid={Boolean(errors.name)}
              hasMessage={Boolean(errors.name)}
            />
          </Field>
          <Field
            label="Flat, house or building"
            htmlFor="address"
            error={errors.line1}
            className="mt-4"
            {...(quote?.addressQuality.needsReview && quote.addressQuality.issues[0] && draft.line1.length > 0
              ? { hint: `Add ${quote.addressQuality.issues[0].toLowerCase()} so the courier can find you.` }
              : {})}
          >
            <TextInput
              id="address"
              value={draft.line1}
              onChange={(event) => onDraft({ line1: event.target.value })}
              onBlur={() => onBlur("line1")}
              autoComplete="address-line1"
              placeholder="Flat 3B, Sunrise Apartments"
              invalid={Boolean(errors.line1)}
              hasMessage={Boolean(errors.line1 || quote?.addressQuality.needsReview)}
            />
          </Field>
          <Field label="Area and street" htmlFor="area" optional className="mt-4">
            <TextInput
              id="area"
              value={draft.line2}
              onChange={(event) => onDraft({ line2: event.target.value })}
              autoComplete="address-line2"
              placeholder="Linking Road, Bandra West"
            />
          </Field>
          <Field label="Landmark" htmlFor="landmark" optional className="mt-4">
            <TextInput
              id="landmark"
              value={draft.landmark}
              onChange={(event) => onDraft({ landmark: event.target.value })}
              placeholder="Opposite the post office"
            />
          </Field>
        </>
      )}

      {/* Behind a toggle: most orders are not B2B, and a GSTIN field on every
          checkout is a question almost nobody needs to answer. */}
      <div className="mt-6 border-t border-[var(--color-rule)] pt-5">
        {business ? (
          <Field
            label="GSTIN"
            htmlFor="gstin"
            error={gstin.length === 15 && !gstinValid ? "That GSTIN does not look right — check the last character." : undefined}
            hint="We will put this on the invoice so you can claim input credit."
          >
            <TextInput
              id="gstin"
              value={gstin}
              onChange={(event) => onGstin(event.target.value.toUpperCase())}
              maxLength={15}
              autoComplete="off"
              placeholder="27AAPFU0939F1ZV"
              invalid={gstin.length === 15 && !gstinValid}
              hasMessage
              className="font-mono tracking-wide"
            />
          </Field>
        ) : (
          <button
            type="button"
            onClick={() => onBusiness(true)}
            className="min-h-11 text-sm text-content-muted underline-offset-4 hover:text-accent-ink hover:underline"
          >
            Buying for a business?
          </button>
        )}
      </div>

      {gift && <GiftMessage {...gift} />}
    </CheckoutStep>
  );
}

const GIFT_MAX = 150;

/**
 * A gift message for the card in the parcel (plan 16 B21) — behind a quiet
 * link like the GSTIN, because most orders are not gifts. The count is
 * shown as the shopper types, so the limit is never a surprise at Pay.
 */
function GiftMessage({
  message,
  onMessage,
  error,
}: {
  message: string;
  onMessage: (value: string) => void;
  error?: string | undefined;
}) {
  const [open, setOpen] = useState(message.length > 0);
  if (!open) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-11 text-sm text-content-muted underline-offset-4 hover:text-accent-ink hover:underline"
        >
          Sending it as a gift? Add a message
        </button>
      </div>
    );
  }
  return (
    <Field
      label="Gift message"
      htmlFor="gift-message"
      optional
      error={error}
      hint={`Handwritten on a card in the parcel. ${message.length}/${GIFT_MAX}`}
      className="mt-4"
    >
      <textarea
        id="gift-message"
        value={message}
        onChange={(event) => onMessage(event.target.value.slice(0, GIFT_MAX))}
        maxLength={GIFT_MAX}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby="gift-message-message"
        className={cn(inputClassName, "h-auto py-3")}
        placeholder="Happy birthday, Asha! Love, Ravi"
      />
    </Field>
  );
}
