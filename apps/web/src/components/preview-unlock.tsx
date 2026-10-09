"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { SiumoraMark } from "@siumora/ui";

export function PreviewUnlock() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [pin, setPin] = useState("");
  const [visible, setVisible] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    const modal = dialog.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal?.showModal();
    input.current?.focus();
    return () => {
      request.current?.abort();
      modal?.close();
      document.body.style.overflow = previousOverflow;
      trigger.current?.focus();
    };
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !/^[0-9]{4}$/.test(pin)) return;
    setPending(true);
    setMessage("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch("/api/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pin }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
      });
      const result: { message?: string } = await response.json();
      if (controller.signal.aborted) return;
      if (response.ok) {
        window.location.assign("/");
        return;
      }
      setMessage(result.message ?? "Could not unlock the store.");
      input.current?.focus();
      input.current?.select();
    } catch {
      if (!controller.signal.aborted) setMessage("Could not connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return <>
    <button ref={trigger} type="button" onClick={() => { setPin(""); setVisible(false); setMessage(""); setOpen(true); }}
      aria-label="Enter store preview PIN" title="Store preview" aria-haspopup="dialog"
      className="flex size-11 shrink-0 items-center justify-center rounded-full border border-ink/20 text-ink/75 transition-colors hover:border-mulberry hover:bg-blush/50 hover:text-mulberry focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mulberry">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
      </svg>
    </button>
    <dialog ref={dialog} onClose={() => setOpen(false)} aria-labelledby="preview-title"
      onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto overscroll-contain border border-ink/15 bg-ivory p-0 text-ink shadow-2xl backdrop:bg-ink/50 backdrop:backdrop-blur-sm [color-scheme:light]">
      <div className="relative px-6 py-8 text-center sm:px-9 sm:py-10">
        <button type="button" onClick={() => dialog.current?.close()} aria-label="Close store preview"
          className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-full text-ink/65 hover:bg-blush hover:text-ink">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
        </button>
        <SiumoraMark size={38} tone="mulberry" label={null} className="mx-auto" />
        <h2 id="preview-title" className="mt-5 font-display text-4xl font-light">Store preview</h2>
        <form onSubmit={submit} className="mt-6 text-left">
          <label htmlFor="preview-pin" className="mb-2 block text-sm font-normal">4-digit PIN</label>
          <div className="relative">
            <input ref={input} id="preview-pin" name="password" type={visible ? "text" : "password"} required
              inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} autoComplete="current-password"
              value={pin} onChange={(event) => { setPin(event.target.value.replace(/[^0-9]/g, "").slice(0, 4)); setMessage(""); }}
              aria-invalid={Boolean(message)} aria-describedby={message ? "preview-error" : undefined}
              className="h-16 w-full rounded-sm border border-ink/30 bg-white/70 pl-4 pr-14 text-center text-2xl font-normal tracking-[0.65em] outline-none focus:border-mulberry focus:ring-1 focus:ring-mulberry" />
            <button type="button" aria-label={visible ? "Hide PIN" : "Show PIN"} aria-pressed={visible} onClick={() => setVisible(!visible)}
              className="absolute right-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center text-ink/65 hover:text-mulberry">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{visible && <path d="m3 3 18 18" />}</svg>
            </button>
          </div>
          <button type="submit" disabled={pending || pin.length !== 4}
            className="mt-5 min-h-14 w-full rounded-sm bg-mulberry px-5 text-sm font-medium text-ivory transition-colors hover:bg-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mulberry disabled:cursor-not-allowed disabled:opacity-55">
            {pending ? "Opening…" : "View store"}
          </button>
          {message && <p id="preview-error" role="alert" className="mt-3 text-sm font-normal text-mulberry">{message}</p>}
        </form>
      </div>
    </dialog>
  </>;
}
