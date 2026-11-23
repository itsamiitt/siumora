/**
 * Load test for browsing and buying (plan 18, launch check G10): the store
 * API at 10x the expected launch-day peak, against STAGING.
 *
 *   k6 run -e BASE_URL=https://api-staging.siumora.com \
 *          -e PUBLISHABLE_KEY=pk_... tooling/load/checkout.k6.js
 *
 * Two scenarios run together, shaped like a festival-sale evening:
 *   browse — product listing and a product page: BROWSE_RATE a second
 *            (default 60, i.e. 10x of ~6 page views a second at peak).
 *   buy    — the whole COD purchase the storefront makes: region, cart,
 *            add a line, quote, sign the buyer in (COD needs a verified
 *            number), address onto the cart, complete. BUY_RATE a second
 *            (default 2, i.e. 10x of one order every five seconds).
 *
 * Staging must run with OTP_ECHO=true (no real messages) and the demo
 * catalog (seed.ts) with enough stock: every completed order takes a unit.
 * Reseed after the run. Medusa's rate limits stay ON — refusals are counted,
 * not failures — and k6 sends no signed client-IP header, so every request
 * shares k6's address: raise the per-IP ceilings on staging for the run or
 * expect 429s to dominate. The direct-caller WAF rules apply too.
 *
 * Pass bar:
 *   - browse p95 < 300 ms, quote p95 < 500 ms, complete p95 < 2 s
 *   - zero 5xx
 *   - every refusal is a 429 (or 409 stock) — never a timeout
 */

import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:9000";
const KEY = __ENV.PUBLISHABLE_KEY || "";
const BROWSE_RATE = Number(__ENV.BROWSE_RATE || 60);
const BUY_RATE = Number(__ENV.BUY_RATE || 2);
const DURATION = __ENV.DURATION || "5m";

export const options = {
  scenarios: {
    browse: {
      executor: "constant-arrival-rate",
      exec: "browse",
      rate: BROWSE_RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: BROWSE_RATE,
      maxVUs: BROWSE_RATE * 4,
    },
    buy: {
      executor: "constant-arrival-rate",
      exec: "buy",
      rate: BUY_RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: BUY_RATE * 10,
      maxVUs: BUY_RATE * 30,
    },
  },
  thresholds: {
    "http_req_duration{step:list}": ["p(95)<300"],
    "http_req_duration{step:product}": ["p(95)<300"],
    "http_req_duration{step:quote}": ["p(95)<500"],
    "http_req_duration{step:complete}": ["p(95)<2000"],
    server_errors: ["count==0"],
  },
};

const serverErrors = new Counter("server_errors");
const refused = new Counter("refused");
const orders = new Counter("orders_placed");

const base = { "content-type": "application/json", "x-publishable-api-key": KEY };

/** Records 5xx and refusals; true when the response is a 2xx. */
function ok(response, step) {
  if (response.status >= 500) serverErrors.add(1, { step });
  if (response.status === 429 || response.status === 409) refused.add(1, { step });
  return check(response, { [`${step} 2xx`]: (r) => r.status >= 200 && r.status < 300 });
}

export function setup() {
  const regions = http.get(`${BASE}/store/regions`, { headers: base });
  const region = regions.json("regions.0.id");
  const listed = http.get(`${BASE}/store/products?limit=50&region_id=${region}&fields=id,handle,*variants`, {
    headers: base,
  });
  const products = (listed.json("products") || []).filter((p) => (p.variants || []).length > 0);
  if (!region || products.length === 0) {
    throw new Error(`staging is not seeded: region ${region}, ${products.length} products`);
  }
  return {
    region,
    handles: products.map((p) => p.handle),
    variants: products.map((p) => p.variants[0].id),
  };
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function browse(data) {
  ok(
    http.get(`${BASE}/store/products?limit=24&region_id=${data.region}`, { headers: base, tags: { step: "list" } }),
    "list",
  );
  ok(
    http.get(`${BASE}/store/products?handle=${pick(data.handles)}&region_id=${data.region}`, {
      headers: base,
      tags: { step: "product" },
    }),
    "product",
  );
}

/** A distinct 97xxxxxxxx per VU and iteration (98… is the OTP script's): the resend cooldown is per number. */
function phoneFor() {
  return `97${String((__VU * 100000 + __ITER) % 100000000).padStart(8, "0")}`;
}

export function buy(data) {
  const cart = http.post(`${BASE}/store/carts`, JSON.stringify({ region_id: data.region }), {
    headers: base,
    tags: { step: "cart" },
  });
  if (!ok(cart, "cart")) return;
  const cartId = cart.json("cart.id");

  const add = http.post(
    `${BASE}/store/carts/${cartId}/line-items`,
    JSON.stringify({ variant_id: pick(data.variants), quantity: 1 }),
    { headers: base, tags: { step: "add" } },
  );
  if (!ok(add, "add")) return;

  const phone = phoneFor();
  const quote = http.post(
    `${BASE}/store/siumora/checkout/quote`,
    JSON.stringify({ cartId, pincode: "400001", address: "Flat 3B, Linking Road", city: "Mumbai", stateCode: "27", phone }),
    { headers: base, tags: { step: "quote" } },
  );
  if (!ok(quote, "quote")) return;

  // COD needs the delivery number verified: sign in with it (echoed code).
  const sent = http.post(`${BASE}/store/siumora-auth/otp`, JSON.stringify({ phone }), {
    headers: base,
    tags: { step: "otp" },
  });
  if (!ok(sent, "otp")) return;
  const code = sent.json("code");
  if (!code) throw new Error("staging must run with OTP_ECHO=true for the buy scenario");
  const verified = http.post(`${BASE}/store/siumora-auth/verify`, JSON.stringify({ phone, code }), {
    headers: base,
    tags: { step: "verify" },
  });
  if (!ok(verified, "verify")) return;
  const signed = { ...base, authorization: `Bearer ${verified.json("token")}` };

  const address = http.post(
    `${BASE}/store/carts/${cartId}`,
    JSON.stringify({
      email: `${phone}@guest.siumora.in`,
      metadata: { siumora_event_id: `load-${__VU}-${__ITER}-${Date.now()}` },
      shipping_address: {
        first_name: "Load",
        last_name: "Test",
        address_1: "Flat 3B, Sunrise Apartments, Linking Road",
        city: "Mumbai",
        province: "27",
        postal_code: "400001",
        country_code: "in",
        phone,
      },
    }),
    { headers: signed, tags: { step: "address" } },
  );
  if (!ok(address, "address")) return;

  const complete = http.post(
    `${BASE}/store/siumora/carts/${cartId}/complete`,
    JSON.stringify({ paymentMethod: "cod" }),
    {
      headers: { ...signed, "idempotency-key": `load-${cartId}` },
      tags: { step: "complete" },
      timeout: "30s",
    },
  );
  if (ok(complete, "complete")) {
    check(complete, { "an SIU number": (r) => /^SIU-\d{5}$/.test(r.json("orderNumber") || "") });
    orders.add(1);
  }
}
