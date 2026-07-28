"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { MicroLabel } from "@siumora/ui";

import { exportMyData, requestErasure } from "@/app/actions/privacy";

/**
 * Access and erasure, for the person they belong to.
 *
 * Buttons, not links: both change something — one hands out a file of personal
 * data, the other deletes an account — and a crawler or a link prefetch must
 * not be able to do either by following a URL.
 *
 * Erasure asks twice. Not a dark pattern in reverse: it is irreversible, and
 * the second tap is the difference between a decision and a mis-tap on a phone.
 */
export function PrivacyControls() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function download() {
    startTransition(async () => {
      const result = await exportMyData();
      if (!result.ok || !result.json) {
        setMessage(result.message ?? "Could not build the file.");
        return;
      }

      // A blob rather than a link to the API: the API needs the session cookie,
      // and a plain anchor to a cross-origin URL would not carry it.
      const url = URL.createObjectURL(
        new Blob([result.json], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `siumora-data-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("Downloaded.");
    });
  }

  function erase() {
    startTransition(async () => {
      const result = await requestErasure();
      setConfirming(false);

      if (!result.ok) {
        setMessage(result.message ?? "Could not record the request.");
        return;
      }

      if (result.erased) {
        setMessage("Erased. You have been signed out.");
        router.push("/");
        router.refresh();
        return;
      }

      // Not a failure. It is recorded, and it runs when the parcels land.
      setMessage(
        `${result.pendingBecause ?? "Recorded."} We will finish this by ${
          result.resolveBy
            ? new Date(result.resolveBy).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })
            : "the deadline"
        }.`,
      );
    });
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <button
          type="button"
          onClick={download}
          disabled={pending}
          className="text-sm text-content-muted underline-offset-4 hover:text-accent-ink hover:underline disabled:opacity-60"
        >
          {pending ? "Working…" : "Download my data"}
        </button>

        {confirming ? (
          <span className="flex flex-wrap items-baseline gap-4">
            <span className="text-sm text-accent-ink">
              This cannot be undone.
            </span>
            <button
              type="button"
              onClick={erase}
              disabled={pending}
              className="text-sm text-accent-ink underline underline-offset-4 disabled:opacity-60"
            >
              Erase everything
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-sm text-content-muted underline-offset-4 hover:underline"
            >
              Keep it
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setConfirming(true);
            }}
            disabled={pending}
            className="text-sm text-content-muted underline-offset-4 hover:text-accent-ink hover:underline disabled:opacity-60"
          >
            Erase my data
          </button>
        )}
      </div>

      {message && (
        <p aria-live="polite" className="mt-3 text-sm text-content-muted">
          {message}
        </p>
      )}

      {/* Said before the button is pressed, not after. A person told "erased"
          while an invoice with their order on it is kept for six years has been
          misled, and the reason is short enough to just give them. */}
      <p className="mt-4 max-w-prose text-xs text-content-faint">
        <MicroLabel>What is kept</MicroLabel>{" "}
        Tax invoices and the order records behind them stay for six years, as
        section 36 of the CGST Act requires. Your name, phone and address are
        removed from them; the amounts, the tax and the invoice number are not.
      </p>
    </div>
  );
}
