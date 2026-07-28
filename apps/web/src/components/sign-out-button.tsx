"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { signOut } from "@/app/actions/auth";

/**
 * Sign out.
 *
 * A button rather than a link: signing out changes state, and a crawler or a
 * link prefetch must not be able to do it by following a URL.
 */
export function SignOutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await signOut();
          router.push("/");
          router.refresh();
        })
      }
      className="text-sm text-ink-muted underline-offset-4 hover:text-mulberry hover:underline disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
