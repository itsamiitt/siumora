import Link from "next/link";
import { Suspense } from "react";
import { SiumoraLockupHorizontal } from "@siumora/ui";
import { CartBadge } from "./cart-badge";
import { MobileMenu, MobileMenuFallback } from "./mobile-menu";
import { shopNavigation, collectionNavigation } from "./site-navigation";
import { listCategories, listCollections } from "@/lib/catalog";
import { StoreIcon } from "./store-icon";

export async function SiteHeader() {
  const [categories, collections] = await Promise.all([listCategories(), listCollections()]);
  const shopLinks = shopNavigation(categories);
  const collectionLinks = collectionNavigation(collections);
  return (
    <>
      <a href="#main-content" className="store-skip-link">Skip to content</a>
      <div className="store-announcement"><Link href="/shipping">A little closer to you. Complimentary shipping on orders ₹999+ <span aria-hidden="true">↗</span></Link></div>
      <header className="store-header">
        <div className="store-header-main store-container">
          <div className="store-header-left">
            <Suspense fallback={<MobileMenuFallback />}><MobileMenu shopLinks={shopLinks} collectionLinks={collectionLinks} /></Suspense>
            <span className="store-header-note">JEWELLERY FOR THE EVERYDAY</span>
          </div>
          <Link href="/" aria-label="Siumora — home" className="store-logo"><SiumoraLockupHorizontal size={36} /></Link>
          <div className="store-header-tools">
            <Link href="/search" aria-label="Search jewellery" className="store-icon-button"><StoreIcon name="search" /></Link>
            <Link href="/account" aria-label="Your account" className="store-icon-button desktop-tool"><StoreIcon name="user" /></Link>
            <Link href="/wishlist" aria-label="Saved jewellery" className="store-icon-button desktop-tool"><StoreIcon name="heart" /></Link>
            <CartBadge />
          </div>
        </div>
        <nav aria-label="Shop jewellery" className="store-desktop-nav">
          {shopLinks.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
          <span className="store-nav-divider" aria-hidden="true" />
          {collectionLinks.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
          <Link href="/#our-story">Our story</Link>
        </nav>
      </header>
    </>
  );
}
