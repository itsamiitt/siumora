# Registering the `remittance` module

Registered in `medusa-config.ts` as part of the M2 wave-B ops surface. This
file records what the config owner needs to know.

## 1. medusa-config.ts snippet

```ts
{
  // COD remittance desk (M2 wave B): the Fastify cod_remittances ledger as
  // a module-owned table. Arithmetic is core's (reconcileRemittance,
  // cashPosition, overDeducted); this module owns the ledger and its
  // idempotent ingest.
  resolve: "./src/modules/remittance",
},
```

## 2. Migration

`pnpm db:migrate` picks up `migrations/Migration20260826091000.ts`, which
creates `siumora_cod_remittances` mirroring the Fastify `cod_remittances`
columns, plus the **unique index on (batch_id, order_number)** — the
idempotency guarantee: a courier resending yesterday's file books nothing
twice; the replay returns the same outcomes with `recorded: 0`. Idempotent
DDL, hand-written, **no MikroORM snapshot** — write further migrations by
hand.

## 3. Semantics

- `ingestRemittanceBatch` takes the caller-assembled `ExpectedOrder[]`
  (from `src/lib/domain-orders.ts` — SIU identity + status row + computed
  paise totals) so "what the shop believes" is the same order truth every
  desk uses. Rows settled by a *different* batch mark an order
  already-reconciled (`settledElsewhere`); the batch being ingested is
  excluded so replays stay honest.
- Reports: `remittanceBatches` (one line per batch), 
  `openRemittanceExceptions` (worst first, reconciler's severity order),
  `remittanceLedger` (one batch's rows), `reconciledOrderNumbers` (for the
  cash position — an order is "remitted" only when a settled row exists).

## 4. Endpoints

- `POST /admin/siumora/remittances` (`remittance:write`) — ingest, audited.
- `GET /admin/siumora/remittances` — `{ batches, exceptions, cash[, ledger] }`.
- `GET /admin/siumora/cash-position` — core `cashPosition` over the shop's
  orders joined to settled remittance rows.

Targets for `SiumoraClient.getRemittanceReport()`.
