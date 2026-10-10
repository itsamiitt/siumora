import { Suspense } from "react";

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Display } from "@siumora/ui";

import { SignInForm } from "@/components/sign-in-form";
import { currentViewer } from "@/lib/session";
import { signInOptions } from "@/lib/signin-options";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};


async function SignInPageContents({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; link?: string; error?: string }>;
}) {
  const { next, link, error } = await searchParams;

  // Only a same-site path is followed. An open redirect here would let a link
  // that looks like ours bounce a shopper to a copy of this very page.
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/account";

  if (await currentViewer()) redirect(destination);

  const options = await signInOptions(destination);
  // Back from Google with an account not yet tied to a phone: one OTP and
  // it is linked (auth plan phase 4). Or Google refused / was cancelled.
  const notice =
    link === "google"
      ? "Almost there — verify your mobile number once to finish signing in with Google."
      : error === "google"
        ? "Google sign-in didn't finish. Try again, or use your mobile number."
        : undefined;

  return (
    <div className="mx-auto max-w-3xl px-5 py-20">
      <Display as="h1" size="sm" className="text-center">
        Sign in
      </Display>
      <p className="mx-auto mt-4 max-w-sm text-center text-sm text-content-muted">
        Your mobile number is your account. We send a code — there is no password
        to remember.
      </p>

      <div className="mt-12">
        <SignInForm
          next={destination}
          {...(options.variant ? { variant: options.variant } : {})}
          {...(options.googleHref && link !== "google" ? { googleHref: options.googleHref } : {})}
          {...(notice ? { notice } : {})}
        />
      </div>
    </div>
  );
}

/**
 * Static shell. The dynamic read — cookies, and the session behind them —
 * happens inside the boundary, so the rest of the route still prerenders and
 * the hole streams in.
 */
export default function SignInPage(props: {
  searchParams: Promise<{ next?: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <SignInPageContents {...props} />
    </Suspense>
  );
}
