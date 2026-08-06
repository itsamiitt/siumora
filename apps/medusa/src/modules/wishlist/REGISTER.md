# Registering the `wishlist` module

This module is complete but **not registered** — `medusa-config.ts` is owned
elsewhere. Everything the config owner needs is below, verbatim.

## 1. medusa-config.ts snippet

Add this entry to the existing `modules: []` array in
`apps/medusa/medusa-config.ts`:

```ts
{
  // Wishlist (design doc M2 storefront modules): the Fastify wishlist as a
  // module-owned table, keyed by the opaque uuid the storefront keeps in
  // an HTTP-only cookie. Stores product handles — saving is an intent
  // about the piece, not a variant.
  resolve: "./src/modules/wishlist",
},
```

## 2. Migration

`pnpm db:migrate` (in `apps/medusa`) after registering picks up
`migrations/Migration20260731150100.ts`, which creates `siumora_wishlists`
(`wishlist_id` uuid, `handle` text, timestamps, composite primary key
`(wishlist_id, handle)`). The SQL is idempotent (`create table if not
exists`), so a table applied ahead of registration is absorbed, not fought.

The migration is hand-written and this module has **no MikroORM snapshot** —
do not run `medusa db:generate` against it (it would propose the table a
second time); write further migrations by hand in `migrations/`.

## 3. Endpoints (what the SDK transport calls)

(Standard `x-publishable-api-key` header, like every /store route. Both
routes sit inside the `/store/siumora` rate-limit mount that
src/api/middlewares.ts already covers.)

### GET /store/siumora/wishlists/:wishlistId

- `200 {"handles":["petal-studs", ...]}` — oldest save first. An unknown but
  well-formed id is `{"handles":[]}`, never a 404: a wishlist exists the
  moment someone saves to it.
- `400 {"error":"invalid_request","message":"wishlistId: expected a UUID"}` —
  the id is client-minted; a malformed one is the caller's bug (the Fastify
  zod arm).
- `Cache-Control: no-store`.

### POST /store/siumora/wishlists/:wishlistId/toggle

Body: `{"handle":"petal-studs"}`

- `200 {"wishlisted":true,"count":1}` — saved; toggling again answers
  `{"wishlisted":false,"count":0}`. Exactly these two keys (the recorded
  contract: sdk-contract.test.ts `assertExactKeys ["wishlisted","count"]`);
  `count` is the whole list after the toggle.
- `400` — malformed wishlist id, or missing/empty `handle`.
- `404 {"error":"not_found"}` — the handle names no catalogue product
  (checked through query.graph, the Fastify products-table check ported).

These are the targets for `MedusaClient.getWishlist()` /
`MedusaClient.toggleWishlist()` (packages/sdk/src/medusa.ts), which
currently throw NotPortedError.

## 4. Parity notes for reviewers

Ported from apps/api/src/routes/wishlist.ts: uuid-keyed anonymous lists;
products not variants; toggle semantics (present → remove, absent → insert
with ON CONFLICT DO NOTHING so a double-tap cannot 500); count re-read from
the table after the write; handle validated against the catalogue (404);
no-store on the read.

Deliberate difference: Fastify stores `product_id` and joins for the handle;
this table stores the handle itself, because module tables do not reach into
Medusa-owned tables (the siumora-order convention) and the wire format is
handles. Consequence: republishing a product under a new handle orphans old
saves on both stacks' wire, but here the row keeps its original handle
rather than following the product. Fastify's un-ordered SELECT is made
explicit as `ORDER BY created_at, handle`.
