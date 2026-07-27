import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { DEFAULT_CONSENT, consentFromChoice } from "./consent.ts";
import type { EventPayload } from "./events.ts";

/**
 * The client adapter holds module state, so each test re-imports it with a
 * cache-busting query to get a clean instance.
 */
async function freshClient() {
  const mod = await import(`./client.ts?t=${Math.random()}`);
  return mod as typeof import("./client.ts");
}

function stubWindow() {
  const fbqCalls: unknown[][] = [];
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = {
    dataLayer: [] as unknown[],
    fbq: (...args: unknown[]) => fbqCalls.push(args),
  };
  return {
    dataLayer: () => (g.window as { dataLayer: Array<{ event: string }> }).dataLayer,
    fbqCalls,
  };
}

const viewItem: EventPayload<"view_item"> = {
  event_id: "evt_view",
  currency: "INR",
  value: 1990,
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

beforeEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).window;
});

test("holds events fired before the banner is answered", async () => {
  const w = stubWindow();
  const client = await freshClient();

  client.setConsent(DEFAULT_CONSENT, { decided: false });
  client.track("view_item", viewItem);

  // Nothing sent yet — but not lost either.
  assert.equal(w.dataLayer().length, 0);
});

test("replays held events once consent is granted", async () => {
  const w = stubWindow();
  const client = await freshClient();

  client.setConsent(DEFAULT_CONSENT, { decided: false });
  client.track("view_item", viewItem);

  client.setConsent(
    consentFromChoice({ analytics: true, ads: true, personalisation: true }),
  );

  // Without the replay, the first page view of every new visitor is invisible.
  assert.deepEqual(
    w.dataLayer().map((e) => e.event),
    ["view_item"],
  );
});

test("drops held events when consent is refused", async () => {
  const w = stubWindow();
  const client = await freshClient();

  client.setConsent(DEFAULT_CONSENT, { decided: false });
  client.track("view_item", viewItem);

  client.setConsent(
    consentFromChoice({ analytics: false, ads: false, personalisation: false }),
  );

  assert.equal(w.dataLayer().length, 0);
});

test("sends the same event id to the pixel for dedup", async () => {
  const w = stubWindow();
  const client = await freshClient();

  client.setConsent(
    consentFromChoice({ analytics: true, ads: true, personalisation: true }),
  );
  client.track("add_to_cart", { ...viewItem, event_id: "evt_add" } as EventPayload<"add_to_cart">);

  const call = w.fbqCalls.find((c) => c[1] === "AddToCart");
  assert.ok(call, "no AddToCart pixel call");
  assert.deepEqual(call[3], { eventID: "evt_add" });
});

test("refuses to send server-only events from the browser", async () => {
  const w = stubWindow();
  const client = await freshClient();

  client.setConsent(
    consentFromChoice({ analytics: true, ads: true, personalisation: true }),
  );
  client.track("refund", { ...viewItem, transaction_id: "SIU-1", tax: 0, shipping: 0 } as EventPayload<"refund">);

  // A browser-sent refund would be trivially forgeable.
  assert.equal(w.dataLayer().length, 0);
});

test("rejects a malformed payload instead of sending a bad row", async () => {
  const w = stubWindow();
  const client = await freshClient();

  client.setConsent(
    consentFromChoice({ analytics: true, ads: true, personalisation: true }),
  );
  client.track("view_item", { event_id: "e", items: [], value: -1 } as never);

  assert.equal(w.dataLayer().length, 0);
});
