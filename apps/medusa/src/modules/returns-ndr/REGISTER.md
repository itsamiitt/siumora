# Registering the `returns-ndr` module

This module is complete but **not registered** — `medusa-config.ts` is owned
elsewhere. Everything the config owner needs is below, verbatim.

## 1. medusa-config.ts snippet

Add this entry to the existing `modules: []` array in
`apps/medusa/medusa-config.ts`:

```ts
// Returns + NDR (design doc M2 · returns-ndr): the Siumora order status
// machine, return requests and NDR events as module-owned tables. The
// status table is the storefront's status truth until real couriers land
// in M3; transitions are validated by @siumora/core's canTransition and
// courier moves are gated by COURIER_SIMULATION exactly as the Fastify
// dev stack gates them.
{ resolve: "./src/modules/returns-ndr" },
```

## 2. Migration

```bash
pnpm --filter @siumora/medusa db:migrate
```

Creates `siumora_order_status`, `siumora_return_requests` (with the
one-open-per-order partial unique index copied from the Fastify schema) and
`siumora_ndr_events`. Every statement is `IF NOT EXISTS`-guarded, so a
database where a verification pass already created the tables converges
cleanly.

Note: no MikroORM snapshot ships with this migration (generating one needs
the module registered, i.e. this file's step 1). If you later run
`npx medusa db:generate returnsNdr`, the regenerated migration will overlap
this one; the guards make that safe, but prefer diffing before committing a
generated file.

## 3. Environment variables

| Variable | Purpose |
| --- | --- |
| `COURIER_SIMULATION` | `"true"` (or unset, outside production) lets non-operators drive courier transitions on `POST …/status` — same env semantics as `apps/api/src/server.ts`. Anything else switches the gate off and the route answers 403 `not_an_operator`. |
| `APP_ENV` | Already part of the boot guards. The simulation helper is hard-off when `APP_ENV=production` regardless of `COURIER_SIMULATION`. |

**Recommended for the boot-guards owner:** the Fastify stack *refuses to
boot* with an explicit `COURIER_SIMULATION=true` in production
(`assertBootSafety`). `src/boot-guards.ts` is owned elsewhere; until it
grows the same refusal, this module's `courierSimulationEnabled` fails
closed in production (the gate is simply off), which protects the data but
silently ignores the misconfiguration instead of refusing it loudly.

## 4. Endpoints once registered (what the wave-2 transport calls)

All under the same guest-key/owner auth arms as the order read: `?key=<uuid>`
for guests (malformed key → 400 `invalid_request`; missing/wrong key or
unknown number → 404 `not_found`, never 403), Medusa customer auth_context
for owners, plus the standard `x-publishable-api-key` header. The Medusa
transport (`packages/sdk/src/medusa.ts`) maps:

- `confirmOrder` → `POST /store/siumora/orders/:number/confirm`
  — 200 `{ok, order}`; 409 `{error:"illegal_transition", message:"Cannot
  confirm an order that is <status>."}` (the contract-pinned arm: COD
  confirms at placement).
- `advanceOrder` → `POST /store/siumora/orders/:number/status` with
  `{status, ndrReason?}` — 200 `{ok, order:{number,status,deliveryAttempts,
  ndrReason}}`; 409 `illegal_transition`; 403 `not_an_operator` when the
  simulation is off.
- `answerNdr` → `POST /store/siumora/orders/:number/ndr` with
  `{action: "reattempt"|"update_address"|"cancel"}` — 200 `{ok, order}`;
  409 `not_awaiting_answer` / `not_recoverable`.
- `requestReturn` → `POST /store/siumora/orders/:number/returns` with
  `{variantIds, reason, resolution, sealIntact?, note?}` — 200
  `{ok, return, reversePickup:null}`; 409 `not_eligible` / `already_open`;
  400 `not_on_order`. `variantIds` are Medusa variant ids
  (`variant_…`), not UUIDs — the one deliberate body-schema difference from
  Fastify.

## 5. Parity notes for reviewers

Ported from the Fastify contract (apps/api/src/routes/orders.ts +
api.test.ts): core's canTransition validates every move; NDR attempts are
counted per failed attempt with core's ndrState/outcomeFor collapsing an
unrecoverable attempt straight to rto; returns run core's evaluateReturn
(delivered-only, 7-day window, 48h damage clock, hygiene seal on pierced
jewellery, COD→UPI refunds, auto-approve); one open return per order is a
partial unique index, not an application check.

Not ported (documented in the source): operator grant and audit-log entries
(M2 operator module), invoice allocation on confirm (M2 gst module),
immediate restock on cancel (Medusa inventory is Medusa's; the ops/RTO port
owns it), reverse-pickup booking (M3 Shiprocket), prepaid refund routing
(M3 Razorpay).
