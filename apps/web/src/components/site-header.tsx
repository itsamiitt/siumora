import Link from "next/link";

import { MicroLabel, SiumoraLockupHorizontal } from "@siumora/ui";

import { CartBadge } from "./cart-badge";
import { PincodeChecker } from "./pincode-checker";
import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { href: "/collections/everyday", label: "Everyday" },
  { href: "/collections/gifting", label: "Gifting" },
  { href: "/collections/the-petal-edit", label: "The Petal Edit" },
];

/**
 * Site header. Uses the horizontal lockup — the guidelines reserve it for
 * constrained bands like this one, with the stacked lockup kept for the footer.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-rule)] bg-ground/92 backdrop-blur-sm">
      {/* Brass appears here only as a hairline rule — never as a fill. */}
      <div className="h-px w-full bg-brass/50" />

      <div className="mx-auto flex h-20 max-w-6xl items-center gap-8 px-5">
        <Link href="/" aria-label="Siumora — home" className="shrink-0">
          <SiumoraLockupHorizontal size={30} />
        </Link>

        <nav className="hidden flex-1 items-center gap-9 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="transition-colors hover:text-accent-ink"
            >
              <MicroLabel>{item.label}</MicroLabel>
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-6">
          <Link href="/search" className="transition-colors hover:text-accent-ink">
            <MicroLabel>Search</MicroLabel>
          </Link>
          <PincodeChecker />
          <Link href="/wishlist" className="transition-colors hover:text-accent-ink">
            <MicroLabel>Saved</MicroLabel>
          </Link>
          {/* A plain link, not a signed-in/signed-out label. Reading the
              session here would make every page dynamic and cost the static
              tier the LCP budget depends on; /account handles both states. */}
          <Link href="/account" className="transition-colors hover:text-accent-ink">
            <MicroLabel>Account</MicroLabel>
          </Link>
          <ThemeToggle />
          <CartBadge />
        </div>
      </div>
    </header>
  );
}
