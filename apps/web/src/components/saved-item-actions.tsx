"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { Variant } from "@siumora/core";

import { moveSavedToCart, removeSavedItem } from "@/app/actions/wishlist";

import { notifyCartChanged } from "./cart-badge";

export function SavedItemActions({
  handle,
  title,
  variants,
}: {
  handle: string;
  title: string;
  variants: readonly Variant[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const firstAvailable = variants.find((variant) => variant.inventory > 0);
  const [selectedId, setSelectedId] = useState(firstAvailable?.id ?? "");
  const selectedAvailable = variants.some(
    (variant) => variant.id === selectedId && variant.inventory > 0,
  );

  function move() {
    setMessage(null);
    startTransition(async () => {
      const result = await moveSavedToCart(handle, selectedId);
      if (!result.ok) {
        setMessage(result.message ?? "Could not move this piece.");
        return;
      }
      notifyCartChanged(result.count);
      if (result.moved) {
        router.refresh();
      } else {
        setMessage(result.message ?? "Added to bag. Remove it from Saved when ready.");
      }
    });
  }

  function remove() {
    setMessage(null);
    startTransition(async () => {
      const result = await removeSavedItem(handle);
      if (result.ok) router.refresh();
      else setMessage(result.message ?? "Could not remove this piece.");
    });
  }

  return (
    <div className="mt-4">
      {variants.length > 1 && (
        <div className="mb-3">
          <label htmlFor={`saved-variant-${handle}`} className="mb-1 block text-xs text-content-muted">
            Option for {title}
          </label>
          <select
            id={`saved-variant-${handle}`}
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
            disabled={pending || !firstAvailable}
            className="min-h-11 w-full border border-content/20 bg-ground px-2 text-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent-ink"
          >
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id} disabled={variant.inventory < 1}>
                {variant.title}{variant.inventory < 1 ? " — sold out" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {variants.length > 0 && (
          <button
            type="button"
            disabled={pending || !selectedAvailable}
            onClick={move}
            className="min-h-11 border border-content/25 px-4 text-sm transition-colors hover:border-accent-ink hover:text-accent-ink disabled:opacity-50"
          >
            {!firstAvailable ? "Sold out" : pending ? "Working…" : "Move to bag"}
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={remove}
          className="min-h-11 text-sm text-content-muted underline underline-offset-4 hover:text-accent-ink disabled:opacity-50"
        >
          Remove
        </button>
      </div>
      <p role="status" aria-live="polite" className="mt-2 text-xs text-content-muted">
        {message}
        {message?.startsWith("Added to bag") && (
          <>
            {" "}
            <Link href="/cart" className="underline underline-offset-4">
              View bag
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
