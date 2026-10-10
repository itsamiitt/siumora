"use client";

import { forwardRef } from "react";

import { MicroLabel } from "@siumora/ui";

/**
 * The mobile number, Indian only: a fixed +91 and ten digits.
 *
 * Paste-friendly — "+91 98765 43210", "098765 43210" and "98765-43210" all
 * reduce to the ten digits — and typed as `tel` with `tel-national`
 * autocomplete so the phone offers the number it already knows.
 */
export const PhoneField = forwardRef<
  HTMLInputElement,
  {
    id?: string;
    value: string;
    onChange: (digits: string) => void;
    disabled?: boolean;
    label?: string;
  }
>(function PhoneField({ id = "phone", value, onChange, disabled, label = "Mobile number" }, ref) {
  return (
    <div>
      <label htmlFor={id} className="block">
        <MicroLabel>{label}</MicroLabel>
      </label>
      <div className="mt-3 flex items-center border border-content/20 focus-within:border-accent-ink">
        <span className="pl-3 text-sm text-content-muted" aria-hidden="true">
          +91
        </span>
        <input
          ref={ref}
          id={id}
          type="tel"
          value={value}
          onChange={(event) => onChange(tenDigits(event.target.value))}
          inputMode="numeric"
          autoComplete="tel-national"
          maxLength={16}
          placeholder="98765 43210"
          disabled={disabled}
          aria-describedby={`${id}-hint`}
          className="h-12 min-w-0 flex-1 bg-transparent px-3 text-base outline-none disabled:opacity-60"
        />
      </div>
      <p id={`${id}-hint`} className="sr-only">
        Ten-digit Indian mobile number. We send a one-time code to it.
      </p>
    </div>
  );
});

/** Keep the last ten digits of whatever was typed or pasted. */
export function tenDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}
