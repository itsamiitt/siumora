import assert from "node:assert/strict";
import { test } from "node:test";

import { consentFromChoice, FULL_CONSENT } from "./consent.ts";
import { toRupees, type EventPayload } from "./events.ts";
import { buildGa4Payload, buildMetaPayload, emit } from "./server.ts";

const purchase: EventPayload<"purchase"> = {
  event_id: "evt_abc",
  transaction_id: "SIU-1001",
  value: 1990,
  currency: "INR",
  tax: 94.76,
  shipping: 0,
  items: [
    {
      item_id: "SIU-PS-GLD",
      item_name: "Petal Studs",
      price: 1990,
      quantity: 1,
      item_brand: "Siumora",
    },
  ],
};

test("converts paise to the decimal rupees the platforms expect", () => {
  // Sending paise would report this order as ₹1,99,000.
  assert.equal(toRupees(199000), 1990);
  assert.equal(toRupees(124950), 1249.5);
});

test("carries the browser event id onto the server event for dedup", async () => {
  const meta = await buildMetaPayload("purchase", purchase, {
    consent: FULL_CONSENT,
    identity: { phone: "9876543210" },
  });

  assert.equal(meta?.event_id, "evt_abc");
  assert.equal(meta?.event_name, "Purchase");
});

test("maps GA4 event names to Meta standard events", async () => {
  const addToCart = await buildMetaPayload(
    "add_to_cart",
    { ...purchase, event_id: "e1" } as EventPayload<"add_to_cart">,
    { consent: FULL_CONSENT },
  );
  assert.equal(addToCart?.event_name, "AddToCart");
});

test("returns no Meta payload for GA4-only events", async () => {
  const meta = await buildMetaPayload(
    "view_cart",
    { ...purchase, event_id: "e2" } as EventPayload<"view_cart">,
    { consent: FULL_CONSENT },
  );
  assert.equal(meta, null);
});

test("withholds identifiers when ad_user_data consent is absent", async () => {
  const consent = consentFromChoice({
    analytics: true,
    ads: false,
    personalisation: false,
  });

  const meta = await buildMetaPayload("purchase", purchase, {
    consent,
    identity: { phone: "9876543210", email: "asha@example.com" },
  });

  // The event still goes; it simply carries no user data.
  assert.ok(meta);
  assert.deepEqual(meta.user_data, {});
});

test("attaches hashed identifiers when consent allows", async () => {
  const meta = await buildMetaPayload("purchase", purchase, {
    consent: FULL_CONSENT,
    identity: { phone: "9876543210", email: "asha@example.com" },
  });

  assert.equal(meta?.user_data.ph?.length, 64);
  assert.equal(meta?.user_data.em?.length, 64);
});

test("puts the order number on the Meta payload", async () => {
  const meta = await buildMetaPayload("purchase", purchase, {
    consent: FULL_CONSENT,
  });
  assert.equal(meta?.custom_data.order_id, "SIU-1001");
  assert.equal(meta?.custom_data.value, 1990);
});

test("skips the GA4 server send without a client id", () => {
  const ga4 = buildGa4Payload("purchase", purchase, { consent: FULL_CONSENT });
  // A synthesised client id would start a phantom session.
  assert.equal(ga4, null);
});

test("builds a GA4 payload when the client id was captured", () => {
  const ga4 = buildGa4Payload("purchase", purchase, {
    consent: FULL_CONSENT,
    identity: { gaClientId: "123.456" },
  });

  assert.equal(ga4?.client_id, "123.456");
  assert.equal(ga4?.events[0]?.name, "purchase");
  assert.equal(ga4?.events[0]?.params.event_id, "evt_abc");
  assert.equal(ga4?.consent.ad_user_data, "GRANTED");
});

test("emit produces both payloads with one shared id", async () => {
  const result = await emit("purchase", purchase, {
    consent: FULL_CONSENT,
    identity: { gaClientId: "123.456", phone: "9876543210" },
    sourceUrl: "https://siumora.com/checkout",
  });

  assert.equal(result.meta?.event_id, "evt_abc");
  assert.equal(result.ga4?.events[0]?.params.event_id, "evt_abc");
  assert.equal(result.meta?.event_source_url, "https://siumora.com/checkout");
});
