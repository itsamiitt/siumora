import { AbstractFulfillmentProviderService, MedusaError } from "@medusajs/framework/utils";
import type {
  CreateFulfillmentResult,
  FulfillmentDTO,
  FulfillmentItemDTO,
  FulfillmentOption,
  FulfillmentOrderDTO,
} from "@medusajs/framework/types";

// prettier-ignore -- single line so @ts-ignore reaches the specifier
// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { canTransition, type OrderStatus } from "@siumora/core";

import {
  cancelShipment,
  ensureStatusRow,
  getShipment,
  saveShipment,
  setStatus,
  type SqlClient,
} from "../returns-ndr/data.ts";
import { initialSiumoraStatus } from "../returns-ndr/lifecycle.ts";
import { createShiprocketClient, type ShiprocketClient } from "./client.ts";
import { shiprocketCredentials, type SettingsPg } from "./credentials.ts";
import { shipmentFor, trackingUrl, type BookableOrder } from "./decide.ts";
import { orderSettlement, type SettlementKind } from "../siumora-order/payment-method.ts";

/**
 * Shiprocket as a Medusa fulfillment provider (plan 16 Phase F, B14) —
 * `shiprocket_shiprocket`, behind the seeded Standard Delivery option.
 *
 * The native "Create fulfillment" button on an order books the courier:
 * the Shiprocket order, the AWB, the pickup — the Fastify booking route's
 * steps, now where an operator already works (rule R5: native first). The
 * label then carries the AWB and a tracking link on the order page, and the
 * Siumora status moves to "processing". The courier webhook
 * (src/api/webhooks/courier) drives everything after.
 *
 * Resume-aware: each step is recorded in siumora_shipments as it lands, so
 * a booking that got its courier order but no AWB (wallet empty, pincode
 * unserved) continues from the AWB on the next try instead of creating a
 * second courier order. A booking that already has its AWB is returned as
 * is — a retried fulfillment never books twice.
 *
 * Without Shiprocket credentials it books nothing and says so in the
 * fulfillment's data, so local and pre-KYC environments keep working like
 * the manual provider.
 */

interface InjectedDependencies {
  logger?: { warn(message: string): void; error(message: string): void };
  __pg_connection__?: SettingsPg & SqlClient;
}

export interface ShiprocketProviderOptions {
  /** Test seams, never set in production. */
  fetch?: typeof fetch;
  baseUrl?: string;
}

const wire = (value: unknown): number => {
  const unwrapped = typeof value === "number" ? value : JSON.parse(JSON.stringify(value ?? 0));
  return typeof unwrapped === "number" ? unwrapped : Number(unwrapped);
};

export class ShiprocketFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static identifier = "shiprocket";

  protected readonly deps_: InjectedDependencies;
  protected readonly options_: ShiprocketProviderOptions;

  constructor(container: InjectedDependencies, options: ShiprocketProviderOptions = {}) {
    super();
    this.deps_ = container ?? {};
    this.options_ = options;
  }

  protected pg(): SqlClient {
    const pg = this.deps_.__pg_connection__;
    if (!pg) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "No database connection.");
    return pg;
  }

  protected async connect(): Promise<{ client: ShiprocketClient; pickupLocation: string } | undefined> {
    const credentials = await shiprocketCredentials(this.deps_.__pg_connection__);
    if (!credentials.configured || !credentials.email || !credentials.password) return undefined;
    return {
      client: createShiprocketClient({
        email: credentials.email,
        password: credentials.password,
        ...(this.options_.fetch ? { fetch: this.options_.fetch } : {}),
        ...(this.options_.baseUrl ? { baseUrl: this.options_.baseUrl } : {}),
      }),
      pickupLocation: credentials.pickupLocation,
    };
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [{ id: "standard", name: "Standard (Shiprocket)" }];
  }

  async validateOption(): Promise<boolean> {
    return true;
  }

  async validateFulfillmentData(
    _optionData: Record<string, unknown>,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return data;
  }

  // Prices are the seeded flat rules (₹79 under ₹999, free above), mirrored
  // by core's shippingFor — never a live courier rate a shopper did not see.
  async canCalculate(): Promise<boolean> {
    return false;
  }

  /** The order's SIU number — the courier order id, and the webhook's key. */
  protected async orderNumber(orderId: string): Promise<string> {
    const result = await this.pg().raw(
      "SELECT order_number FROM siumora_order_identity WHERE order_id = ? AND deleted_at IS NULL",
      [orderId],
    );
    const row = result.rows[0] as { order_number?: string } | undefined;
    if (!row?.order_number) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "This is not a storefront order (no SIU number) — book its courier by hand.",
      );
    }
    return row.order_number;
  }

  /**
   * What is being shipped: the fulfilment's items at the order's own prices.
   * COD vs Prepaid comes from the payment Medusa recorded, never the order's
   * metadata — that began as shopper-writable cart metadata, and a parcel
   * booked Prepaid is one the courier hands over without collecting.
   */
  protected bookable(
    number: string,
    order: Partial<FulfillmentOrderDTO>,
    items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    settlement: SettlementKind,
  ): BookableOrder {
    const orderItems = order.items ?? [];
    return {
      number,
      placedAt: new Date(order.created_at ?? Date.now()),
      paymentMethod: settlement,
      address: order.shipping_address ?? {},
      lines: items.map((item) => {
        const line = orderItems.find((candidate) => candidate.id === item.line_item_id);
        return {
          title: item.title ?? line?.title ?? "Jewellery",
          sku: item.sku ?? line?.variant_sku ?? "",
          quantity: wire(item.quantity ?? 1),
          unitPricePaise: Math.round(wire(line?.unit_price ?? 0) * 100),
        };
      }),
    };
  }

  async createFulfillment(
    _data: Record<string, unknown>,
    items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    _fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>,
  ): Promise<CreateFulfillmentResult> {
    if (!order?.id) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "A courier booking needs its order.");
    }
    const connection = await this.connect();
    if (!connection) {
      this.deps_.logger?.warn(`shiprocket not configured — order ${order.id} fulfilled without a courier booking`);
      return { data: { courier: "none", note: "Shiprocket is not connected; book the courier by hand." }, labels: [] };
    }
    const { client, pickupLocation } = connection;
    const pg = this.pg();
    const number = await this.orderNumber(order.id);

    let shipment = await getShipment(pg, order.id);
    if (shipment?.awb) return this.result(shipment.courier_order_id, shipment.shipment_id, shipment.awb, shipment.courier);

    if (!shipment?.shipment_id) {
      const settlement = await orderSettlement(pg, order.id);
      const input = shipmentFor(this.bookable(number, order, items, settlement), { pickupLocation });
      if ("error" in input) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, `Cannot book ${number}: ${input.error}.`);
      }
      const created = await client.createOrder(input);
      if (!created.ok) {
        this.deps_.logger?.error(`shiprocket booking for ${number} failed: ${created.error}`);
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Shiprocket refused the booking for ${number}. Check the panel and try again.`);
      }
      shipment = await saveShipment(pg, order.id, { courierOrderId: created.orderId, shipmentId: created.shipmentId });
    }

    const assigned = await client.assignAwb(shipment.shipment_id!);
    if (!assigned.ok) {
      // The courier order stands; the next try resumes here.
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `No courier took ${number} yet (${assigned.error}). Top up the wallet or check serviceability in Shiprocket, then try again.`,
      );
    }
    // Best-effort: a pickup can be rescheduled from the panel, and holding the
    // booking hostage to it would leave a parcel with an AWB looking unbooked.
    const pickup = await client.schedulePickup(shipment.shipment_id!);
    if (!pickup.ok) this.deps_.logger?.warn(`pickup for ${number} not scheduled — reschedule in Shiprocket`);
    shipment = await saveShipment(pg, order.id, {
      awb: assigned.awb,
      courier: assigned.courier,
      pickupScheduled: pickup.ok,
    });

    await this.markProcessing(order.id, order.status);
    return this.result(shipment.courier_order_id, shipment.shipment_id, assigned.awb, assigned.courier);
  }

  /** Booked → "processing" on the Siumora status machine, if it may move there. */
  protected async markProcessing(orderId: string, medusaStatus: unknown): Promise<void> {
    const pg = this.pg();
    const row = await ensureStatusRow(pg, orderId, initialSiumoraStatus(String(medusaStatus ?? "pending")));
    if (canTransition(row.status as OrderStatus, "processing")) await setStatus(pg, orderId, "processing");
  }

  protected result(
    courierOrderId: string | null,
    shipmentId: string | null,
    awb: string,
    courier: string | null,
  ): CreateFulfillmentResult {
    return {
      data: {
        courier_order_id: courierOrderId,
        shipment_id: shipmentId,
        awb,
        courier,
      },
      labels: [{ tracking_number: awb, tracking_url: trackingUrl(awb), label_url: "" }],
    };
  }

  /** Cancelled before pickup: cancel the courier order and free the booking. */
  async cancelFulfillment(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const courierOrderId = typeof data.courier_order_id === "string" ? data.courier_order_id : undefined;
    const connection = await this.connect();
    if (connection && courierOrderId) {
      const cancelled = await connection.client.cancelOrders([courierOrderId]);
      if (!cancelled.ok) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Shiprocket would not cancel this booking — it may already be picked up.",
        );
      }
    }
    const pg = this.deps_.__pg_connection__;
    if (pg && courierOrderId) {
      const found = await pg.raw(
        "SELECT order_id FROM siumora_shipments WHERE courier_order_id = ? AND deleted_at IS NULL",
        [courierOrderId],
      );
      const orderId = (found.rows[0] as { order_id?: string } | undefined)?.order_id;
      if (orderId) await cancelShipment(pg, orderId);
    }
    return { ...data, cancelled: true };
  }

  /** A return's reverse pickup, booked from the customer's address. */
  async createReturnFulfillment(fulfillment: Record<string, unknown>): Promise<CreateFulfillmentResult> {
    const connection = await this.connect();
    if (!connection) return { data: { courier: "none", note: "Shiprocket is not connected; arrange the pickup by hand." }, labels: [] };
    const address = (fulfillment.delivery_address ?? {}) as BookableOrder["address"];
    const items = (fulfillment.items ?? []) as Array<{ title?: string; sku?: string; quantity?: unknown }>;
    const input = shipmentFor(
      {
        number: `RET-${String(fulfillment.id ?? Date.now())}`.slice(0, 40),
        placedAt: new Date(),
        paymentMethod: "prepaid",
        address,
        lines: items.map((item) => ({
          title: item.title ?? "Return",
          sku: item.sku ?? "",
          quantity: wire(item.quantity ?? 1),
          unitPricePaise: 0,
        })),
      },
      { pickupLocation: connection.pickupLocation },
    );
    if ("error" in input) throw new MedusaError(MedusaError.Types.INVALID_DATA, `Cannot book the return pickup: ${input.error}.`);
    const created = await connection.client.createReturn(input);
    if (!created.ok) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Shiprocket refused the return pickup. Try again from the panel.");
    }
    return { data: { courier_order_id: created.orderId, shipment_id: created.shipmentId, reverse: true }, labels: [] };
  }
}
