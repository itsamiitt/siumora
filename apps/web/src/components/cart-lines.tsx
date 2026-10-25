"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useOptimistic, useState, useTransition } from "react";

import { mintEventId, track } from "@siumora/analytics/client";
import type { CartLine } from "@siumora/core";
import { formatPaise } from "@siumora/in-locale";
import { MicroLabel, cn } from "@siumora/ui";

import { addToCart, removeFromCart, updateCartQuantity } from "@/app/actions/cart";
import { moveBagLineToSaved } from "@/app/actions/wishlist";
import { analyticsItems } from "@/lib/checkout-rules";

import { notifyCartChanged } from "./cart-badge";

/**
 * Bag lines with optimistic quantity changes (plan 16 Phase D).
 *
 * The quantity flips immediately and reconciles when the action returns. A
 * change the stock cannot fill snaps back and says why on the line ("Only 2
 * left") instead of silently undoing itself; "+" stops at what is on hand
 * when the bag knows it. Remove is undoable for a few seconds — a slip of
 * the thumb should not cost a piece someone chose — and "Save for later"
 * moves it to the wishlist rather than deleting it.
 *
 * `compact` is the drawer's version: the same behaviour, smaller, without
 * save-for-later. `onChanged` lets the drawer re-read the bag after a
 * mutation; on the bag page the server action's revalidation does that.
 */

const UNDO_MS = 6000;

export function CartLines({
  lines,
  compact = false,
  highlight,
  onChanged,
}: {
  lines: CartLine[];
  compact?: boolean;
  /** The variant just added, marked for a moment in the drawer. */
  highlight?: string | undefined;
  onChanged?: () => void;
}) {
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [removed, setRemoved] = useState<CartLine | null>(null);
  const [optimisticLines, applyOptimistic] = useOptimistic(
    lines,
    (state: CartLine[], update: { variantId: string; quantity: number }) =>
      state
        .map((line) =>
          line.variantId === update.variantId ? { ...line, quantity: update.quantity } : line,
        )
        .filter((line) => line.quantity > 0),
  );

  // The undo offer lapses on its own.
  useEffect(() => {
    if (!removed) return;
    const timer = window.setTimeout(() => setRemoved(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [removed]);

  function mark(variantId: string, on: boolean) {
    setBusy((current) => {
      const next = new Set(current);
      if (on) next.add(variantId);
      else next.delete(variantId);
      return next;
    });
  }

  function run(line: CartLine, quantity: number, action: () => Promise<{ ok: boolean; message?: string; count: number }>) {
    setErrors(({ [line.variantId]: _, ...rest }) => rest);
    mark(line.variantId, true);
    startTransition(async () => {
      applyOptimistic({ variantId: line.variantId, quantity });
      const result = await action();
      notifyCartChanged(result.count);
      mark(line.variantId, false);
      if (!result.ok) {
        setErrors((current) => ({
          ...current,
          [line.variantId]: result.message ?? "Could not update this piece.",
        }));
      }
      onChanged?.();
    });
  }

  function remove(line: CartLine) {
    track("remove_from_cart", {
      event_id: mintEventId(),
      currency: "INR",
      value: (line.unitPrice * line.quantity) / 100,
      items: analyticsItems([line]),
    });
    setRemoved(line);
    run(line, 0, () => removeFromCart(line.variantId));
  }

  function undo() {
    const line = removed;
    if (!line) return;
    setRemoved(null);
    startTransition(async () => {
      const result = await addToCart(line.variantId, line.quantity);
      notifyCartChanged(result.count);
      onChanged?.();
    });
  }

  function saveForLater(line: CartLine) {
    run(line, 0, () => moveBagLineToSaved(line.productHandle, line.variantId));
  }

  return (
    <>
      <ul
        className={cn(
          "divide-y divide-[var(--color-rule)] border-t border-[var(--color-rule)]",
          !compact && "mt-8",
        )}
      >
        {optimisticLines.map((line) => {
          const atStock = line.available !== undefined && line.quantity >= line.available;
          const pending = busy.has(line.variantId);
          return (
            <li
              key={line.variantId}
              aria-busy={pending}
              className={cn(
                "flex gap-4 transition-opacity",
                compact ? "py-4" : "gap-5 py-6",
                pending && "opacity-60",
              )}
            >
              <Link href={`/products/${line.productHandle}`} className="shrink-0 bg-ground-raised">
                <Image
                  src={line.imageUrl}
                  alt={line.title}
                  width={compact ? 72 : 96}
                  height={compact ? 90 : 120}
                  className={compact ? "h-[90px] w-[72px] object-cover" : "h-30 w-24 object-cover"}
                />
              </Link>

              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex justify-between gap-4">
                  <div className="min-w-0">
                    <Link href={`/products/${line.productHandle}`}>
                      <h2
                        className="font-heading text-sm uppercase"
                        style={{ letterSpacing: "var(--tracking-caps)" }}
                      >
                        {line.title}
                      </h2>
                    </Link>
                    <p className="mt-1 text-sm text-content-muted">
                      {line.variantTitle}
                      {highlight === line.variantId && (
                        <span className="text-accent-ink"> · Just added</span>
                      )}
                    </p>
                  </div>
                  <p className="shrink-0 font-medium">{formatPaise(line.unitPrice * line.quantity)}</p>
                </div>

                <div className="mt-auto flex items-center justify-between gap-4 pt-3">
                  <div className="flex items-center border border-content/20">
                    <QuantityButton
                      label={`Decrease quantity of ${line.title}`}
                      disabled={pending}
                      onClick={() =>
                        line.quantity <= 1
                          ? remove(line)
                          : run(line, line.quantity - 1, () =>
                              updateCartQuantity(line.variantId, line.quantity - 1),
                            )
                      }
                    >
                      −
                    </QuantityButton>
                    <span className="w-10 text-center text-sm tabular-nums" aria-live="polite">
                      {line.quantity}
                    </span>
                    <QuantityButton
                      label={`Increase quantity of ${line.title}`}
                      disabled={pending || atStock}
                      onClick={() =>
                        run(line, line.quantity + 1, () =>
                          updateCartQuantity(line.variantId, line.quantity + 1),
                        )
                      }
                    >
                      +
                    </QuantityButton>
                  </div>

                  <div className="flex items-center gap-4">
                    {!compact && (
                      <button
                        type="button"
                        onClick={() => saveForLater(line)}
                        disabled={pending}
                        className="min-h-11 transition-colors hover:text-accent-ink"
                      >
                        <MicroLabel>Save for later</MicroLabel>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(line)}
                      disabled={pending}
                      className="min-h-11 transition-colors hover:text-accent-ink"
                    >
                      <MicroLabel>Remove</MicroLabel>
                    </button>
                  </div>
                </div>

                {(errors[line.variantId] || atStock) && (
                  <p role="status" className="mt-2 text-xs text-accent-ink">
                    {errors[line.variantId] ?? `That's all we have — ${line.available} in stock.`}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {removed && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-sm items-center justify-between gap-4 bg-content px-4 py-3 text-sm text-ground lg:bottom-8"
        >
          <span className="truncate">Removed {removed.title}</span>
          <button type="button" onClick={undo} className="min-h-11 shrink-0 font-medium underline underline-offset-4">
            Undo
          </button>
        </div>
      )}
    </>
  );
}

function QuantityButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-11 items-center justify-center text-base transition-colors hover:text-accent-ink disabled:text-content-faint disabled:hover:text-content-faint"
    >
      {children}
    </button>
  );
}
