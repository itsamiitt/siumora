import { AbstractPaymentProvider, MedusaError } from "@medusajs/framework/utils";
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types";

import { createRazorpayClient, type RazorpayClient } from "./client.ts";
import { razorpayCredentials, type RazorpayCredentials, type SettingsPg } from "./credentials.ts";
import {
  majorFromPaise,
  paiseFromMajor,
  parseWebhook,
  readPayments,
  verifyWebhookSignature,
} from "./decide.ts";

/**
 * Razorpay as a Medusa payment provider (plan 16 Phase B, B10) —
 * `pp_razorpay_razorpay`.
 *
 * Payment comes before the order: the prepare route opens a session here
 * (a Razorpay order for the cart total), the browser pays in Checkout.js,
 * and the cart completes only once Razorpay says the money is there. If the
 * browser never comes back, Razorpay's webhook reaches Medusa's
 * /hooks/payment/razorpay_razorpay and processPaymentWorkflow completes the
 * cart; the recon job (src/jobs/payment-recon.ts) catches what both missed.
 *
 * Every state question is asked of Razorpay directly (fetchOrderPayments),
 * never inferred from what a browser claims. A payment for any amount other
 * than the session's is refused, never completed (decide.ts readPayments).
 *
 * Session data carries only non-secret values: the Razorpay order id, the
 * amount in paise, the public key id (the browser needs it to open the
 * modal), and the payment id once there is one.
 */

export interface RazorpaySessionData extends Record<string, unknown> {
  razorpay_order_id: string;
  amount_paise: number;
  key_id: string;
  session_id?: string;
  created_at: string;
  razorpay_payment_id?: string;
}

interface InjectedDependencies {
  logger?: { warn(message: string): void; error(message: string): void };
  /** Registered in every module container; absent in unit tests. */
  __pg_connection__?: SettingsPg & {
    raw(sql: string, bindings?: ReadonlyArray<string>): Promise<{ rows: unknown[] }>;
  };
}

export interface RazorpayProviderOptions {
  /** Test seams: a recorded fetch and a base URL, never set in production. */
  fetch?: typeof fetch;
  baseUrl?: string;
}

const RECEIPT_MAX = 40;

function sessionData(data: Record<string, unknown> | undefined): RazorpaySessionData {
  const orderId = data?.razorpay_order_id;
  const amount = data?.amount_paise;
  if (typeof orderId !== "string" || typeof amount !== "number") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "This payment session has no Razorpay order.",
    );
  }
  return data as RazorpaySessionData;
}

export class RazorpayPaymentProviderService extends AbstractPaymentProvider<RazorpayProviderOptions> {
  static identifier = "razorpay";

  protected readonly deps_: InjectedDependencies;
  protected readonly options_: RazorpayProviderOptions;

  constructor(container: InjectedDependencies, options: RazorpayProviderOptions = {}) {
    super(container as Record<string, unknown>, options);
    this.deps_ = container ?? {};
    this.options_ = options;
  }

  /** Credentials and a client, resolved per call so an admin edit applies at once. */
  protected async connect(): Promise<{ client: RazorpayClient; credentials: RazorpayCredentials }> {
    const credentials = await razorpayCredentials(this.deps_.__pg_connection__);
    if (!credentials.configured || !credentials.keyId || !credentials.keySecret) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Razorpay is not configured.");
    }
    const client = createRazorpayClient({
      keyId: credentials.keyId,
      keySecret: credentials.keySecret,
      ...(this.options_.fetch ? { fetch: this.options_.fetch } : {}),
      ...(this.options_.baseUrl ? { baseUrl: this.options_.baseUrl } : {}),
    });
    return { client, credentials };
  }

  protected async createOrder(
    amountPaise: number,
    sessionId: string | undefined,
  ): Promise<RazorpaySessionData> {
    const { client, credentials } = await this.connect();
    const created = await client.createOrder({
      amountPaise,
      receipt: (sessionId ?? `siumora_${Date.now()}`).slice(0, RECEIPT_MAX),
      // The webhook's routing key back to this session (decide.ts parseWebhook).
      ...(sessionId ? { notes: { session_id: sessionId } } : {}),
    });
    if (!created.ok) {
      this.deps_.logger?.error(`razorpay order create failed: ${created.error}`);
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Online payment could not be started. Nothing was charged — try again.",
      );
    }
    return {
      razorpay_order_id: created.orderId,
      amount_paise: amountPaise,
      key_id: credentials.keyId!,
      ...(sessionId ? { session_id: sessionId } : {}),
      created_at: new Date().toISOString(),
    };
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    if (input.currency_code.toLowerCase() !== "inr") {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Razorpay takes INR only.");
    }
    const sessionId =
      typeof input.data?.session_id === "string" ? input.data.session_id : undefined;
    const data = await this.createOrder(paiseFromMajor(input.amount), sessionId);
    return { id: data.razorpay_order_id, status: "pending", data };
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const current = sessionData(input.data);
    const amountPaise = paiseFromMajor(input.amount);
    if (amountPaise === current.amount_paise) return { data: current };
    // A Razorpay order's amount is fixed: a new total needs a new order.
    return { status: "pending", data: await this.createOrder(amountPaise, current.session_id) };
  }

  /**
   * Called when the cart completes (browser path) or a webhook arrives.
   * Captured → captured. Authorized → capture now (auto-capture missed it:
   * the drop-off case); a failed capture stays authorized for recon.
   * Nothing yet → pending, so completion refuses rather than places.
   */
  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const data = sessionData(input.data);
    const { client } = await this.connect();
    const listed = await client.fetchOrderPayments(data.razorpay_order_id);
    if (!listed.ok) {
      this.deps_.logger?.warn(`razorpay payments read failed: ${listed.error}`);
      return { status: "pending", data };
    }
    const reading = readPayments(listed.payments, data.amount_paise);
    switch (reading.state) {
      case "captured":
        return { status: "captured", data: { ...data, razorpay_payment_id: reading.paymentId } };
      case "authorized": {
        const captured = await client.capturePayment(reading.paymentId, data.amount_paise);
        return {
          status: captured.ok ? "captured" : "authorized",
          data: { ...data, razorpay_payment_id: reading.paymentId },
        };
      }
      case "pending":
        return { status: "pending", data };
      default:
        this.deps_.logger?.error(
          `razorpay order ${data.razorpay_order_id} read ${reading.state} — not completing`,
        );
        return { status: "error", data };
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const data = sessionData(input.data);
    const { client } = await this.connect();
    const listed = await client.fetchOrderPayments(data.razorpay_order_id);
    if (!listed.ok) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Could not read the payment.");
    }
    const reading = readPayments(listed.payments, data.amount_paise);
    if (reading.state === "captured") {
      return { data: { ...data, razorpay_payment_id: reading.paymentId } };
    }
    if (reading.state === "authorized") {
      const captured = await client.capturePayment(reading.paymentId, data.amount_paise);
      if (!captured.ok) {
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Razorpay refused the capture.");
      }
      return { data: { ...data, razorpay_payment_id: reading.paymentId } };
    }
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Nothing to capture (${reading.state}).`);
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const data = sessionData(input.data);
    const paymentId = data.razorpay_payment_id;
    if (!paymentId) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "There is no Razorpay payment to refund.");
    }
    const { client } = await this.connect();
    const refunded = await client.refundPayment(paymentId, {
      amountPaise: paiseFromMajor(input.amount),
      notes: { razorpay_order_id: data.razorpay_order_id },
    });
    if (!refunded.ok) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Razorpay refused the refund.");
    }
    return { data: { ...data, last_refund_id: refunded.refundId } };
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const data = sessionData(input.data);
    const { client } = await this.connect();
    const listed = await client.fetchOrderPayments(data.razorpay_order_id);
    if (!listed.ok) return { status: "pending", data };
    const reading = readPayments(listed.payments, data.amount_paise);
    const status =
      reading.state === "captured" || reading.state === "authorized" || reading.state === "pending"
        ? reading.state
        : "error";
    return { status, data };
  }

  // A Razorpay order cannot be cancelled or deleted; an unpaid one simply
  // expires, and an authorized-never-captured payment auto-refunds.
  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: input.data ?? {} };
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data ?? {} };
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    return { data: input.data ?? {} };
  }

  /**
   * Medusa's /hooks/payment/razorpay_razorpay hands every delivery here.
   * Unsigned or wrongly signed → not_supported (Medusa then does nothing:
   * the parity rows "rejects an unsigned / wrong-secret payment webhook").
   * Replays are safe downstream: completion is idempotent per cart and the
   * invoice is allocated once per order.
   */
  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"],
  ): Promise<WebhookActionResult> {
    const credentials = await razorpayCredentials(this.deps_.__pg_connection__);
    const header = payload.headers?.["x-razorpay-signature"];
    const signature = Array.isArray(header) ? header[0] : header;
    const raw = payload.rawData as string | Buffer | undefined;
    if (!verifyWebhookSignature(raw, typeof signature === "string" ? signature : undefined, credentials.webhookSecret)) {
      this.deps_.logger?.warn("razorpay webhook refused: signature did not verify");
      return { action: "not_supported" };
    }

    const event = parseWebhook(payload.data);
    if (event.kind === "ignored") return { action: "not_supported" };

    const sessionId = event.sessionId ?? (await this.sessionForOrder(event.razorpayOrderId));
    if (!sessionId) return { action: "not_supported" };

    return {
      action: event.kind,
      data: { session_id: sessionId, amount: majorFromPaise(event.amountPaise) },
    };
  }

  /** A payment that carried no session note is routed by its Razorpay order. */
  protected async sessionForOrder(razorpayOrderId: string): Promise<string | undefined> {
    const pg = this.deps_.__pg_connection__;
    if (!pg) return undefined;
    const result = await pg.raw(
      "SELECT id FROM payment_session WHERE data->>'razorpay_order_id' = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
      [razorpayOrderId],
    );
    const row = result.rows[0] as { id?: unknown } | undefined;
    return typeof row?.id === "string" ? row.id : undefined;
  }
}
