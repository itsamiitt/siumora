/**
 * The publish gate for statutory product fields — pure, so node --test can
 * strip-type it; the workflow hook (src/workflows/hooks/product-publish-
 * guard.ts) is the thin wiring.
 *
 * A published product must carry what the storefront and the GST invoice
 * cannot do without: metadata.hsn (4–8 digits) and metadata.gst_slab (one of
 * core's slabs). These are the keys and the bar the India-fields widget
 * writes (src/admin/lib/india-fields.ts); the SDK's mapProduct refuses a
 * product without a slab, so publishing one would only hide it from the
 * shop at best. Drafts are free to be incomplete — that is how a product
 * gets created, then filled in through the widget, then published.
 */

/** Mirrors @siumora/core GST_SLABS; pinned against it in the test. */
export const PUBLISHABLE_GST_SLABS = [0, 5, 18, 40] as const;

export interface PublishCandidate {
  readonly id?: string;
  readonly handle?: string | null;
  readonly title?: string | null;
  readonly status?: string | null;
  readonly metadata?: Record<string, unknown> | null;
}

/** What is missing for this product to be published, or [] when nothing. */
export function missingPublishFields(product: PublishCandidate): string[] {
  if (product.status !== "published") return [];
  const metadata = product.metadata ?? {};
  const missing: string[] = [];
  if (typeof metadata.hsn !== "string" || !/^\d{4,8}$/.test(metadata.hsn.trim())) {
    missing.push("HSN code");
  }
  const slab = metadata.gst_slab;
  if (typeof slab !== "number" || !(PUBLISHABLE_GST_SLABS as readonly number[]).includes(slab)) {
    missing.push("GST slab");
  }
  return missing;
}

/** The refusal for a batch, or null when every published product is complete. */
export function publishRefusal(products: readonly PublishCandidate[]): string | null {
  const problems = products
    .map((product) => ({ product, missing: missingPublishFields(product) }))
    .filter((entry) => entry.missing.length > 0);
  if (problems.length === 0) return null;
  const named = problems
    .map(({ product, missing }) =>
      `"${product.title ?? product.handle ?? product.id ?? "product"}" needs ${missing.join(" and ")}`)
    .join("; ");
  return `Cannot publish: ${named}. Save it as a draft, fill in the India fields, then publish.`;
}
