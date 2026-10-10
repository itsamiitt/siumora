import type { ReactNode } from "react";

import Link from "next/link";

import { Display, MicroLabel } from "@siumora/ui";

import { SignInForm } from "@/components/sign-in-form";
import { SignOutButton } from "@/components/sign-out-button";
import type { Viewer } from "@/lib/session";

/**
 * The account area's frame (auth plan phase 2): a heading, who is signed
 * in, and the five sections as tabs — Orders, Addresses, Profile, Security,
 * Privacy. Signed out, it is the sign-in form itself, in place, rather than
 * a link to another page: the shortest path from "my orders?" to the orders.
 */

export type AccountSection = "orders" | "addresses" | "profile" | "security" | "privacy";

const SECTIONS: ReadonlyArray<{ key: AccountSection; href: string; label: string }> = [
  { key: "orders", href: "/account", label: "Orders" },
  { key: "addresses", href: "/account/addresses", label: "Addresses" },
  { key: "profile", href: "/account/profile", label: "Profile" },
  { key: "security", href: "/account/security", label: "Security" },
  { key: "privacy", href: "/account/privacy", label: "Privacy" },
];

export function SignedOutAccount({ next }: { next: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-5 py-24 text-center">
      <Display as="h1" size="sm">
        Your account
      </Display>
      <p className="mt-4 text-content-muted">
        Sign in with your mobile number to see everything you have ordered.
      </p>
      <div className="mt-10 w-full text-left">
        <SignInForm next={next} />
      </div>
    </div>
  );
}

export function AccountShell({
  viewer,
  section,
  children,
}: {
  viewer: Viewer;
  section: AccountSection;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <Display as="h1" size="sm">
          Your account
        </Display>
        <SignOutButton />
      </div>

      <p className="mt-3 text-sm text-content-faint">
        Signed in as {viewer.customer.maskedPhone}.
        {viewer.isAdmin && (
          <>
            {" "}
            <Link
              href="/admin"
              className="border-b border-content/40 pb-0.5 hover:border-accent-ink hover:text-accent-ink"
            >
              Open the ops dashboard
            </Link>
            .
          </>
        )}
      </p>

      <nav aria-label="Account" className="mt-8 overflow-x-auto border-b border-[var(--color-rule)]">
        <ul className="flex gap-6">
          {SECTIONS.map((entry) => (
            <li key={entry.key}>
              <Link
                href={entry.href}
                aria-current={entry.key === section ? "page" : undefined}
                className={`inline-flex min-h-11 items-center border-b-2 pb-2 transition-colors ${
                  entry.key === section
                    ? "border-accent-ink text-accent-ink"
                    : "border-transparent text-content-muted hover:text-accent-ink"
                }`}
              >
                <MicroLabel>{entry.label}</MicroLabel>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-8">{children}</div>
    </div>
  );
}
