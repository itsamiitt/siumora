# Ecommerce completion and data consistency

Prepared 2026-10-24 from repository inspection. Implementation started after approval; see the progress record below. No database, provider, or deployment changes have been made.

## Implementation progress — 2026-10-24

First pricing batch implemented locally:

- Catalog selling price now uses Medusa calculated_price, never legacy price_paise metadata. A missing contextual price fails explicitly instead of guessing from stale metadata.
- Cart line prices now come from persisted unit_price. Shared backend line mapping also uses persisted unit_price, protecting order/invoice selling amounts from later catalog metadata edits.
- India-fields widget edits HSN/GST/MRP only. Selling-price edits belong to native Medusa Pricing; the widget no longer writes a second selling price.
- Regression coverage exercises native price changes with conflicting metadata, missing native prices, persisted cart prices, order/invoice price stability and MRP-only editing.
- Verification: SDK suite 23 passed / 8 live tests skipped; targeted Medusa suites 40 passed; SDK and Medusa TypeScript checks passed; git diff --check passed.

Environment baseline: no app .env files discovered, no relevant backend/database environment configuration in this shell, and no listener observed on ports 3000/4000/9000. Deployed configuration and live mismatch reproduction remain unverified. No backend switch or live data migration was attempted.

This does not complete phase 1. Next pricing work: authoritative discount/shipping/tax/COD totals, publish-time native price versus MRP validation, transaction snapshots of MRP/tax metadata and a read-only live discrepancy report before migration. Existing legacy price_paise values are left intact but no longer determine selling prices in the changed readers. The catalog still rejects selling prices above configured MRP; operators must correct invalid MRP/native-price combinations. Collection membership and cache invalidation follow the pricing contract work.

## Objective and evidence limits

### Category/product consistency batch

Implemented locally after the reported mismatch on siumora.com:

- Shop category filters and desktop/mobile/footer navigation read public Medusa categories rather than fixed labels or title regular expressions. Unknown/deleted category URLs return not-found instead of silently showing all products.
- Collection membership now follows native Medusa assignment and server-side collection-ID filtering. Legacy metadata membership is deliberately ignored, including after a collection is removed.
- Product, category and collection reads paginate through the available records instead of stopping at the first page. Store API publication, sales-channel and public-category restrictions still apply; drafts/internal categories are not meant to appear publicly.
- Homepage collection imagery uses actual catalog images; product images no longer get replaced with illustrative demo assets. Removed fixed demo-collection links from shopping entry points and empty states.
- Reduced catalog revalidation to five seconds and removed the footer's days-long cache. This is time-based revalidation, not event-driven invalidation or a live push into already-open tabs.
- Verification: 27 SDK/navigation/image tests passed, eight live integrations skipped; SDK and storefront TypeScript checks passed. A separate installed-validator runtime probe did not finish and was stopped; it is not counted as passing evidence.
- Public HTTP check of siumora.com returned the coming-soon rewrite. Authenticated preview comparison and deployment remain pending server/admin connection details. No live release or backend switch has been performed.

### Verification follow-up and product detail freshness

- Broader review exercised 326 SDK, web and Medusa tests: eight live integrations skipped. One migration test initially failed because it was invoked from the repository root; rerunning its complete 32-test suite from apps/medusa passed. The other 317 tests passed on the initial run.
- SDK, web, Medusa and E2E TypeScript checks passed. Corrected the legacy Fastify browser test so it verifies that unsupported categories are not invented from product titles.
- The production build exposed a footer current-time prerender error. Moved only the copyright year into its own cache boundary; the subsequent production build passed.
- The reported stale PDP had a whole-page days-long cache. Moved the clock-dependent JSON-LD into a separate cache keyed by current product data, leaving visible product details on the catalog freshness path.
- Medusa mapping now requests the native thumbnail and material fields. The selected thumbnail leads the gallery, including thumbnail-only products; native material edits take precedence over legacy seed metadata.
- Added regression tests for thumbnail selection, native material updates and thumbnail-only images. Targeted catalog/navigation suite now has 29 passed and eight live integrations skipped. Final browser verification uses a controlled HTTP catalog and an installed Chrome browser; this is not evidence of deployment to siumora.com.
- Final production build and Chrome browser verification passed: backend category filtering, native collection page, deleted-category not-found behavior, mobile navigation, and a backend edit to PDP title/description/material/thumbnail becoming visible after reload and revalidation. Build output confirms five-second route revalidation. Restored the generated Next type reference after the isolated build; no verification server remains running.

An operator's supported changes must appear correctly in the storefront, and a customer's cart, checkout, payment, order, invoice, fulfillment, refund, and stock movements must reconcile. A working page or passing unit test alone does not establish this.

This review establishes code paths and gaps, not the exact cause of a particular live mismatch. The active deployed environment, live records, provider accounts, and current test results were not inspected. Start implementation by reproducing mismatches against the actual admin and storefront URLs. Existing roadmap/checklist completion counts are historical; re-baseline them rather than treating unchecked rows as proof that code is absent.

Use this plan for execution order and acceptance criteria. Plan 13 remains the broader UI/operations backlog; docs/track-m-pending.md remains migration context.

## Findings from current code

| Finding | Evidence | Consequence |
|---|---|---|
| Two selectable commerce backends; default is Fastify | apps/web/src/lib/commerce-backend.ts; README describes separate databases | Editing Medusa Admin cannot update a storefront reading Fastify. Actual environment mismatch is still to be verified. |
| Selling price prefers variant metadata.price_paise over calculated_price | packages/sdk/src/medusa.ts: variantPrice | Native pricing edits/promotions can disagree with storefront prices when metadata remains populated. |
| India-fields widget writes metadata prices, not native prices | apps/medusa/src/admin/widgets/india-fields.tsx: save | Two independently editable prices exist. Updating one is insufficient. |
| Cart display uses variant-derived prices and reconstructed totals | packages/sdk/src/medusa.ts: mapCartLine/getCart | Native line prices, discounts, shipping, and rendered totals require explicit reconciliation; display is not simply the native cart quote. |
| Collection filtering uses product.metadata.collections | packages/sdk/src/medusa.ts: mapProduct/listProducts | Native collection assignment alone does not establish storefront membership. |
| Catalog reads use a 60-second revalidation interval | apps/web/src/lib/catalog.ts | Admin edits need a defined freshness contract and invalidation; do not promise immediate updates from this code. |
| Seed image URLs are replaced; homepage collection artwork/copy is hardcoded | apps/web/src/lib/catalog-presentation.ts; apps/web/src/app/page.tsx | Some visible presentation intentionally differs from backend content. Uploaded product images are preserved by the replacement helper. |
| Catalog list loads one page of 100 then filters; collection list has no explicit pagination | packages/sdk/src/medusa.ts: fetchCatalog/listProducts/listCollections | Search and collection results can omit records as the catalog grows. |
| Missing GST metadata throws during product mapping | packages/sdk/src/medusa.ts: mapProduct | One incomplete published product can fail a listing. Admin completeness warnings are insufficient as a publishing guarantee. |
| All cart-read failures are presented as an empty bag | apps/web/src/lib/cart-store.ts: getCartLines | A backend outage can look like lost customer data. |
| Prepaid checkout explicitly throws NotPortedError | packages/sdk/src/medusa.ts: checkout | Medusa cannot yet support the complete prepaid purchase journey. |
| Medusa browser tests are explicitly refused | apps/e2e/playwright.config.ts | Existing browser evidence cannot establish Medusa end-to-end readiness. |
| Outbox, daily GST reconciliation, dedicated restock action and deferred privacy processing remain recorded gaps | docs/track-m-pending.md; GST TODOs | Verify each against executable behavior and finish outstanding lifecycle work. |

Authentication is substantially implemented: revocable customer sessions, account profile/addresses, guest-order claims, staff security and Google/email flows exist. Validate and complete these rather than rebuilding them from older README statements.

## Phase 0 — Reproduce and establish the data baseline (P0)

1. Record storefront/admin/API URLs, selected backend, deployment revision, database identity, INR region, sales channel, publishable-key scope and stock location. Record identifiers, never secrets. Confirm build-time and runtime target the intended environment.
2. Select representative products: simple SKU, multiple variants, sold out, draft, discounted, multiple collections, and recently edited price/image. Compare admin API, Store API, SDK output, rendered PDP, bag and checkout. Include old and new carts.
3. Record field-level expected/actual values and request IDs in a discrepancy register: product/variant ID, SKU, status, membership, image, currency, MRP, price, available stock, shipping, tax, discount, total and observation time.
4. Inspect existing order samples across admin, customer page, stored invoice and provider ledger where access exists. Do not mutate real orders to diagnose reads.
5. Inventory every visible customer/admin action as implemented, failing, unsupported, or unverified. Replace stale completion counts with current evidence.

Exit: every reported mismatch has a reproducible example and an identified layer; the deployed backend is known. Preserve existing data and backups; never reseed a live catalog to make records agree.

## Phase 1 — One authoritative commerce model (P0)

Target: Medusa owns active commerce data, consistent with the existing admin investment. Keep any current working deployment until migration gates pass. Avoid running two independent writable commerce authorities.

| Domain | Intended authority | Implementation work |
|---|---|---|
| Selling price and discounts | Native contextual pricing and cart quote | Stop preferring custom selling-price metadata. Keep MRP as a validated additional field. Define INR, tax-inclusive pricing, region/channel context and promotion allocation once. |
| Cart/checkout totals | Server's persisted/recalculated quote | Return line prices, discounts, shipping, tax, COD fee and payable total together. Display that quote; revalidate at completion and explain changed price/stock to the buyer. |
| Collections | A single supported membership model | Support native membership, and explicitly model multi-collection membership if needed. Add an admin editor and migration; remove independent hidden memberships. |
| Inventory | Inventory service availability/reservations | Validate location/channel configuration; distinguish on-hand, reserved and sellable stock. Recheck stock at mutation/completion. |
| Product metadata | Validated product fields | HSN, GST, material, origin, return restrictions and MRP need server validation before publication. Incomplete drafts remain editable and cannot break public catalog pages. |
| Media and merchandising | Persisted content managed by operators | Product images, collection art, homepage selections and campaign copy need explicit ownership. Retire demo substitutions when real catalog photography is ready. |
| Order state | One documented domain state model | Map native fulfillment/payment state and Siumora status explicitly. Customer cards, admin, COD eligibility and metrics read the same derived state. |
| Historical invoices/orders | Immutable transaction snapshots | Catalog edits must not rewrite purchased prices, tax, addresses retained for the transaction or issued invoice amounts. |

Migration: export both sources, produce a dry-run conflict report, resolve differences deliberately, preserve product/SKU/order/customer mappings, backfill approved fields, reconcile totals, then switch reads/writes. Never overwrite the real price automatically because a seed or metadata value exists.

Exit: a native admin price edit reaches PDP, bag and checkout consistently; collection moves work; inventory adjustments change sellable availability; historical orders remain unchanged. All money comparisons are exact integer paise at the application boundary, with explicit conversion from provider/native units.

## Phase 2 — Storefront freshness and complete shopping behavior (P0)

- Add authenticated, replay-safe catalog invalidation after relevant product/variant/collection/inventory/content changes. Proposed target: public catalog edits visible within 5 seconds in normal operation; documented fallback freshness when invalidation fails. Money and availability are revalidated synchronously at checkout.
- Remove first-page-only discovery behavior: paginate catalog/collections and perform search/filter/sort over the intended dataset. Test more than 100 products and enough collections to cross the API page limit.
- Check publish/unpublish, variant selection, thumbnail/gallery order, image reachability, wishlist, cart add/update/remove and account cart merge. No dead navigation to fixed demo collection handles.
- Distinguish empty data from failures. An API outage shows retry/error state; a confirmed expired cart can be cleared/recreated safely. Prevent stale backend-specific cart/session identifiers surviving a cutover unnoticed.
- Expose supported payment methods and backend settings to checkout. Complete coupons/promotions if offered; otherwise remove unusable controls until implemented.
- Align free-shipping promises, pincode eligibility, COD rules, return policy and delivery estimates with backend decisions. Test boundary totals and non-serviceable pincodes.
- Verify SEO price/availability, sitemap and structured data follow the same published catalog.

Exit: a test edits an item through the admin API, observes the correct storefront result, adds it to a bag and confirms a matching backend quote. Cover price decreases/increases, stale open tabs, unpublish and last-unit stock.

## Phase 3 — Payments, order integrity and delivery (P0)

1. Complete Medusa Razorpay integration: payment-session creation, browser flow, server verification, signed webhooks, payment capture and reconciliation. Cover declined/cancelled/pending payments, success after browser closes, duplicate and out-of-order callbacks, provider timeout, retry and amount/currency mismatch.
2. Verify COD confirmation, fee, eligibility, stock reservation and collection accounting separately from prepaid capture. A placed COD order is not proof of payment received.
3. Finish durable events/outbox and retries for order, invoice, notification and conversion effects. Use unique idempotency keys and resumable/compensated workflows; expose failed work to operators.
4. Complete courier booking, AWB/label, tracking webhook, delivery, NDR/reattempt, cancellation and RTO. Ensure customer status and admin status agree.
5. Complete return approval, reverse pickup, inspection, once-only refund and once-only restock. COD refunds need an explicit recorded payout workflow. Do not restock merely because a return was requested.
6. Add scheduled reconciliation for payment/order totals, refunds, inventory reservations, invoices/tax, remittance and courier status. Surface actionable discrepancies rather than silently changing financial records.

Exit: guest and signed-in COD/prepaid purchases complete through delivery; cancellation and return paths settle correctly; duplicate requests cannot duplicate orders, charges, invoice numbers, refunds or stock. Provider sandbox evidence precedes controlled live validation.

## Phase 4 — Operable admin and launch dependencies (P0/P1)

- Make Medusa Admin the canonical operational entry once unique legacy dashboard functions are available there. Finish actionable fulfillment, returns, refund, restock, remittance, messaging failure and deferred privacy queues.
- Audit permissions on both native admin APIs and custom endpoints; test actual role denials, staff second factor, revocation and sensitive writes. Resolve legacy phone-operator access separately from dashboard MFA.
- Reconcile overview metrics to the order/payment ledger and document booked revenue, recognized revenue, refunds and cash awaiting remittance.
- Verify account sign-in, address persistence, session revocation, guest claims, order access and invoice access. Confirm one customer cannot read another's data.
- Business owner supplies approved entity/contact details, product claims/photos, policies and provider accounts. Verify provider credentials, storage, sender configuration and callback URLs without exposing secrets. Existing account readiness is unverified.
- Configure durable media storage, worker deployment, monitoring, backups, restore rehearsal and deployment rollback. Exercise database/provider/worker failure modes before launch.
- Finish usable mobile navigation, loading/error/empty states, keyboard access, form feedback, image performance and consent-aware analytics across purchase and account journeys.

Exit: an operator can process a normal trading day and its exceptions without direct database edits. Every required external dependency has a named owner and verified readiness.

## Phase 5 — Release proof and cutover (P0)

Enable a real Medusa E2E harness with isolated database, migrations, fixtures, workers and provider test doubles; remove the existing refusal only when that harness works. Run the SDK contracts and meaningful database/provider integration tests as well as browser tests; do not count skipped integrations as passed.

Required release scenarios:

1. Product publish/edit/unpublish, collection assignment and media change appear correctly without a deploy.
2. Exact totals agree across PDP context, cart quote, checkout, payment request, stored order, customer view, admin view and invoice. Explicitly account for contextual discounts/shipping; test rounding and tax boundaries.
3. Two buyers competing for the last unit yield no oversell; stale carts show a recoverable response.
4. Guest and signed-in COD/prepaid flows succeed, with payment failure/retry and delayed webhook recovery.
5. Shipment, delivery, NDR, RTO, cancellation, partial/whole returns where supported, refund and restock reconcile.
6. Sign-in/out, cart merge, guest claim, session revocation, access denial, privacy export and deferred erasure work.
7. Checkout kill switch, provider outage, worker restart and duplicate events are safe and observable.
8. Mobile and desktop critical journeys, accessible forms, performance baseline, monitoring alerts and backup restoration pass.

Cutover requires data migration and reconciliation, a write-routing plan and rollback rehearsal. An environment flip alone is not safe rollback after Medusa accepts new customers/orders: either replay approved changes into the rollback target or pause writes and reconcile before switching. Do not lose orders created during the cutover window.

Release gate: zero unexplained monetary/stock discrepancies, no open critical defects, all required journeys evidenced on the intended backend, and verified operational/provider readiness. Record test date, revision, environment, results and remaining limitations.

## First implementation batch and work that can wait

First batch: reproduce one live price mismatch, establish backend/environment identity, fix the authoritative price/cart contract, migrate conflicting prices safely, and add an admin-to-storefront-to-checkout regression test. Next address collection membership and cache freshness. This directly fixes the reported problem before expanding functionality.

Then deliver phases 2–5 in dependency order. Assign engineering estimates after the phase-0 discrepancy register and provider inventory; existing code volume is not a reliable estimate of remaining effort.

Growth features can follow reliable commerce: review submission/moderation, recommendations, advanced search, loyalty, additional locales and AI features. Back-in-stock becomes relevant when real products sell out. They should not delay correct prices, successful checkout, delivery and refunds.
