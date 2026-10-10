"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { stateByCode } from "@siumora/in-locale";
import type { SavedAddress } from "@siumora/sdk";

import { deleteAddress } from "@/app/actions/account";

/**
 * The address book (auth plan phase 2). Addresses join it when an order is
 * placed signed in, and checkout offers them first; here they can only be
 * removed — adding one is just ordering to it.
 */
export function AddressBook({ addresses }: { addresses: SavedAddress[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  if (addresses.length === 0) {
    return (
      <p className="mt-6 text-sm text-content-muted">
        No saved addresses yet. The address you order to is saved here for next time.
      </p>
    );
  }

  return (
    <div className="mt-6">
      <ul className="grid gap-4 sm:grid-cols-2">
        {addresses.map((address) => (
          <li key={address.id} className="border border-[var(--color-rule)] p-4 text-sm">
            <p className="font-medium">
              {address.name}
              {address.isDefault && <span className="ml-2 text-xs text-content-muted">Default</span>}
            </p>
            <p className="mt-2 text-content-muted">
              {address.line1}
              {address.line2 ? `, ${address.line2}` : ""}
              <br />
              {address.city}, {stateByCode(address.stateCode)?.name ?? address.stateCode} {address.pincode}
              <br />
              {address.phone}
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteAddress(address.id);
                  setMessage(result.ok ? null : (result.message ?? "Could not remove it."));
                  router.refresh();
                })
              }
              className="mt-3 min-h-11 text-sm text-content-muted underline-offset-4 hover:text-accent-ink hover:underline disabled:opacity-60"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {message && (
        <p role="alert" className="mt-3 text-sm text-accent-ink">
          {message}
        </p>
      )}
    </div>
  );
}
