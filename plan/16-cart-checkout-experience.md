# 16 · Cart, Checkout & One Backend — Master Plan (v3)

**Status:** Plan v3 · 25 Oct 2026 · supersedes v1 and v2 · **Phases 0 and A–F landed 25 Oct 2026** (live run against Medusa + Postgres + Razorpay/Shiprocket test accounts, and a browser pass of storefront and admin, pending — see §7)
**Decision taken:** Siumora launches on **Medusa only**. Fastify (`apps/api`) is frozen now and deleted before launch. Research and the options compared are in [17-one-backend.md](17-one-backend.md).
**Goal:**
- A Kwik-style "phone → address → pay" checkout that is fast and brand-true, where the total shown always equals the charge.
- It runs on one Medusa backend that enforces every rule.
- It is operated from a native-looking Medusa Admin with one custom sidebar entry.

> **Basis:** a code read of the storefront, the Medusa routes and modules, the SDK, Fastify (for porting) and all 16 custom admin files, plus web research.
> **Not done:** the app was not run. Items marked *verify* need a live check.

---

## 1. What changes from v2

- Removed every Fastify branch: the F1/F2 patch, dual-transport contract work and the Fastify "Complete payment" order page.
- Added the backend consolidation from plan 17: shipping, messaging/outbox, recon, privacy and payout, and Fastify removal.
- Merged everything into one timeline (§7).
- D1 (which backend) is settled as **Medusa**.

---

## 2. What is wrong today

### 2.1 Storefront (`apps/web`)
| P | Issue | Where |
|---|---|---|
| P0 | A dismissed or failed payment goes to an order page with no pay action, and the bag is already empty. | `checkout-form.tsx:163-175`, `actions/order.ts:62` |
| P0 | The total ignores the COD fee and inter-state GST. The Pay button shows no amount. | `checkout/page.tsx:64-68` |
| P0 | Name, address and city are not required. A blank name becomes `"Customer"`. | `checkout-form.tsx:124,144` |
| P0 | An unserviceable pincode is silent, and Pay stays enabled. | `checkout-form.tsx:104,346` |
| P0 | After a Medusa order, `clearCart()` deletes lines on a *completed* cart. It likely errors after the order succeeds (*verify*). | `actions/order.ts:62` |
| P1 | The quote is called per keystroke. COD can flip while typing. | `checkout-form.tsx:79-119` |
| P1 | Bag errors are swallowed. `+` is never capped. There is no undo. | `cart-lines.tsx:36-44` |
| P1 | Add to bag shows only tiny text and calls `router.refresh()`. | `add-to-bag.tsx:79-81` |
| P1 | A disabled Pay gives no reason. There is no city/state autofill. A saved address still shows the full form. Mobile total sits below the form. Checkout has a blank loading state. | `checkout-form.tsx`, `checkout/page.tsx` |
| P1 | COD verification surprises the shopper at Pay. `cod_requires_otp` is on by default, so this hits **every** COD buyer. | `checkout-form.tsx:176-180` |
| P1 | No `view_cart`, `begin_checkout` or `add_shipping_info` events. `add_payment_info` sends `items: []`. | — |
| P2 | Hard-coded hex values, mixed field styles, and no gift message, coupon or landmark. | various |

### 2.2 Medusa backend (`apps/medusa`)
| P | Gap | Where |
|---|---|---|
| P0 | **No prepaid.** The SDK refuses non-COD checkout, and `/config` hard-codes `razorpayConfigured:false`. | `packages/sdk/src/medusa.ts`, `api/store/siumora/config` |
| P0 | **The COD fee is never charged.** COD eligibility and serviceability are not re-checked at completion. The **kill-switch is not enforced**. The COD gate runs for every method. | `carts/[cartId]/complete/route.ts` |
| P0 | No payment webhooks and no recon job (`src/jobs` does not exist). | — |
| P0 | No courier integration. Fulfilment is manual only, with no Shiprocket and no courier webhook. | — |
| P0 | Messages and conversion events go through `apps/worker`, which reads the **Fastify** database. | `apps/worker/src/main.ts` |
| P1 | The privacy operator queue, the COD return payout action and boot-guard parity are still open. | `docs/track-m-pending.md` |
| P1 | The quote returns no totals. Cart lines carry no stock (`CartLine` has no `available`). | quote route, `packages/core/src/cart.ts` |

### 2.3 Admin (`apps/medusa/src/admin`)
- **7 custom sidebar entries** (Siumora, Store control center, Abuse, Sign-in health, Audit log, GST desk, Waiting list) plus 3 settings pages.
- **Forms:** always-editable, with a Save button per field.
- **Missing native patterns:** no `ActionMenu`, no react-query, `Badge` where `StatusBadge` belongs, `return null` while loading, and raw `<a href="/app/…">` links.
- **Copy:** environment-variable names shown to users.
- **Duplicates:** COD settings split over 2 pages; device alerts and provider status each shown twice.
- **Endpoints with no UI:** remittances, cash position, restock queue.

---

## 3. Rules

| | Rule |
|---|---|
| R1 | **No new storefront pages or tabs.** Work happens on `/cart`, `/checkout` and `/orders/[n]` and the existing header bag button. |
| R2 | **Reuse existing controls.** `SignInSheet` handles COD verification. Coupon and gift message go inside the existing summary card. Retry happens in the existing Pay button. |
| R3 | **Admin has one custom sidebar entry.** Every other option is a widget on the native page it belongs to, or lives in an existing settings group. |
| R4 | **Native Medusa UI.** Read-only sections, a header `ActionMenu`, Edit in a `Drawer`, `Prompt` for risky actions, `StatusBadge`, react-query, router `Link`. |
| R5 | **Native Medusa features first.** Promotions for coupons, Shipping Options for prices, Payment, Fulfillment and Notification providers, scheduled jobs. |
| R6 | **The server decides money.** The browser never computes a fee, discount or tax. |
| R7 | **One backend.** No new code in `apps/api`. Everything new is built in `apps/medusa`. |

---

## 4. Storefront target

### 4.1 Bag
- **Drawer** opened by add to bag and by the existing header bag button. It holds the lines, the free-shipping bar, the subtotal, one `Checkout · ₹X` button and a "View bag" link.
- **`/cart` page:**
  - Inline line errors, with `+` capped at `available`.
  - Per-line pending state and a Remove undo toast.
  - "Move to wishlist" link.
  - Gift message and pincode check inside the summary card.
  - Bestsellers in the empty state, a matching skeleton, and a sticky mobile checkout bar.

### 4.2 Checkout: one page, three collapsing steps
```
← Bag     SIUMORA                       (minimal header)
Order summary ▾                 ₹2,259  (mobile; sticky card on desktop)
1 CONTACT   +91 phone · "For delivery updates on WhatsApp"
            [Verify] optional inline OTP → unlocks COD + saved addresses
2 DELIVERY  Pincode → city/state autofill · "Arrives by Thu 30 Oct"
            Name · Flat/building · Area/street · Landmark (opt.) | saved-address cards
3 PAYMENT   ◉ UPI (Recommended) ○ Card/EMI ○ Netbanking ○ COD +₹49
[            PAY ₹2,259            ]    (sticky; label = server total)
```
- The quote is debounced: it fires on pincode completion and on address blur. It returns **server totals** per payment method plus a `cartVersion`. The summary and Pay label read only from it.
- An unserviceable pincode shows a message and blocks Pay. A disabled Pay always states why and focuses the first bad field.
- Choosing COD unverified opens the verify sheet **at selection**, not at Pay.
- **Dismissed or failed payment:** stay on checkout with the bag intact and nothing charged. Pay becomes "Try again" using the same Razorpay order, with "Pay on delivery instead" when eligible.
- A "Prices updated" notice appears when `cartVersion` changes.
- Coupon: "Have a code?" inside the summary card.
- Analytics: `begin_checkout`, `add_shipping_info`, `add_payment_info` (full items and `event_id`) and `view_cart`.

### 4.3 Order page
Thank-you line, delivery date and thumbnails. Guests are offered a password-free account *after* the order.

**Design:**
- Brand kit: ivory, ink, mulberry only for the action and selection, one brass hairline.
- Cormorant for the title and total, Jost for everything else.
- Square corners and hairlines.
- New primitives in `packages/ui`: `Field`, `TextInput`, `RadioCard`, `CheckoutStep`, `Drawer`, `StickyBar`.

---

## 5. Backend workstreams (all in `apps/medusa`)

### W1 · Checkout correctness
| ID | Change |
|---|---|
| B1 | Enforce the kill-switch at completion with 503 `payments_paused`. |
| B2 | A shared `priceCheckout()` helper, used by the quote and completion. It re-derives serviceability, address score, RTO and COD eligibility and fee from settings, and never trusts the client. |
| B3 | **Done:** the COD fee is folded into the cart's shipping method just before completion. The split is recorded in the method's `data` (`siumora_shipping_paise`, `siumora_cod_fee_paise`) and survives Medusa repricing. The order card, invoice PDF and admin domain order print shipping and COD charges apart. Chosen over a custom line item, which would have broken invoice and cart-line mapping, since those require HSN/slab on every item. |
| B4 | Run the COD gate only for COD. |
| B5 | Validate the address server-side: name, `address_1`, city, state code, pincode and phone. Errors come back as a field-keyed 400. |
| B6 | After an order, the storefront **drops the cart cookie**; it no longer clears lines on a completed cart. |
| B7 | `available` on `CartLine` (core + SDK), from `inventory_quantity`. |
| B8 | The quote returns `totals.{prepaid,cod}` (subtotal, discount, shipping, codFee, total, GST split, interState from `ORIGIN_STATE_CODE`) plus `cartVersion`. |

### W2 · Payments (Razorpay): payment before order
```
Pay → POST /store/siumora/checkout/prepare  (validate · price · shipping · COD line · Razorpay session)
    ← {razorpay handoff, totals, cartVersion}
modal → paid → POST /carts/:id/complete {signature} → verify → complete → SIU no. + invoice
drop-off → Razorpay webhook → /hooks/payment/razorpay → processPaymentWorkflow completes cart
```
| ID | Change |
|---|---|
| B9 | ✅ `POST /store/siumora/carts/:cartId/prepare`. It readies the cart as completion would, then opens a Razorpay order, or reuses one for the same amount under 30 minutes old. It refuses (409 `already_paid`) to open a second order over money already received. *Moved to Phase C/I:* gift message, landmark and reminder consent in `cart.metadata`. |
| B10 | ✅ `src/modules/razorpay-payment` (`pp_razorpay_razorpay`), **ported** (D4). The plugin targets Medusa 2.7 and has no releases. The 5 Fastify client tests are ported unchanged, plus 18 decision tests and 11 provider tests. Credentials are read per call from encrypted settings, then env. The seed enables the provider on the region; completion refuses providers not enabled there. |
| B11 | ✅ The complete route checks the Checkout.js signature, that the paid order is this cart's session, and that the cart still totals what was paid. `/config` reports the real `razorpayConfigured`. SDK: `paymentFlow`, `preparePayment`, `completePayment`. Storefront: payment-first branch in the checkout form. The payment method is recorded on order metadata, and the order card, invoice and admin read it. The `order.placed` subscriber also issues the invoice for webhook-completed orders. |
| B12 | ✅ `paid_not_placed`: refunds through Razorpay when Medusa has not already compensated. 409 `payment_pending` when Razorpay has not settled; the webhook or recon finishes the order. *Not yet:* a row in the audit log (logged at error level for now; the alert hooks into Phase G's outbox). |
| B13 | ✅ `src/jobs/payment-recon.ts` runs every 15 minutes with a 48-hour lookback. It replays `processPaymentWorkflow` for sessions Razorpay says are captured or authorized, and flags a wrong amount for a person. A cart that can no longer complete is refunded by Medusa's compensation. |

### W3 · Shipping (Shiprocket)
| ID | Change |
|---|---|
| B14 | ✅ `src/modules/shiprocket-fulfillment` (`shiprocket_shiprocket`), **ported**. The client and its tests come from Fastify, plus `cancelOrders`. The native **Create fulfillment** books the courier order, AWB and pickup; the label carries the AWB and tracking link, and the status moves to processing. Bookings resume from `siumora_shipments` (new table and migration in returns-ndr), so they never book twice. Covers cancel and reverse pickup. Without credentials it books nothing and says so. The seed moves Standard Delivery onto it. |
| B15 | ✅ `POST /webhooks/courier` accepts the Shiprocket token (`x-api-key`) or the signed courier format (HMAC, `COURIER_WEBHOOK_SECRET`). It finds the order by SIU number or AWB, moves it through `decideAdvance` (an illegal move is acknowledged, not forced), records NDR events, and audits the move as the courier, never a person. |

### W4 · Messaging, outbox and analytics
| ID | Change |
|---|---|
| B16 | ✅ `src/modules/outbox`: `siumora_notifications`, `siumora_tracking_events` and `siumora_notification_preferences` in the Medusa DB, with `(event_key, template_key)` and `(event_id, destination)` unique keys as the dedup. Written by one order hub, `lib/order-events.ts` `orderMoved`, called after every status write (admin status/NDR, store confirm/status/NDR, courier webhook, the placement subscriber). *Deviation:* after the write rather than inside a Medusa workflow; a crash between the two loses one message, never doubles one. |
| B17 | ✅ Messages composed in `outbox/compose.ts` (`messageFor`) for confirmed, COD confirm, shipped, out for delivery, delivery failed, delivered and refund. Sent by the worker over `@siumora/messaging` (WhatsApp BSP, then MSG91 SMS) rather than as Medusa notification providers. Delivery receipts land at `POST /webhooks/messaging` (HMAC, `MESSAGING_WEBHOOK_SECRET`). Admin: a "Messages and conversions" card on the Siumora home. |
| B18 | ✅ `apps/worker` drains either outbox through an `OutboxStore` (`store.ts`; `medusa-store.ts` for Medusa), chosen by `OUTBOX_BACKEND=medusa`. GA4 and Meta CAPI purchases carry the checkout's `siumora_event_id` and GA client id from cart metadata, honour the recorded consent, count prepaid at confirmation and COD at delivery. |

### W5 · Conversion features
| ID | Change |
|---|---|
| B19 | ✅ Coupons are native Promotions, applied through `POST/DELETE /store/siumora/coupons` (one code at a time, its own 10/min limit; the native `/store/carts/:id/promotions` door is closed). Core `CartLine.discount` carries Medusa's line adjustments: GST is extracted from the net line value (CGST Act s.15(3)(a)), so the quote, invoice, order card, GSTR-1 and Razorpay amount agree. Free shipping is judged after the coupon. Storefront: "Have a coupon code?" in the summary, a Coupon row in every total. Admin: the native Promotions page. |
| B20 | ⏸ Not built — D2 says no prepaid offer at launch; the COD fee already rewards prepaid. A native automatic promotion is the route when it is tested. |
| B21 | ✅ Gift message: setting `gift_message_enabled` (off by default); a field behind a link in the delivery step with a live count; written to cart metadata, tidied and bounded to 150 by `cleanGiftMessage` in `readyCart`, copied to the order; shown on the admin order card. *Deviation:* there is no packing slip in the codebase, so the order card is where the packer reads it. |
| B22 | ✅ Cart reminders: settings `cart_recovery_enabled` (off) and `cart_recovery_delay_minutes` (60). An unticked opt-in at step 1 records `siumora_cart_reminders` (consent time, number); the `siumora-cart-reminders` job queues one `cart_reminder` WhatsApp (marketing: quiet hours, opt-out wins) per cart once it has been quiet for the delay, never after checkout or past three days. The link is signed (`cart_resume`, 7 days) and `/cart/resume` puts the bag on the tapping browser. Erasure removes pending reminders. |

### W6 · Admin endpoints
| ID | Change |
|---|---|
| B23 | ✅ Settings PATCH accepts `{entries:[…]}`, validated together (including COD min ≤ max), in one multi-row upsert, with one audit entry. |
| B24 | Moved to Phase I with B21/B22 — the gift and cart-reminder keys are added with the features they switch. |
| B25 | ✅ `GET/POST /admin/siumora/serviceability`: summary, pincode lookup, CSV import (header-named columns, every bad line named, dry run reports new, changed and unchanged). |
| B26 | ✅ The order lookup adds payment method, COD fee, Razorpay payment id, and the shipment (AWB, courier, tracking, pickup). The gift message and landmark arrive with Phase I (the landmark already prints in address line 2). |

### W7 · Remaining parity
| ID | Change |
|---|---|
| B27 | ✅ `GET /admin/siumora/privacy-requests` and `POST …/:id` (`complete` re-runs the erasure check, `refuse` needs a reason), both audited (`privacy.erase`/`privacy.refuse`). Shown as a "Privacy requests" card on the Siumora home only when one is open. Erasure now also empties the outbox (`forgetRecipient`). |
| B28 | ✅ `POST /admin/siumora/orders/:number/returns/payout`: COD only, an open return, the UPI/UTR reference written once by a conditional update, audited (`return.payout`). "Record COD payout" in the order card's menu. Migration `Migration20261025150000` adds the payout columns. |
| B29 | ✅ `POST /admin/siumora/orders/:number/restock`: rto/returned only; claims `restocked_at` before `adjustInventory` (released if it fails), so goods are counted once; bundles counted by required quantity; audited (`order.restock`). "Put back in stock" in the order card; the restock queue now shrinks. |
| B30 | ✅ `src/boot-guards.ts` refuses `COURIER_SIMULATION=true` and `OTP_ECHO=true` when `APP_ENV=production`; staging still allows both. |

### W8 · Retire Fastify
| ID | Change |
|---|---|
| B31 | Re-scope the parity checklist to its **launch-critical** rows (money, stock, invoice, auth, privacy). Mark the rest "covered by Medusa core" or "dropped". |
| B32 | 🟡 Prep done, deletion not yet (by choice: Medusa has had no live run). Medusa is the default for the storefront, the worker and E2E; `fastify` must be named. A Medusa E2E harness (fresh database, seed, Medusa on :9123) and a non-blocking `E2E (medusa)` CI job. `scripts/retire-fastify.mjs` reports every remaining dependency and deletes `apps/api` and `packages/db` only on a clean tree with none left; `docs/fastify-retirement.md` has the edits and the launch checks. |
| B33 | ⬜ KYC site review on the Medusa stack in COD-only or "payments coming soon" mode — part of the launch gate in `docs/fastify-retirement.md`. |

---

## 6. Admin target (native Medusa, no tab sprawl)

```
Sidebar:   … native …  ·  Siumora  (the only custom entry: ops home)
             └ label-less sub-routes: GST · Sign-in (Health | Abuse tabs) · Remittances
Customers: Waiting list (nested)
Settings:  Customer sign-in · Integrations (providers + messaging) · Staff security (+ audit log)
Widgets:   Store page    → "Checkout & COD" card · "Storefront" card
           Order side    → "Siumora order" (status · NDR · payment/COD · gift message) — ActionMenu
           Customer page → "Security" — ActionMenu
           Product side  → "India tax" (HSN, GST, MRP) — Edit drawer
```

**The "Checkout & COD" card (Store page)**
- **Read-only rows:**
  - Checkout open or paused, and Razorpay connected or not (both as StatusBadges).
  - COD fee, order range, verified-phone rule and step-up threshold.
  - Serviceable pincodes and the date they were updated.
  - Gift message and cart reminders.
  - The prepaid offer, shown as a link to the native promotion.
- **ActionMenu:**
  - Edit checkout rules: a Drawer using react-hook-form, zod and `CurrencyInput`, saved in one atomic call (B23).
  - Pause checkout, behind a Prompt.
  - Import pincodes in a FocusModal, and Look up a pincode.

**Plumbing**
- react-query hooks over `sdk.client.fetch`, so `/settings` is fetched once.
- Shared `SectionHeader`, `KeyValueRow`, `EditDrawer`, StatusBadge map, and skeleton and empty states.
- Human labels instead of environment-variable names.
- Delete `lib/settings-controls.tsx`.

**Result:** 7 sidebar entries become 1. Settings stays at 3 pages. The remittance, cash-position and restock endpoints get UI on the Siumora home.

---

## 7. Timeline (one engineer ≈ 7–8 weeks; two in parallel ≈ 4–5)

| Phase | Contents | Depends on | Size |
|---|---|---|---|
| 0 ✅ | Freeze Fastify (R7: `README.md`, `apps/api/README.md`). Re-scope the parity checklist (B31: "Launch scope" in `docs/medusa-parity-checklist.md`). | — | 1 d |
| A ✅ | W1 checkout correctness (B1–B8): `modules/siumora-order/checkout-rules.ts` (+26 Medusa tests), `lib/checkout-context.ts`, quote and complete routes, order card / invoice / domain order fee split, SDK `available` + `ApiError.fields` + quote totals type, storefront `forgetCart()`. **Pending:** contract suite against live Medusa + Postgres (none on the dev machine). | 0 | 4–5 d |
| B ✅ | W2 Razorpay (B9–B13). Medusa production build passes; 333 Medusa tests. **Pending:** live run with Razorpay test keys. |
| C ✅ | Storefront checkout (§4.2–4.3). `components/checkout/` holds three collapsing steps, a live server-total summary (collapsed on mobile, sticky on desktop), a debounced quote, pincode → city/state autofill, a delivery date, inline validation with focus on the first problem, server `fields` errors on their fields, a price-changed notice, a verify sheet at COD selection, prepaid hidden when Razorpay is off, a sticky Pay with the amount, and a skeleton. Funnel: `begin_checkout`, `add_shipping_info`, and `add_payment_info` with items (it was sent empty before). Minimal header. UI primitives in `packages/ui`. E2E updated to the steps. | A; B for prepaid | 5–6 d |
| D ✅ | Storefront bag (§4.1): `Drawer` + `BagDrawer` from the header bag and after add-to-bag (no PDP refresh); lines with stock cap, per-line errors and busy state, Remove + Undo, Save for later; `/cart` with a total-carrying CTA, sticky mobile bar, pincode check that checkout reuses, bestsellers when empty, matched skeleton, `view_cart` and `remove_from_cart`. **Moved to Phase I:** gift message (needs validated server storage, B21). | B7 | 4 d |
| E ✅ | Admin made native (§6, B23, B25, B26). One sidebar entry (Siumora home: money, cash position, states, NDR and restock queues; GST, Sign-in and Remittances open from its menu); Waiting list nested under Customers; Settings: Customer sign-in, **Integrations** (all providers, including Shiprocket, with the old Messaging page merged in), Staff security (audit log included). Store page: **Checkout & COD** and **Storefront** cards. Order, customer and product cards: side-column, ActionMenu, Drawer edits, Prompt for risky moves. react-query plumbing, `components/kit.tsx`. Removed: Store control center, Abuse, Sign-in health, Audit log and Messaging pages, and the always-editable controls. | — | 6–7 d |
| F ✅ | W3 Shiprocket (B14–B15). 23 new tests; Medusa build passes. **Pending:** a live booking with a Shiprocket test account, and confirming the account plan includes push webhooks. | — | 4–5 d |
| G ✅ | W4 outbox, notifications and analytics (B16–B18): `modules/outbox`, the `orderMoved` hub, the delivery-receipt webhook, consent and GA client id carried on the cart, the worker's `OutboxStore` with a Medusa store. **Pending:** a live drain against Postgres and real BSP/GA4/Meta credentials. | — | 5–6 d |
| H ✅ | W7 parity remainder (B27–B30): privacy queue, COD payout, restock, boot guards, plus the remittance file upload (CSV read in the browser, `modules/remittance/csv.ts`). Medusa 380 tests; build passes. **Pending:** `db:migrate` and a live pass of payout/restock against Postgres. | G for privacy messaging | 3 d |
| I ✅ | W5 conversion: coupons (B19), gift message (B21), cart reminders (B22); B20 deferred by D2. Medusa 385 tests, build passes; core, SDK, web, worker green. **Pending:** a live coupon order through Razorpay, and a reminder through the worker. | A–C; G for B22 | 4–5 d |
| J 🟡 | W8 retire Fastify (B32–B33). Prep done: Medusa by default, Medusa E2E harness and CI job, the retirement script and checklist. **Next:** the launch checks, then `retire-fastify.mjs --apply`. | all above | 2–3 d |

**Critical path to taking money on Medusa:** 0 → A → B → C. Shipping (F) and messaging (G) must also be done before the launch gate (J).

---

## 8. Tests and acceptance

- **Money invariant:** across {intra/inter-state} × {prepaid/COD} × {under/over free shipping} × {with/without coupon}: quote total = Pay label = Razorpay amount = order total = invoice total.
- **Provider tests:** the 10 Razorpay and the Shiprocket client behaviours pass against the Medusa providers.
- **Contract suite** (Medusa only): quote totals and `cartVersion`, `prepare`, prepaid `checkout`, `available`, promotions, and the field-error envelope.
- **Parity:** every launch-critical row from B31 is ticked with a test.
- **E2E** (`E2E_BACKEND=medusa`):
  - Prepaid: dismiss → bag intact → retry → order.
  - Webhook drop-off completes the order.
  - COD unverified → sheet → order.
  - An unserviceable pincode blocks Pay.
  - A price-change notice appears.
  - The last unit bought by two shoppers → one order, one refund.
  - Courier status updates the order.
  - The order message is queued once.
- **Admin:** one custom sidebar item, widgets on native pages, one audited save per Drawer, Pause needs a Prompt, no blank loading.
- **Accessibility and performance:** axe clean at 320–1440 px in light and dark. Checkout LCP ≤ 2.0 s on 4G. The PDP stays static.

---

## 9. Rollout and monitoring

- **PostHog flags:** `checkout_v3`, `bag_drawer` and `prepaid_offer`.
- **Kill paths:** the payments kill-switch, or disabling Razorpay in Integrations, which drops to COD-only with honest copy.
- **Alerts:** `paid_not_placed`, recon fixes > 0, webhook signature failures, quote p95 > 300 ms, and an outbox backlog.
- **Funnel:** view_cart → begin_checkout → add_shipping_info → add_payment_info → purchase, plus COD share and RTO by method. Take a baseline before C, then compare after each phase.

---

## 10. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| D2 | Prepaid offer: none, ₹50 or a percentage? | None at launch. The COD fee already rewards prepaid. Test later with B20. |
| D3 | COD fee as a line item or as a shipping option? | **Decided:** folded into the shipping method (see B3). |
| D4 | Razorpay and Shiprocket: plugin or port? | **Both ported** (Phases B and F) — each plugin was early (2.7-era / 0.2.x) and the ports keep our tested behaviour. |
| D5 | Cart reminders at launch? | No. They need the outbox and approved WhatsApp templates. |
| D6 | Hard launch date under ~3 weeks? | If yes, revisit 17-one-backend.md §5 (launch on Fastify, migrate after). |

## Sources
See [17-one-backend.md](17-one-backend.md) for backend and plugin research.
Checkout UX: [Baymard form best practices](https://baymard.com/blog/checkout-form-best-practices) · [Baymard checkout usability](https://baymard.com/blog/ecommerce-checkout-usability) · [Razorpay Magic Checkout](https://razorpay.com/magic-checkout/) · [GoKwik × Aureate](https://aureatelabs.com/blog/aureate-partners-with-gokwik/) · [Truecaller × GoKwik](https://www.crn.in/?p=53091) · [eChai](https://echai.ventures/d2c/d2c-payments-cod/one-click-checkout-gokwik-shopflo-worth-it) · [cartylabs: drawer vs page](https://cartylabs.com/blog/shopify-cart-page-vs-cart-drawer/)
