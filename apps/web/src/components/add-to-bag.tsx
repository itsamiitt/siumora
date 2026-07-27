"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { mintEventId } from "@siumora/analytics";
import { track } from "@siumora/analytics/client";
import type { Variant } from "@siumora/core";
import { Button, MicroLabel } from "@siumora/ui";

import { addToCart } from "@/app/actions/cart";

import { notifyCartChanged } from "./cart-badge";

/**
 * Variant picker plus add-to-bag.
 *
 * Sold-out variants stay visible but unselectable — hiding them makes the range
 * look thinner than it is, and shoppers look for the size that was there before.
 */
export function AddToBag({
  variants,
  productTitle,
}: {
  variants: readonly Variant[];
  productTitle: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const firstAvailable = variants.find((v) => v.inventory > 0);
  const [selectedId, setSelectedId] = useState(firstAvailable?.id ?? "");

  const selected = variants.find((v) => v.id === selectedId);
  const anyAvailable = variants.some((v) => v.inventory > 0);

  function onAdd() {
    if (!selected) return;
    setMessage(null);

    startTransition(async () => {
      const result = await addToCart(selected.id);
      if (result.ok) {
        track("add_to_cart", {
          // Minted here and reused if this is ever echoed server-side, so the
          // two sends dedupe into one conversion.
          event_id: mintEventId(),
          currency: "INR",
          value: selected.price.selling / 100,
          items: [
            {
              item_id: selected.sku,
              item_name: productTitle,
              price: selected.price.selling / 100,
              quantity: 1,
              item_variant: selected.title,
              item_brand: "Siumora",
            },
          ],
        });
        notifyCartChanged(result.count);
        router.refresh();
        setMessage("Added to bag");
      } else {
        setMessage(result.message ?? "Could not add that.");
      }
    });
  }

  return (
    <div>
      <fieldset>
        <legend className="sr-only">Choose an option</legend>
        <MicroLabel>Options</MicroLabel>
        <div className="mt-3 flex flex-wrap gap-2.5">
          {variants.map((variant) => {
            const soldOut = variant.inventory === 0;
            const active = variant.id === selectedId;

            return (
              <button
                key={variant.id}
                type="button"
                disabled={soldOut}
                aria-pressed={active}
                onClick={() => setSelectedId(variant.id)}
                className={
                  soldOut
                    ? "cursor-not-allowed border border-ink/12 px-5 py-2.5 text-sm text-ink-faint line-through"
                    : active
                      ? "border border-mulberry bg-mulberry/5 px-5 py-2.5 text-sm text-mulberry"
                      : "border border-ink/25 px-5 py-2.5 text-sm transition-colors hover:border-mulberry hover:text-mulberry"
                }
              >
                {variant.title}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Low-stock nudge only where it is true — a permanent banner is noise. */}
      {selected && selected.inventory > 0 && selected.inventory <= 5 && (
        <p className="mt-3 text-xs text-mulberry">
          Only {selected.inventory} left
        </p>
      )}

      <Button
        size="lg"
        className="mt-6 w-full"
        onClick={onAdd}
        disabled={!anyAvailable || !selected || pending}
      >
        {!anyAvailable ? "Sold out" : pending ? "Adding…" : "Add to bag"}
      </Button>

      {message && (
        <p aria-live="polite" className="mt-2 text-center text-xs text-ink-muted">
          {message}
        </p>
      )}
    </div>
  );
}
