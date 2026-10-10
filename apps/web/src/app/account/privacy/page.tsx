import { Suspense } from "react";

import type { Metadata } from "next";

import { MicroLabel } from "@siumora/ui";

import { AccountShell, SignedOutAccount } from "@/components/account/account-shell";
import { PrivacyControls } from "@/components/privacy-controls";
import { currentViewer } from "@/lib/session";

import Loading from "../loading";

export const metadata: Metadata = {
  title: "Your data",
  robots: { index: false, follow: false },
};

async function PrivacyContents() {
  const viewer = await currentViewer();
  if (!viewer) return <SignedOutAccount next="/account/privacy" />;

  return (
    <AccountShell viewer={viewer} section="privacy">
      <h2>
        <MicroLabel>Your data</MicroLabel>
      </h2>
      <p className="mt-3 max-w-prose text-sm text-content-muted">
        Under the Digital Personal Data Protection Act you can take a copy of
        everything we hold about you, or ask us to erase it. Erasing asks for a
        fresh code first.
      </p>
      <PrivacyControls maskedPhone={viewer.customer.maskedPhone} />
    </AccountShell>
  );
}

export default function PrivacyPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PrivacyContents />
    </Suspense>
  );
}
