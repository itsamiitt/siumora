"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { FormEvent } from "react";

import { saveProfile } from "@/app/actions/auth";

interface ProfileFormProps {
  name: string;
  email: string | null;
}

export function ProfileForm({ name: initialName, email: initialEmail }: ProfileFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const cleanName = name.trim().replace(/\s+/g, " ");
    const cleanEmail = email.trim();
    if (!cleanName) {
      setMessage("Enter your name.");
      return;
    }
    if (initialEmail && !cleanEmail) {
      setMessage("Enter an email address to replace your current one.");
      return;
    }

    startTransition(async () => {
      const result = await saveProfile({
        name: cleanName,
        ...(cleanEmail ? { email: cleanEmail } : {}),
      });
      if (!result.ok) {
        setMessage(result.message ?? "Could not save those details.");
        return;
      }
      setName(cleanName);
      setEmail(cleanEmail);
      setMessage("Details saved.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="mt-5 grid max-w-md gap-4">
      <div>
        <label htmlFor="profile-name" className="mb-1 block text-sm text-content-muted">
          Name
        </label>
        <input
          id="profile-name"
          name="name"
          type="text"
          autoComplete="name"
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="min-h-11 w-full rounded-sm border border-[var(--color-rule)] bg-transparent px-3 text-content outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent-ink"
        />
      </div>
      <div>
        <label htmlFor="profile-email" className="mb-1 block text-sm text-content-muted">
          Email address <span className="text-content-faint">(optional)</span>
        </label>
        <input
          id="profile-email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={200}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="min-h-11 w-full rounded-sm border border-[var(--color-rule)] bg-transparent px-3 text-content outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent-ink"
        />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-sm bg-content px-5 text-sm text-ivory transition-opacity hover:opacity-80 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save details"}
        </button>
        <p role="status" aria-live="polite" className="text-sm text-content-muted">
          {message}
        </p>
      </div>
    </form>
  );
}
