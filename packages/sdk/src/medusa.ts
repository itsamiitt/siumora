import {
  calculateTotals,
  collectionSchema,
  isGstSlab,
  productSchema,
  searchProducts,
  shippingFor,
  summariseRatings,
  type CartLine,
  type CartTotals,
  type Collection,
  type Product,
  type RatingSummary,
  type Review,
} from "@siumora/core";

import { ApiError, SiumoraClient } from "./index.ts";

/**
 * Medusa transport for the commerce surface (design doc M1).
 *
 * The same public methods as SiumoraClient, served by a Medusa 2.x store API
 * instead of the Fastify one. Two rules govern this file:
 *
 * 1. **This module is the only place Medusa wire shapes exist outside
 *    `apps/medusa`.** The interfaces below describe exactly the fields the
 *    transport reads — nothing imports `@medusajs/*` here or anywhere else in
 *    the storefront's dependency graph, and `medusa-boundary.test.ts` fails
 *    the build if that changes. Everything leaving this file is a core domain
 *    shape, revalidated through core's own zod schemas so a Medusa-side drift
 *    is a loud parse error, not a quiet storefront bug.
 *
 * 2. **Money crosses back to paise immediately.** The seed wrote canonical
 *    integer paise onto variant metadata (`mrp_paise` / `price_paise`);
 *    the transport prefers that lossless channel and only falls back to
 *    Medusa's major-unit amounts × 100, refusing any amount that does not
 *    round-trip to an integer paise value.
 *
 * Methods whose Medusa backing has not been built yet throw NotPortedError
 * (501 `not_ported`) naming the phase that delivers them — the same
 * loud-refusal contract as COMMERCE_BACKEND and E2E_BACKEND: a refusal beats
 * silently serving the wrong answer.
 */

export class NotPortedError extends ApiError {
  constructor(method: string, phase: string) {
    super(
      501,
      "not_ported",
      `${method} is not ported to the Medusa transport yet (lands with ${phase}).`,
    );
    this.name = "NotPortedError";
  }
}

// ── Medusa wire shapes (this file only) ───────────────────────────────────

interface MedusaImage {
  url: string;
  metadata?: { alt?: unknown; width?: unknown; height?: unknown } | null;
}

interface MedusaVariant {
  id: string;
  sku: string | null;
  title: string | null;
  metadata?: { mrp_paise?: unknown; price_paise?: unknown } | null;
  inventory_quantity?: number;
  calculated_price?: { calculated_amount: number | null } | null;
}

interface MedusaProduct {
  id: string;
  handle: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  metadata?: {
    hsn?: unknown;
    gst_slab?: unknown;
    material?: unknown;
    pierced_jewellery?: unknown;
    collections?: unknown;
  } | null;
  images?: MedusaImage[] | null;
  variants?: MedusaVariant[] | null;
}

interface MedusaCollection {
  id: string;
  handle: string;
  title: string;
  metadata?: { description?: unknown } | null;
}

interface MedusaCartItem {
  id: string;
  quantity: number;
  unit_price: number;
  variant_id?: string | null;
  variant_sku?: string | null;
  variant_title?: string | null;
  product_title?: string | null;
  product_handle?: string | null;
  thumbnail?: string | null;
  variant?:
    | (MedusaVariant & {
        product?: (Pick<MedusaProduct, "metadata"> & { images?: MedusaImage[] | null }) | null;
      })
    | null;
}

interface MedusaCart {
  id: string;
  items?: MedusaCartItem[] | null;
}

// ── Money ─────────────────────────────────────────────────────────────────

/**
 * Medusa major units (rupees) back to canonical paise.
 *
 * The inverse of the seed's paiseToInrMajor. Throws rather than rounding:
 * a Medusa amount that is not a whole paise value means the data went
 * through a float somewhere, and that is a bug to surface, not smooth over.
 */
export function majorToPaise(amount: number): number {
  const paise = Math.round(amount * 100);
  if (!Number.isFinite(amount) || Math.abs(amount * 100 - paise) > 1e-6) {
    throw new Error(`Medusa amount ${amount} does not convert to integer paise`);
  }
  return paise;
}

function metadataPaise(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function variantPrice(variant: MedusaVariant): { mrp: number; selling: number } {
  const selling =
    metadataPaise(variant.metadata?.price_paise) ??
    (typeof variant.calculated_price?.calculated_amount === "number"
      ? majorToPaise(variant.calculated_price.calculated_amount)
      : undefined);
  if (selling === undefined) {
    throw new Error(`variant ${variant.id} carries no usable price`);
  }
  // A variant seeded without an MRP is priced at MRP — never below a floor
  // that does not exist.
  const mrp = metadataPaise(variant.metadata?.mrp_paise) ?? selling;
  return { mrp, selling };
}

// ── Mapping to core domain shapes ─────────────────────────────────────────

function mapImage(image: MedusaImage, productTitle: string) {
  return {
    url: image.url,
    alt: typeof image.metadata?.alt === "string" ? image.metadata.alt : productTitle,
    width: image.metadata?.width,
    height: image.metadata?.height,
  };
}

/** Medusa product → core Product, revalidated through core's schema. */
export function mapProduct(product: MedusaProduct): Product {
  const metadata = product.metadata ?? {};
  const slab = typeof metadata.gst_slab === "number" ? metadata.gst_slab : NaN;
  if (!isGstSlab(slab)) {
    throw new Error(`product ${product.handle} has no valid gst_slab in metadata`);
  }

  return productSchema.parse({
    id: product.id,
    handle: product.handle,
    title: product.title,
    subtitle: product.subtitle ?? "",
    description: product.description ?? "",
    hsn: metadata.hsn,
    gstSlab: slab,
    material: typeof metadata.material === "string" ? metadata.material : "",
    piercedJewellery: metadata.pierced_jewellery === true,
    images: (product.images ?? []).map((image) => mapImage(image, product.title)),
    variants: (product.variants ?? []).map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      title: variant.title,
      price: variantPrice(variant),
      inventory: variant.inventory_quantity ?? 0,
    })),
    collections: Array.isArray(metadata.collections) ? metadata.collections : [],
  });
}

/** Medusa collection → core Collection. Description rides metadata. */
export function mapCollection(collection: MedusaCollection): Collection {
  return collectionSchema.parse({
    id: collection.id,
    handle: collection.handle,
    title: collection.title,
    description:
      typeof collection.metadata?.description === "string"
        ? collection.metadata.description
        : "",
  });
}

/** Medusa cart item → core CartLine, integer paise throughout. */
export function mapCartLine(item: MedusaCartItem): CartLine {
  const variant = item.variant ?? undefined;
  const productMetadata = variant?.product?.metadata ?? {};
  const slab =
    typeof productMetadata.gst_slab === "number" ? productMetadata.gst_slab : NaN;
  if (!isGstSlab(slab)) {
    throw new Error(`cart line ${item.id} has no valid gst_slab on its product`);
  }
  const price = variant
    ? variantPrice(variant)
    : { mrp: majorToPaise(item.unit_price), selling: majorToPaise(item.unit_price) };
  const firstImage = variant?.product?.images?.[0]?.url;

  return {
    variantId: variant?.id ?? item.variant_id ?? "",
    sku: item.variant_sku ?? variant?.sku ?? "",
    productHandle: item.product_handle ?? "",
    title: item.product_title ?? "",
    variantTitle: item.variant_title ?? variant?.title ?? "",
    imageUrl: firstImage ?? item.thumbnail ?? "",
    mrp: price.mrp,
    unitPrice: price.selling,
    quantity: item.quantity,
    gstSlab: slab,
    hsn: typeof productMetadata.hsn === "string" ? productMetadata.hsn : "",
    piercedJewellery: productMetadata.pierced_jewellery === true,
  };
}

// ── The transport ─────────────────────────────────────────────────────────

export interface MedusaClientOptions {
  /** Base URL of the Medusa store API, e.g. http://localhost:9000. */
  baseUrl: string;
  /** Sent as x-publishable-api-key on every request. */
  publishableKey: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  /** Session token — unused until the phone-OTP auth provider ports (M1). */
  token?: string;
}

/**
 * Everything expandable the product mapping needs, in one fields clause.
 * region_id rides along so calculated_price is present as the fallback.
 */
const PRODUCT_FIELDS =
  "id,handle,title,subtitle,description,metadata," +
  "*images,*variants,*variants.metadata,+variants.inventory_quantity," +
  "*variants.calculated_price";

const CART_FIELDS =
  "id,*items,*items.variant,*items.variant.metadata," +
  "*items.variant.product.metadata,*items.variant.product.images";

/** The catalogue is 4 products; every read is one page. The Meilisearch row
 * in TODOS.md owns the day this stops being true. */
const CATALOG_PAGE = 100;

type PublicSurface = Omit<
  { [K in keyof SiumoraClient]: SiumoraClient[K] },
  "withToken"
>;

export class MedusaClient implements PublicSurface {
  private readonly baseUrl: string;
  private readonly publishableKey: string;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof globalThis.fetch;
  private readonly token: string | undefined;
  private regionId: Promise<string> | undefined;

  constructor(options: MedusaClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.publishableKey = options.publishableKey;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.doFetch = options.fetch ?? globalThis.fetch;
    this.token = options.token;
  }

  /** Same contract as SiumoraClient.withToken: a new instance, never mutation. */
  withToken(token: string | undefined): MedusaClient {
    return new MedusaClient({
      baseUrl: this.baseUrl,
      publishableKey: this.publishableKey,
      timeoutMs: this.timeoutMs,
      fetch: this.doFetch,
      ...(token ? { token } : {}),
    });
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.doFetch(`${this.baseUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        "x-publishable-api-key": this.publishableKey,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      // Medusa errors carry { type, code?, message } — keep the structured
      // code so callers can still tell "sold out" from "server is down".
      let code = "request_failed";
      let message = `Request failed with ${response.status}.`;
      try {
        const payload = (await response.json()) as {
          type?: string;
          code?: string;
          message?: string;
        };
        code = payload.code ?? payload.type ?? code;
        message = payload.message ?? message;
      } catch {
        // Non-JSON error body; the status is all we have.
      }
      throw new ApiError(response.status, code, message);
    }

    return (await response.json()) as T;
  }

  /** The INR region the seed created; resolved once per client. */
  private region(): Promise<string> {
    this.regionId ??= this.request<{
      regions: Array<{ id: string; currency_code: string }>;
    }>("GET", "/store/regions").then((data) => {
      const inr = data.regions.find((region) => region.currency_code === "inr");
      if (!inr) {
        throw new ApiError(500, "no_inr_region", "Medusa has no INR region — run the seed.");
      }
      return inr.id;
    });
    return this.regionId;
  }

  private async fetchCatalog(): Promise<Product[]> {
    const regionId = await this.region();
    const data = await this.request<{ products: MedusaProduct[] }>(
      "GET",
      `/store/products?fields=${encodeURIComponent(PRODUCT_FIELDS)}` +
        `&region_id=${encodeURIComponent(regionId)}&limit=${CATALOG_PAGE}`,
    );
    return data.products.map(mapProduct);
  }

  // ── Catalogue ───────────────────────────────────────────────

  async listProducts(
    query: { collection?: string; q?: string } = {},
  ): Promise<Product[]> {
    let products = await this.fetchCatalog();
    if (query.collection) {
      // Full membership lives on metadata; Medusa's collection_id only knows
      // the primary. Filtering here keeps multi-collection products visible.
      products = products.filter((product) =>
        product.collections.includes(query.collection!),
      );
    }
    if (query.q) {
      // The same Hinglish-aware scorer the Fastify API runs — parity by
      // construction, not by re-implementation.
      products = searchProducts(products, query.q).map((hit) => hit.product);
    }
    return products;
  }

  async getProduct(
    handle: string,
  ): Promise<
    { product: Product; reviews: Review[]; rating: RatingSummary } | undefined
  > {
    const regionId = await this.region();
    const data = await this.request<{ products: MedusaProduct[] }>(
      "GET",
      `/store/products?handle=${encodeURIComponent(handle)}` +
        `&fields=${encodeURIComponent(PRODUCT_FIELDS)}` +
        `&region_id=${encodeURIComponent(regionId)}`,
    );
    const product = data.products[0];
    if (!product) return undefined;
    // Reviews live Fastify-side until their write path exists (TODOS.md row);
    // an empty list through the same summariser is exact parity with the
    // review-free catalogue the Fastify API serves today.
    return { product: mapProduct(product), reviews: [], rating: summariseRatings([]) };
  }

  async listCollections(): Promise<Collection[]> {
    const data = await this.request<{ collections: MedusaCollection[] }>(
      "GET",
      "/store/collections",
    );
    return data.collections.map(mapCollection);
  }

  // ── Cart ────────────────────────────────────────────────────

  async createCart(): Promise<string> {
    const regionId = await this.region();
    const data = await this.request<{ cart: { id: string } }>(
      "POST",
      "/store/carts",
      { region_id: regionId },
    );
    return data.cart.id;
  }

  private async fetchCart(cartId: string): Promise<MedusaCart> {
    const data = await this.request<{ cart: MedusaCart }>(
      "GET",
      `/store/carts/${encodeURIComponent(cartId)}?fields=${encodeURIComponent(CART_FIELDS)}`,
    );
    return data.cart;
  }

  async getCart(
    cartId: string,
  ): Promise<{ cartId: string; lines: CartLine[]; totals: CartTotals }> {
    const cart = await this.fetchCart(cartId);
    const lines = (cart.items ?? []).map(mapCartLine);
    const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
    return {
      cartId,
      lines,
      // Same recipe as the Fastify cart read: intra-state until checkout
      // knows the delivery state; the order recomputes.
      totals: calculateTotals(lines, {
        interState: false,
        shipping: shippingFor(subtotal),
      }),
    };
  }

  /**
   * The stock guard the Fastify API enforces at add time.
   *
   * Medusa defers inventory reservation to completion; the storefront's
   * contract refuses at the door instead ("refuses to add more than the
   * stock on hand"), so the transport checks before creating the line.
   */
  private async assertInStock(
    variantId: string,
    requestedTotal: number,
  ): Promise<void> {
    const products = await this.fetchCatalog();
    const variant = products
      .flatMap((product) => product.variants)
      .find((candidate) => candidate.id === variantId);
    if (!variant) {
      throw new ApiError(409, "unavailable", "That variant is not available.");
    }
    if (requestedTotal > variant.inventory) {
      throw new ApiError(
        409,
        "unavailable",
        `Only ${variant.inventory} left in stock.`,
      );
    }
  }

  private async cartCount(cartId: string): Promise<number> {
    const cart = await this.fetchCart(cartId);
    return (cart.items ?? []).reduce((sum, item) => sum + item.quantity, 0);
  }

  async addToCart(
    cartId: string,
    variantId: string,
    quantity = 1,
  ): Promise<{ ok: boolean; count: number }> {
    const cart = await this.fetchCart(cartId);
    const existing = (cart.items ?? []).find(
      (item) => (item.variant?.id ?? item.variant_id) === variantId,
    );
    await this.assertInStock(variantId, (existing?.quantity ?? 0) + quantity);
    await this.request(
      "POST",
      `/store/carts/${encodeURIComponent(cartId)}/line-items`,
      { variant_id: variantId, quantity },
    );
    return { ok: true, count: await this.cartCount(cartId) };
  }

  async setCartQuantity(
    cartId: string,
    variantId: string,
    quantity: number,
  ): Promise<{ ok: boolean; count: number }> {
    const cart = await this.fetchCart(cartId);
    const line = (cart.items ?? []).find(
      (item) => (item.variant?.id ?? item.variant_id) === variantId,
    );
    if (quantity === 0) {
      if (line) {
        await this.request(
          "DELETE",
          `/store/carts/${encodeURIComponent(cartId)}/line-items/${encodeURIComponent(line.id)}`,
        );
      }
    } else {
      await this.assertInStock(variantId, quantity);
      if (line) {
        await this.request(
          "POST",
          `/store/carts/${encodeURIComponent(cartId)}/line-items/${encodeURIComponent(line.id)}`,
          { quantity },
        );
      } else {
        await this.request(
          "POST",
          `/store/carts/${encodeURIComponent(cartId)}/line-items`,
          { variant_id: variantId, quantity },
        );
      }
    }
    return { ok: true, count: await this.cartCount(cartId) };
  }

  async clearCart(cartId: string): Promise<void> {
    const cart = await this.fetchCart(cartId);
    for (const item of cart.items ?? []) {
      await this.request(
        "DELETE",
        `/store/carts/${encodeURIComponent(cartId)}/line-items/${encodeURIComponent(item.id)}`,
      );
    }
  }

  // ── Not yet ported — each names the phase that delivers it ──

  async requestOtp(): Promise<never> {
    throw new NotPortedError("requestOtp", "the M1 phone-OTP auth provider");
  }
  async verifyOtp(): Promise<never> {
    throw new NotPortedError("verifyOtp", "the M1 phone-OTP auth provider");
  }
  async getSession(): Promise<never> {
    throw new NotPortedError("getSession", "the M1 phone-OTP auth provider");
  }
  async signOut(): Promise<never> {
    throw new NotPortedError("signOut", "the M1 phone-OTP auth provider");
  }
  async signOutEverywhere(): Promise<never> {
    throw new NotPortedError("signOutEverywhere", "the M1 phone-OTP auth provider");
  }
  async updateProfile(): Promise<never> {
    throw new NotPortedError("updateProfile", "the M1 phone-OTP auth provider");
  }
  async getPincode(): Promise<never> {
    throw new NotPortedError("getPincode", "the M1 order/checkout port");
  }
  async quoteCheckout(): Promise<never> {
    throw new NotPortedError("quoteCheckout", "the M1 order/checkout port");
  }
  async checkout(): Promise<never> {
    throw new NotPortedError("checkout", "the M1 order/checkout port");
  }
  async listOrders(): Promise<never> {
    throw new NotPortedError("listOrders", "the M1 order/checkout port");
  }
  async getOrder(): Promise<never> {
    throw new NotPortedError("getOrder", "the M1 order/checkout port");
  }
  async confirmOrder(): Promise<never> {
    throw new NotPortedError("confirmOrder", "the M1 order/checkout port");
  }
  async advanceOrder(): Promise<never> {
    throw new NotPortedError("advanceOrder", "the M1 order/checkout port");
  }
  async answerNdr(): Promise<never> {
    throw new NotPortedError("answerNdr", "the M1 order/checkout port");
  }
  async requestReturn(): Promise<never> {
    throw new NotPortedError("requestReturn", "the M1 order/checkout port");
  }
  async invoicePdf(): Promise<never> {
    throw new NotPortedError("invoicePdf", "the M2 gst module");
  }
  async getWishlist(): Promise<never> {
    throw new NotPortedError("getWishlist", "the M2 storefront modules");
  }
  async toggleWishlist(): Promise<never> {
    throw new NotPortedError("toggleWishlist", "the M2 storefront modules");
  }
  async exportMyData(): Promise<never> {
    throw new NotPortedError("exportMyData", "the M2 data-principal port");
  }
  async requestErasure(): Promise<never> {
    throw new NotPortedError("requestErasure", "the M2 data-principal port");
  }
  async getGstr1(): Promise<never> {
    throw new NotPortedError("getGstr1", "the M2 gst module");
  }
  async getAuditLog(): Promise<never> {
    throw new NotPortedError("getAuditLog", "the M2 ops routes");
  }
  async getMetrics(): Promise<never> {
    throw new NotPortedError("getMetrics", "the M2 ops routes");
  }
  async getRemittanceReport(): Promise<never> {
    throw new NotPortedError("getRemittanceReport", "the M2 ops routes");
  }
  async getStoreConfig(): Promise<never> {
    throw new NotPortedError("getStoreConfig", "the M2 settings port");
  }
}

/**
 * Build a Medusa transport from the environment.
 *
 * Mirrors createClient's contract: throw on missing configuration rather
 * than defaulting to a machine that is not there.
 */
export function createMedusaClient(
  env: Record<string, string | undefined> = process.env,
): MedusaClient {
  const baseUrl = env.MEDUSA_URL;
  const publishableKey = env.MEDUSA_PUBLISHABLE_KEY;
  if (!baseUrl || !publishableKey) {
    throw new Error(
      "MEDUSA_URL and MEDUSA_PUBLISHABLE_KEY must both be set. " +
        "Point them at the Medusa store API and the key the seed prints.",
    );
  }
  return new MedusaClient({ baseUrl, publishableKey });
}
