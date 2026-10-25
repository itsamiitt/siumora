import { isStorefrontContent, type StorefrontContent } from "@siumora/core/storefront";
import {
  calculateTotals,
  collectionSchema,
  hsnSummary,
  isGstSlab,
  isInterState,
  maskPhone,
  normalisePhone,
  productSchema,
  searchProducts,
  shippingFor,
  summariseInvoice,
  summariseRatings,
  type CartLine,
  type CartTotals,
  type Collection,
  type HsnSummaryRow,
  type InvoiceTotals,
  type Order,
  type Product,
  type RatingSummary,
  type ReturnReason,
  type ReturnResolution,
  type Review,
} from "@siumora/core";

import { ApiError, SiumoraClient } from "./index.ts";
import type {
  AccountCustomer,
  CheckoutAnalytics,
  CheckoutExtras,
  CheckoutQuote,
  ClaimableOrder,
  CouponState,
  DeviceSession,
  GoogleOutcome,
  SignInMethods,
  SavedAddress,
  OtpIssued,
  OtpRequestOptions,
  PaymentFlow,
  PaymentProof,
  PlacedOrder,
  RazorpayHandoff,
  SessionInfo,
  StoreConfig,
} from "./index.ts";

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
 * 2. **Money crosses back to paise immediately.** Catalog selling prices
 *    come from native contextual pricing; carts use persisted line prices.
 *    Only MRP comes from metadata. Legacy price_paise must never override
 *    commerce pricing. Conversion refuses sub-paise amounts.
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
  thumbnail?: string | null;
  material?: string | null;
  collection?: { id: string; handle: string } | null;
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

export interface CatalogCategory {
  id: string;
  handle: string;
  name: string;
  parent_category_id: string | null;
}

interface MedusaCartItem {
  id: string;
  quantity: number;
  unit_price: number;
  product_id?: string | null;
  variant_id?: string | null;
  variant_sku?: string | null;
  variant_title?: string | null;
  product_title?: string | null;
  product_handle?: string | null;
  thumbnail?: string | null;
  /** Promotion adjustments (plan 16 B19) — majors, like unit_price. */
  adjustments?: Array<{ amount?: number | null; code?: string | null } | null> | null;
  variant?:
    | (MedusaVariant & {
        product?: (Pick<MedusaProduct, "metadata"> & { images?: MedusaImage[] | null }) | null;
      })
    | null;
}

interface MedusaCart {
  id: string;
  items?: MedusaCartItem[] | null;
  promotions?: Array<{ code?: string | null } | null> | null;
}

interface MedusaCustomer {
  id: string;
  email?: string | null;
  phone?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

/** The wire shape of GET /store/siumora/orders/:number. */
interface SiumoraOrderWire {
  order: {
    id: string;
    number: string;
    status: string;
    paymentMethod: string;
    placedAt: string;
    address: { province?: string | null } | null;
    subtotal: number;
    shipping: number;
    codFee: number;
    total: number;
    invoiceNumber: string | null;
    lines: Array<{
      variantId: string;
      sku: string;
      productHandle: string;
      title: string;
      variantTitle: string;
      imageUrl: string;
      mrp: number;
      unitPrice: number;
      quantity: number;
      gstSlab: number | null;
      hsn: string;
      piercedJewellery: boolean;
    }>;
  };
  /** The stored statutory card once the gst module issued one; null before. */
  invoice: { rows: HsnSummaryRow[]; totals: InvoiceTotals } | null;
  return: Record<string, unknown> | null;
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

/** Guest checkout needs a cart email; this one is derived and recognizable. */
const GUEST_EMAIL_DOMAIN = "guest.siumora.in";

function guestEmail(phone: string): string {
  return `${phone}@${GUEST_EMAIL_DOMAIN}`;
}

/** A placeholder email is not the customer's email — the card says null. */
function realEmail(email: string | null | undefined): string | null {
  if (!email || email.endsWith(`@${GUEST_EMAIL_DOMAIN}`)) return null;
  return email;
}

function customerCard(customer: MedusaCustomer, phone: string) {
  return {
    id: customer.id,
    phone,
    maskedPhone: maskPhone(phone),
    name: [customer.first_name ?? "", customer.last_name ?? ""].join(" ").trim(),
    email: realEmail(customer.email),
  };
}

function variantPrice(variant: MedusaVariant): { mrp: number; selling: number } {
  const selling =
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

/**
 * Fallback dimensions for an image whose metadata carries none. The seed
 * stamps real width/height, but an image uploaded through the Medusa Admin
 * arrives with no metadata at all — and core's schema (positive ints, used
 * by next/image for aspect ratio) must not fail the whole catalogue over
 * it. Square is the storefront's product-card crop, so a square default
 * renders correctly-cropped rather than stretched.
 */
const FALLBACK_IMAGE_DIM = 1200;

function imageDim(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : FALLBACK_IMAGE_DIM;
}

function mapImage(image: MedusaImage, productTitle: string) {
  return {
    url: image.url,
    alt: typeof image.metadata?.alt === "string" ? image.metadata.alt : productTitle,
    width: imageDim(image.metadata?.width),
    height: imageDim(image.metadata?.height),
  };
}

/** Medusa product → core Product, revalidated through core's schema. */
export function mapProduct(product: MedusaProduct): Product {
  const metadata = product.metadata ?? {};
  const slab = typeof metadata.gst_slab === "number" ? metadata.gst_slab : NaN;
  if (!isGstSlab(slab)) {
    throw new Error(`product ${product.handle} has no valid gst_slab in metadata`);
  }

  const images = product.images ?? [];
  // Admin's selected thumbnail is the lead image, even if its gallery rank differs.
  const orderedImages = product.thumbnail
    ? [images.find((image) => image.url === product.thumbnail) ?? { url: product.thumbnail },
      ...images.filter((image) => image.url !== product.thumbnail)]
    : images;

  return productSchema.parse({
    id: product.id,
    handle: product.handle,
    title: product.title,
    subtitle: product.subtitle ?? "",
    description: product.description ?? "",
    hsn: metadata.hsn,
    gstSlab: slab,
    material: product.material ?? (typeof metadata.material === "string" ? metadata.material : ""),
    piercedJewellery: metadata.pierced_jewellery === true,
    images: orderedImages.map((image) => mapImage(image, product.title)),
    variants: (product.variants ?? []).map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      title: variant.title,
      price: variantPrice(variant),
      inventory: variant.inventory_quantity ?? 0,
    })),
    collections: product.collection ? [product.collection.handle] : [],
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
  // A cart line owns its price. Current catalog metadata must never reprice it.
  const unitPrice = majorToPaise(item.unit_price);
  const mrp = metadataPaise(variant?.metadata?.mrp_paise) ?? unitPrice;
  const firstImage = variant?.product?.images?.[0]?.url;
  // Promotion adjustments, rounded to the paisa (a promotion spread across
  // lines can split into fractions; the server's quote rounds the same way).
  const discount = Math.max(
    0,
    Math.round((item.adjustments ?? []).reduce((sum, adjustment) => sum + (adjustment?.amount ?? 0), 0) * 100),
  );

  return {
    variantId: variant?.id ?? item.variant_id ?? "",
    sku: item.variant_sku ?? variant?.sku ?? "",
    productHandle: item.product_handle ?? "",
    title: item.product_title ?? "",
    variantTitle: item.variant_title ?? variant?.title ?? "",
    imageUrl: firstImage ?? item.thumbnail ?? "",
    mrp,
    unitPrice,
    quantity: item.quantity,
    gstSlab: slab,
    hsn: typeof productMetadata.hsn === "string" ? productMetadata.hsn : "",
    piercedJewellery: productMetadata.pierced_jewellery === true,
    ...(discount > 0 ? { discount } : {}),
  };
}

/** A route's field-keyed error map, kept only if every value is a string. */
function stringFields(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0 || entries.some(([, message]) => typeof message !== "string")) {
    return undefined;
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

// ── The transport ─────────────────────────────────────────────────────────

export interface MedusaClientOptions {
  /** Base URL of the Medusa store API, e.g. http://localhost:9000. */
  baseUrl: string;
  /** Sent as x-publishable-api-key on every request. */
  publishableKey: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  /** The opaque session token from verifyOtp, sent as a bearer. */
  token?: string;
}

/**
 * Everything expandable the product mapping needs, in one fields clause.
 * region_id rides along so native contextual pricing is available.
 *
 * Medusa 2.21+ refuses a store `fields` path that is not on the route's
 * allow-list (400). Any path here or in CART_FIELDS outside Medusa's defaults
 * must also be added to allowFields() in apps/medusa/src/api/middlewares.ts.
 */
const PRODUCT_FIELDS =
  "id,handle,title,subtitle,description,thumbnail,material,metadata,*collection," +
  "*images,*variants,*variants.metadata,+variants.inventory_quantity," +
  "*variants.calculated_price";

const CART_FIELDS =
  "id,*items,*items.variant,*items.variant.metadata," +
  "*items.variant.product.metadata,*items.variant.product.images," +
  // Coupons (plan 16 B19): each line's adjustments and the codes applied.
  "*items.adjustments,promotions.code";

/** Bound each request, not the size of the visible catalog. */
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
    options: {
      headers?: Record<string, string>;
      /** Per-call bearer, for the sign-in dance before a token is held. */
      bearer?: string;
      /** Next data-cache revalidation window, like the Fastify client's. */
      revalidate?: number;
    } = {},
  ): Promise<T> {
    const bearer = options.bearer ?? this.token;
    // revalidate opts the read into Next's data cache — without it a Cache
    // Components prerender aborts the fetch as uncached IO, which is
    // exactly how the storefront's static shell 500s (AbortError,
    // env: Prerender). Same shape as the Fastify client's request(): the
    // timeout signal and the next hint ride together.
    const init: RequestInit & { next?: { revalidate: number } } = {
      method,
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        "x-publishable-api-key": this.publishableKey,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...options.headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(options.revalidate !== undefined
        ? { next: { revalidate: options.revalidate } }
        : {}),
    };
    const response = await this.doFetch(`${this.baseUrl}${path}`, init);

    if (!response.ok) {
      // Two error dialects share this transport: the siumora custom routes
      // speak the Fastify envelope ({ error, message }), Medusa's native
      // routes speak { type, code?, message }. Read all three so callers can
      // still tell "sold out" from "server is down" on either.
      let code = "request_failed";
      let message = `Request failed with ${response.status}.`;
      let fields: Record<string, string> | undefined;
      try {
        const payload = (await response.json()) as {
          error?: string;
          type?: string;
          code?: string;
          message?: string;
          fields?: unknown;
        };
        code = payload.error ?? payload.code ?? payload.type ?? code;
        message = payload.message ?? message;
        fields = stringFields(payload.fields);
      } catch {
        // Non-JSON error body; the status is all we have.
      }
      throw new ApiError(response.status, code, message, fields);
    }

    return (await response.json()) as T;
  }

  /** The INR region the seed created; resolved once per client. Revalidated
   * rather than signal-bounded so the first resolution can happen inside a
   * Cache Components prerender (which aborts uncached IO) — a region id
   * changes on reseed at most, and the instance caches it anyway. */
  private region(): Promise<string> {
    this.regionId ??= this.request<{
      regions: Array<{ id: string; currency_code: string }>;
    }>("GET", "/store/regions", undefined, { revalidate: 3600 }).then((data) => {
      const inr = data.regions.find((region) => region.currency_code === "inr");
      if (!inr) {
        throw new ApiError(500, "no_inr_region", "Medusa has no INR region — run the seed.");
      }
      return inr.id;
    });
    return this.regionId;
  }

  private async fetchCatalog(
    options?: { revalidate?: number; limit?: number; categoryId?: string; collectionId?: string },
  ): Promise<Product[]> {
    const regionId = await this.region();
    const products: Product[] = [];
    let offset = 0;
    while (true) {
      const limit = Math.min(CATALOG_PAGE, options?.limit ? options.limit - products.length : CATALOG_PAGE);
      const data = await this.request<{ products: MedusaProduct[]; count?: number }>(
        "GET",
        `/store/products?fields=${encodeURIComponent(PRODUCT_FIELDS)}` +
          `&region_id=${encodeURIComponent(regionId)}&limit=${limit}&offset=${offset}&order=-created_at` +
          (options?.categoryId ? `&category_id[]=${encodeURIComponent(options.categoryId)}` : "") +
          (options?.collectionId ? `&collection_id[]=${encodeURIComponent(options.collectionId)}` : ""),
        undefined,
        options?.revalidate !== undefined ? { revalidate: options.revalidate } : {},
      );
      products.push(...data.products.map(mapProduct));
      offset += data.products.length;
      if (!data.products.length || (options?.limit && products.length >= options.limit) ||
        (data.count !== undefined ? offset >= data.count : data.products.length < limit)) break;
    }
    return products;
  }

  // ── Catalogue ───────────────────────────────────────────────

  async listProducts(
    query: { collection?: string; q?: string; limit?: number } = {},
    options?: { revalidate?: number },
  ): Promise<Product[]> {
    const collection = query.collection
      ? (await this.listCollections(options)).find((entry) => entry.handle === query.collection)
      : undefined;
    if (query.collection && !collection) return [];
    let products = await this.fetchCatalog({
      ...options,
      ...(collection ? { collectionId: collection.id } : {}),
      ...(query.limit && !query.collection && !query.q ? { limit: query.limit } : {}),
    });
    if (query.q) {
      // The same Hinglish-aware scorer the Fastify API runs — parity by
      // construction, not by re-implementation.
      products = searchProducts(products, query.q).map((hit) => hit.product);
    }
    if (query.limit) products = products.slice(0, query.limit);
    return products;
  }

  async getProduct(
    handle: string,
    options?: { revalidate?: number },
  ): Promise<
    { product: Product; reviews: Review[]; rating: RatingSummary } | undefined
  > {
    const regionId = await this.region();
    const data = await this.request<{ products: MedusaProduct[] }>(
      "GET",
      `/store/products?handle=${encodeURIComponent(handle)}` +
        `&fields=${encodeURIComponent(PRODUCT_FIELDS)}` +
        `&region_id=${encodeURIComponent(regionId)}`,
      undefined,
      options?.revalidate !== undefined ? { revalidate: options.revalidate } : {},
    );
    const product = data.products[0];
    if (!product) return undefined;
    // Reviews live Fastify-side until their write path exists (TODOS.md row);
    // an empty list through the same summariser is exact parity with the
    // review-free catalogue the Fastify API serves today.
    return { product: mapProduct(product), reviews: [], rating: summariseRatings([]) };
  }

  async listCollections(options?: { revalidate?: number }): Promise<Collection[]> {
    const collections: Collection[] = [];
    while (true) {
      const data = await this.request<{ collections: MedusaCollection[]; count?: number }>(
        "GET",
        `/store/collections?limit=${CATALOG_PAGE}&offset=${collections.length}&order=created_at`,
        undefined,
        options?.revalidate !== undefined ? { revalidate: options.revalidate } : {},
      );
      collections.push(...data.collections.map(mapCollection));
      if (!data.collections.length || (data.count !== undefined
        ? collections.length >= data.count : data.collections.length < CATALOG_PAGE)) break;
    }
    return collections;
  }

  async listCategories(options?: { revalidate?: number }): Promise<CatalogCategory[]> {
    const categories: CatalogCategory[] = [];
    while (true) {
      // Store API enforces active, public categories; never query admin data here.
      const data = await this.request<{ product_categories: CatalogCategory[]; count?: number }>(
        "GET", `/store/product-categories?fields=id,name,handle,parent_category_id&limit=${CATALOG_PAGE}&offset=${categories.length}&order=rank`,
        undefined, options ?? {},
      );
      categories.push(...data.product_categories);
      if (!data.product_categories.length || (data.count !== undefined
        ? categories.length >= data.count : data.product_categories.length < CATALOG_PAGE)) break;
    }
    return categories;
  }

  async listProductsInCategory(categoryId: string, options?: { revalidate?: number }): Promise<Product[]> {
    return this.fetchCatalog({ ...options, categoryId });
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
  ): Promise<{ cartId: string; lines: CartLine[]; totals: CartTotals; coupons?: string[] }> {
    const cart = await this.fetchCart(cartId);
    const items = cart.items ?? [];
    const onHand = await this.stockFor(items);
    const lines = items.map((item) => {
      const line = mapCartLine(item);
      const available = onHand.get(line.variantId);
      return available === undefined ? line : { ...line, available };
    });
    // Free shipping is judged after any coupon, as Medusa's item_total is.
    const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity - (l.discount ?? 0), 0);
    const coupons = (cart.promotions ?? [])
      .map((promotion) => promotion?.code)
      .filter((code): code is string => typeof code === "string" && code.length > 0);
    return {
      cartId,
      lines,
      coupons,
      // Same recipe as the Fastify cart read: intra-state until checkout
      // knows the delivery state; the order recomputes.
      totals: calculateTotals(lines, {
        interState: false,
        shipping: shippingFor(subtotal),
      }),
    };
  }

  /**
   * Units on hand per variant for the cart's products (plan 16 B7), so the
   * bag can cap "+" where the stock guard below would refuse. One small read
   * of just those products — not the catalogue, since the header count reads
   * the cart on every page. A failed read leaves availability unknown rather
   * than failing the bag.
   */
  private async stockFor(items: readonly MedusaCartItem[]): Promise<Map<string, number>> {
    const productIds = [...new Set(items.map((item) => item.product_id).filter(Boolean))];
    const onHand = new Map<string, number>();
    if (productIds.length === 0) return onHand;
    try {
      const data = await this.request<{
        products: Array<{ variants?: Array<{ id: string; inventory_quantity?: number }> | null }>;
      }>(
        "GET",
        `/store/products?fields=${encodeURIComponent("id,*variants,+variants.inventory_quantity")}` +
          `&limit=${productIds.length}` +
          productIds.map((id) => `&id[]=${encodeURIComponent(id!)}`).join(""),
      );
      for (const product of data.products) {
        for (const variant of product.variants ?? []) {
          if (typeof variant.inventory_quantity === "number") {
            onHand.set(variant.id, variant.inventory_quantity);
          }
        }
      }
    } catch {
      // Availability is a convenience; the stock guard still refuses at add.
    }
    return onHand;
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

  // ── Sign-in ─────────────────────────────────────────────────

  /**
   * Ask for a code. The Fastify /auth/otp envelope plus `channel` (which
   * one delivered) and `channels` (what the backend can send on), so the
   * storefront can offer "Send by SMS instead". The Turnstile token rides
   * along when the challenge is on.
   */
  async requestOtp(phone: string, options: OtpRequestOptions = {}): Promise<OtpIssued> {
    return this.request("POST", "/store/siumora-auth/otp", {
      phone,
      ...(options.channel ? { channel: options.channel } : {}),
      ...(options.turnstileToken ? { turnstileToken: options.turnstileToken } : {}),
    });
  }

  /**
   * Verify the code. One call: the route judges the code, finds or creates
   * the customer and opens a revocable session; `token` is the opaque
   * session token the storefront keeps in its HTTP-only cookie (auth plan
   * phase 1). Same envelope as the Fastify /auth/verify.
   */
  async verifyOtp(
    phone: string,
    code: string,
    options: { googleLinkToken?: string } = {},
  ): Promise<{
    ok: true;
    token: string;
    expiresAt: string;
    isAdmin: boolean;
    claimedOrders: number;
    /** Guest orders on this phone the account page will offer to claim. */
    claimableOrders?: number;
    customer: AccountCustomer;
  }> {
    return this.request("POST", "/store/siumora-auth/verify", {
      phone,
      code,
      // A Google sign-in waiting on this phone (phase 4) links on success.
      ...(options.googleLinkToken ? { googleLinkToken: options.googleLinkToken } : {}),
    });
  }

  async getSession(): Promise<
    | { signedIn: false }
    | { signedIn: true; isAdmin: boolean; customer: AccountCustomer; session?: SessionInfo }
  > {
    if (!this.token) return { signedIn: false };
    // A dead or revoked token is simply anonymous here: the session door
    // drops it and the route answers signedIn:false.
    return this.request("GET", "/store/siumora-auth/session");
  }

  async signOut(): Promise<void> {
    await this.request("POST", "/store/siumora-auth/signout", {});
  }

  async signOutEverywhere(): Promise<{ ok: boolean; revoked: number }> {
    return this.request("POST", "/store/siumora-auth/signout-everywhere", {});
  }

  async listSessions(): Promise<DeviceSession[]> {
    const data = await this.request<{ sessions: DeviceSession[] }>(
      "GET",
      "/store/siumora-auth/sessions",
    );
    return data.sessions;
  }

  async revokeSession(id: string): Promise<{ ok: boolean; current: boolean }> {
    return this.request("DELETE", `/store/siumora-auth/sessions/${encodeURIComponent(id)}`);
  }

  /** Re-prove the phone for a sensitive action (StepUpGate). */
  async stepUp(code: string): Promise<{ ok: boolean; stepUpExpiresAt: string }> {
    return this.request("POST", "/store/siumora-auth/step-up", { code });
  }

  /**
   * Move the account to a new number: needs a fresh step-up on the current
   * number, and `code` is the one sent to the NEW number.
   */
  async changePhone(
    phone: string,
    code: string,
  ): Promise<{ ok: boolean; maskedPhone: string; signedOutDevices: number }> {
    return this.request("POST", "/store/siumora-auth/phone", { phone, code });
  }

  // ── Google and email (auth plan phase 4) ────────────────────

  async getSignInMethods(): Promise<SignInMethods> {
    return this.request("GET", "/store/siumora-auth/methods", undefined, { revalidate: 60 });
  }

  /** Where to send the shopper to choose their Google account. */
  async googleStart(): Promise<{ location: string }> {
    return this.request("POST", "/auth/customer/google", {});
  }

  /**
   * Back from Google: Medusa's provider turns the code into a short JWT for
   * the Google identity, and the Siumora route turns that into a session —
   * or into { needsPhone, linkToken } when this Google account is not yet
   * tied to a phone.
   */
  async googleFinish(query: { code: string; state: string }): Promise<GoogleOutcome> {
    const search = new URLSearchParams({ code: query.code, state: query.state });
    const { token } = await this.request<{ token: string }>(
      "POST",
      `/auth/customer/google/callback?${search}`,
      {},
    );
    return this.request("POST", "/store/siumora-auth/google", {}, { bearer: token });
  }

  async requestEmailVerification(): Promise<{ ok: boolean; alreadyVerified: boolean }> {
    return this.request("POST", "/store/siumora/me/email/request", {});
  }

  async verifyEmail(token: string): Promise<{ ok: boolean }> {
    return this.request("POST", "/store/siumora/me/email/verify", { token });
  }

  // ── The signed-in account (auth plan phase 2) ───────────────

  /** Guest orders on this account's phone, waiting for "Is this your order?". */
  async listClaimableOrders(): Promise<ClaimableOrder[]> {
    const data = await this.request<{ orders: ClaimableOrder[] }>(
      "GET",
      "/store/siumora/me/claimable-orders",
    );
    return data.orders;
  }

  async claimOrders(numbers: string[]): Promise<{ ok: boolean; claimed: number }> {
    return this.request("POST", "/store/siumora/me/claim", { numbers });
  }

  /** Tie this browser's wishlist to the account; answers the id to keep. */
  async linkWishlist(wishlistId?: string): Promise<{ wishlistId: string | null }> {
    return this.request("POST", "/store/siumora/me/wishlist", wishlistId ? { wishlistId } : {});
  }

  /** Tie this browser's bag to the account; answers the cart id to keep. */
  async linkCart(cartId?: string): Promise<{ cartId: string | null }> {
    return this.request("POST", "/store/siumora/me/cart", cartId ? { cartId } : {});
  }

  /** The account's address book (Medusa's own customer addresses). */
  async listAddresses(): Promise<SavedAddress[]> {
    const data = await this.request<{
      addresses: Array<{
        id: string;
        first_name: string | null;
        last_name: string | null;
        phone: string | null;
        address_1: string | null;
        address_2: string | null;
        city: string | null;
        province: string | null;
        postal_code: string | null;
        is_default_shipping?: boolean;
      }>;
    }>("GET", "/store/customers/me/addresses?limit=50");
    return data.addresses.map((address) => ({
      id: address.id,
      name: [address.first_name ?? "", address.last_name ?? ""].join(" ").trim(),
      phone: address.phone ?? "",
      line1: address.address_1 ?? "",
      ...(address.address_2 ? { line2: address.address_2 } : {}),
      city: address.city ?? "",
      stateCode: address.province ?? "",
      pincode: address.postal_code ?? "",
      isDefault: Boolean(address.is_default_shipping),
    }));
  }

  async deleteAddress(id: string): Promise<void> {
    await this.request("DELETE", `/store/customers/me/addresses/${encodeURIComponent(id)}`);
  }

  // ── Checkout and orders ─────────────────────────────────────

  /**
   * Medusa takes prepaid money before the order exists (plan 16 Phase B):
   * preparePayment → Checkout.js → completePayment.
   */
  readonly paymentFlow: PaymentFlow = "payment-first";

  /**
   * The delivery address onto Medusa's cart (stateCode as province — the GST
   * place-of-supply signal the order read turns back into interState), plus
   * a derived guest email (completion requires one; the card maps it back to
   * null).
   *
   * The checkout's analytics identity rides the cart's metadata, which
   * Medusa copies onto the order (plan 16 Phase G): the event id the browser
   * pixel used (so the server conversion dedupes against it), the GA4 client
   * id (GA4 refuses a server event without one), and the shopper's consent
   * choice. The server overwrites its own keys (the payment method) after.
   */
  private async setCartAddress(
    cartId: string,
    address: Order["address"],
    analytics: CheckoutAnalytics = {},
    extras: CheckoutExtras = {},
  ): Promise<void> {
    const normalized = normalisePhone(address.phone) ?? address.phone;
    const [firstName, ...restName] = address.name.split(/\s+/);
    const metadata = {
      ...(analytics.eventId ? { siumora_event_id: analytics.eventId } : {}),
      ...(analytics.gaClientId ? { siumora_ga_client_id: analytics.gaClientId } : {}),
      ...(analytics.consent ? { siumora_consent: analytics.consent } : {}),
      // Always written, so a message removed after a refused attempt goes
      // too; the server tidies, bounds, or drops it (plan 16 B21).
      siumora_gift_message: extras.giftMessage?.trim() ?? "",
    };
    try {
      await this.request("POST", `/store/carts/${encodeURIComponent(cartId)}`, {
        email: guestEmail(normalized),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        shipping_address: {
          first_name: firstName ?? "",
          last_name: restName.join(" "),
          address_1: address.line1,
          // The landmark rides line 2 ("…, Near the post office") so it prints on
          // the courier label and the invoice, where it is actually read.
          ...(addressLine2(address) ? { address_2: addressLine2(address) } : {}),
          city: address.city,
          province: address.stateCode,
          postal_code: address.pincode,
          country_code: "in",
          phone: normalized,
        },
      });
    } catch (error) {
      // A retried checkout finds the cart already completed — the address is
      // baked in and the complete route below replays the original order.
      // Any other update failure is real.
      if (
        !(error instanceof ApiError) ||
        error.status !== 400 ||
        !/already completed/i.test(error.message)
      ) {
        throw error;
      }
    }
  }

  /**
   * COD checkout through the Siumora completion route, which allocates the
   * SIU number + access key. Prepaid goes through preparePayment and
   * completePayment instead — refused here so a caller cannot place an
   * order nobody has paid for.
   */
  async checkout(
    input: {
      cartId: string;
      address: Order["address"];
      paymentMethod: Order["paymentMethod"];
      eventId: string;
      gaClientId?: string;
      buyerGstin?: string;
      /** The shopper's consent choice at checkout, for the server conversion. */
      consent?: CheckoutAnalytics["consent"];
    } & CheckoutExtras,
    idempotencyKey?: string,
  ): Promise<PlacedOrder> {
    if (input.paymentMethod !== "cod") {
      throw new ApiError(
        409,
        "payment_first",
        "Online payment is taken before the order: use preparePayment, then completePayment.",
      );
    }
    await this.setCartAddress(input.cartId, input.address, analyticsOf(input), { giftMessage: input.giftMessage });
    return this.request(
      "POST",
      `/store/siumora/carts/${encodeURIComponent(input.cartId)}/complete`,
      // The route re-derives everything else; the method decides whether
      // the COD fee and gate apply.
      { paymentMethod: input.paymentMethod },
      idempotencyKey ? { headers: { "idempotency-key": idempotencyKey } } : {},
    );
  }

  /**
   * Open a prepaid payment: the address onto the cart, then the prepare
   * route readies the cart and opens (or reuses) a Razorpay order for its
   * total. Nothing is placed. A 409 already_paid carries the handoff too —
   * the caller should complete, not pay again.
   */
  async preparePayment(
    input: {
      cartId: string;
      address: Order["address"];
      paymentMethod: Order["paymentMethod"];
    } & CheckoutAnalytics &
      CheckoutExtras,
  ): Promise<{ razorpay: RazorpayHandoff }> {
    await this.setCartAddress(input.cartId, input.address, analyticsOf(input), { giftMessage: input.giftMessage });
    return this.request(
      "POST",
      `/store/siumora/carts/${encodeURIComponent(input.cartId)}/prepare`,
      { paymentMethod: input.paymentMethod },
    );
  }

  /**
   * Apply a coupon (plan 16 B19) — one at a time, a new code replaces the
   * last. 400 invalid_coupon for an unknown code, 409 coupon_not_applicable
   * when this bag does not qualify; the server message says which.
   */
  async applyCoupon(cartId: string, code: string): Promise<CouponState> {
    return this.request("POST", "/store/siumora/coupons", { cartId, code });
  }

  async removeCoupon(cartId: string, code: string): Promise<CouponState> {
    return this.request("DELETE", "/store/siumora/coupons", { cartId, code });
  }

  /**
   * The cart-reminder opt-in from checkout step 1 (plan 16 B22): consent
   * true records the number and the time, false withdraws it. Answers
   * reminders:false when the operator has reminders off.
   */
  async setCartReminders(cartId: string, input: { phone: string; consent: boolean }): Promise<{ reminders: boolean }> {
    return this.request("POST", `/store/siumora/carts/${encodeURIComponent(cartId)}/reminders`, input);
  }

  /** The signed link in a reminder → the cart it names (410 if already ordered). */
  async resumeCart(token: string): Promise<{ cartId: string }> {
    return this.request("POST", "/store/siumora/carts/resume", { token });
  }

  /**
   * Place the order for a payment the browser says it made. The route
   * believes Razorpay, not this call: it checks the signature, the session
   * and the amount, and refunds if the order cannot be placed (409
   * paid_not_placed); 409 payment_pending means Razorpay has not settled it
   * yet and the webhook will finish the order.
   */
  async completePayment(
    input: { cartId: string; paymentMethod: Order["paymentMethod"]; razorpay: PaymentProof },
    idempotencyKey?: string,
  ): Promise<PlacedOrder> {
    return this.request(
      "POST",
      `/store/siumora/carts/${encodeURIComponent(input.cartId)}/complete`,
      { paymentMethod: input.paymentMethod, razorpay: input.razorpay },
      idempotencyKey ? { headers: { "idempotency-key": idempotencyKey } } : {},
    );
  }

  /**
   * The guest order read. 404 (no key, wrong key, unknown number) is
   * undefined exactly like the Fastify transport; a malformed key stays the
   * thrown 400.
   *
   * The stored statutory card is authoritative when the gst module issued
   * one — it is the invoice that actually exists. The computed-from-lines
   * card (same core engine, same paise) remains only as the fallback for
   * orders that predate the module or whose issue was refused.
   */
  async getOrder(
    number: string,
    accessKey?: string,
  ): Promise<
    | {
        order: Record<string, unknown>;
        invoice: { rows: HsnSummaryRow[]; totals: InvoiceTotals };
        return: Record<string, unknown> | null;
      }
    | undefined
  > {
    const query = accessKey ? `?key=${encodeURIComponent(accessKey)}` : "";
    let wire: SiumoraOrderWire;
    try {
      wire = await this.request<SiumoraOrderWire>(
        "GET",
        `/store/siumora/orders/${encodeURIComponent(number)}${query}`,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return undefined;
      throw error;
    }

    let invoice = wire.invoice;
    if (!invoice) {
      const lines: CartLine[] = wire.order.lines.map((line) => {
        if (!isGstSlab(line.gstSlab ?? -1)) {
          throw new Error(`order ${number} line ${line.sku} has no valid gstSlab`);
        }
        return { ...line, gstSlab: line.gstSlab as CartLine["gstSlab"] };
      });
      const interState = isInterState(wire.order.address?.province ?? "");
      const rows = hsnSummary(lines, { interState });
      invoice = { rows, totals: summariseInvoice(rows) };
    }
    return {
      order: wire.order as unknown as Record<string, unknown>,
      invoice,
      return: wire.return,
    };
  }

  /** Same contract as the Fastify transport's invoicePdf: bytes or a status. */
  async invoicePdf(
    orderNumber: string,
    accessKey?: string,
  ): Promise<{ ok: boolean; status: number; body?: ArrayBuffer }> {
    const query = accessKey ? `?key=${encodeURIComponent(accessKey)}` : "";
    const response = await this.doFetch(
      `${this.baseUrl}/store/siumora/orders/${encodeURIComponent(orderNumber)}/invoice.pdf${query}`,
      {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          "x-publishable-api-key": this.publishableKey,
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        cache: "no-store",
      } as RequestInit,
    );
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, status: response.status, body: await response.arrayBuffer() };
  }

  async getPincode(
    pincode: string,
  ): Promise<{
    pincode: string;
    city?: string;
    stateCode?: string;
    serviceable: boolean;
    codAvailable: boolean;
    estimatedDays: string;
    rtoRateBps: number;
  }> {
    return this.request("GET", `/store/siumora/pincodes/${encodeURIComponent(pincode)}`);
  }

  async quoteCheckout(input: {
    cartId: string;
    pincode: string;
    address?: string;
    city?: string;
    stateCode?: string;
    phone?: string;
  }): Promise<CheckoutQuote> {
    return this.request("POST", "/store/siumora/checkout/quote", input);
  }

  private orderAction<T>(
    number: string,
    action: string,
    body: unknown,
    accessKey?: string,
  ): Promise<T> {
    const query = accessKey ? `?key=${encodeURIComponent(accessKey)}` : "";
    return this.request<T>(
      "POST",
      `/store/siumora/orders/${encodeURIComponent(number)}/${action}${query}`,
      body,
    );
  }

  async confirmOrder(number: string, accessKey?: string): Promise<{ ok: boolean }> {
    return this.orderAction(number, "confirm", {}, accessKey);
  }

  async advanceOrder(
    number: string,
    status: string,
    ndrReason?: string,
    accessKey?: string,
  ): Promise<{ ok: boolean; order: Record<string, unknown> }> {
    return this.orderAction(number, "status", { status, ndrReason }, accessKey);
  }

  async answerNdr(
    number: string,
    action: "reattempt" | "update_address" | "cancel",
    accessKey?: string,
  ): Promise<{ ok: boolean }> {
    return this.orderAction(number, "ndr", { action }, accessKey);
  }

  async requestReturn(
    number: string,
    input: {
      variantIds: string[];
      reason: ReturnReason;
      resolution: ReturnResolution;
      sealIntact?: boolean;
      note?: string;
    },
    accessKey?: string,
  ): Promise<{
    ok: boolean;
    return: Record<string, unknown>;
    reversePickup: Record<string, unknown> | null;
  }> {
    return this.orderAction(number, "returns", input, accessKey);
  }

  // ── Wishlist and config ─────────────────────────────────────

  async getWishlist(wishlistId: string): Promise<string[]> {
    const data = await this.request<{ handles: string[] }>(
      "GET",
      `/store/siumora/wishlists/${encodeURIComponent(wishlistId)}`,
    );
    return data.handles;
  }

  async toggleWishlist(
    wishlistId: string,
    handle: string,
  ): Promise<{ wishlisted: boolean; count: number }> {
    return this.request(
      "POST",
      `/store/siumora/wishlists/${encodeURIComponent(wishlistId)}/toggle`,
      { handle },
    );
  }

  async removeWishlist(wishlistId: string, handle: string): Promise<{ count: number }> {
    return this.request(
      "DELETE",
      `/store/siumora/wishlists/${encodeURIComponent(wishlistId)}/items/${encodeURIComponent(handle)}`,
    );
  }

  async getStorefrontContent(): Promise<StorefrontContent> {
    const data = await this.request<{ content: unknown }>("GET", "/store/siumora/storefront", undefined, { revalidate: 5 });
    if (!isStorefrontContent(data.content)) throw new Error("Invalid storefront content from backend");
    return data.content;
  }

  async getStoreConfig(): Promise<StoreConfig> {
    return this.request("GET", "/store/siumora/config");
  }

  // ── Not yet ported — each names the phase that delivers it ──

  async updateProfile(input: {
    name?: string;
    email?: string;
  }): Promise<{ ok: boolean; customer: AccountCustomer }> {
    if (!this.token) {
      throw new ApiError(401, "unauthorized", "Sign in to update your details.");
    }

    const name = input.name?.trim();
    const parts = name?.split(/\s+/) ?? [];
    const email = input.email?.trim();

    // Names through Medusa's own profile route — the only fields it takes
    // since the security review. Read back either way, to compare the email.
    const current = await this.request<{ customer: MedusaCustomer }>(
      name !== undefined ? "POST" : "GET",
      "/store/customers/me",
      name !== undefined
        ? { first_name: parts[0] ?? "", last_name: parts.slice(1).join(" ") }
        : undefined,
    );
    const phone =
      normalisePhone(current.customer.phone ?? "") ?? current.customer.phone ?? "";

    // A changed email goes through the step-up route; 403
    // step_up_required surfaces to the caller, which asks for a fresh code.
    if (email !== undefined && email.toLowerCase() !== (realEmail(current.customer.email) ?? "").toLowerCase()) {
      const changed = await this.request<{ customer: AccountCustomer | null }>(
        "POST",
        "/store/siumora/me/email",
        { email },
      );
      if (changed.customer) return { ok: true, customer: changed.customer };
    }
    return { ok: true, customer: customerCard(current.customer, phone) };
  }
  /** The account's own orders — placed signed in, or claimed. */
  async listOrders(): Promise<Array<Record<string, unknown>>> {
    const data = await this.request<{ orders: Array<Record<string, unknown>> }>(
      "GET",
      "/store/siumora/me/orders",
    );
    return data.orders;
  }
  async exportMyData(): Promise<Record<string, unknown>> {
    return this.request("GET", "/store/siumora/me/data");
  }
  /** Needs a fresh step-up: answers 403 step_up_required otherwise. */
  async requestErasure(): Promise<{
    requestId: string;
    alreadyOpen: boolean;
    erased: boolean;
    pendingBecause?: string;
    resolveBy: string;
    retained: Array<{ keeps: string; forHowLong: string; because: string }>;
  }> {
    return this.request("POST", "/store/siumora/me/erasure", {});
  }
  // ── Admin (the M2 ops routes) ───────────────────────────────
  //
  // The operator here is a phone-OTP customer on the ADMIN_PHONES
  // allow-list: the held JWT rides Authorization exactly as it does for
  // account reads, and the /admin/siumora middleware admits the customer
  // actor alongside the dashboard's emailpass user. Role and permission are
  // decided server-side per request (packages/core rbac via the operator
  // gate), so a number taken off the list is refused immediately.

  async getGstr1(period: string): Promise<Record<string, unknown>> {
    return this.request(
      "GET",
      `/admin/siumora/gstr1?period=${encodeURIComponent(period)}`,
    );
  }
  async getAuditLog(): Promise<Record<string, unknown>> {
    return this.request("GET", "/admin/siumora/audit");
  }
  async getMetrics(): Promise<Record<string, unknown>> {
    return this.request("GET", "/admin/siumora/metrics");
  }
  async getRemittanceReport(): Promise<Record<string, unknown>> {
    return this.request("GET", "/admin/siumora/remittances");
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

/** The checkout's analytics identity, without unset keys. */
function analyticsOf(input: CheckoutAnalytics): CheckoutAnalytics {
  return {
    ...(input.eventId ? { eventId: input.eventId } : {}),
    ...(input.gaClientId ? { gaClientId: input.gaClientId } : {}),
    ...(input.consent ? { consent: input.consent } : {}),
  };
}

/** Line 2 as the courier reads it: the area, then the landmark. */
function addressLine2(address: Order["address"]): string | undefined {
  const parts = [
    "line2" in address ? address.line2?.trim() : undefined,
    "landmark" in address && address.landmark?.trim() ? `Near ${address.landmark.trim()}` : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : undefined;
}
