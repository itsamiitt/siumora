"use client";

import { SignInFlow } from "@/components/auth/sign-in-flow";

/**
 * The /signin page's form — the shared sign-in flow (components/auth), kept
 * under its old name so the page and anything else importing it need not
 * change.
 */
export function SignInForm({ next = "/account" }: { next?: string }) {
  return <SignInFlow next={next} surface="signin_page" />;
}
