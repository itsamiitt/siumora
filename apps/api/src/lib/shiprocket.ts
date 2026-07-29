/**
 * Shiprocket REST client (plan W1 logistics).
 *
 * The same shape as the payment client: explicit calls, outcome objects, an
 * injectable fetch so every branch is testable before the KYC clears. The one
 * extra concern is auth — Shiprocket issues a bearer token against the
 * account's email/password with a ~10-day life, so the token is fetched
 * lazily, cached, and refreshed exactly once when a call comes back 401.
 *
 * Note from the eng review [3A, medium confidence]: push webhooks are
 * reported as Growth-plan-and-above. Verify at KYC signup; if the account
 * lands on Lite, a tracking-poll fallback becomes W1 work.
 */

export type ShiprocketOutcome<T> =
  | ({ readonly ok: true } & T)
  | { readonly ok: false; readonly error: string; readonly status?: number };

export interface ShipmentItem {
  readonly name: string;
  readonly sku: string;
  readonly units: number;
  /** Rupees, not paise — Shiprocket's API takes decimal rupees. */
  readonly sellingPrice: number;
  readonly hsn?: string;
}

export interface ShipmentAddress {
  readonly name: string;
  readonly phone: string;
  readonly line1: string;
  readonly city: string;
  readonly stateName: string;
  readonly pincode: string;
}

export interface CreateShipmentInput {
  readonly orderNumber: string;
  readonly orderDate: string;
  readonly pickupLocation: string;
  readonly address: ShipmentAddress;
  readonly items: readonly ShipmentItem[];
  readonly paymentMethod: "Prepaid" | "COD";
  /** Rupees. */
  readonly subTotal: number;
  readonly weightKg: number;
  readonly dimensionsCm: { length: number; breadth: number; height: number };
}

export interface ShiprocketClient {
  createOrder(
    input: CreateShipmentInput,
  ): Promise<ShiprocketOutcome<{ orderId: string; shipmentId: string }>>;
  assignAwb(
    shipmentId: string,
  ): Promise<ShiprocketOutcome<{ awb: string; courier: string }>>;
  schedulePickup(shipmentId: string): Promise<ShiprocketOutcome<object>>;
  createReturn(
    input: CreateShipmentInput,
  ): Promise<ShiprocketOutcome<{ orderId: string; shipmentId: string }>>;
}

export interface ShiprocketConfig {
  readonly email: string;
  readonly password: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

export function createShiprocketClient(config: ShiprocketConfig): ShiprocketClient {
  const base = config.baseUrl ?? "https://apiv2.shiprocket.in/v1/external";
  const doFetch = config.fetch ?? fetch;

  let token: string | undefined;

  async function login(): Promise<ShiprocketOutcome<{ token: string }>> {
    try {
      const response = await doFetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: config.email, password: config.password }),
      });
      const text = await response.text();
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: `HTTP ${response.status}: ${text.slice(0, 300)}`,
        };
      }
      const parsed = JSON.parse(text) as { token?: string };
      if (!parsed.token) return { ok: false, error: "login returned no token" };
      token = parsed.token;
      return { ok: true, token: parsed.token };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }

  async function call<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    retried = false,
  ): Promise<ShiprocketOutcome<T>> {
    if (!token) {
      const auth = await login();
      if (!auth.ok) return auth;
    }

    try {
      const response = await doFetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

      const text = await response.text();

      if (response.status === 401 && !retried) {
        // The cached token expired. One refresh, one retry — a second 401
        // means the credentials are wrong, and retrying those forever is how
        // an account gets locked.
        token = undefined;
        return call<T>(method, path, body, true);
      }

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: `HTTP ${response.status}: ${text.slice(0, 300)}`,
        };
      }
      return { ok: true, ...(JSON.parse(text) as T) } as ShiprocketOutcome<T> & {
        ok: true;
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }

  function shipmentPayload(input: CreateShipmentInput) {
    return {
      order_id: input.orderNumber,
      order_date: input.orderDate,
      pickup_location: input.pickupLocation,
      billing_customer_name: input.address.name,
      billing_last_name: "",
      billing_address: input.address.line1,
      billing_city: input.address.city,
      billing_pincode: input.address.pincode,
      billing_state: input.address.stateName,
      billing_country: "India",
      billing_phone: input.address.phone,
      shipping_is_billing: true,
      order_items: input.items.map((item) => ({
        name: item.name,
        sku: item.sku,
        units: item.units,
        selling_price: item.sellingPrice,
        ...(item.hsn ? { hsn: item.hsn } : {}),
      })),
      payment_method: input.paymentMethod,
      sub_total: input.subTotal,
      length: input.dimensionsCm.length,
      breadth: input.dimensionsCm.breadth,
      height: input.dimensionsCm.height,
      weight: input.weightKg,
    };
  }

  return {
    async createOrder(input) {
      const result = await call<{ order_id?: number | string; shipment_id?: number | string }>(
        "POST",
        "/orders/create/adhoc",
        shipmentPayload(input),
      );
      if (!result.ok) return result;
      if (result.order_id === undefined || result.shipment_id === undefined) {
        return { ok: false, error: "create returned no order/shipment id" };
      }
      return {
        ok: true,
        orderId: String(result.order_id),
        shipmentId: String(result.shipment_id),
      };
    },

    async assignAwb(shipmentId) {
      const result = await call<{
        awb_assign_status?: number;
        response?: { data?: { awb_code?: string; courier_name?: string } };
      }>("POST", "/courier/assign/awb", { shipment_id: shipmentId });
      if (!result.ok) return result;

      const data = result.response?.data;
      if (result.awb_assign_status !== 1 || !data?.awb_code) {
        // No courier could take it — a serviceability or wallet problem the
        // operator resolves in the panel; the booking itself stands.
        return { ok: false, error: "no courier assigned an AWB" };
      }
      return {
        ok: true,
        awb: data.awb_code,
        courier: data.courier_name ?? "courier",
      };
    },

    async schedulePickup(shipmentId) {
      const result = await call<object>("POST", "/courier/generate/pickup", {
        shipment_id: [shipmentId],
      });
      return result.ok ? { ok: true } : result;
    },

    async createReturn(input) {
      const result = await call<{ order_id?: number | string; shipment_id?: number | string }>(
        "POST",
        "/orders/create/return",
        {
          ...shipmentPayload(input),
          // On a return the customer's address is where the parcel is picked
          // up from; Shiprocket's return API reads the same fields as pickup_*.
          pickup_customer_name: input.address.name,
          pickup_address: input.address.line1,
          pickup_city: input.address.city,
          pickup_state: input.address.stateName,
          pickup_country: "India",
          pickup_pincode: input.address.pincode,
          pickup_phone: input.address.phone,
        },
      );
      if (!result.ok) return result;
      if (result.order_id === undefined || result.shipment_id === undefined) {
        return { ok: false, error: "return returned no order/shipment id" };
      }
      return {
        ok: true,
        orderId: String(result.order_id),
        shipmentId: String(result.shipment_id),
      };
    },
  };
}
