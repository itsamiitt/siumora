import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { applyFilters, materialFacets, parseFilters, priceFacets } from "@siumora/core";
import { ProductCard } from "@/components/product-card";
import { ProductFilters } from "@/components/product-filters";
import { SHOP_NAV } from "@/components/site-navigation";
import { listProducts } from "@/lib/catalog";

export const metadata: Metadata = { title: "Shop all jewellery", description: "Discover Siumora demi-fine earrings, necklaces and rings in 925 sterling silver and 18k gold PVD." };
type Query = Record<string, string | string[] | undefined>;
const categories: Record<string, { label: string; pattern: RegExp }> = {
  earrings: { label: "Earrings", pattern: /earring|stud|hoop/i },
  necklaces: { label: "Necklaces", pattern: /necklace|pendant|chain/i },
  rings: { label: "Rings", pattern: /\bring\b|\bband\b/i },
};

export default function ShopPage({ searchParams }: { searchParams: Promise<Query> }) {
  return <Suspense fallback={<div className="store-container store-section" role="status">Gathering your everyday pieces…</div>}><ShopContent searchParams={searchParams} /></Suspense>;
}

async function ShopContent({ searchParams }: { searchParams: Promise<Query> }) {
  const [all, query] = await Promise.all([listProducts(), searchParams]);
  const category = typeof query.category === "string" ? query.category : "";
  const selected = categories[category];
  const products = selected ? all.filter((product) => selected.pattern.test(`${product.title} ${product.subtitle}`)) : all;
  const visible = applyFilters(products, parseFilters(query));
  return <div className="store-container store-section">
    <header className="store-shop-heading"><p className="store-eyebrow">The Siumora collection</p><h1>{selected?.label ?? "All jewellery"}</h1><p>Little pieces to make your everyday your own.</p><nav className="store-shop-categories" aria-label="Jewellery categories">{SHOP_NAV.map((item) => <Link key={item.href} href={item.href} aria-current={item.href === (selected ? `/shop?category=${category}` : "/shop") ? "page" : undefined}>{item.label}</Link>)}</nav></header>
    <ProductFilters materials={materialFacets(products)} prices={priceFacets(products)} total={products.length} showing={visible.length} />
    {visible.length ? <div className="store-product-grid">{visible.map((product, index) => <ProductCard key={product.id} product={product} priority={index < 4} />)}</div> : <div className="store-empty"><p>No pieces match these filters just yet.</p><Link href="/shop" className="store-text-link">Explore all jewellery</Link></div>}
  </div>;
}
