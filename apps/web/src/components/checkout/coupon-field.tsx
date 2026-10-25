"use client";

import { useState, useTransition } from "react";

import { Button, Field, TextInput } from "@siumora/ui";

import { applyCoupon, removeCoupon } from "@/app/actions/checkout";

/**
 * The coupon field in the order summary (plan 16 B19). Folded behind a
 * quiet link so a shopper without a code is not sent hunting for one
 * (Baymard: a visible empty coupon box sends people off to search for a
 * code, and some do not come back). One code at a time; the server says
 * what it is worth, and the parent re-reads the cart and re-quotes after.
 */
export function CouponField({
  id = "coupon",
  coupons,
  onChange,
}: {
  /** The input's id — distinct per rendered copy of the summary. */
  id?: string;
  coupons: readonly string[];
  /** Called with the codes now on the cart, after the server has applied them. */
  onChange: (coupons: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const apply = () => {
    if (!code.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await applyCoupon(code);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setCode("");
      setOpen(false);
      onChange(result.coupons);
    });
  };

  const remove = (applied: string) => {
    setError(null);
    startTransition(async () => {
      const result = await removeCoupon(applied);
      if (!result.ok) setError(result.message);
      else onChange(result.coupons);
    });
  };

  if (coupons.length > 0) {
    return (
      <div className="mt-5 text-sm">
        {coupons.map((applied) => (
          <div key={applied} className="flex min-h-11 items-center justify-between gap-3">
            <span>
              Coupon <span className="font-medium tracking-wide">{applied}</span> applied
            </span>
            <button
              type="button"
              onClick={() => remove(applied)}
              disabled={pending}
              className="min-h-11 text-content-muted underline underline-offset-4 hover:text-content disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ))}
        {error && (
          <p role="alert" className="text-xs text-accent-ink">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-5 min-h-11 text-sm text-content-muted underline underline-offset-4 hover:text-content"
      >
        Have a coupon code?
      </button>
    );
  }

  return (
    <Field label="Coupon code" htmlFor={id} error={error ?? undefined} className="mt-5">
      <div className="flex gap-2">
        <TextInput
          id={id}
          value={code}
          onChange={(event) => {
            setCode(event.target.value.replace(/\s/g, ""));
            setError(null);
          }}
          onKeyDown={(event) => {
            // Enter applies the code; it must not submit the checkout form.
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
          }}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          invalid={Boolean(error)}
          hasMessage={Boolean(error)}
          autoFocus
        />
        <Button type="button" variant="secondary" onClick={apply} disabled={pending || !code.trim()}>
          {pending ? "Checking…" : "Apply"}
        </Button>
      </div>
    </Field>
  );
}
