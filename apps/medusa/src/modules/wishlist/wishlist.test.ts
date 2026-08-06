import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isWellFormedWishlistId,
  toggleWishlist,
  type WishlistStore,
} from "./wishlist.ts";

// ── The uuid arm: 400 material vs a real lookup ───────────────

test("a real uuid is well-formed — it earns a lookup, never a 400", () => {
  assert.equal(isWellFormedWishlistId(crypto.randomUUID()), true);
  assert.equal(
    isWellFormedWishlistId("A9C3B1E2-4F5D-4a6b-9c8d-112233445566"),
    true,
  );
});

test("malformed wishlist ids are refused as 400 material", () => {
  for (const bad of [
    "not-a-uuid",
    "",
    "1234",
    "a9c3b1e2-4f5d-4a6b-9c8d-11223344556", // one hex short
    "a9c3b1e2-4f5d-4a6b-zc8d-112233445566", // z is not hex
    "a9c3b1e24f5d4a6b9c8d112233445566", // no dashes
  ]) {
    assert.equal(isWellFormedWishlistId(bad), false, bad);
  }
});

// ── The toggle: on, off, and the count ────────────────────────

/**
 * In-memory WishlistStore with the same contract the pg store keeps:
 * idempotent add (the ON CONFLICT), hard remove, oldest-save-first reads.
 * Running the real toggleWishlist against it proves the decision logic
 * without a database; the pg store itself is exercised end-to-end against
 * the booted app.
 */
function memoryStore(): WishlistStore {
  const rows: Array<{ wishlistId: string; handle: string }> = [];
  const at = (wishlistId: string, handle: string) =>
    rows.findIndex((row) => row.wishlistId === wishlistId && row.handle === handle);
  return {
    async has(wishlistId, handle) {
      return at(wishlistId, handle) !== -1;
    },
    async add(wishlistId, handle) {
      if (at(wishlistId, handle) === -1) rows.push({ wishlistId, handle });
    },
    async remove(wishlistId, handle) {
      const index = at(wishlistId, handle);
      if (index !== -1) rows.splice(index, 1);
    },
    async handles(wishlistId) {
      return rows
        .filter((row) => row.wishlistId === wishlistId)
        .map((row) => row.handle);
    },
  };
}

const LIST = "0b2a4e88-1111-4222-8333-444455556666";

test("first toggle saves: wishlisted true, count 1", async () => {
  const store = memoryStore();
  const result = await toggleWishlist(store, LIST, "petal-studs");
  assert.deepEqual(result, { wishlisted: true, count: 1 });
  assert.deepEqual(await store.handles(LIST), ["petal-studs"]);
});

test("second toggle of the same handle removes: wishlisted false, count 0", async () => {
  const store = memoryStore();
  await toggleWishlist(store, LIST, "petal-studs");
  const result = await toggleWishlist(store, LIST, "petal-studs");
  assert.deepEqual(result, { wishlisted: false, count: 0 });
  assert.deepEqual(await store.handles(LIST), []);
});

test("the count is the whole list, not the toggled handle", async () => {
  const store = memoryStore();
  await toggleWishlist(store, LIST, "petal-studs");
  const second = await toggleWishlist(store, LIST, "jaali-hoops");
  assert.deepEqual(second, { wishlisted: true, count: 2 });

  // Removing one leaves the other, and says so in the count.
  const removed = await toggleWishlist(store, LIST, "petal-studs");
  assert.deepEqual(removed, { wishlisted: false, count: 1 });
  assert.deepEqual(await store.handles(LIST), ["jaali-hoops"]);
});

test("wishlists are isolated by id", async () => {
  const store = memoryStore();
  const other = "1c3b5d77-2222-4333-9444-555566667777";
  await toggleWishlist(store, LIST, "petal-studs");
  const result = await toggleWishlist(store, other, "petal-studs");
  // Same handle, different list: a fresh save with its own count.
  assert.deepEqual(result, { wishlisted: true, count: 1 });
});

test("toggle envelope carries exactly the recorded contract keys", async () => {
  // sdk-contract.test.ts pins assertExactKeys ["wishlisted", "count"].
  const result = await toggleWishlist(memoryStore(), LIST, "petal-studs");
  assert.deepEqual(Object.keys(result).sort(), ["count", "wishlisted"]);
});
