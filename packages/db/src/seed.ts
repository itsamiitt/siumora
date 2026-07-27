import { connectionStringFromEnv, createDb, createPool } from "./client.ts";
import { migrate } from "./migrate.ts";
import {
  collections,
  pincodeServiceability,
  productCollections,
  products,
  reviews,
  variants,
} from "./schema.ts";

/**
 * Seed the catalogue.
 *
 * Idempotent: it clears the catalogue tables first, so running it twice leaves
 * the same state rather than four copies of every product.
 */

const CATALOG = [
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
    ],
    collections: ["everyday", "gifting"],
    variants: [
      { sku: "SIU-PS-GLD", title: "Gold", mrp: 249000, price: 199000, inventory: 24 },
      { sku: "SIU-PS-SLV", title: "Silver", mrp: 229000, price: 189000, inventory: 11 },
    ],
    reviews: [
      {
        rating: 5,
        title: "Wear them every day",
        body: "Bought these after my first salary. Have not taken them off since.",
        authorName: "Asha M.",
        verifiedBuyer: true,
      },
      {
        rating: 4,
        title: "Smaller than I expected",
        body: "Lovely finish and the packing is genuinely gift-ready.",
        authorName: "Riya S.",
        verifiedBuyer: true,
      },
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
    ],
    collections: ["gifting", "the-petal-edit"],
    variants: [
      { sku: "SIU-KP-GLD", title: "Gold", mrp: 429000, price: 349000, inventory: 8 },
    ],
    reviews: [
      {
        rating: 5,
        title: "Gifted it, then bought my own",
        body: "Gave this to my sister for her exam result and ended up ordering the same one.",
        authorName: "Nikhil P.",
        verifiedBuyer: true,
      },
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
    ],
    collections: ["everyday", "the-petal-edit"],
    variants: [
      { sku: "SIU-JH-GLD", title: "Gold", mrp: 329000, price: 279000, inventory: 16 },
      { sku: "SIU-JH-SLV", title: "Silver", mrp: 299000, price: 259000, inventory: 0 },
    ],
    reviews: [
      {
        rating: 4,
        title: "Light enough to forget",
        body: "I usually cannot wear hoops all day. These I forget I have on.",
        authorName: "Fatima K.",
        verifiedBuyer: true,
      },
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
    ],
    collections: ["everyday"],
    variants: [
      { sku: "SIU-TB-12", title: "Size 12", mrp: 189000, price: 159000, inventory: 19 },
      { sku: "SIU-TB-14", title: "Size 14", mrp: 189000, price: 159000, inventory: 7 },
    ],
    reviews: [],
  },
] as const;

const COLLECTIONS = [
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
];

/** Metro pincodes get the faster window and COD; the rest are standard. */
const PINCODES = [
  { pincode: "400001", city: "Mumbai", stateCode: "27", codAvailable: true, estimatedDays: "2-3", rtoRateBps: 400 },
  { pincode: "110001", city: "Delhi", stateCode: "07", codAvailable: true, estimatedDays: "2-3", rtoRateBps: 2600 },
  { pincode: "560001", city: "Bengaluru", stateCode: "29", codAvailable: true, estimatedDays: "2-3", rtoRateBps: 700 },
  { pincode: "700001", city: "Kolkata", stateCode: "19", codAvailable: true, estimatedDays: "3-4", rtoRateBps: 1500 },
  { pincode: "781001", city: "Guwahati", stateCode: "18", codAvailable: false, estimatedDays: "5-7", rtoRateBps: 2200 },
];

export async function seed(databaseUrl?: string) {
  const pool = createPool({
    connectionString: databaseUrl ?? connectionStringFromEnv(),
    ssl: process.env.DATABASE_SSL === "true",
  });

  try {
    await migrate(pool);
    const db = createDb(pool);

    await db.delete(productCollections);
    await db.delete(reviews);
    await db.delete(variants);
    await db.delete(products);
    await db.delete(collections);
    await db.delete(pincodeServiceability);

    const collectionRows = await db
      .insert(collections)
      .values(COLLECTIONS)
      .returning();
    const collectionByHandle = new Map(
      collectionRows.map((row) => [row.handle, row.id]),
    );

    for (const entry of CATALOG) {
      const [product] = await db
        .insert(products)
        .values({
          handle: entry.handle,
          title: entry.title,
          subtitle: entry.subtitle,
          description: entry.description,
          hsn: entry.hsn,
          gstSlab: entry.gstSlab,
          material: entry.material,
          piercedJewellery: entry.piercedJewellery,
          images: entry.images,
        })
        .returning();

      await db.insert(variants).values(
        entry.variants.map((variant) => ({ ...variant, productId: product!.id })),
      );

      await db.insert(productCollections).values(
        entry.collections.map((handle, index) => ({
          productId: product!.id,
          collectionId: collectionByHandle.get(handle)!,
          position: index,
        })),
      );

      if (entry.reviews.length > 0) {
        await db
          .insert(reviews)
          .values(entry.reviews.map((r) => ({ ...r, productId: product!.id })));
      }
    }

    await db.insert(pincodeServiceability).values(PINCODES);

    return {
      products: CATALOG.length,
      collections: COLLECTIONS.length,
      pincodes: PINCODES.length,
    };
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await seed();
  console.log(
    `seeded ${result.products} products, ${result.collections} collections, ${result.pincodes} pincodes`,
  );
}
