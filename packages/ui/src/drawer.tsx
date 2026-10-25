"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A panel from the right — the bag (plan 16 Phase D).
 *
 * A native <dialog> shown modally, the same mechanics as the mobile menu:
 * focus is trapped and returned, Escape and a backdrop tap close it, the page
 * behind is inert and does not scroll. At most 90vw on a phone, so the page
 * the shopper was on stays in view behind it.
 */
export function Drawer({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** The accessible name — "Your bag". */
  label: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!open) {
      if (element.open) element.close();
      return;
    }
    if (!element.open) element.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(event) => {
        // A tap on the backdrop (the dialog element itself) closes it.
        if (event.target === dialog.current) onClose();
      }}
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-[min(420px,90vw)] max-w-none overflow-hidden bg-ground p-0 text-content backdrop:bg-[rgb(20_17_15/0.42)] backdrop:backdrop-blur-[3px] open:flex open:flex-col"
    >
      {open && children}
    </dialog>
  );
}
