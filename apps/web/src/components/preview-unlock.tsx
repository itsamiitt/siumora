"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

export function PreviewUnlock() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab") return;
      const elements = dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])");
      if (!elements?.length) return;
      const first = elements[0]!;
      const last = elements[elements.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => { window.removeEventListener("keydown", handleKey); trigger.current?.focus(); };
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: input.current?.value ?? "" }),
      });
      const result: { message?: string } = await response.json();
      if (response.ok) {
        window.location.assign("/");
        return;
      }
      setMessage(result.message ?? "Could not unlock the store.");
    } catch {
      setMessage("Could not connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return <>
    <button ref={trigger} type="button" onClick={() => setOpen(true)}
      aria-label="Enter store preview password" title="Store preview"
      className="flex size-11 items-center justify-center rounded-full text-ink/60 transition-colors hover:bg-blush hover:text-mulberry focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mulberry">
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="5" y="10" width="14" height="11" rx="1.5" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    </button>
    {open && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/50 px-5" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="preview-title" className="w-full max-w-sm bg-ivory p-7 text-left shadow-2xl sm:p-9">
        <div className="flex items-start justify-between gap-4">
          <h2 id="preview-title" className="font-display text-4xl font-light">Store preview</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-2xl text-ink/55 hover:text-ink">×</button>
        </div>
        <form onSubmit={submit} className="mt-7">
          <label htmlFor="preview-password" className="mb-2 block text-sm">Password</label>
          <input ref={input} id="preview-password" type="password" required autoComplete="current-password"
            className="h-13 w-full border border-ink/25 bg-white px-4 text-base outline-none focus:border-mulberry focus:ring-1 focus:ring-mulberry" />
          <button type="submit" disabled={pending} className="mt-4 min-h-12 w-full bg-mulberry px-5 text-xs font-medium uppercase tracking-[0.17em] text-ivory hover:bg-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-65">
            {pending ? "Unlocking…" : "View store"}
          </button>
          {message && <p role="alert" className="mt-3 text-sm text-mulberry">{message}</p>}
        </form>
      </div>
    </div>}
  </>;
}
