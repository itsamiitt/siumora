import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { isUniqueViolation } from "./data.ts";
import {
  NDR_ACTIONS,
  NDR_REASONS,
  RETURN_REASONS,
  RETURN_RESOLUTIONS,
  SIMULATION_REFUSAL,
  WALKABLE_STATUSES,
  courierSimulationEnabled,
  decideAdvance,
  decideConfirm,
  decideNdrAnswer,
  decideReturn,
  initialSiumoraStatus,
  orderEnvelope,
  parseNdrBody,
  parseReturnBody,
  parseStatusBody,
  returnEnvelope,
  type OrderStatus,
  type ReturnRow,
} from "./lifecycle.ts";

// Dynamic on purpose: this app typechecks as CJS and core's static surface
// is ESM; a dynamic import is legal from both worlds. These pins are what
// keep this module's vocabulary and decisions honest against core — drift
// fails here, loudly. (Same convention as siumora-order/identity.test.ts.)
const corePromise = import("@siumora/core");

// ── Vocabulary pins against @siumora/core ─────────────────────

test("the walkable vocabulary is core's, minus the two pre-placement statuses", async () => {
  const core = await corePromise;
  assert.deepEqual(
    [...WALKABLE_STATUSES],
    core.ORDER_STATUSES.filter(
      (status) => status !== "pending_payment" && status !== "awaiting_cod_confirmation",
    ),
  );
});

test("the NDR and return vocabularies are core's", async () => {
  const core = await corePromise;
  assert.deepEqual([...NDR_REASONS].sort(), Object.keys(core.NDR_REASON_LABELS).sort());
  assert.deepEqual(
    [...RETURN_REASONS].sort(),
    Object.keys(core.RETURN_REASON_LABELS).sort(),
  );
  assert.deepEqual([...RETURN_RESOLUTIONS], ["refund", "exchange"]);
  assert.deepEqual([...NDR_ACTIONS], ["reattempt", "update_address", "cancel"]);
});

// ── Transition legality: decideAdvance agrees with core ───────

test("decideAdvance agrees with core's canTransition across the whole matrix", async () => {
  const core = await corePromise;
  for (const from of core.ORDER_STATUSES) {
    for (const to of WALKABLE_STATUSES) {
      const decision = decideAdvance(from, to, 0, undefined, null);
      assert.equal(
        decision.ok,
        core.canTransition(from, to),
        `${from} -> ${to}`,
      );
      if (!decision.ok) {
        assert.equal(decision.code, 409);
        assert.equal(decision.error, "illegal_transition");
        assert.equal(decision.message, `Cannot move from ${from} to ${to}.`);
      }
    }
  }
});

test("the courier walk lands every stop, attempts untouched", () => {
  let from: OrderStatus = "confirmed";
  for (const to of ["processing", "shipped", "out_for_delivery", "delivered"] as const) {
    const decision = decideAdvance(from, to, 0, undefined, null);
    assert.ok(decision.ok, `${from} -> ${to}`);
    assert.equal(decision.status, to);
    assert.equal(decision.deliveryAttempts, 0);
    assert.equal(decision.recordNdr, false);
    from = to;
  }
});

// ── Confirm: the contract-pinned 409 arm ──────────────────────

test("confirming a confirmed order is the pinned 409 illegal_transition", () => {
  const decision = decideConfirm("confirmed");
  assert.ok(!decision.ok);
  assert.equal(decision.code, 409);
  assert.equal(decision.error, "illegal_transition");
  // Fastify's exact wording (apps/api/src/routes/orders.ts).
  assert.equal(decision.message, "Cannot confirm an order that is confirmed.");
});

test("decideConfirm agrees with core for every current status", async () => {
  const core = await corePromise;
  for (const current of core.ORDER_STATUSES) {
    assert.equal(
      decideConfirm(current).ok,
      core.canTransition(current, "confirmed"),
      current,
    );
  }
});

// ── NDR: attempts, collapse to rto, the customer's answer ─────

test("a recoverable failed attempt parks the order in ndr and counts it", () => {
  const decision = decideAdvance("out_for_delivery", "ndr", 0, "customer_unavailable", null);
  assert.ok(decision.ok);
  assert.equal(decision.status, "ndr");
  assert.equal(decision.deliveryAttempts, 1);
  assert.equal(decision.ndrReason, "customer_unavailable");
  assert.equal(decision.recordNdr, true);
});

test("the third failed attempt collapses straight to rto", () => {
  const decision = decideAdvance("out_for_delivery", "ndr", 2, "customer_unavailable", null);
  assert.ok(decision.ok);
  assert.equal(decision.status, "rto");
  assert.equal(decision.deliveryAttempts, 3);
  assert.equal(decision.recordNdr, true);
});

test("a refused parcel goes to rto on the first attempt", () => {
  const decision = decideAdvance("out_for_delivery", "ndr", 0, "customer_refused", null);
  assert.ok(decision.ok);
  assert.equal(decision.status, "rto");
  assert.equal(decision.deliveryAttempts, 1);
});

test("an ndr without a requested reason falls back to the stored one", () => {
  const decision = decideAdvance("shipped", "ndr", 0, undefined, "premises_closed");
  assert.ok(decision.ok);
  assert.equal(decision.ndrReason, "premises_closed");
});

test("only an order in ndr can be answered", () => {
  for (const current of ["confirmed", "delivered", "out_for_delivery", "rto"]) {
    const decision = decideNdrAnswer(current, "reattempt", 1, "customer_unavailable");
    assert.ok(!decision.ok);
    assert.equal(decision.code, 409);
    assert.equal(decision.error, "not_awaiting_answer");
    assert.equal(decision.message, "This order is not in NDR.");
  }
});

test("cancel is always available from ndr", () => {
  const decision = decideNdrAnswer("ndr", "cancel", 3, "customer_refused");
  assert.ok(decision.ok);
  assert.equal(decision.target, "cancelled");
});

test("a recoverable answer goes back out for delivery", () => {
  for (const action of ["reattempt", "update_address"] as const) {
    const decision = decideNdrAnswer("ndr", action, 1, "customer_unavailable");
    assert.ok(decision.ok, action);
    assert.equal(decision.target, "out_for_delivery");
  }
});

test("exhausted attempts and refusals are not recoverable", () => {
  for (const [attempts, reason] of [
    [3, "customer_unavailable"],
    [1, "customer_refused"],
  ] as const) {
    const decision = decideNdrAnswer("ndr", "reattempt", attempts, reason);
    assert.ok(!decision.ok);
    assert.equal(decision.code, 409);
    assert.equal(decision.error, "not_recoverable");
    assert.equal(decision.message, "The courier cannot attempt this delivery again.");
  }
});

// ── Returns: the published policy, via core's evaluateReturn ──

const DELIVERED_NOW = {
  orderStatus: "delivered" as OrderStatus,
  deliveredAt: new Date("2026-07-30T10:00:00Z"),
  now: new Date("2026-07-31T10:00:00Z"),
  paymentMethod: "cod" as const,
};
const PIERCED = [{ variantId: "variant_1", piercedJewellery: true }];
const PLAIN = [{ variantId: "variant_1", piercedJewellery: false }];

test("pierced jewellery with a broken seal is refused on change-of-mind", () => {
  const decision = decideReturn({
    ...DELIVERED_NOW,
    lines: PIERCED,
    body: {
      variantIds: ["variant_1"],
      reason: "changed_mind",
      resolution: "refund",
      sealIntact: false,
    },
  });
  assert.ok(!decision.ok);
  assert.equal(decision.code, 409);
  assert.equal(decision.error, "not_eligible");
  assert.match(decision.message, /hygiene/i);
});

test("a damaged pierced piece comes back regardless of the seal, shipping on us", () => {
  // Mirrors api.test.ts: a broken seal must not dodge a defect.
  const decision = decideReturn({
    ...DELIVERED_NOW,
    lines: PIERCED,
    body: {
      variantIds: ["variant_1"],
      reason: "damaged",
      resolution: "refund",
      sealIntact: false,
    },
  });
  assert.ok(decision.ok);
  assert.equal(decision.insert.status, "approved");
  assert.equal(decision.insert.freeReturnShipping, true);
});

test("an undelivered order cannot be returned", () => {
  const decision = decideReturn({
    ...DELIVERED_NOW,
    orderStatus: "out_for_delivery",
    lines: PLAIN,
    body: { variantIds: ["variant_1"], reason: "changed_mind", resolution: "refund" },
  });
  assert.ok(!decision.ok);
  assert.equal(decision.error, "not_eligible");
});

test("the window closes after core's RETURN_WINDOW_DAYS", async () => {
  const core = await corePromise;
  const decision = decideReturn({
    ...DELIVERED_NOW,
    deliveredAt: new Date("2026-07-01T10:00:00Z"),
    now: new Date(
      new Date("2026-07-01T10:00:00Z").getTime() +
        (core.RETURN_WINDOW_DAYS + 1) * 86_400_000,
    ),
    lines: PLAIN,
    body: { variantIds: ["variant_1"], reason: "changed_mind", resolution: "refund" },
  });
  assert.ok(!decision.ok);
  assert.equal(decision.error, "not_eligible");
});

test("pieces not on the order are a 400, not a policy refusal", () => {
  const decision = decideReturn({
    ...DELIVERED_NOW,
    lines: PLAIN,
    body: { variantIds: ["variant_other"], reason: "changed_mind", resolution: "refund" },
  });
  assert.ok(!decision.ok);
  assert.equal(decision.code, 400);
  assert.equal(decision.error, "not_on_order");
  assert.equal(decision.message, "Those pieces are not on this order.");
});

test("COD refunds route to UPI, faults pay their own freight home", () => {
  const decision = decideReturn({
    ...DELIVERED_NOW,
    lines: PLAIN,
    body: { variantIds: ["variant_1"], reason: "wrong_item", resolution: "refund" },
  });
  assert.ok(decision.ok);
  assert.equal(decision.insert.refundTo, "upi");
  assert.equal(decision.insert.freeReturnShipping, true);

  const changedMind = decideReturn({
    ...DELIVERED_NOW,
    lines: PLAIN,
    body: { variantIds: ["variant_1"], reason: "changed_mind", resolution: "refund" },
  });
  assert.ok(changedMind.ok);
  assert.equal(changedMind.insert.freeReturnShipping, false);
});

// ── One open return per order: the constraint is the database's ──

test("the migration carries the Fastify one-open-per-order disposition", async () => {
  // The rule is a partial unique index, not an application check. Pin this
  // module's migration to the Fastify schema's predicate, read from both
  // files so drift on either side fails here. Paths are cwd-relative
  // (import.meta is unavailable to this CJS-typechecked file): the test
  // script runs from apps/medusa, like every test in this app.
  const migration = await readFile(
    resolve("src/modules/returns-ndr/migrations/Migration20260731140000.ts"),
    "utf8",
  );
  const fastify = await readFile(
    resolve("../../packages/db/src/migrate.ts"),
    "utf8",
  );
  assert.match(fastify, /returns_one_open_per_order/);
  assert.match(fastify, /WHERE status <> 'rejected'/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS "IDX_siumora_returns_one_open_per_order" ON "siumora_return_requests" \("order_id"\) WHERE status <> 'rejected'/,
  );
  // And the lazy status insert's ON CONFLICT arbiter exists.
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS "IDX_siumora_order_status_order_id_unique" ON "siumora_order_status" \("order_id"\) WHERE deleted_at IS NULL/,
  );
});

test("a 23505 is the unique-violation the insert maps to already_open", () => {
  assert.equal(isUniqueViolation({ code: "23505" }), true);
  assert.equal(isUniqueViolation({ code: "23503" }), false);
  assert.equal(isUniqueViolation(new Error("boom")), false);
  assert.equal(isUniqueViolation(null), false);
});

// ── Courier-simulation gating (env semantics of apps/api/src/server.ts) ──

test("the simulation is on in development unless switched off", () => {
  assert.equal(courierSimulationEnabled({}), true);
  assert.equal(courierSimulationEnabled({ APP_ENV: "development" }), true);
  assert.equal(courierSimulationEnabled({ COURIER_SIMULATION: "true" }), true);
  assert.equal(courierSimulationEnabled({ COURIER_SIMULATION: "false" }), false);
  assert.equal(courierSimulationEnabled({ COURIER_SIMULATION: "1" }), false);
});

test("staging permits the simulation, mirroring the Fastify env tests", () => {
  assert.equal(courierSimulationEnabled({ APP_ENV: "staging" }), true);
  assert.equal(
    courierSimulationEnabled({ APP_ENV: "staging", COURIER_SIMULATION: "true" }),
    true,
  );
});

test("production is hard-off, even against an explicit true", () => {
  assert.equal(courierSimulationEnabled({ APP_ENV: "production" }), false);
  assert.equal(
    courierSimulationEnabled({ APP_ENV: "production", COURIER_SIMULATION: "true" }),
    false,
  );
});

test("the 403 wording is Fastify's", () => {
  assert.equal(SIMULATION_REFUSAL.code, 403);
  assert.equal(SIMULATION_REFUSAL.error, "not_an_operator");
  assert.equal(
    SIMULATION_REFUSAL.message,
    "Only the courier or an operator can move this order.",
  );
});

// ── Lazy-init seed mapping ────────────────────────────────────

test("the lazy status row seeds confirmed-unless-cancelled, like the sibling read", () => {
  assert.equal(initialSiumoraStatus("pending"), "confirmed");
  assert.equal(initialSiumoraStatus("completed"), "confirmed");
  assert.equal(initialSiumoraStatus("canceled"), "cancelled");
});

// ── Body parsing ──────────────────────────────────────────────

test("parseStatusBody accepts the walk and refuses the vocabulary's edges", () => {
  assert.ok(parseStatusBody({ status: "delivered" }).ok);
  assert.ok(parseStatusBody({ status: "ndr", ndrReason: "premises_closed" }).ok);
  assert.ok(!parseStatusBody({ status: "pending_payment" }).ok);
  assert.ok(!parseStatusBody({ status: "teleported" }).ok);
  assert.ok(!parseStatusBody({ status: "ndr", ndrReason: "aliens" }).ok);
  assert.ok(!parseStatusBody(null).ok);
  assert.ok(!parseStatusBody("delivered").ok);
});

test("parseNdrBody accepts only the three actions", () => {
  assert.ok(parseNdrBody({ action: "reattempt" }).ok);
  assert.ok(parseNdrBody({ action: "cancel" }).ok);
  assert.ok(!parseNdrBody({ action: "shout" }).ok);
  assert.ok(!parseNdrBody({}).ok);
});

test("parseReturnBody mirrors the Fastify schema, minus the uuid shape", () => {
  assert.ok(
    parseReturnBody({
      variantIds: ["variant_01ABC"],
      reason: "size_or_fit",
      resolution: "refund",
      sealIntact: true,
      note: "ring too small",
    }).ok,
  );
  assert.ok(!parseReturnBody({ variantIds: [], reason: "quality", resolution: "refund" }).ok);
  assert.ok(!parseReturnBody({ variantIds: ["v"], reason: "meh", resolution: "refund" }).ok);
  assert.ok(!parseReturnBody({ variantIds: ["v"], reason: "quality", resolution: "store_credit" }).ok);
  assert.ok(!parseReturnBody({ variantIds: ["v"], reason: "quality", resolution: "refund", sealIntact: "yes" }).ok);
  assert.ok(
    !parseReturnBody({
      variantIds: ["v"],
      reason: "quality",
      resolution: "refund",
      note: "x".repeat(1001),
    }).ok,
  );
});

// ── Envelopes: the recorded contract's exact keys ─────────────

test("orderEnvelope is {ok, order} with at least number and status", () => {
  const envelope = orderEnvelope("SIU-00042", "delivered", 0, null);
  assert.deepEqual(Object.keys(envelope).sort(), ["ok", "order"]);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.order.number, "SIU-00042");
  assert.equal(envelope.order.status, "delivered");
  assert.equal(envelope.order.deliveryAttempts, 0);
  assert.equal(envelope.order.ndrReason, null);
});

test("returnEnvelope carries exactly {ok, return, reversePickup}, pickup null until M3", () => {
  const row: ReturnRow = {
    id: "siret_x",
    order_id: "order_x",
    status: "approved",
    reason: "size_or_fit",
    resolution: "refund",
    variant_ids: ["variant_1"],
    refund_to: "upi",
    free_return_shipping: false,
    seal_intact: true,
    note: null,
    created_at: new Date(),
  };
  const envelope = returnEnvelope(row);
  assert.deepEqual(Object.keys(envelope).sort(), ["ok", "return", "reversePickup"].sort());
  assert.equal(envelope.ok, true);
  assert.equal(envelope.reversePickup, null);
  assert.equal(envelope.return.status, "approved");
  assert.equal(envelope.return.refundTo, "upi");
  assert.equal(envelope.return.freeReturnShipping, false);
  assert.deepEqual(envelope.return.variantIds, ["variant_1"]);
});
