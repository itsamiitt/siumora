"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SiumoraLockupHorizontal } from "@siumora/ui";
import { PincodeChecker } from "./pincode-checker";
import { COLLECTION_NAV, SHOP_NAV } from "./site-navigation";
import { ThemeToggle } from "./theme-toggle";
import { StoreIcon } from "./store-icon";

// Keep the static trigger in Suspense: usePathname can suspend on dynamic routes.
export function MobileMenuFallback() {
  return <button type="button" aria-label="Menu" aria-expanded={false} className="store-icon-button store-menu-trigger" disabled><StoreIcon name="menu" /></button>;
}

export function MobileMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  useEffect(() => {
    const dialog = panel.current;
    if (!dialog) return;
    if (!open) { if (dialog.open) dialog.close(); return; }
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);
  function close() { setOpen(false); trigger.current?.focus(); }
  return (
    <>
      <button ref={trigger} type="button" aria-label="Menu" aria-controls="mobile-site-menu" aria-expanded={open} onClick={() => setOpen(true)} className="store-icon-button store-menu-trigger"><StoreIcon name="menu" /></button>
      <dialog ref={panel} id="mobile-site-menu" aria-label="Shop menu" className="store-mobile-menu" onCancel={close} onClose={() => setOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
        <div className="store-mobile-inner">
          <div className="store-mobile-top"><SiumoraLockupHorizontal size={28} /><button type="button" aria-label="Close menu" onClick={close} className="store-icon-button" autoFocus><StoreIcon name="close" /></button></div>
          <form action="/search" className="store-menu-search" onSubmit={close} role="search"><label htmlFor="menu-search" className="sr-only">Search jewellery</label><input id="menu-search" type="search" name="q" placeholder="Find your everyday piece" /><button type="submit" aria-label="Search"><StoreIcon name="search" /></button></form>
          <nav aria-label="Mobile navigation">
            <p className="store-eyebrow">Find something to keep</p>
            {SHOP_NAV.map((item) => <Link key={item.href} href={item.href} onClick={close} className="store-mobile-category">{item.label}<StoreIcon name="arrow" width="18" /></Link>)}
            <div className="store-mobile-collections">{COLLECTION_NAV.map((item) => <Link key={item.href} href={item.href} onClick={close}>{item.label}</Link>)}<Link href="/#our-story" onClick={close}>Our story</Link></div>
            <div className="store-mobile-utilities"><Link href="/account" onClick={close}><StoreIcon name="user" />Your account</Link><Link href="/wishlist" onClick={close}><StoreIcon name="heart" />Saved pieces</Link><Link href="/shipping" onClick={close}><StoreIcon name="truck" />Shipping & delivery</Link></div>
          </nav>
          <div className="store-mobile-settings"><PincodeChecker inline /><ThemeToggle /></div>
          <p className="store-mobile-signoff">Something given, something kept.</p>
        </div>
      </dialog>
    </>
  );
}
