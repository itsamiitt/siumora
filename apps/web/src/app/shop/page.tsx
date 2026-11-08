import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { applyFilters, materialFacets, parseFilters, priceFacets } from "@siumora/core";
import { ProductCard } from "@/components/product-card";
import { ProductFilters } from "@/components/product-filters";
import { categoryHref, shopNavigation, subcategoryNavigation } from "@/components/site-navigation";
import { listAllCategories, listProducts, listCategories, listProductsInCategory } from "@/lib/catalog";

export const metadata: Metadata = { title: "Shop all jewellery", description: "Discover Siumora demi-fine earrings, necklaces and rings in 925 sterling silver and 18k gold PVD." };
type Query = Record<string, string | string[] | undefined>;

export default function ShopPage({ searchParams }: { searchParams: Promise<Query> }) {
  return <Suspense fallback={<div className="store-container store-section" role="status">Gathering your everyday pieces…</div>}><ShopContent searchParams={searchParams} /></Suspense>;
}

async function ShopContent({ searchParams }: { searchParams: Promise<Query> }) {
  // Links come from categories with products; a link to an empty (but live)
  // category still resolves, to an honest empty page rather than a 404.
  const [all, categories, query] = await Promise.all([listAllCategories(), listCategories(), searchParams]);
  const category = typeof query.category === "string" ? query.category : "";
  const selected = all.find((entry) => entry.handle === category);
  if (category && !selected) notFound();
  const products = selected ? await listProductsInCategory(selected, all) : await listProducts();
  const visible = applyFilters(products, parseFilters(query));
  const current = selected ? categoryHref(selected) : "/shop";
  const subLinks = selected ? subcategoryNavigation(categories, selected) : [];
  return <div className="store-container store-section">
    <header className="store-shop-heading"><p className="store-eyebrow">The Siumora collection</p><h1>{selected?.name ?? "All jewellery"}</h1><p>Little pieces to make your everyday your own.</p><nav className="store-shop-categories" aria-label="Jewellery categories">{shopNavigation(categories).map((item) => <Link key={item.href} href={item.href} aria-current={item.href === current ? "page" : undefined}>{item.label}</Link>)}</nav>{subLinks.length > 0 && <nav className="store-shop-categories" aria-label={`${subLinks[0]!.label.replace(/^All /, "")} categories`}>{subLinks.map((item) => <Link key={item.href} href={item.href} aria-current={item.href === current ? "page" : undefined}>{item.label}</Link>)}</nav>}</header>
    <ProductFilters materials={materialFacets(products)} prices={priceFacets(products)} total={products.length} showing={visible.length} />
    {visible.length ? <div className="store-product-grid">{visible.map((product, index) => <ProductCard key={product.id} product={product} priority={index < 4} />)}</div> : <div className="store-empty"><p>No pieces match these filters just yet.</p><Link href="/shop" className="store-text-link">Explore all jewellery</Link></div>}
  </div>;
}
