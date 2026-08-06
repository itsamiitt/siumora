# Registering the `settings` module

This module is complete but **not registered** — `medusa-config.ts` is owned
elsewhere. Everything the config owner needs is below, verbatim.

## 1. medusa-config.ts snippet

Add this entry to the existing `modules: []` array in
`apps/medusa/medusa-config.ts`:

```ts
{
  // Runtime settings (design doc M2: kill-switch + COD caps): the Fastify
  // settings table as a module-owned key/value store. Defaults live in
  // code (src/modules/settings/settings.ts), so an empty table means
  // "payments enabled, launch COD caps".
  resolve: "./src/modules/settings",
},
```

## 2. Migration

`pnpm db:migrate` (in `apps/medusa`) after registering picks up
`migrations/Migration20260731150000.ts`, which creates `siumora_settings`
(`key` text primary key, `value` jsonb, timestamps). The SQL is idempotent
(`create table if not exists`), so a table applied ahead of registration is
absorbed, not fought.

The migration is hand-written and this module has **no MikroORM snapshot** —
do not run `medusa db:generate` against it (it would propose the table a
second time); write further migrations by hand in `migrations/`.

The migration seeds **no rows**, deliberately: defaults are code
(`SETTING_DEFAULTS` — `payments_enabled: true`, `cod_max_order: 500000`,
`cod_fee: 4900`, `cod_min_order: 49900`, mirroring
`packages/db/src/settings-repository.ts`). A row exists only once an
operator has moved a lever; a malformed stored value degrades to the
default at read, never crashes.

## 3. Environment variables

| Variable | Purpose |
| --- | --- |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Presence of **both** makes `/store/siumora/config` report `razorpayConfigured: true` — the same condition under which the Fastify boot builds its payment client. No client is built here; that is the M3 Razorpay provider port. |

## 4. Endpoints (what the SDK transport calls)

### GET /store/siumora/config

(Standard `x-publishable-api-key` header, like every /store route.)

- `200 {"paymentsEnabled":true,"razorpayConfigured":false}` — exactly these
  two keys (the recorded contract: sdk-contract.test.ts `assertExactKeys
  ["paymentsEnabled","razorpayConfigured"]`).
- `Cache-Control: no-store` — a kill-switch behind a cache TTL is not a
  kill-switch.

This is the target for `MedusaClient.getStoreConfig()`
(packages/sdk/src/medusa.ts), which currently throws NotPortedError.

## 5. Parity notes for reviewers

Ported from apps/api/src/routes/settings.ts + lib/settings.ts +
packages/db/src/settings-repository.ts: the dumb key/value table with the
typed registry/defaults/validation in code; stored rows merged over defaults
with malformed values ignored; the 30-second in-process TTL cache
(`SETTINGS_TTL_MS`, with `invalidate()` for the future write path); the
`/config` envelope and its no-store header.

Not ported (M2 ops routes): the owner-only `GET/PATCH /admin/settings` write
surface and its audit trail. Until it lands, a kill-switch flip on this
stack is an SQL write to `siumora_settings` (visible within the 30s TTL).
