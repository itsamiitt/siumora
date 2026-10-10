"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { DeviceSession } from "@siumora/sdk";
import { Button } from "@siumora/ui";

import { revokeDevice, signOutEverywhere } from "@/app/actions/auth";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Signed-in devices (account → Security, auth plan phase 2): each one can be
 * signed out on its own, or all at once — what someone does after losing a
 * phone. "Sign out everywhere" asks once more, because it signs this device
 * out too.
 */
export function DeviceList({ sessions }: { sessions: DeviceSession[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div>
      <ul className="divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
        {sessions.map((session) => (
          <li key={session.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div>
              <p className="text-sm">
                {session.device}
                {session.current && (
                  <span className="ml-2 text-xs text-accent-ink">This device</span>
                )}
              </p>
              <p className="mt-1 text-xs text-content-muted">
                Signed in {when(session.createdAt)} · last active {when(session.lastSeenAt)}
              </p>
            </div>
            {!session.current && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await revokeDevice(session.id);
                    setMessage(result.ok ? "Signed that device out." : (result.message ?? null));
                    router.refresh();
                  })
                }
                className="min-h-11 text-sm text-content-muted underline-offset-4 hover:text-accent-ink hover:underline disabled:opacity-60"
              >
                Sign out
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-6">
        {confirming ? (
          <div className="flex flex-wrap items-center gap-4">
            <p className="text-sm text-accent-ink">This signs out every device, this one too.</p>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await signOutEverywhere();
                  router.push("/");
                  router.refresh();
                })
              }
            >
              Yes, sign out everywhere
            </Button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="min-h-11 text-sm text-content-muted underline-offset-4 hover:underline"
            >
              Cancel
            </button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
            Sign out everywhere
          </Button>
        )}
      </div>

      {message && (
        <p aria-live="polite" className="mt-3 text-sm text-content-muted">
          {message}
        </p>
      )}
    </div>
  );
}
