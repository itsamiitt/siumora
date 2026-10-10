import { Suspense } from "react";

import type { Metadata } from "next";

import type { SavedAddress } from "@siumora/sdk";
import { MicroLabel } from "@siumora/ui";

import { AccountShell, SignedOutAccount } from "@/components/account/account-shell";
import { AddressBook } from "@/components/account/address-book";
import { apiAs, currentViewer } from "@/lib/session";

import Loading from "../loading";

export const metadata: Metadata = {
  title: "Your addresses",
  robots: { index: false, follow: false },
};

async function AddressesContents() {
  const viewer = await currentViewer();
  if (!viewer) return <SignedOutAccount next="/account/addresses" />;

  const addresses = await (await apiAs()).listAddresses().catch((): SavedAddress[] => []);

  return (
    <AccountShell viewer={viewer} section="addresses">
      <h2>
        <MicroLabel>Saved addresses</MicroLabel>
      </h2>
      <AddressBook addresses={addresses} />
    </AccountShell>
  );
}

export default function AddressesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AddressesContents />
    </Suspense>
  );
}
