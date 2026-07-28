"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  RETURN_REASON_LABELS,
  isFault,
  type CartLine,
  type ReturnReason,
  type ReturnResolution,
} from "@siumora/core";
import { Button, MicroLabel } from "@siumora/ui";

import { requestReturn } from "@/app/actions/returns";

/**
 * Self-serve return.
 *
 * The hygiene declaration only appears when it actually applies — pierced
 * jewellery being returned for a non-fault reason. Asking about a seal on a
 * damaged ring is noise, and a form that asks irrelevant questions gets
 * answered carelessly.
 */
export function ReturnForm({
  orderNumber,
  lines,
}: {
  orderNumber: string;
  lines: readonly CartLine[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState<ReturnReason>("changed_mind");
  const [resolution, setResolution] = useState<ReturnResolution>("refund");
  const [sealIntact, setSealIntact] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const chosen = lines.filter((line) => selected.includes(line.variantId));
  const needsSealDeclaration =
    chosen.some((line) => line.piercedJewellery) && !isFault(reason);

  function toggle(variantId: string) {
    setSelected((current) =>
      current.includes(variantId)
        ? current.filter((id) => id !== variantId)
        : [...current, variantId],
    );
  }

  return (
    <div className="mt-8 border border-[var(--color-rule)] p-6">
      <MicroLabel>Start a return</MicroLabel>

      <fieldset className="mt-5">
        <legend className="text-sm text-content-muted">What is coming back?</legend>
        <div className="mt-3 space-y-2">
          {lines.map((line) => (
            <label
              key={line.variantId}
              className="flex cursor-pointer items-center gap-3 text-sm"
            >
              <input
                type="checkbox"
                checked={selected.includes(line.variantId)}
                onChange={() => toggle(line.variantId)}
                className="accent-[#6B2942]"
              />
              <span>
                {line.title}
                <span className="text-content-muted"> · {line.variantTitle}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm text-content-muted">Why?</span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as ReturnReason)}
            className="h-11 w-full border border-content/20 bg-transparent px-3 text-sm outline-none focus:border-accent-ink"
          >
            {Object.entries(RETURN_REASON_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm text-content-muted">
            Refund or exchange?
          </span>
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value as ReturnResolution)}
            className="h-11 w-full border border-content/20 bg-transparent px-3 text-sm outline-none focus:border-accent-ink"
          >
            <option value="refund">Refund</option>
            <option value="exchange">Exchange</option>
          </select>
        </label>
      </div>

      {needsSealDeclaration && (
        <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={sealIntact}
            onChange={(e) => setSealIntact(e.target.checked)}
            className="mt-1 accent-[#6B2942]"
          />
          <span className="text-content-muted">
            The hygiene seal on the pierced jewellery is unbroken. We can only
            take these back sealed.
          </span>
        </label>
      )}

      {isFault(reason) && (
        <p className="mt-4 text-xs text-accent-ink">
          That is on us — return shipping is free.
        </p>
      )}

      <Button
        size="sm"
        className="mt-6"
        disabled={selected.length === 0 || pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await requestReturn({
              orderNumber,
              variantIds: selected,
              reason,
              resolution,
              sealIntact: needsSealDeclaration ? sealIntact : undefined,
            });
            if (result.ok) router.refresh();
            else setError(result.message ?? "Could not start the return.");
          })
        }
      >
        {pending ? "Starting…" : "Request return"}
      </Button>

      {error && (
        <p aria-live="polite" className="mt-3 text-xs text-accent-ink">
          {error}
        </p>
      )}
    </div>
  );
}
