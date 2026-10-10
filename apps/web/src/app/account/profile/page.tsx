import { Suspense } from "react";

import type { Metadata } from "next";

import { MicroLabel } from "@siumora/ui";

import { AccountShell, SignedOutAccount } from "@/components/account/account-shell";
import { PhoneChange } from "@/components/account/phone-change";
import { ProfileForm } from "@/components/profile-form";
import { currentViewer } from "@/lib/session";

import Loading from "../loading";

export const metadata: Metadata = {
  title: "Your profile",
  robots: { index: false, follow: false },
};

async function ProfileContents() {
  const viewer = await currentViewer();
  if (!viewer) return <SignedOutAccount next="/account/profile" />;

  return (
    <AccountShell viewer={viewer} section="profile">
      <section>
        <h2>
          <MicroLabel>Your details</MicroLabel>
        </h2>
        <p className="mt-3 text-sm text-content-muted">
          Add a name and an email for receipts. Changing the email asks for a fresh code.
        </p>
        <ProfileForm
          name={viewer.customer.name}
          email={viewer.customer.email}
          maskedPhone={viewer.customer.maskedPhone}
        />
      </section>

      <section className="mt-12 border-t border-[var(--color-rule)] pt-8">
        <h2>
          <MicroLabel>Mobile number</MicroLabel>
        </h2>
        <p className="mt-3 text-sm text-content-muted">
          {viewer.customer.maskedPhone} — this is how you sign in. Changing it needs a code on
          this number and on the new one.
        </p>
        <PhoneChange maskedPhone={viewer.customer.maskedPhone} />
      </section>
    </AccountShell>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<Loading />}>
      <ProfileContents />
    </Suspense>
  );
}
