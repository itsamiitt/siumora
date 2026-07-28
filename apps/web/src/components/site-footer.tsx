import { cacheLife } from "next/cache";
import Link from "next/link";

import { MicroLabel, SiumoraLockupStacked } from "@siumora/ui";

/**
 * Footer carries the stacked lockup — the primary lockup, used wherever there
 * is room. Ink Plate ground, so the mark is set in ivory with a brass kernel.
 */
export async function SiteFooter() {
  // Cached for a day. The only moving part is the copyright year, and under
  // Cache Components an uncached read of the clock would pin every prerendered
  // page to the date the build ran.
  "use cache";
  cacheLife("days");

  // Plate in both themes — it is the kit's named dark surface, not a role that
  // flips. The brass hairline is what keeps it distinct on a dark page, where a
  // plate block on a plate ground would otherwise have no edge.
  return (
    <footer className="mt-24 border-t border-brass/40 bg-plate text-ivory">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <div className="flex flex-col items-center gap-4 text-center">
          <SiumoraLockupStacked size={52} tone="ivory" />
          <p className="font-display text-lg font-light text-ivory/80">
            Something given, something kept.
          </p>
        </div>

        <div className="mt-14 grid gap-10 border-t border-ivory/12 pt-10 sm:grid-cols-3">
          <FooterColumn
            heading="Shop"
            links={[
              { href: "/collections/everyday", label: "Everyday" },
              { href: "/collections/gifting", label: "Gifting" },
              { href: "/collections/the-petal-edit", label: "The Petal Edit" },
            ]}
          />
          <FooterColumn
            heading="Help"
            links={[
              { href: "/shipping", label: "Shipping & delivery" },
              { href: "/returns", label: "Returns & exchange" },
              { href: "/care", label: "Care guide" },
              { href: "/account", label: "Your orders" },
            ]}
          />
          <FooterColumn
            heading="Legal"
            links={[
              { href: "/privacy", label: "Privacy policy" },
              { href: "/terms", label: "Terms of use" },
              { href: "/grievance", label: "Grievance officer" },
            ]}
          />
        </div>

        <p className="mt-12 text-xs text-ivory/50">
          © {new Date().getFullYear()} Siumora. All prices inclusive of taxes.
        </p>
      </div>
    </footer>
  );
}

function FooterColumn({
  heading,
  links,
}: {
  heading: string;
  links: Array<{ href: string; label: string }>;
}) {
  return (
    <div>
      <MicroLabel className="text-ivory/55">{heading}</MicroLabel>
      <ul className="mt-4 space-y-2.5">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="text-sm text-ivory/75 transition-colors hover:text-brass-light"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
