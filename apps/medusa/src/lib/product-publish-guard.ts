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
 *
 * It also refuses what would publish a product no shopper can see: a variant
 * with no INR price (the storefront's listing skips a product it cannot
 * price) and no sales channel behind a live publishable key (the store API
 * never returns it). Both used to pass here and fail silently downstream.
 */

/** Mirrors @siumora/core GST_SLABS; pinned against it in the test. */
export const PUBLISHABLE_GST_SLABS = [0, 5, 18, 40] as const;

export interface PublishCandidate {
  readonly id?: string;
  readonly handle?: string | null;
  readonly title?: string | null;
  readonly status?: string | null;
  readonly metadata?: Record<string, unknown> | null;
  /** Present when the caller read them; an absent list is not checked. */
  readonly variants?: ReadonlyArray<{
    readonly id?: string;
    readonly title?: string | null;
    readonly prices?: readonly CandidatePrice[] | null;
  } | null> | null;
  readonly sales_channels?: ReadonlyArray<{ readonly id?: string } | null> | null;
}

type CandidatePrice = { readonly amount?: number | null; readonly currency_code?: string | null } | null;

/** The storefront's currency; mirrors the seeded India region. */
export const STOREFRONT_CURRENCY = "inr";

function hasStorefrontPrice(prices: readonly CandidatePrice[] | null | undefined): boolean {
  return (prices ?? []).some((price) =>
    price?.currency_code?.toLowerCase() === STOREFRONT_CURRENCY &&
    typeof price.amount === "number" && Number.isFinite(price.amount) && price.amount > 0);
}

/**
 * What is missing for this product to be published, or [] when nothing.
 *
 * `storefrontChannels` — the sales channels behind live publishable keys.
 * When given, a published product must sit in at least one of them.
 */
export function missingPublishFields(
  product: PublishCandidate,
  storefrontChannels?: ReadonlySet<string>,
): string[] {
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
  if (product.variants) {
    const variants = product.variants.filter((variant) => variant !== null);
    if (variants.length === 0) missing.push("at least one variant");
    else if (variants.some((variant) => !hasStorefrontPrice(variant.prices))) {
      missing.push("an INR price on every variant");
    }
  }
  if (storefrontChannels) {
    const channels = (product.sales_channels ?? []).flatMap((channel) => (channel?.id ? [channel.id] : []));
    if (!channels.some((id) => storefrontChannels.has(id))) {
      missing.push("the storefront sales channel");
    }
  }
  return missing;
}

/** The refusal for a batch, or null when every published product is complete. */
export function publishRefusal(
  products: readonly PublishCandidate[],
  storefrontChannels?: ReadonlySet<string>,
): string | null {
  const problems = products
    .map((product) => ({ product, missing: missingPublishFields(product, storefrontChannels) }))
    .filter((entry) => entry.missing.length > 0);
  if (problems.length === 0) return null;
  const named = problems
    .map(({ product, missing }) =>
      `"${product.title ?? product.handle ?? product.id ?? "product"}" needs ${missing.join(" and ")}`)
    .join("; ");
  return `Cannot publish: ${named}. Save it as a draft, fill in what is missing, then publish.`;
}
