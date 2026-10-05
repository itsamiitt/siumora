"use client";

import { useEffect, useState } from "react";

import { isValidPincode, normalisePincodeInput } from "@siumora/in-locale";
import { Button, MicroLabel } from "@siumora/ui";

import { checkPincode } from "@/app/actions/checkout";

const PINCODE_CHANGED_EVENT = "siumora:pincode-changed";

/**
 * Pincode checker — serviceability, estimated delivery, and COD availability.
 *
 * Lives in the header and on the PDP. The chosen pincode is persisted so
 * checkout can reuse it rather than asking twice.
 */
export function PincodeChecker({ inline = false }: { inline?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const [pincode, setPincode] = useState("");
  const [result, setResult] = useState<{
    serviceable: boolean;
    estimatedDays: string;
    codAvailable: boolean;
  } | null>(null);
  const [pending, setPending] = useState(false);

  const valid = isValidPincode(pincode);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("siumora.pincode");
      if (saved && isValidPincode(saved)) setPincode(saved);
    } catch {
      // Storage can be disabled; delivery checking still works for this visit.
    }

    function onChanged(event: Event) {
      const saved = (event as CustomEvent<string>).detail;
      if (!isValidPincode(saved)) return;
      setPincode(saved);
      setResult(null);
    }
    window.addEventListener(PINCODE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(PINCODE_CHANGED_EVENT, onChanged);
  }, []);

  async function onCheck() {
    if (!valid) return;
    setPending(true);
    try {
      const next = await checkPincode(pincode);
      try {
        window.localStorage.setItem("siumora.pincode", pincode);
      } catch {
        // The result is still useful when persistence is unavailable.
      }
      window.dispatchEvent(new CustomEvent<string>(PINCODE_CHANGED_EVENT, { detail: pincode }));
      setResult(next);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={inline ? "w-full" : "relative"}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="transition-colors hover:text-accent-ink"
      >
        <MicroLabel>{result ? `Deliver to ${pincode}` : "Deliver to"}</MicroLabel>
      </button>

      {open && (
        <div className={inline
          ? "mt-3 w-full border border-[var(--color-rule)] bg-ground p-4"
          : "absolute right-0 top-9 w-72 border border-[var(--color-rule)] bg-ground p-4 shadow-lg"}>
          <MicroLabel>Check delivery</MicroLabel>

          <div className="mt-3 flex gap-2">
            <input
              value={pincode}
              onChange={(e) => {
                setPincode(normalisePincodeInput(e.target.value));
                setResult(null);
              }}
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="400001"
              aria-label="Pincode"
              className="h-11 min-w-0 flex-1 border border-content/20 bg-transparent px-3 text-sm outline-none focus:border-accent-ink"
            />
            <Button size="sm" onClick={onCheck} disabled={!valid || pending}>
              {pending ? "…" : "Check"}
            </Button>
          </div>

          {result && (
            <dl className="mt-4 space-y-1.5 text-sm">
              {result.serviceable ? (
                <>
                  <div className="flex justify-between gap-4">
                    <dt className="text-content-muted">Delivery by</dt>
                    <dd>{result.estimatedDays} days</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-content-muted">Cash on delivery</dt>
                    <dd>{result.codAvailable ? "Available" : "Not available"}</dd>
                  </div>
                </>
              ) : (
                <p className="text-content-muted">
                  We do not deliver here yet. Try another pincode.
                </p>
              )}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
