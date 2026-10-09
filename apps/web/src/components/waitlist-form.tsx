"use client";

import { useState, type FormEvent } from "react";

export function WaitlistForm() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    if (!name) {
      setMessage("Please enter your name.");
      form.querySelector<HTMLInputElement>("[name=name]")?.focus();
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email }),
        signal: AbortSignal.timeout(12000),
      });
      const result: { message?: string } = await response.json();
      setSuccess(response.ok);
      setMessage(result.message ?? "Please try again.");
      if (response.ok) form.reset();
    } catch {
      setMessage("Could not connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-6 md:mt-8">
      {success ? (
        <div role="status" aria-live="polite" className="border border-mulberry/20 bg-blush/50 px-6 py-8">
          <svg className="mb-4 text-mulberry" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <circle cx="12" cy="12" r="10" /><path d="m7 12 3 3 7-7" />
          </svg>
          <p className="font-display text-3xl">You’re on the list.</p>
          <p className="mt-2 text-sm font-normal text-ink/75">We’ll be in touch when Siumora opens.</p>
        </div>
      ) : (
        <form onSubmit={submit} aria-label="Join the waiting list" aria-busy={pending}>
          <div className="space-y-4">
            <div>
              <label htmlFor="waitlist-name" className="mb-2 block text-xs font-medium text-ink/80">Your name</label>
              <input id="waitlist-name" name="name" type="text" required maxLength={100}
                autoComplete="name" placeholder="Your full name" disabled={pending}
                className="h-14 w-full min-w-0 rounded-sm border border-ink/25 bg-white/65 px-4 text-base font-normal text-ink outline-none transition-colors placeholder:text-ink/55 hover:border-ink/40 focus:border-mulberry focus:ring-1 focus:ring-mulberry disabled:opacity-60" />
            </div>
            <div>
              <label htmlFor="waitlist-email" className="mb-2 block text-xs font-medium text-ink/80">Email address</label>
              <input id="waitlist-email" name="email" type="email" inputMode="email" required maxLength={254}
                autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" disabled={pending}
                className="h-14 w-full min-w-0 rounded-sm border border-ink/25 bg-white/65 px-4 text-base font-normal text-ink outline-none transition-colors placeholder:text-ink/55 hover:border-ink/40 focus:border-mulberry focus:ring-1 focus:ring-mulberry disabled:opacity-60" />
            </div>
          </div>
          <button type="submit" disabled={pending}
            className="mt-5 flex min-h-14 w-full items-center justify-between gap-4 rounded-sm bg-mulberry px-5 text-sm font-medium text-ivory transition-colors hover:bg-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mulberry disabled:cursor-wait disabled:opacity-70">
            <span>{pending ? "Joining…" : "Join the waitlist"}</span>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>
          </button>
          {message && <p role="alert" className="mt-3 text-sm font-normal text-mulberry">{message}</p>}
        </form>
      )}
    </div>
  );
}
