"use client";

import { SignInFlow } from "@/components/auth/sign-in-flow";

/**
 * The /signin page's form — the shared sign-in flow (components/auth), kept
 * under its old name so the page and anything else importing it need not
 * change. `googleHref` and `variant` come from the server
 * (lib/signin-options.ts): the A/B arm decides whether Google is offered.
 */
export function SignInForm({
  next = "/account",
  googleHref,
  variant,
  notice,
}: {
  next?: string;
  googleHref?: string;
  variant?: string;
  notice?: string;
}) {
  return (
    <SignInFlow
      next={next}
      surface="signin_page"
      {...(googleHref ? { googleHref } : {})}
      {...(variant ? { variant } : {})}
      {...(notice ? { notice } : {})}
    />
  );
}
