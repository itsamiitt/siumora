import type {
  CartLine,
  CartTotals,
  CodDecision,
  Collection,
  HsnSummaryRow,
  InvoiceTotals,
  Order,
  Product,
  RatingSummary,
  Review,
  ReturnReason,
  ReturnResolution,
} from "@siumora/core";

/**
 * Typed client for the commerce API.
 *
 * One place that knows the wire format, so a route change is a compile error
 * in the storefront rather than a runtime surprise.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ClientOptions {
  baseUrl: string;
  /** Per-request timeout. A hung API must not hold a page render open. */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export interface RequestOptions {
  /** Sent as Idempotency-Key so a retry cannot place a second order. */
  idempotencyKey?: string;
  /** Next.js caching hints, ignored by a plain fetch. */
  cache?: RequestCache;
  revalidate?: number;
  signal?: AbortSignal;
}

interface NextFetchInit extends RequestInit {
  next?: { revalidate?: number };
}

export class SiumoraClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof globalThis.fetch;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.doFetch = options.fetch ?? globalThis.fetch;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    // Own timeout, combined with any caller signal, so neither is lost.
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([timeout, options.signal])
      : timeout;

    const init: NextFetchInit = {
      method,
      signal,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(options.idempotencyKey
          ? { "idempotency-key": options.idempotencyKey }
          : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(options.cache ? { cache: options.cache } : {}),
      ...(options.revalidate !== undefined
        ? { next: { revalidate: options.revalidate } }
        : {}),
    };

    const response = await this.doFetch(`${this.baseUrl}${path}`, init);

    if (!response.ok) {
      // Read the structured error the API returns rather than throwing a bare
      // status, so callers can distinguish "sold out" from "server is down".
      let code = "request_failed";
      let message = `Request failed with ${response.status}.`;
      try {
        const payload = (await response.json()) as {
          error?: string;
          message?: string;
        };
        code = payload.error ?? code;
        message = payload.message ?? message;
      } catch {
        // Non-JSON error body; the status is all we have.
      }
      throw new ApiError(response.status, code, message);
    }

    return (await response.json()) as T;
  }

  // ── Catalogue ───────────────────────────────────────────────

  async listProducts(
    query: { collection?: string; q?: string } = {},
    options?: RequestOptions,
  ): Promise<Product[]> {
    const search = new URLSearchParams();
    if (query.collection) search.set("collection", query.collection);
    if (query.q) search.set("q", query.q);
    const suffix = search.size > 0 ? `?${search}` : "";

    const data = await this.request<{ products: Product[] }>(
      "GET",
      `/products${suffix}`,
      undefined,
      options,
    );
    return data.products;
  }

  async getProduct(
    handle: string,
    options?: RequestOptions,
  ): Promise<
    { product: Product; reviews: Review[]; rating: RatingSummary } | undefined
  > {
    try {
      return await this.request("GET", `/products/${handle}`, undefined, options);
    } catch (error) {
      // A missing product is an expected outcome for a stale link, not a fault.
      if (error instanceof ApiError && error.status === 404) return undefined;
      throw error;
    }
  }

  async listCollections(options?: RequestOptions): Promise<Collection[]> {
    const data = await this.request<{ collections: Collection[] }>(
      "GET",
      "/collections",
      undefined,
      options,
    );
    return data.collections;
  }

  async getPincode(
    pincode: string,
    options?: RequestOptions,
  ): Promise<{
    pincode: string;
    city?: string;
    serviceable: boolean;
    codAvailable: boolean;
    estimatedDays: string;
    rtoRateBps: number;
  }> {
    return this.request("GET", `/pincodes/${pincode}`, undefined, options);
  }

  // ── Cart ────────────────────────────────────────────────────

  async createCart(): Promise<string> {
    const data = await this.request<{ cartId: string }>("POST", "/carts");
    return data.cartId;
  }

  async getCart(
    cartId: string,
  ): Promise<{ cartId: string; lines: CartLine[]; totals: CartTotals }> {
    return this.request("GET", `/carts/${cartId}`, undefined, { cache: "no-store" });
  }

  async addToCart(
    cartId: string,
    variantId: string,
    quantity = 1,
  ): Promise<{ ok: boolean; count: number }> {
    return this.request("POST", `/carts/${cartId}/lines`, { variantId, quantity });
  }

  async setCartQuantity(
    cartId: string,
    variantId: string,
    quantity: number,
  ): Promise<{ ok: boolean; count: number }> {
    return this.request("PATCH", `/carts/${cartId}/lines/${variantId}`, {
      quantity,
    });
  }

  async clearCart(cartId: string): Promise<void> {
    await this.request("DELETE", `/carts/${cartId}`);
  }

  // ── Checkout ────────────────────────────────────────────────

  async quoteCheckout(input: {
    cartId: string;
    pincode: string;
    address?: string;
    city?: string;
    stateCode?: string;
  }): Promise<{
    serviceable: boolean;
    estimatedDays: string;
    addressQuality: { score: number; issues: string[]; needsReview: boolean };
    rto: { risk: "low" | "medium" | "high"; score: number };
    cod: CodDecision;
  }> {
    return this.request("POST", "/checkout/quote", input, { cache: "no-store" });
  }

  async checkout(
    input: {
      cartId: string;
      address: Order["address"];
      paymentMethod: Order["paymentMethod"];
      eventId: string;
    },
    idempotencyKey?: string,
  ): Promise<{
    ok: true;
    orderNumber: string;
    status: string;
    invoiceNumber: string | null;
  }> {
    return this.request("POST", "/checkout", input, { idempotencyKey });
  }

  // ── Orders ──────────────────────────────────────────────────

  async getOrder(number: string): Promise<
    | {
        order: Record<string, unknown>;
        invoice: { rows: HsnSummaryRow[]; totals: InvoiceTotals };
        return: Record<string, unknown> | null;
      }
    | undefined
  > {
    try {
      return await this.request("GET", `/orders/${number}`, undefined, {
        cache: "no-store",
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return undefined;
      throw error;
    }
  }

  async confirmOrder(number: string): Promise<{ ok: boolean }> {
    return this.request("POST", `/orders/${number}/confirm`);
  }

  async advanceOrder(
    number: string,
    status: string,
    ndrReason?: string,
  ): Promise<{ ok: boolean }> {
    return this.request("POST", `/orders/${number}/status`, { status, ndrReason });
  }

  async answerNdr(
    number: string,
    action: "reattempt" | "update_address" | "cancel",
  ): Promise<{ ok: boolean }> {
    return this.request("POST", `/orders/${number}/ndr`, { action });
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
  ): Promise<{ ok: boolean }> {
    return this.request("POST", `/orders/${number}/returns`, input);
  }

  // ── Wishlist ────────────────────────────────────────────────

  async getWishlist(wishlistId: string): Promise<string[]> {
    const data = await this.request<{ handles: string[] }>(
      "GET",
      `/wishlists/${wishlistId}`,
      undefined,
      { cache: "no-store" },
    );
    return data.handles;
  }

  async toggleWishlist(
    wishlistId: string,
    handle: string,
  ): Promise<{ wishlisted: boolean; count: number }> {
    return this.request("POST", `/wishlists/${wishlistId}/toggle`, { handle });
  }

  // ── Admin ───────────────────────────────────────────────────

  async getMetrics(): Promise<Record<string, unknown>> {
    return this.request("GET", "/admin/metrics", undefined, { cache: "no-store" });
  }
}

/**
 * Build a client from the environment.
 *
 * Throws when the base URL is missing rather than defaulting to localhost: a
 * production build that silently points at a machine that is not there fails
 * much later and much more confusingly.
 */
export function createClient(
  env: Record<string, string | undefined> = process.env,
): SiumoraClient {
  const baseUrl = env.API_URL ?? env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new Error("API_URL is not set. Point it at the commerce API.");
  }
  return new SiumoraClient({ baseUrl });
}
