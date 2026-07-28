"use client";

import Image from "next/image";
import Link from "next/link";
import { useOptimistic, useTransition } from "react";

import { type CartLine } from "@siumora/core";
import { formatPaise } from "@siumora/in-locale";
import { MicroLabel } from "@siumora/ui";

import { removeFromCart, updateCartQuantity } from "@/app/actions/cart";

import { notifyCartChanged } from "./cart-badge";

/**
 * Cart lines with optimistic quantity changes.
 *
 * The quantity flips immediately and reconciles when the action returns; a
 * rejected change (stock ran out) snaps back on revalidation rather than
 * leaving the row showing a quantity the warehouse cannot fill.
 */
export function CartLines({ lines }: { lines: CartLine[] }) {
  const [pending, startTransition] = useTransition();
  const [optimisticLines, applyOptimistic] = useOptimistic(
    lines,
    (state: CartLine[], update: { variantId: string; quantity: number }) =>
      state
        .map((line) =>
          line.variantId === update.variantId
            ? { ...line, quantity: update.quantity }
            : line,
        )
        .filter((line) => line.quantity > 0),
  );

  function changeQuantity(variantId: string, quantity: number) {
    startTransition(async () => {
      applyOptimistic({ variantId, quantity });
      const result =
        quantity <= 0
          ? await removeFromCart(variantId)
          : await updateCartQuantity(variantId, quantity);
      notifyCartChanged(result.count);
    });
  }

  return (
    <ul
      className="mt-8 divide-y divide-[var(--color-rule)] border-t border-[var(--color-rule)]"
      aria-busy={pending}
    >
      {optimisticLines.map((line) => (
        <li key={line.variantId} className="flex gap-5 py-6">
          <Link
            href={`/products/${line.productHandle}`}
            className="shrink-0 bg-ground-raised"
          >
            <Image
              src={line.imageUrl}
              alt={line.title}
              width={96}
              height={120}
              className="h-30 w-24 object-cover"
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
                </p>
              </div>
              <p className="shrink-0 font-medium">
                {formatPaise(line.unitPrice * line.quantity)}
              </p>
            </div>

            <div className="mt-auto flex items-center justify-between gap-4 pt-4">
              <div className="flex items-center border border-content/20">
                <QuantityButton
                  label="Decrease quantity"
                  onClick={() =>
                    changeQuantity(line.variantId, line.quantity - 1)
                  }
                >
                  −
                </QuantityButton>
                <span className="w-10 text-center text-sm tabular-nums">
                  {line.quantity}
                </span>
                <QuantityButton
                  label="Increase quantity"
                  onClick={() =>
                    changeQuantity(line.variantId, line.quantity + 1)
                  }
                >
                  +
                </QuantityButton>
              </div>

              <button
                type="button"
                onClick={() => changeQuantity(line.variantId, 0)}
                className="transition-colors hover:text-accent-ink"
              >
                <MicroLabel>Remove</MicroLabel>
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function QuantityButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center text-base transition-colors hover:text-accent-ink"
    >
      {children}
    </button>
  );
}
