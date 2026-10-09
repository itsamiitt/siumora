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
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: data.get("name"), email: data.get("email") }),
      });
      const result: { message?: string } = await response.json();
      setSuccess(response.ok);
      setMessage(result.message ?? "Please try again.");
      if (response.ok) form.reset();
    } catch {
      setSuccess(false);
      setMessage("Could not connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-10 w-full max-w-2xl" aria-label="Join the waiting list">
      <div className="flex flex-col overflow-hidden border border-ink/25 bg-white text-left shadow-[0_8px_35px_rgba(28,25,23,0.04)] focus-within:border-mulberry sm:flex-row sm:items-center">
        <label htmlFor="waitlist-name" className="sr-only">Your name</label>
        <input id="waitlist-name" name="name" type="text" required maxLength={100}
          autoComplete="name" placeholder="Your name"
          className="h-14 min-h-14 min-w-0 shrink-0 border-b border-ink/10 bg-transparent px-5 text-base text-ink outline-none placeholder:text-ink/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-mulberry sm:flex-1 sm:border-b-0 sm:border-r" />
        <label htmlFor="waitlist-email" className="sr-only">Email address</label>
        <input id="waitlist-email" name="email" type="email" required maxLength={254}
          autoComplete="email" placeholder="Email address"
          className="h-14 min-h-14 min-w-0 shrink-0 bg-transparent px-5 text-base text-ink outline-none placeholder:text-ink/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-mulberry sm:flex-1" />
        <button type="submit" disabled={pending}
          className="min-h-14 bg-mulberry px-6 text-xs font-medium uppercase tracking-[0.15em] text-ivory transition-colors hover:bg-ink focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-ivory disabled:cursor-wait disabled:opacity-65">
          {pending ? "Joining…" : "Join the list"}
        </button>
      </div>
      {message && <p role={success ? "status" : "alert"} aria-live="polite"
        className={`mt-4 text-sm ${success ? "text-ink" : "text-mulberry"}`}>{message}</p>}
    </form>
  );
}
