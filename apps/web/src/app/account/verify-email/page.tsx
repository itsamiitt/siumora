import { Suspense } from "react";

import type { Metadata } from "next";

import { Display } from "@siumora/ui";

import { ConfirmEmail } from "@/components/account/email-verification";

export const metadata: Metadata = {
  title: "Confirm your email",
  robots: { index: false, follow: false },
  // The token is in the URL; it must not travel to other sites.
  referrer: "no-referrer",
};

async function VerifyEmailContents({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <div className="mx-auto max-w-md px-5 py-24 text-center">
      <Display as="h1" size="sm">
        Confirm your email
      </Display>
      <p className="mt-4 text-content-muted">
        One tap to confirm this address for your Siumora account.
      </p>
      <div className="mt-10">
        {token ? (
          <ConfirmEmail token={token} />
        ) : (
          <p className="text-sm text-content-muted">
            This link is missing its code. Send a new one from your profile.
          </p>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage(props: { searchParams: Promise<{ token?: string }> }) {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContents {...props} />
    </Suspense>
  );
}
