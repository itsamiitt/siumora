import Link from "next/link";

import { MicroLabel, SiumoraLockupHorizontal, SiumoraMark } from "@siumora/ui";

import { CartBadge } from "./cart-badge";
import { MobileMenu } from "./mobile-menu";
import { PincodeChecker } from "./pincode-checker";
import { COLLECTION_NAV } from "./site-navigation";
import { ThemeToggle } from "./theme-toggle";

/**
 * Site header. Uses the horizontal lockup — the guidelines reserve it for
 * constrained bands like this one, with the stacked lockup kept for the footer.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-rule)] bg-ground/92 backdrop-blur-sm">
      {/* Brass appears here only as a hairline rule — never as a fill. */}
      <div className="h-px w-full bg-brass/50" />

      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5 xl:h-20 xl:gap-6">
        <Link href="/" aria-label="Siumora — home" className="shrink-0">
          <span className="sm:hidden"><SiumoraMark size={30} label={null} /></span>
          <span className="hidden sm:inline-flex"><SiumoraLockupHorizontal size={30} /></span>
        </Link>

        <nav aria-label="Collections" className="hidden flex-1 items-center gap-6 xl:flex">
          {COLLECTION_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="transition-colors hover:text-accent-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-ink"
            >
              <MicroLabel>{item.label}</MicroLabel>
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-4 xl:flex">
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
        </div>
        <MobileMenu />
        <CartBadge />
      </div>
    </header>
  );
}
