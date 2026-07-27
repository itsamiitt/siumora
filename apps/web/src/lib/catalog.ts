import "server-only";

import {
  productSchema,
  type Collection,
  type Product,
  type Variant,
} from "@siumora/core";

/**
 * Catalog source.
 *
 * Phase 1 reads a local fixture so the storefront can be built and reviewed
 * before Medusa is provisioned. The exported functions are the seam: when
 * apps/api comes up, these bodies call packages/sdk and every caller — pages,
 * metadata, sitemap — keeps working unchanged.
 *
 * Prices are paise, tax-inclusive, per plan/02-frontend §3.
 */

const RAW_PRODUCTS: unknown[] = [
  {
    id: "prod_petal_studs",
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
      {
        url: "/catalog/petal-studs.svg",
        alt: "Petal Studs in gold-plated sterling silver",
        width: 1200,
        height: 1500,
      },
    ],
    variants: [
      {
        id: "var_petal_studs_gold",
        sku: "SIU-PS-GLD",
        title: "Gold",
        price: { mrp: 249000, selling: 199000 },
        inventory: 24,
      },
      {
        id: "var_petal_studs_silver",
        sku: "SIU-PS-SLV",
        title: "Silver",
        price: { mrp: 229000, selling: 189000 },
        inventory: 11,
      },
    ],
    collections: ["everyday", "gifting"],
  },
  {
    id: "prod_kernel_pendant",
    handle: "kernel-pendant",
    title: "Kernel Pendant",
    subtitle: "One stone, set dead centre.",
    description:
      "A single mulberry-toned stone in a hand-set bezel on a 45cm chain. 925 sterling silver with 18k gold PVD. Adjustable to 42cm.",
    hsn: "7113",
    gstSlab: 5,
    material: "925 sterling silver · 18k gold PVD",
    images: [
      {
        url: "/catalog/kernel-pendant.svg",
        alt: "Kernel Pendant on a fine chain",
        width: 1200,
        height: 1500,
      },
    ],
    variants: [
      {
        id: "var_kernel_pendant_gold",
        sku: "SIU-KP-GLD",
        title: "Gold",
        price: { mrp: 429000, selling: 349000 },
        inventory: 8,
      },
    ],
    collections: ["gifting", "the-petal-edit"],
  },
  {
    id: "prod_jaali_hoops",
    handle: "jaali-hoops",
    title: "Jaali Hoops",
    subtitle: "The lattice, opened out.",
    description:
      "Fine 20mm hoops cut with the jaali lattice. Light enough for all day. 925 sterling silver with 18k gold PVD.",
    hsn: "7113",
    gstSlab: 5,
    material: "925 sterling silver · 18k gold PVD",
    piercedJewellery: true,
    images: [
      {
        url: "/catalog/jaali-hoops.svg",
        alt: "Jaali Hoops cut with the lattice pattern",
        width: 1200,
        height: 1500,
      },
    ],
    variants: [
      {
        id: "var_jaali_hoops_gold",
        sku: "SIU-JH-GLD",
        title: "Gold",
        price: { mrp: 329000, selling: 279000 },
        inventory: 16,
      },
      {
        id: "var_jaali_hoops_silver",
        sku: "SIU-JH-SLV",
        title: "Silver",
        price: { mrp: 299000, selling: 259000 },
        inventory: 0,
      },
    ],
    collections: ["everyday", "the-petal-edit"],
  },
  {
    id: "prod_tuesday_band",
    handle: "tuesday-band",
    title: "Tuesday Band",
    subtitle: "For the Tuesday, not the wedding.",
    description:
      "A plain 2mm band with a brushed finish and a single kernel on the inner face, where only you see it. 925 sterling silver with 18k gold PVD.",
    hsn: "7113",
    gstSlab: 5,
    material: "925 sterling silver · 18k gold PVD",
    images: [
      {
        url: "/catalog/tuesday-band.svg",
        alt: "Tuesday Band with a brushed finish",
        width: 1200,
        height: 1500,
      },
    ],
    variants: [
      {
        id: "var_tuesday_band_12",
        sku: "SIU-TB-12",
        title: "Size 12",
        price: { mrp: 189000, selling: 159000 },
        inventory: 19,
      },
      {
        id: "var_tuesday_band_14",
        sku: "SIU-TB-14",
        title: "Size 14",
        price: { mrp: 189000, selling: 159000 },
        inventory: 7,
      },
    ],
    collections: ["everyday"],
  },
];

/**
 * Parsed once at module load. A malformed fixture fails the build rather than
 * rendering a broken price, which is the failure mode that matters here.
 */
const PRODUCTS: Product[] = RAW_PRODUCTS.map((raw) => productSchema.parse(raw));

const COLLECTIONS: Collection[] = [
  {
    id: "col_everyday",
    handle: "everyday",
    title: "Everyday",
    description: "Made to be worn, not stored.",
  },
  {
    id: "col_gifting",
    handle: "gifting",
    title: "Gifting",
    description: "Every piece leaves here wrapped as a gift.",
  },
  {
    id: "col_petal_edit",
    handle: "the-petal-edit",
    title: "The Petal Edit",
    description: "The mark, worn four ways.",
  },
];

export async function listProducts(): Promise<Product[]> {
  return PRODUCTS;
}

export async function getProduct(handle: string): Promise<Product | undefined> {
  return PRODUCTS.find((product) => product.handle === handle);
}

export async function listCollections(): Promise<Collection[]> {
  return COLLECTIONS;
}

export async function getCollection(
  handle: string,
): Promise<Collection | undefined> {
  return COLLECTIONS.find((collection) => collection.handle === handle);
}

export async function listProductsInCollection(
  handle: string,
): Promise<Product[]> {
  return PRODUCTS.filter((product) => product.collections.includes(handle));
}

/** Resolve a variant and the product carrying it. Used by the cart. */
export async function findVariant(
  variantId: string,
): Promise<{ product: Product; variant: Variant } | undefined> {
  for (const product of PRODUCTS) {
    const variant = product.variants.find((v) => v.id === variantId);
    if (variant) return { product, variant };
  }
  return undefined;
}
