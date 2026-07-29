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
  /** Session token, sent as a bearer on every call. */
  token?: string;
}

export interface AccountCustomer {
  id: string;
  phone: string;
  /** Safe to print on a page — the middle four digits are dropped. */
  maskedPhone: string;
  name: string;
  email: string | null;
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
  private readonly token: string | undefined;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.doFetch = options.fetch ?? globalThis.fetch;
    this.token = options.token;
  }

  /**
   * The same client, signed in.
   *
   * A new instance rather than a mutable field: a request already in flight
   * must not pick up a token that arrived after it started.
   */
  withToken(token: string | undefined): SiumoraClient {
    return new SiumoraClient({
      baseUrl: this.baseUrl,
      timeoutMs: this.timeoutMs,
      fetch: this.doFetch,
      ...(token ? { token } : {}),
    });
  }

  /**
   * The tax invoice, as raw bytes.
   *
   * Its own method rather than going through `request`, which parses JSON — a
   * PDF put through `response.json()` is a syntax error where a document should
   * be. Authorisation is the same: the bearer, or the access key for a guest.
   */
  async invoicePdf(
    orderNumber: string,
    accessKey?: string,
  ): Promise<{ ok: boolean; status: number; body?: ArrayBuffer }> {
    const query = accessKey ? `?key=${encodeURIComponent(accessKey)}` : "";
    const response = await this.doFetch(
      `${this.baseUrl}/orders/${encodeURIComponent(orderNumber)}/invoice.pdf${query}`,
      {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
        cache: "no-store",
      } as RequestInit,
    );

    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, status: response.status, body: await response.arrayBuffer() };
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
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
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

  // ── Sign-in ─────────────────────────────────────────────────

  /**
   * Ask for a code.
   *
   * `code` comes back only in an environment with no WhatsApp/DLT sender wired
   * up, and `delivery` says which situation you are in.
   */
  async requestOtp(phone: string): Promise<{
    ok: boolean;
    maskedPhone: string;
    expiresAt: string;
    delivery: "sent" | "not_configured";
    code?: string;
  }> {
    return this.request("POST", "/auth/otp", { phone }, { cache: "no-store" });
  }

  async verifyOtp(
    phone: string,
    code: string,
  ): Promise<{
    ok: true;
    token: string;
    expiresAt: string;
    isAdmin: boolean;
    claimedOrders: number;
    customer: AccountCustomer;
  }> {
    return this.request("POST", "/auth/verify", { phone, code }, { cache: "no-store" });
  }

  async getSession(): Promise<
    | { signedIn: false }
    | { signedIn: true; isAdmin: boolean; customer: AccountCustomer }
  > {
    return this.request("GET", "/auth/session", undefined, { cache: "no-store" });
  }

  async signOut(): Promise<void> {
    await this.request("POST", "/auth/signout");
  }

  async signOutEverywhere(): Promise<{ ok: boolean; revoked: number }> {
    return this.request("POST", "/auth/signout-everywhere");
  }

  async updateProfile(input: {
    name?: string;
    email?: string;
  }): Promise<{ ok: boolean; customer: AccountCustomer }> {
    return this.request("PATCH", "/auth/profile", input);
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
    /** Lets the API tell whether this is the number the shopper proved. */
    phone?: string;
  }): Promise<{
    serviceable: boolean;
    estimatedDays: string;
    addressQuality: { score: number; issues: string[]; needsReview: boolean };
    rto: { risk: "low" | "medium" | "high"; score: number };
    cod: CodDecision;
    phoneVerified: boolean;
  }> {
    return this.request("POST", "/checkout/quote", input, { cache: "no-store" });
  }

  async checkout(
    input: {
      cartId: string;
      address: Order["address"];
      paymentMethod: Order["paymentMethod"];
      eventId: string;
      /** The browser's GA4 client id; GA4 refuses a server event without one. */
      gaClientId?: string;
      /** A registered buyer GSTIN, for a B2B invoice. */
      buyerGstin?: string;
    },
    idempotencyKey?: string,
  ): Promise<{
    ok: true;
    orderNumber: string;
    status: string;
    invoiceNumber: string | null;
    accessKey: string;
    /** Present when a payment provider order was created for the handoff. */
    razorpay?: { orderId: string; keyId: string; amountPaise: number };
  }> {
    return this.request("POST", "/checkout", input, { idempotencyKey });
  }

  // ── Orders ──────────────────────────────────────────────────

  /**
   * The access key, as a query suffix.
   *
   * Order numbers are a readable sequence, so the API will not serve one on the
   * number alone. A signed-in owner needs no key; a guest passes the one they
   * were given at checkout.
   */
  private keySuffix(accessKey?: string): string {
    return accessKey ? `?key=${encodeURIComponent(accessKey)}` : "";
  }

  /** The signed-in customer's own orders. */
  async listOrders(): Promise<Array<Record<string, unknown>>> {
    const data = await this.request<{ orders: Array<Record<string, unknown>> }>(
      "GET",
      "/orders",
      undefined,
      { cache: "no-store" },
    );
    return data.orders;
  }

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
    try {
      return await this.request(
        "GET",
        `/orders/${number}${this.keySuffix(accessKey)}`,
        undefined,
        { cache: "no-store" },
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return undefined;
      throw error;
    }
  }

  async confirmOrder(number: string, accessKey?: string): Promise<{ ok: boolean }> {
    return this.request(
      "POST",
      `/orders/${number}/confirm${this.keySuffix(accessKey)}`,
    );
  }

  async advanceOrder(
    number: string,
    status: string,
    ndrReason?: string,
    accessKey?: string,
  ): Promise<{ ok: boolean }> {
    return this.request(
      "POST",
      `/orders/${number}/status${this.keySuffix(accessKey)}`,
      { status, ndrReason },
    );
  }

  async answerNdr(
    number: string,
    action: "reattempt" | "update_address" | "cancel",
    accessKey?: string,
  ): Promise<{ ok: boolean }> {
    return this.request("POST", `/orders/${number}/ndr${this.keySuffix(accessKey)}`, {
      action,
    });
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
  ): Promise<{ ok: boolean }> {
    return this.request(
      "POST",
      `/orders/${number}/returns${this.keySuffix(accessKey)}`,
      input,
    );
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

  // ── Data-principal rights ───────────────────────────────────

  /** Everything held about the signed-in person. Scoped to the caller. */
  async exportMyData(): Promise<Record<string, unknown>> {
    return this.request("GET", "/account/data", undefined, { cache: "no-store" });
  }

  /**
   * Ask for erasure.
   *
   * Completes on the spot when every order has settled, and stays open with a
   * reason when one has not — a parcel in transit needs an address to arrive at.
   */
  async requestErasure(): Promise<{
    requestId: string;
    alreadyOpen: boolean;
    erased: boolean;
    pendingBecause?: string;
    resolveBy: string;
    retained: Array<{ keeps: string; forHowLong: string; because: string }>;
  }> {
    return this.request("POST", "/account/erasure", {});
  }

  // ── Admin ───────────────────────────────────────────────────

  /**
   * The GSTR-1 return for a period.
   *
   * The figures come from the same engine that produced the invoices, so the
   * return and the invoices cannot drift apart the way a spreadsheet does.
   */
  async getGstr1(period: string): Promise<Record<string, unknown>> {
    return this.request(
      "GET",
      `/admin/gstr1?period=${encodeURIComponent(period)}`,
      undefined,
      { cache: "no-store" },
    );
  }

  /** The audit log, newest first. Owner only, and read-only by construction. */
  async getAuditLog(): Promise<Record<string, unknown>> {
    return this.request("GET", "/admin/audit", undefined, { cache: "no-store" });
  }

  async getMetrics(): Promise<Record<string, unknown>> {
    return this.request("GET", "/admin/metrics", undefined, { cache: "no-store" });
  }

  /**
   * COD remittance batches, open exceptions and the cash position.
   *
   * Read-only. Ingesting a courier's file is an operator action against the API
   * directly, not something the storefront proxies.
   */
  async getRemittanceReport(): Promise<Record<string, unknown>> {
    return this.request("GET", "/admin/remittances", undefined, {
      cache: "no-store",
    });
  }

  /**
   * Public runtime flags — today just the payments kill-switch.
   *
   * Never cached: the checkout page reads this per request, and a paused
   * checkout served from a cache is a kill-switch that does not kill.
   */
  async getStoreConfig(): Promise<StoreConfig> {
    return this.request("GET", "/config", undefined, { cache: "no-store" });
  }
}

export interface StoreConfig {
  readonly paymentsEnabled: boolean;
  readonly razorpayConfigured: boolean;
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
