# Registering the `serviceability` module

This module is complete but **not registered** — `medusa-config.ts` is owned
elsewhere. Everything the config owner needs is below, verbatim.

## 1. medusa-config.ts snippet

Add this entry to the existing `modules: []` array in
`apps/medusa/medusa-config.ts`:

```ts
{
  // Pincode serviceability (design doc M2: the cod-rto port's read side):
  // the courier serviceability table behind GET /store/siumora/pincodes/
  // :pincode and POST /store/siumora/checkout/quote, mirroring packages/db's
  // pincode_serviceability column for column.
  resolve: "./src/modules/serviceability",
},
```

## 2. Migration + seed

```bash
cd apps/medusa
npx medusa db:migrate                                  # runs the module migration
npx medusa exec ./src/scripts/seed-serviceability.ts   # converges the 5 canonical rows
```

The routes do NOT wait for registration: they read through raw SQL on the
shared pg connection (lookup.ts), and the seed script stands the table up
with the same IF-NOT-EXISTS DDL the migration carries (the two are declared
twins — evolve them together). Registration makes the module the formal
owner: `db:migrate` records the migration, and the generated service
(`listPincodeServiceabilities`, …) becomes available for the M2 ops
write-path (the weekly RTO review's dial).

If the model ever changes, regenerate the snapshot + next migration with
`npx medusa db:generate serviceability` (needs the module registered).

## 3. One middleware note for the quote route

`POST /store/siumora/checkout/quote` answers `phoneVerified: false` for every
caller until an authenticate entry lands in `src/api/middlewares.ts` (also
owned elsewhere):

```ts
{
  matcher: "/store/siumora/checkout/quote",
  middlewares: [authenticate("customer", ["bearer", "session"], { allowUnauthenticated: true })],
},
```

With that in place the route compares the signed-in customer's stored phone
against the submitted one (strict equality, the Fastify customerSignals
contract) and counts their order history into the RTO signals. Anonymous
callers keep the honest defaults either way.

## 4. Parity notes for reviewers

Ported from the Fastify contract (apps/api/src/routes/catalog.ts
`GET /pincodes/:pincode`, apps/api/src/routes/checkout.ts
`POST /checkout/quote`, pinned by apps/api/src/sdk-contract.test.ts):

- malformed pincode → 400 `invalid_request`, never a query;
- unknown pincode → `{pincode, serviceable:false, codAvailable:false,
  estimatedDays:"—", rtoRateBps:0}` (not an error);
- known pincode → the seven-key card, `Cache-Control: public, max-age=3600`;
- quote envelope → `{serviceable, estimatedDays, addressQuality{score,
  issues,needsReview}, rto{risk,score}, cod, phoneVerified}` computed by
  core's `scoreAddress`/`scoreRto`/`evaluateCod` (imported, not copied) over
  the pincode row, the cart's integer-paise subtotal, and the settings
  module's COD caps (its defaults when the table is absent — the same values
  Fastify defaults to).
