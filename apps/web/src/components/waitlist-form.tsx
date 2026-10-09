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
    <form onSubmit={submit} className="max-w-xl" aria-label="Join the waiting list">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent-ink">Be first in line</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="waitlist-name" className="mb-2 block text-sm">Your name</label>
          <input id="waitlist-name" name="name" type="text" required minLength={1} maxLength={100}
            autoComplete="name" placeholder="Your name"
            className="h-13 w-full border border-content/25 bg-white px-4 text-base text-ink outline-none focus:border-mulberry focus:ring-1 focus:ring-mulberry" />
        </div>
        <div>
          <label htmlFor="waitlist-email" className="mb-2 block text-sm">Email address</label>
          <input id="waitlist-email" name="email" type="email" required maxLength={254}
            autoComplete="email" placeholder="you@example.com"
            className="h-13 w-full border border-content/25 bg-white px-4 text-base text-ink outline-none focus:border-mulberry focus:ring-1 focus:ring-mulberry" />
        </div>
      </div>
      <button type="submit" disabled={pending}
        className="mt-5 min-h-13 w-full bg-mulberry px-7 text-xs font-medium uppercase tracking-[0.18em] text-ivory transition-colors hover:bg-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-wait disabled:opacity-65 sm:w-auto">
        {pending ? "Joining…" : "Join the waiting list"}
      </button>
      <p className="mt-3 text-xs leading-relaxed text-ink/65">
        We’ll use your details to tell you when we open. See our <a className="underline underline-offset-2" href="/privacy">privacy policy</a>.
      </p>
      {message && <p role={success ? "status" : "alert"} aria-live="polite"
        className={`mt-4 text-sm ${success ? "text-ink" : "text-mulberry"}`}>{message}</p>}
    </form>
  );
}
