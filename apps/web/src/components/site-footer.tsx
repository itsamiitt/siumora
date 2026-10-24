import Link from "next/link";
import { cacheLife } from "next/cache";
import { listCategories, listCollections } from "@/lib/catalog";
import { shopNavigation, collectionNavigation } from "./site-navigation";
import { SiumoraLockupStacked } from "@siumora/ui";
import { CookieChoicesButton } from "./cookie-choices-button";
import { ThemeToggle } from "./theme-toggle";
import { PincodeChecker } from "./pincode-checker";

export async function SiteFooter() {
  const [categories, collections] = await Promise.all([listCategories(), listCollections()]);
  return (
    <footer className="store-footer">
      <div className="store-container">
        <div className="store-footer-main">
          <div className="store-footer-brand"><Link href="/" aria-label="Siumora home"><SiumoraLockupStacked size={48} tone="ivory" /></Link><p>Something given, something kept.</p><span>Demi-fine jewellery. Everyday meaning.</span></div>
          <FooterColumn heading="Find your piece" links={[...shopNavigation(categories), ...collectionNavigation(collections)]} />
          <FooterColumn heading="Here to help" links={[{ href: "/shipping", label: "Shipping & delivery" }, { href: "/returns", label: "Returns & exchanges" }, { href: "/care", label: "Jewellery care" }, { href: "/account", label: "Your orders" }, { href: "/grievance", label: "Contact & support" }]} />
          <div className="store-footer-details"><h2>Considered, down to the details.</h2><p>925 sterling silver. Thoughtful wrapping.<br />A little something to make your day.</p><Link href="/shop" className="store-footer-edit">Discover all jewellery ↗</Link><div className="store-footer-settings"><PincodeChecker inline /><ThemeToggle /></div></div>
        </div>
        <div className="store-footer-bottom"><p>© <CopyrightYear /> Siumora. All prices inclusive of taxes.</p><div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><CookieChoicesButton /></div><span>INDIA · INR ₹</span></div>
      </div>
    </footer>
  );
}

/** Cache the clock read without freezing category and collection navigation. */
async function CopyrightYear() {
  "use cache";
  cacheLife("days");
  return new Date().getFullYear();
}
function FooterColumn({ heading, links }: { heading: string; links: Array<{ href: string; label: string }> }) {
  return <nav aria-label={heading} className="store-footer-column"><h2>{heading}</h2><ul>{links.map((link) => <li key={link.href}><Link href={link.href}>{link.label}</Link></li>)}</ul></nav>;
}
