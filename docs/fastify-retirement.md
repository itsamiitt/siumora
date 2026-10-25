# Retiring Fastify (plan 16 Phase J)

This covers B32 and B33 in `plan/16-cart-checkout-experience.md`. Medusa is now the default everywhere: the storefront (`COMMERCE_BACKEND`), the worker (`OUTBOX_BACKEND`) and the browser suite (`E2E_BACKEND`). Fastify (`apps/api`, `packages/db`) is still on disk and still selectable by name. It is a rollback target until the launch gate below passes.

`node scripts/retire-fastify.mjs` lists everything that still needs Fastify. It changes nothing. `--apply` deletes `apps/api` and `packages/db` only when that list is empty and the git tree is clean, so the deletion lands as its own commit.

## 1. Launch gate (must pass before any deletion)

None of these has run yet. Each needs real infrastructure.

- [ ] `pnpm --filter @siumora/medusa db:migrate` and both seeds against the production-shaped database. New migrations since the last run:
  - returns-ndr: `Migration20261025120000` (shipments) and `Migration20261025150000` (payout and restock)
  - outbox: `Migration20261025140000` and `Migration20261026100000` (cart reminders)
- [ ] The **E2E (medusa)** CI job is green. It is `continue-on-error` until then. After the first green run, remove that line.
- [ ] Money invariant, by hand, on a test order with a coupon, for COD and for prepaid. These must all be equal:
  - the quote total
  - the Pay label
  - the Razorpay amount
  - the order total
  - the invoice total
- [ ] Razorpay test keys: a paid order, a `paid_not_placed` refund, and the recon job picking up a missed webhook.
- [ ] Shiprocket test account:
  - a booking
  - the tracking webhook moving an order
  - confirming the plan includes push webhooks
- [ ] Worker on the Medusa outbox with real WhatsApp/SMS, GA4 and Meta credentials. Check:
  - one order message
  - one purchase conversion
  - one delivery receipt
  - one cart reminder, held through quiet hours
- [ ] Admin pass in a browser:
  - order card: payout, restock, gift message
  - privacy queue
  - remittance upload
  - Store › Checkout switches
- [ ] B33: the KYC site review on the Medusa stack, in COD-only or "payments coming soon" mode.

## 2. Code edits (make `retire-fastify.mjs` report nothing)

| Where | Edit |
|---|---|
| `.github/workflows/ci.yml` | Delete the `check` job's Fastify steps: `@siumora/db` migrate and seed, "Start the API", and the `E2E_BACKEND: fastify` E2E. Keep typecheck and test, now without `DATABASE_URL`. Make `e2e-medusa` blocking. Merge it with the `medusa` job if the time budget allows. |
| `.env.example` | Remove `COMMERCE_BACKEND=fastify`, `API_URL`/`NEXT_PUBLIC_API_URL`, `DATABASE_URL` and the other Fastify-only blocks. |
| `apps/web/src/lib/commerce-backend.ts` (+ test) | Construct `createMedusaClient` only. Drop the `fastify` branch and the `SiumoraClient` union. The waitlist route and `coming-soon/admin` lose their Fastify branch. |
| `packages/sdk` | Fold the shared types out of the Fastify `SiumoraClient` class in `index.ts`, then delete the class, `createClient` and `paymentFlow: "order-first"`. `MedusaClient`'s `PublicSurface` becomes its own interface. |
| `apps/worker` | Replace `@siumora/db`'s `createPool` with `pg`'s `Pool` (add `pg`). Read `MEDUSA_DATABASE_URL` only. Delete `drizzleStore` and the Fastify `drain.test.ts` cases; `medusa-store.test.ts` covers the store. Drop the `@siumora/db` dependency. |
| `apps/e2e` | Delete `setup/prepare-db.ts`, the `fastify` branch in `setup/backend.ts`, `setup/prepare.ts` and `playwright.config.ts`, and the `@siumora/db` dependency. `signin.spec.ts` loses its backend skip. |
| `packages/dist-smoke` | Drop the `@siumora/db` entries. |
| `README.md`, `apps/api/README.md` | Rewrite the run instructions for Medusa only. |

Then run `node scripts/retire-fastify.mjs --apply` on a clean tree, then `pnpm install`, typecheck, test and E2E. Commit the deletion on its own.

## 3. After

- Update the Phase J row in plan 16 and the parity checklist's launch-scope table.
- Keep the last commit that still contains `apps/api` tagged (for example `pre-fastify-retirement`) as the rollback point.
