"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

import { SignInSheet } from "./auth-sheet";

/**
 * The StepUpGate (auth plan phase 2): run a sensitive action; if the server
 * answers `step_up_required`, ask for a fresh code on the account's own
 * number in a sheet, then run the action again — once.
 *
 *   const { gate, sheet } = useStepUp("98••••5678");
 *   const result = await gate(() => requestErasure());
 *   …
 *   return <>{form}{sheet}</>;
 *
 * The server decides, every time. This hook only saves the customer from a
 * dead end when it says no.
 */
export function useStepUp(maskedPhone?: string): {
  gate: <T extends { ok: boolean; error?: string }>(action: () => Promise<T>) => Promise<T>;
  sheet: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const pending = useRef<{ retry: () => void; cancel: () => void } | null>(null);

  const gate = useCallback(
    <T extends { ok: boolean; error?: string }>(action: () => Promise<T>): Promise<T> =>
      action().then((first) => {
        if (first.ok || first.error !== "step_up_required") return first;
        return new Promise<T>((resolve) => {
          pending.current = {
            retry: () => {
              action().then(resolve, () => resolve(first));
            },
            cancel: () => resolve(first),
          };
          setOpen(true);
        });
      }),
    [],
  );

  const sheet = (
    <SignInSheet
      open={open}
      onClose={() => {
        setOpen(false);
        pending.current?.cancel();
        pending.current = null;
      }}
      title="Confirm it's you"
      intro="This change needs a fresh code on your number."
      mode="stepup"
      surface="step_up"
      {...(maskedPhone ? { maskedPhone } : {})}
      onDone={() => {
        setOpen(false);
        const next = pending.current;
        pending.current = null;
        next?.retry();
      }}
    />
  );

  return { gate, sheet };
}
