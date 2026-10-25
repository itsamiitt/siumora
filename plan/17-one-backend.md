# 17 · One Backend — Options, Research and Recommendation

**Status:** Research and recommendation · 25 Oct 2026
**Question:** The app has two backends, Fastify (`apps/api`) and Medusa (`apps/medusa`). Each has features the other lacks. What is the better solution?
**Short answer:** **Finish Medusa and retire Fastify before launch.** Do not run both, and do not move back to Fastify.
- The shop is pre-launch, so there is no live data to migrate and no dual-writing.
- Medusa already holds most of the product.
- The missing pieces are exactly the ones Medusa has native slots for.

---

## 1. Facts this rests on (checked in the repo)

| Fact | Evidence |
|---|---|
| The storefront talks to one backend at a time through `COMMERCE_BACKEND` (`fastify` default, or `medusa`). The SDK has two classes with one surface. | `apps/web/src/lib/commerce-backend.ts`, `.env.example:206` |
| The two backends use **separate databases**. | `README.md` |
| **Pre-launch**: a coming-soon page and waitlist. KYC, GSTIN, DLT and Shiprocket accounts are still founder-blocked. | `README.md` "Coming Soon launch", `docs/track-m-pending.md` "Founder-blocked" |
| Medusa has ≈16.4k lines of non-test source vs Fastify's ≈4.9k lines of routes plus libraries. Product admin, sign-in v2, address book, sessions, Google sign-in, order claiming and staff MFA exist **only** on Medusa. | `wc -l`, SDK `not_supported` stubs in `packages/sdk/src/index.ts` |
| Medusa is missing only money and logistics: Razorpay prepaid, the COD fee, payment webhooks and recon, Shiprocket booking and the courier webhook, the notification outbox and worker, the privacy-request queue, and the COD payout action. | `packages/sdk/src/medusa.ts` (`checkout (prepaid)` not ported), `docs/track-m-pending.md` |
| The parity checklist has 24 of 207 rows ticked, with **90 P0 rows open**. Many rows are "prove with a test" items for behaviour that already exists, not missing features. | `docs/medusa-parity-checklist.md` |

---

## 2. Options compared

| | **A. Finish Medusa, retire Fastify** | **B. Stay on Fastify, drop Medusa** | **C. Keep both, split by domain** | **D. Move to Shopify + GoKwik/Shiprocket apps** |
|---|---|---|---|---|
| What it means | Port the money and logistics pieces into Medusa's native slots (payment provider, fulfillment provider, notification providers, scheduled jobs, webhook routes). Delete `apps/api` at launch. | Rebuild in Fastify: product admin, sign-in v2, sessions, address book, Google sign-in, staff MFA and audit. Delete `apps/medusa`. | Fastify keeps payments and shipping. Medusa keeps the catalogue, auth and admin. Orders are joined across two databases. | Use a hosted platform. The custom GST, COD/RTO, OTP and invoice code is mostly discarded or rebuilt as apps. |
| Work left | **~4–5 engineer-weeks** (§4) | ~8–12 weeks, because product admin alone is a large build that Medusa gives free | Lowest now, highest forever | 2–4 weeks of setup and theme, but every custom rule must be re-checked against app limits |
| Data risk | None. Pre-launch, nothing to migrate. | None | **High.** Two write owners for orders, customers and stock. The literature says migrations stall exactly here ([archman](https://archman.dev/docs/modernization-and-migration/strangler-fig-pattern), [netguru](https://www.netguru.com/blog/strangler-fig-pattern-guide)). | Data moves to Shopify. Export later is limited. |
| Ongoing cost | One stack. Medusa upgrades. | One stack, but everything Medusa provides must be owned in-house | Two stacks, two databases, cross-database reconciliation | Shopify plan + **2% surcharge on Basic** because Shopify Payments isn't available in India ([witscode](https://witscode.com/blogs/shopify-vs-woocommerce-india-d2c-2026)) + per-order app fees |
| Checkout control (plan 16) | Full. Brand-true, our own COD/RTO engine. | Full | Full but split | Limited. Checkout UI belongs to Shopify or the checkout app. |
| Admin for non-technical staff | Native Medusa Admin (already live at `/app`) | Must be built | Two admins | Shopify admin (best in class) |
| Verdict | **Recommended** | Throws away the larger, newer half | Avoid: the worst long-term option | Only if engineering capacity, not money, is the real constraint |

**Why not C (the "strangler" middle path)?** The strangler-fig pattern is for *live* systems that cannot stop. The common advice is one write owner per entity, with ownership moved explicitly at cutover ([archman](https://archman.dev/docs/modernization-and-migration/strangler-fig-pattern), [iweb](https://www.iweb.co.uk/the-record/replatforming-without-a-freeze-the-dual-write-pattern-that-makes-it-possible)). Siumora has no live traffic, so it can skip the overlap entirely and do a single, clean switch.

---

## 3. Build or plug in? (for option A)

The Medusa ecosystem already has community plugins for the two biggest gaps. **Adopt one only if it passes our existing provider tests.** Otherwise port our tested Fastify adapters into the same native slots.

| Gap | Medusa native slot | Plugin found | Plugin state | Our code to port | Recommendation |
|---|---|---|---|---|---|
| Razorpay prepaid | Payment Module Provider. Webhooks arrive at the built-in `/hooks/payment/{id}_{provider}` route and `processPaymentWorkflow` completes the cart ([Medusa docs](https://docs.medusajs.com/resources/commerce-modules/payment/webhook-events), [workflow ref](https://docs.medusajs.com/resources/references/medusa-workflows/processPaymentWorkflow)) | [SGFGOV medusa-payment-plugins](https://github.com/SGFGOV/medusa-payment-plugins) (`medusa-plugin-razorpay-v2`); [@tsc_tech/medusa-plugin-razorpay-payment](https://unpkg.com/@tsc_tech/medusa-plugin-razorpay-payment@0.0.11/README.md) | SGF: 17★, 7 open issues, badge says Medusa 2.7.0 (we run 2.21.2), no releases. tsc: v0.0.11. | `apps/api/src/lib/razorpay.ts` + its 10 tests | **1-day spike on SGF.** If it fails any of the 10 tests (idempotent capture, the bare-authorized drop-off, refund, recon listing) or doesn't run on 2.21, **port ours** (~3–4 d). The port is the likely winner. |
| Shiprocket booking, AWB, tracking | Fulfillment Module Provider ([Medusa docs](https://medusajs.com/fulfillment-module/)) | [@sam-ael/medusa-plugin-shiprocket](https://medusajs.com/integrations/@sam-aelmedusa-plugin-shiprocket) | v0.2.1, Medusa v2, updated 12 Jun 2026, ~357 downloads a month. Features unconfirmed. | `apps/api/src/lib/shiprocket.ts` + tests, courier webhook | Same rule: spike, then port if needed (~3 d). Also check COD remittance fields and reverse pickup. |
| WhatsApp, SMS and email messages | Notification Module Provider, one per channel ([Medusa docs](https://docs.medusajs.com/resources/references/notification-provider-module)) | None for our BSP or MSG91 | — | `packages/messaging` (already shared), `apps/worker` | Write 3 thin providers over `@siumora/messaging`. Trigger from subscribers (`order.placed`, …). ~3 d. |
| Notification and conversion outbox | Workflows (with compensation) + scheduled jobs | — | — | `apps/worker` (reads the Fastify DB) | Re-point the worker's drain at a `siumora_outbox` table in the Medusa DB. This is track-m row 4, ~3 d. GA4 and Meta CAPI senders are reused unchanged. |
| Payment recon | Scheduled job (`src/jobs/`) | — | — | `apps/api/src/lib/recon.ts` | Port as a 15-minute job. ~1 d. |
| COD fee, kill-switch, order-time checks | Complete route (already custom) | — | — | Fastify `/checkout` logic | Plan 16 §5.1 (B1–B5). ~2–3 d. |
| Privacy queue, COD payout | Admin routes + widgets | — | — | Fastify admin routes | ~2–3 d. Can follow launch if the legal timeline allows. |

**Plugin caution:** both plugins are small community projects. Even when adopted, pin the exact version, vendor it if it is abandoned, and keep our tests as the gate.

---

## 4. Plan for option A

| Step | Work | Effort |
|---|---|---|
| 0 | **Freeze Fastify now.** No new features go to `apps/api`. Only fixes that block KYC review (if any). | — |
| 1 | Re-scope the parity checklist: mark which of the 90 open P0 rows are **launch-critical** (money, stock, invoice, auth, privacy) and which are "already covered by Medusa core" or "Fastify-only, dropped". The cutover bar becomes those rows, not all 207. | 1 d |
| 2 | Checkout correctness on Medusa (plan 16 Phase A: kill-switch, COD fee, re-derived rules, address validation, cart cookie rotation, server totals) | 4–5 d |
| 3 | Razorpay provider (spike → adopt or port) + webhook + recon job + `/config` truth + SDK prepaid | 6–8 d |
| 4 | Shiprocket fulfillment provider (spike → adopt or port) + courier webhook route + NDR feed into returns-ndr | 4–5 d |
| 5 | Outbox in the Medusa DB + notification providers (WhatsApp, SMS, email) + worker re-pointed + conversion events from `order.placed` | 5–6 d |
| 6 | Privacy operator queue, COD payout action, boot-guard parity (track-m rows 1, 3, 10) | 3 d |
| 7 | CI: run E2E and the contract suite with `E2E_BACKEND=medusa` as the **only** mode. Delete the Fastify transport from the SDK, `apps/api` and `packages/db` usage. Set `COMMERCE_BACKEND` to medusa (then remove the seam). | 2–3 d |

**Total: about 5 weeks for one engineer.** Steps 3–5 can run in parallel with two people. Plan 16's checkout UI work (Phase C) proceeds on top of steps 2–3.

**For the KYC site review**, which is blocked on a live site: Razorpay and the banks review a working storefront with policies and pricing, not live payments. Deploy the **Medusa** stack in COD-only or "payments coming soon" mode. Don't deploy Fastify just to retire it weeks later. The design doc's "deploy Fastify for KYC now" note predates Medusa being this far along. If a review needs a site *this week* and Medusa hosting isn't ready, a Fastify deploy is an acceptable stopgap, as long as it takes **no real orders**.

---

## 5. What would change this recommendation

- **Engineering capacity under about 1 person for the next 6 weeks** → consider D (Shopify + GoKwik + Shiprocket apps). Accept the ~2% Basic-plan surcharge, app fees and less checkout control, in exchange for speed. Get real quotes first; the published comparisons are vendor or agency blogs ([eChai](https://echai.ventures/d2c/d2c-choose-platform/shopify-or-woocommerce-first-store-india), [buildwithmatija](https://www.buildwithmatija.com/blog/md/medusa-vs-shopify-2026-cost-b2b-headless-tradeoffs)).
- **A hard launch date within 2 weeks** → launch on Fastify as-is (prepaid works there). Keep Medusa as the target and migrate after launch. This brings back a real data migration (orders, customers, invoice series) and exactly the dual-owner risk that §2 warns about, so only do it if the date truly cannot move.
- **Both community plugins pass our test bars** → steps 3–4 shrink by about 5 days.

---

## 6. Decision needed

| # | Decision | Recommendation |
|---|---|---|
| D1 | Which backend does Siumora launch on? | **Medusa**, with Fastify frozen today and deleted at launch |
| D2 | Is there a hard launch date? | If it is under 2 weeks away, see §5. Otherwise follow the §4 plan. |
| D3 | Plugins or ports for Razorpay and Shiprocket? | 1-day spike each, gated on our tests. Default to porting. |

## Sources
- Medusa: [Payment webhook events](https://docs.medusajs.com/resources/commerce-modules/payment/webhook-events) · [processPaymentWorkflow](https://docs.medusajs.com/resources/references/medusa-workflows/processPaymentWorkflow) · [getWebhookActionAndData](https://docs.medusajs.com/resources/references/payment/getWebhookActionAndData) · [Notification provider](https://docs.medusajs.com/resources/references/notification-provider-module) · [Fulfillment module](https://medusajs.com/fulfillment-module/)
- Plugins: [SGFGOV Razorpay](https://github.com/SGFGOV/medusa-payment-plugins) · [medusa-plugin-razorpay-v2 README](https://unpkg.com/medusa-plugin-razorpay-v2@0.1.0/README.md) · [@tsc_tech Razorpay](https://unpkg.com/@tsc_tech/medusa-plugin-razorpay-payment@0.0.11/README.md) · [Shiprocket plugin](https://medusajs.com/integrations/@sam-aelmedusa-plugin-shiprocket)
- Migration practice: [archman: strangler fig](https://archman.dev/docs/modernization-and-migration/strangler-fig-pattern) · [netguru](https://www.netguru.com/blog/strangler-fig-pattern-guide) · [iweb: dual write](https://www.iweb.co.uk/the-record/replatforming-without-a-freeze-the-dual-write-pattern-that-makes-it-possible)
- Platform cost: [witscode: Shopify vs WooCommerce India 2026](https://witscode.com/blogs/shopify-vs-woocommerce-india-d2c-2026) · [eChai](https://echai.ventures/d2c/d2c-choose-platform/shopify-or-woocommerce-first-store-india) · [buildwithmatija: Medusa vs Shopify](https://www.buildwithmatija.com/blog/md/medusa-vs-shopify-2026-cost-b2b-headless-tradeoffs)
