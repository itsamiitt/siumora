"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@siumora/ui";

import { requestEmailVerification, verifyEmail } from "@/app/actions/account";

/**
 * Email verification (auth plan phase 4). The account is the phone; an
 * email is optional and only counts once its owner clicks the link sent to
 * it. Changing the email makes it unverified again.
 */
export function EmailVerificationStatus({
  email,
  verified,
}: {
  email: string | null;
  verified: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  if (!email) return null;
  if (verified) {
    return <p className="mt-3 text-sm text-content-muted">{email} is verified.</p>;
  }

  return (
    <div className="mt-3 text-sm">
      <span className="text-content-muted">{email} is not verified yet. </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await requestEmailVerification();
            setMessage(
              !result.ok
                ? (result.message ?? "Could not send the link.")
                : result.alreadyVerified
                  ? "Already verified."
                  : `We sent a link to ${email}. It works for 24 hours.`,
            );
          })
        }
        className="min-h-11 underline underline-offset-4 hover:text-accent-ink disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send verification link"}
      </button>
      {message && (
        <p role="status" className="mt-1 text-content-muted">
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * The landing page's one button. A click, not an automatic call on load:
 * mail scanners open every link in an email, and a link that verified on
 * open would be verified by the scanner, not the person.
 */
export function ConfirmEmail({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const [message, setMessage] = useState<string | null>(null);

  if (state === "done") {
    return (
      <div>
        <p>Your email is verified. Thank you.</p>
        <Button className="mt-6" onClick={() => router.push("/account/profile")}>
          Back to your profile
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Button
        disabled={pending || !token}
        onClick={() =>
          startTransition(async () => {
            const result = await verifyEmail(token);
            if (result.ok) {
              setState("done");
              return;
            }
            setState("failed");
            setMessage(result.message ?? "That link didn't work.");
          })
        }
      >
        {pending ? "Confirming…" : "Confirm my email"}
      </Button>
      {state === "failed" && message && (
        <p role="alert" className="mt-4 text-sm text-accent-ink">
          {message}
        </p>
      )}
    </div>
  );
}
