"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { MicroLabel } from "@siumora/ui";

import { SignInFlow, type SignInFlowProps } from "./sign-in-flow";

/**
 * The sign-in sheet: the same two-step flow as /signin, opened in place —
 * from checkout, the wishlist, a step-up — so signing in never costs the
 * shopper the page they were on (auth plan: storefront UX).
 *
 * A native <dialog> shown modally: focus is trapped and restored, Escape
 * closes it, and the page behind is inert, without a focus-trap library. On
 * a phone it rises from the bottom as a sheet; wider, it is a centred card.
 */
export function AuthSheet({
  open,
  onClose,
  title,
  intro,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(event) => {
        // A tap on the backdrop (the dialog element itself) closes it.
        if (event.target === dialog.current) onClose();
      }}
      aria-labelledby="auth-sheet-title"
      className="m-0 mt-auto w-full max-w-none bg-ground p-0 text-content backdrop:bg-black/40 sm:m-auto sm:max-w-md"
    >
      <div className="px-6 pb-8 pt-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id="auth-sheet-title">
            <MicroLabel>{title}</MicroLabel>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-2 min-h-11 min-w-11 text-xl leading-none text-content-muted hover:text-accent-ink"
          >
            ×
          </button>
        </div>
        {intro && <div className="mt-2 text-sm text-content-muted">{intro}</div>}
        <div className="mt-6">{open && children}</div>
      </div>
    </dialog>
  );
}

/** The sheet with the sign-in flow in it. */
export function SignInSheet({
  open,
  onClose,
  title = "Sign in",
  intro,
  ...flow
}: SignInFlowProps & {
  open: boolean;
  onClose: () => void;
  title?: string;
  intro?: ReactNode;
}) {
  return (
    <AuthSheet open={open} onClose={onClose} title={title} intro={intro}>
      <SignInFlow {...flow} />
    </AuthSheet>
  );
}
