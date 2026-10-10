import Image from "next/image";
import Link from "next/link";
import { SiumoraMark } from "@siumora/ui";
import { ProductCard } from "@/components/product-card";
import { StoreIcon } from "@/components/store-icon";
import { listCollections, listRecentProducts } from "@/lib/catalog";

const collectionArt: Record<string, { image: string; line: string }> = {
  everyday: { image: "/storefront/tuesday-band.webp", line: "For all your ordinary, extraordinary days." },
  gifting: { image: "/storefront/kernel-pendant.webp", line: "A small gesture. A lasting feeling." },
  "the-petal-edit": { image: "/storefront/petal-studs.webp", line: "Rooted in a petal. Made your own." },
};

export default async function HomePage() {
  const [products, collections] = await Promise.all([listRecentProducts(4), listCollections()]);
  return (
    <div className="store-home">
      <section className="store-hero" aria-labelledby="hero-title">
        <div className="store-hero-copy">
          <p className="store-eyebrow"><span className="store-small-rule" />The everyday, made a little special</p>
          <h1 id="hero-title">Something given.<br /><span>Something kept.</span></h1>
          <p className="store-hero-description">Little pieces. Lasting meaning.<br />Demi-fine jewellery for the moments that are yours.</p>
          <Link href="/shop" className="store-button">Discover the collection <StoreIcon name="arrow" width="19" /></Link>
          <Link href="/collections/gifting" className="store-text-link">Find a little something to give</Link>
          <p className="store-hero-note">925 STERLING SILVER <span>·</span> 18K GOLD PVD</p>
        </div>
        <div className="store-hero-photo">
          <Image src="/storefront/everyday-hero.webp" alt="Sunlit portrait with delicate gold jewellery and an ivory linen shirt" fill priority sizes="(min-width: 1024px) 56vw, 100vw" className="store-hero-image" />
          <div className="store-photo-label"><span>THE ART OF EVERYDAY</span><span>01 / SIUMORA</span></div>
        </div>
      </section>

      <section className="store-service-strip" aria-label="The Siumora details">
        <div><StoreIcon name="spark" /><span>925 sterling silver</span></div>
        <div><StoreIcon name="gift" /><span>Always gift-wrapped</span></div>
        <Link href="/shipping"><StoreIcon name="truck" /><span>Shipping on us, ₹999+</span></Link>
        <Link href="/care"><StoreIcon name="heart" /><span>A little care, a long life</span></Link>
      </section>

      <section className="store-container store-section" aria-labelledby="new-in-title">
        <div className="store-section-heading">
          <div><p className="store-eyebrow">Meet your everyday pieces</p><h2 id="new-in-title">Small things. Big feelings.</h2></div>
          <Link href="/shop" className="store-text-link">Explore all jewellery <StoreIcon name="arrow" width="18" /></Link>
        </div>
        {products.length > 0 ? <div className="store-product-grid">{products.map((product) => <ProductCard key={product.id} product={product} />)}</div> : <div className="store-empty"><p>New pieces are on their way.</p><Link href="/collections/everyday" className="store-text-link">Explore the Everyday collection</Link></div>}
        <p className="store-collection-note">Made to become part of your everyday. All prices include taxes.</p>
      </section>

      {collections.length > 0 && <section className="store-collections-section" aria-labelledby="collections-title">
        <div className="store-container">
          <div className="store-section-heading"><div><p className="store-eyebrow">A piece for every part of you</p><h2 id="collections-title">Follow your feeling.</h2></div><span className="store-section-aside">Thoughtful pieces, thoughtfully gathered.</span></div>
          <div className="store-collection-grid">{collections.map((collection) => {
            const art = collectionArt[collection.handle];
            return <Link key={collection.id} href={`/collections/${collection.handle}`} className="store-collection-card"><div className="store-collection-image">{art ? <Image src={art.image} alt={`${collection.title} jewellery design study`} fill sizes="(min-width: 768px) 33vw, 100vw" /> : <SiumoraMark size={80} label={null} />}</div><div className="store-collection-caption"><div><h3>{collection.title}</h3><p>{art?.line ?? collection.description}</p></div><span className="store-round-arrow"><StoreIcon name="arrow" /></span></div></Link>;
          })}</div>
        </div>
      </section>}

      <section id="our-story" className="store-story" aria-labelledby="story-title">
        <div className="store-story-image"><Image src="/coming-soon/atelier.webp" alt="The Siumora atelier, with jewellery and thoughtful wrapping details" fill sizes="(min-width: 768px) 50vw, 100vw" /></div>
        <div className="store-story-copy"><SiumoraMark size={45} label={null} /><p className="store-eyebrow">The Siumora way</p><h2 id="story-title">For the days.<br />For the always.</h2><p>Not every moment needs an occasion. Sometimes, a Tuesday is reason enough.</p><p>We make demi-fine jewellery in 925 sterling silver and 18k gold PVD. Pieces to reach for without thinking. To give with feeling. To keep close.</p><Link href="/care" className="store-text-link">A little care goes a long way <StoreIcon name="arrow" width="18" /></Link></div>
      </section>

      <section className="store-gift-note"><div className="store-gift-pattern siumora-jaali" aria-hidden="true" /><StoreIcon name="gift" width="30" height="30" /><p>Every piece leaves here wrapped as a gift.</p><Link href="/collections/gifting" className="store-text-link">Even when it’s for you <StoreIcon name="arrow" width="18" /></Link></section>
    </div>
  );
}
