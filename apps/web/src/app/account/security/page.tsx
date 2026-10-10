import { Suspense } from "react";

import type { Metadata } from "next";

import type { DeviceSession } from "@siumora/sdk";
import { MicroLabel } from "@siumora/ui";

import { AccountShell, SignedOutAccount } from "@/components/account/account-shell";
import { DeviceList } from "@/components/account/device-list";
import { apiAs, currentViewer } from "@/lib/session";

import Loading from "../loading";

export const metadata: Metadata = {
  title: "Sign-in and security",
  robots: { index: false, follow: false },
};

async function SecurityContents() {
  const viewer = await currentViewer();
  if (!viewer) return <SignedOutAccount next="/account/security" />;

  const sessions = await (await apiAs()).listSessions().catch((): DeviceSession[] => []);

  return (
    <AccountShell viewer={viewer} section="security">
      <h2>
        <MicroLabel>Where you&apos;re signed in</MicroLabel>
      </h2>
      <p className="mt-3 max-w-prose text-sm text-content-muted">
        We message you on WhatsApp when your account signs in on a new device. Don&apos;t
        recognise one below? Sign it out — or sign out everywhere and sign back in.
      </p>
      <div className="mt-6">
        {sessions.length > 0 ? (
          <DeviceList sessions={sessions} />
        ) : (
          <p className="text-sm text-content-muted">
            Device details are not available right now.
          </p>
        )}
      </div>
    </AccountShell>
  );
}

export default function SecurityPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SecurityContents />
    </Suspense>
  );
}
