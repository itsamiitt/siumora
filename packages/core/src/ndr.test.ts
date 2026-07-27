import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_DELIVERY_ATTEMPTS,
  escalation,
  isRefusal,
  ndrState,
  needsAddressFix,
  outcomeFor,
} from "./ndr.ts";

test("counts down the attempts a courier will still make", () => {
  assert.equal(ndrState(1, "customer_unavailable").attemptsRemaining, 2);
  assert.equal(ndrState(2, "customer_unavailable").attemptsRemaining, 1);
  assert.equal(ndrState(3, "customer_unavailable").attemptsRemaining, 0);
});

test("never reports negative attempts remaining", () => {
  // A courier that overshoots must not produce "-1 attempts left".
  const state = ndrState(9, "customer_unavailable");
  assert.equal(state.attemptsRemaining, 0);
  assert.equal(state.exhausted, true);
});

test("stops offering recovery once attempts are exhausted", () => {
  const state = ndrState(MAX_DELIVERY_ATTEMPTS, "customer_unavailable");
  assert.equal(state.recoverable, false);
  assert.deepEqual(state.suggestedActions, ["cancel"]);
});

test("leads with fixing the address when that is what failed", () => {
  // Re-sending to the same wrong address burns an attempt and teaches the
  // customer that replying is pointless.
  const state = ndrState(1, "address_incomplete");
  assert.equal(state.suggestedActions[0], "update_address");
  assert.ok(needsAddressFix("address_incomplete"));
  assert.ok(!needsAddressFix("customer_unavailable"));
});

test("leads with another attempt when the address is fine", () => {
  assert.equal(ndrState(1, "customer_unavailable").suggestedActions[0], "reattempt");
});

test("does not chase a customer who refused the parcel", () => {
  // A refusal is a decision, not a missed call.
  const state = ndrState(1, "customer_refused");
  assert.equal(state.recoverable, false);
  assert.deepEqual(state.suggestedActions, ["cancel"]);
  assert.ok(isRefusal("customer_refused"));
});

test("sends a refusal or an exhausted parcel back to origin", () => {
  assert.equal(outcomeFor(1, "customer_refused"), "rto");
  assert.equal(outcomeFor(MAX_DELIVERY_ATTEMPTS, "customer_unavailable"), "rto");
});

test("keeps a recoverable delivery in NDR rather than returning it", () => {
  assert.equal(outcomeFor(1, "customer_unavailable"), "ndr");
  assert.equal(outcomeFor(2, "phone_unreachable"), "ndr");
});

test("escalates to a call on the last attempt", () => {
  // After the final attempt the freight is spent either way, so it is worth
  // more than another message.
  assert.equal(escalation(0), "message");
  assert.equal(escalation(1), "message");
  assert.equal(escalation(2), "message_and_call");
});

test("always offers cancel", () => {
  for (const attempts of [0, 1, 2, 3]) {
    assert.ok(
      ndrState(attempts, "customer_unavailable").suggestedActions.includes("cancel"),
    );
  }
});
