# Siumora storefront

Built in the existing Next.js storefront, preserving the Siumora brand kit, catalog API, cart, saved items, account, consent controls, theme preference, and launch-preview gate.

## Research and decisions

- [Baymard: expose product categories in mobile navigation](https://baymard.com/research-articles/main-navigation-product-categories). Earrings, necklaces, rings, and all jewellery appear directly in the drawer. Collection stories and account utilities follow them.
- [Baymard: mobile search and navigation](https://baymard.com/research-articles/mobile-ecommerce-search-and-navigation). A static hero, visible catalog breadth, and collection entry points avoid an automatic carousel and nested shopping menus.
- [Mejuri storefront](https://mejuri.com/). Reference for restrained jewelry presentation and category-led browsing, not copied layouts or assets.
- Local authority: `brand-kit/README.md`. Ivory ground, mulberry accent, brass used sparingly, Cormorant display type, Jost interface type, existing logo geometry and brand voice.

## Implementation

- Responsive sticky header with visible search and bag, an accessible native-dialog mobile menu, Escape dismissal, focus restoration, scroll locking, and a skip link. Existing Suspense protection around `usePathname` is retained.
- Photographic hero, four API-backed products, three collection entry points, atelier story, gift-wrap message, service links, and responsive footer.
- `/shop` exposes category browsing alongside the existing URL-based filters and sorting. Filter changes preserve the selected category. Categories currently use product names because the existing Product schema has no product-type field; use an explicit API category field when that becomes available.
- Cards and product galleries replace only the four known bundled SVG sample illustrations. Uploaded merchant images are never replaced. Images use `next/image`, responsive sizes, fixed aspect ratios, and lazy loading below the hero.
- Footer retains shipping, returns, care, account, support, privacy, terms, cookie preferences, delivery lookup, and theme controls. Shipping copy follows the existing shipping page.

## Artwork

Created with the built-in imagegen tool, then resized and encoded as WebP. These are illustrative campaign and product concepts, not photographs of manufactured inventory. Replace the sample artwork with verified product photography before offering the represented designs for sale. The four original sample SVGs remain intact.

Files are in `apps/web/public/storefront/`:

| Asset | Purpose |
| --- | --- |
| `everyday-hero.webp` | Editorial hero, 1536 × 1024 |
| `petal-studs.webp` | Stud-earring design study, 1000 × 1250 |
| `kernel-pendant.webp` | Pendant design study, 1000 × 1250 |
| `jaali-hoops.webp` | Hoop-earring design study, 1000 × 1250 |
| `tuesday-band.webp` | Ring design study, 1000 × 1250 |

The existing `public/coming-soon/atelier.webp` is reused for the brand story. The five new WebP assets total approximately 356 KiB before Next.js responsive optimization.

### Final hero prompt

Use case: photorealistic-natural. Asset type: wide editorial jewelry storefront hero photograph, landscape 3:2. Create a refined natural-light fashion campaign photograph for Siumora, an Indian demi-fine jewelry brand. Close cropped portrait from lower nose to collarbone of an adult South Asian woman with warm brown skin, wearing a simple ivory linen shirt open at neckline, tiny elegant sculptural gold hoop earring and a single fine gold chain with a very small petal pendant. Her hand gently touches her neck with one simple thin gold band. Face and hand have authentic skin texture. She is on the right half of the composition. Left half is softly blurred warm cream interior, soft afternoon sun and delicate shadows. Quiet, tactile, understated magazine editorial photography, cream/ochre palette, film grain. No words, no logos, no watermarks, no collage. Anatomy correct, jewelry subtle and realistic.

### Final product prompt template

Use case: product-mockup. Asset type: jewelry collection concept image for storefront design. Photorealistic high-end studio product photography of SUBJECT. One product only, centred in generous negative space, fills middle 45 percent of portrait 4:5 composition. Warm ivory matte paper background, soft afternoon sunlight from upper left, gentle realistic cast shadow toward lower right, restrained gold tone, extremely refined fine jewelry, sharp accurate detailed metalwork, no branding, no text, no watermark, no props, no border. This is an illustrative design concept.

SUBJECT values:

- Petal Studs: a pair of tiny gold stud earrings, each composed of four delicate overlapping circular gold loops forming a four-petal flower, with a tiny round mulberry-colored stone in the centre.
- Kernel Pendant: a fine gold chain necklace loosely arranged in a graceful oval, with one tiny circular bezel-set deep mulberry stone pendant hanging at the bottom.
- Jaali Hoops: a pair of small fine gold hoop earrings, each with an intricate open geometric floral lattice pattern, one standing at an angle and the other resting flat.
- Tuesday Band: a single thin 2mm gold band ring with an elegant brushed finish standing at a slight angle, subtle gold reflections.

## Local operation and verification

Run the existing application with a configured commerce API as described in the root README. There is no sample-data fallback in production and no change to checkout credentials or deployment.

Validation used an isolated read-only HTTP fixture generated from the repository's seed catalog because no commerce server was running locally. The fixture is not part of the application. Production compilation and the existing web unit suite were checked. Static browser snapshots cover 320, 390, 768, 1024, and 1440 px, plus the dark theme. Interactive browser checks could not be completed because automatic approval review blocked the local preview server, including a loopback-only attempt, with the reason “blocked by policy.” Full purchase-flow validation still requires the actual commerce services.
