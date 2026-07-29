/**
 * Razorpay REST client (plan W1 payments).
 *
 * Thin and explicit: four calls, basic auth, outcome objects instead of
 * thrown errors — a payment provider being down is an expected state the
 * caller routes on, not an exception. `fetch` is injectable so every branch
 * is testable with recorded fixtures before any KYC clears; the live swap is
 * two environment variables.
 *
 * Orders are created with `payment_capture: 1` — auto-capture on success is
 * the settled policy (eng review, verified against the provider's docs); the
 * explicit capture call exists only for the `payment.authorized` fallback,
 * the drop-off case where the browser never came back.
 */

export interface RazorpayPayment {
  readonly id: string;
  readonly status: "created" | "authorized" | "captured" | "refunded" | "failed";
  readonly order_id?: string;
  readonly amount?: number;
}

export type RazorpayOutcome<T> =
  | ({ readonly ok: true } & T)
  | { readonly ok: false; readonly error: string; readonly status?: number };

export interface RazorpayClient {
  createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<RazorpayOutcome<{ orderId: string }>>;
  fetchOrderPayments(
    orderId: string,
  ): Promise<RazorpayOutcome<{ payments: RazorpayPayment[] }>>;
  capturePayment(
    paymentId: string,
    amountPaise: number,
  ): Promise<RazorpayOutcome<{ status: RazorpayPayment["status"] }>>;
  refundPayment(
    paymentId: string,
    input: { amountPaise: number; notes?: Record<string, string> },
  ): Promise<RazorpayOutcome<{ refundId: string }>>;
}

export interface RazorpayConfig {
  readonly keyId: string;
  readonly keySecret: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

export function createRazorpayClient(config: RazorpayConfig): RazorpayClient {
  const base = config.baseUrl ?? "https://api.razorpay.com/v1";
  const doFetch = config.fetch ?? fetch;
  const auth = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`;

  async function call<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<RazorpayOutcome<T>> {
    try {
      const response = await doFetch(`${base}${path}`, {
        method,
        headers: {
          authorization: auth,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

      const text = await response.text();
      if (!response.ok) {
        // The body carries the provider's reason; the first line is enough for
        // a log and never echoed to a customer.
        return {
          ok: false,
          status: response.status,
          error: `HTTP ${response.status}: ${text.slice(0, 300)}`,
        };
      }
      return { ok: true, ...(JSON.parse(text) as T) } as RazorpayOutcome<T> & {
        ok: true;
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }

  return {
    async createOrder(input) {
      const result = await call<{ id: string }>("POST", "/orders", {
        amount: input.amountPaise,
        currency: "INR",
        receipt: input.receipt,
        payment_capture: 1,
        ...(input.notes ? { notes: input.notes } : {}),
      });
      if (!result.ok) return result;
      return { ok: true, orderId: result.id };
    },

    async fetchOrderPayments(orderId) {
      const result = await call<{ items: RazorpayPayment[] }>(
        "GET",
        `/orders/${orderId}/payments`,
      );
      if (!result.ok) return result;
      return { ok: true, payments: result.items ?? [] };
    },

    async capturePayment(paymentId, amountPaise) {
      const result = await call<{ status: RazorpayPayment["status"] }>(
        "POST",
        `/payments/${paymentId}/capture`,
        { amount: amountPaise, currency: "INR" },
      );
      if (!result.ok) return result;
      return { ok: true, status: result.status };
    },

    async refundPayment(paymentId, input) {
      const result = await call<{ id: string }>(
        "POST",
        `/payments/${paymentId}/refund`,
        {
          amount: input.amountPaise,
          ...(input.notes ? { notes: input.notes } : {}),
        },
      );
      if (!result.ok) return result;
      return { ok: true, refundId: result.id };
    },
  };
}
