import { z } from "zod";

import { GST_SLABS } from "./gst.ts";

/** Money is paise everywhere — integers only, never negative. */
const paise = z.number().int().nonnegative();

const handle = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "handle must be lowercase kebab-case");

export const gstSlabSchema = z.union([
  z.literal(GST_SLABS[0]),
  z.literal(GST_SLABS[1]),
  z.literal(GST_SLABS[2]),
  z.literal(GST_SLABS[3]),
]);

export const imageSchema = z.object({
  url: z.string(),
  alt: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const priceSchema = z
  .object({
    /** Maximum retail price in paise, tax-inclusive. Shown struck through. */
    mrp: paise,
    /** What the customer actually pays, in paise, tax-inclusive. */
    selling: paise,
  })
  .refine((p) => p.selling <= p.mrp, {
    message: "selling price cannot exceed MRP",
    path: ["selling"],
  });

export const variantSchema = z.object({
  id: z.string().min(1),
  sku: z.string().min(1),
  title: z.string().min(1),
  price: priceSchema,
  /** Units available to promise. Zero renders as sold out, never as buyable. */
  inventory: z.number().int().nonnegative(),
});

export const productSchema = z.object({
  id: z.string().min(1),
  handle,
  title: z.string().min(1),
  /** One-line description used on cards and in meta tags. */
  subtitle: z.string(),
  description: z.string(),
  /** HSN code — required on the GST invoice. */
  hsn: z.string().min(4),
  gstSlab: gstSlabSchema,
  material: z.string(),
  /**
   * Pierced jewellery — earrings and nose pins. The returns policy refuses
   * these once the hygiene seal is broken, so the catalogue has to say which
   * pieces they are rather than the rule guessing from the title.
   */
  piercedJewellery: z.boolean().default(false),
  images: z.array(imageSchema).min(1),
  variants: z.array(variantSchema).min(1),
  collections: z.array(handle),
});

export const collectionSchema = z.object({
  id: z.string().min(1),
  handle,
  title: z.string().min(1),
  description: z.string(),
});

export type Image = z.infer<typeof imageSchema>;
export type Price = z.infer<typeof priceSchema>;
export type Variant = z.infer<typeof variantSchema>;
export type Product = z.infer<typeof productSchema>;
export type Collection = z.infer<typeof collectionSchema>;

/** Lowest selling price across a product's variants, for "from ₹X" on cards. */
export function lowestPrice(product: Product): Price {
  return product.variants.reduce<Price>(
    (lowest, variant) => (variant.price.selling < lowest.selling ? variant.price : lowest),
    product.variants[0]!.price,
  );
}

/** A product is buyable when any variant has stock. */
export function isInStock(product: Product): boolean {
  return product.variants.some((variant) => variant.inventory > 0);
}
