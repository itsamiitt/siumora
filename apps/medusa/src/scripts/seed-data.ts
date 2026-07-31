/**
 * The canonical Siumora catalog, ported from packages/db/src/seed.ts (the
 * Fastify-side seed). That file stays the source of truth for the dual-run
 * window; this module is the Medusa-shaped copy of the same four products,
 * three collections, INR prices and stock quantities. If the numbers here
 * ever drift from packages/db/src/seed.ts, that is a bug in this file.
 *
 * Like the source, this is deliberately review-free: a seeded review with an
 * invented author would render as a fabricated statutory-adjacent claim.
 * Reviews only ever come from customers.
 *
 * Two Medusa-only fields exist per product, because Medusa's data model
 * demands them and the source has no equivalent:
 * - `optionTitle`: Medusa requires every variant to answer a product option.
 *   The source models variants by bare title ("Gold", "Size 12"), so each
 *   product gets exactly one option — "Finish" for plating choices, "Size"
 *   for the ring — and each variant's option value is its source title,
 *   verbatim.
 * - collections stay multi-valued here, but Medusa products carry a single
 *   `collection_id`; see seed.ts for how membership is preserved.
 */

/**
 * Paise → Medusa price mapping (THE conversion site — the only one).
 *
 * Load-bearing repo rule: money is integer paise everywhere; floats are
 * forbidden. Medusa 2.x stores price amounts in MAJOR currency units — for
 * INR, whole rupees (₹1,990 is stored and served as `1990`). The mapping is
 * therefore `paise / 100`, applied exactly once, at this seed boundary.
 * Every canonical price is a whole-rupee amount (multiples of ₹1), so the
 * division is exact; a paise value not divisible by 100 means corrupted
 * input, not a rounding decision, and this function refuses it rather than
 * ever producing a fractional (float) amount. The M1 adapter reverses the
 * mapping (rupees × 100 → paise) when reconstructing core money shapes.
 */
export function paiseToInrMajor(paise: number): number {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new Error(`paise must be a non-negative integer, got ${paise}`);
  }
  if (paise % 100 !== 0) {
    throw new Error(
      `refusing sub-rupee amount: ${paise} paise is not a whole number of rupees`,
    );
  }
  return paise / 100;
}

/**
 * Shipping tiers, copied from @siumora/core's cart constants
 * (FREE_SHIPPING_THRESHOLD / STANDARD_SHIPPING) under this file's standing
 * rule: the source stays canonical, and if these numbers ever drift from
 * core's, that is a bug in this file. identity.test.ts pins them against
 * core itself. Copied rather than imported because this app typechecks as
 * CJS and core's static surface is ESM.
 */
export const FREE_SHIPPING_THRESHOLD_PAISE = 99900;
export const STANDARD_SHIPPING_PAISE = 7900;

export interface SeedVariant {
  sku: string;
  title: string;
  /** Maximum retail price, integer paise (statutory, printed on the tag). */
  mrp: number;
  /** Selling price, integer paise. */
  price: number;
  /** Stock on hand at the single warehouse. */
  inventory: number;
}

export interface SeedImage {
  url: string;
  alt: string;
  width: number;
  height: number;
}

export interface SeedProduct {
  handle: string;
  title: string;
  subtitle: string;
  description: string;
  hsn: string;
  gstSlab: number;
  material: string;
  piercedJewellery: boolean;
  images: SeedImage[];
  /** Ordered; the first entry is the product's primary collection. */
  collections: string[];
  /** Medusa-only: the single product option every variant answers. */
  optionTitle: string;
  variants: SeedVariant[];
}

export const COLLECTIONS = [
  { handle: "everyday", title: "Everyday", description: "Made to be worn, not stored." },
  {
    handle: "gifting",
    title: "Gifting",
    description: "Every piece leaves here wrapped as a gift.",
  },
  {
    handle: "the-petal-edit",
    title: "The Petal Edit",
    description: "The mark, worn four ways.",
  },
] as const;

export const CATALOG: SeedProduct[] = [
  {
    handle: "petal-studs",
    title: "Petal Studs",
    subtitle: "The four-circle mark, worn small.",
    description:
      "925 sterling silver with 18k gold PVD. Hypoallergenic, nickel-free, made to be worn every day — in the shower, at the gym, at your cousin's wedding.",
    hsn: "7113",
    gstSlab: 5,
    material: "925 sterling silver · 18k gold PVD",
    piercedJewellery: true,
    images: [
      { url: "/catalog/petal-studs.svg", alt: "Petal Studs", width: 1200, height: 1500 },
      { url: "/catalog/petal-studs-detail.svg", alt: "Petal Studs — the kernel, close up", width: 1200, height: 1500 },
      { url: "/catalog/petal-studs-scale.svg", alt: "Petal Studs drawn at 11 mm across, against a millimetre rule", width: 1200, height: 1500 },
    ],
    collections: ["everyday", "gifting"],
    optionTitle: "Finish",
    variants: [
      { sku: "SIU-PS-GLD", title: "Gold", mrp: 249000, price: 199000, inventory: 24 },
      { sku: "SIU-PS-SLV", title: "Silver", mrp: 229000, price: 189000, inventory: 11 },
    ],
  },
  {
    handle: "kernel-pendant",
    title: "Kernel Pendant",
    subtitle: "One stone, set dead centre.",
    description:
      "A single mulberry-toned stone in a hand-set bezel on a 45cm chain. 925 sterling silver with 18k gold PVD.",
    hsn: "7113",
    gstSlab: 5,
    material: "925 sterling silver · 18k gold PVD",
    piercedJewellery: false,
    images: [
      { url: "/catalog/kernel-pendant.svg", alt: "Kernel Pendant", width: 1200, height: 1500 },
      { url: "/catalog/kernel-pendant-detail.svg", alt: "Kernel Pendant — the kernel, close up", width: 1200, height: 1500 },
      { url: "/catalog/kernel-pendant-scale.svg", alt: "Kernel Pendant drawn at 18 mm across, against a millimetre rule", width: 1200, height: 1500 },
    ],
    collections: ["gifting", "the-petal-edit"],
    optionTitle: "Finish",
    variants: [
      { sku: "SIU-KP-GLD", title: "Gold", mrp: 429000, price: 349000, inventory: 8 },
    ],
  },
  {
    handle: "jaali-hoops",
    title: "Jaali Hoops",
    subtitle: "The lattice, opened out.",
    description:
      "Fine 20mm hoops cut with the jaali lattice. Light enough for all day.",
    hsn: "7113",
    gstSlab: 5,
    material: "925 sterling silver · 18k gold PVD",
    piercedJewellery: true,
    images: [
      { url: "/catalog/jaali-hoops.svg", alt: "Jaali Hoops", width: 1200, height: 1500 },
      { url: "/catalog/jaali-hoops-detail.svg", alt: "Jaali Hoops — the kernel, close up", width: 1200, height: 1500 },
      { url: "/catalog/jaali-hoops-scale.svg", alt: "Jaali Hoops drawn at 32 mm across, against a millimetre rule", width: 1200, height: 1500 },
    ],
    collections: ["everyday", "the-petal-edit"],
    optionTitle: "Finish",
    variants: [
      { sku: "SIU-JH-GLD", title: "Gold", mrp: 329000, price: 279000, inventory: 16 },
      { sku: "SIU-JH-SLV", title: "Silver", mrp: 299000, price: 259000, inventory: 0 },
    ],
  },
  {
    handle: "tuesday-band",
    title: "Tuesday Band",
    subtitle: "For the Tuesday, not the wedding.",
    description:
      "A plain 2mm band with a brushed finish and a single kernel on the inner face.",
    hsn: "7113",
    gstSlab: 5,
    material: "925 sterling silver · 18k gold PVD",
    piercedJewellery: false,
    images: [
      { url: "/catalog/tuesday-band.svg", alt: "Tuesday Band", width: 1200, height: 1500 },
      { url: "/catalog/tuesday-band-detail.svg", alt: "Tuesday Band — the kernel, close up", width: 1200, height: 1500 },
      { url: "/catalog/tuesday-band-scale.svg", alt: "Tuesday Band drawn at 6 mm across, against a millimetre rule", width: 1200, height: 1500 },
    ],
    collections: ["everyday"],
    optionTitle: "Size",
    variants: [
      { sku: "SIU-TB-12", title: "Size 12", mrp: 189000, price: 159000, inventory: 19 },
      { sku: "SIU-TB-14", title: "Size 14", mrp: 189000, price: 159000, inventory: 7 },
    ],
  },
];
