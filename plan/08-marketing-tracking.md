# 08 · Marketing, Analytics & Tracking — GA4 E‑commerce + Google Ads + Meta Pixel/CAPI

**The gap this file closes:** without correct GA4 e‑commerce events and Meta Pixel + Conversions API, every rupee of ad spend is optimized on partial data. Browser‑only pixels lose a large share of conversions to ad blockers, iOS/Safari restrictions, and network flakiness; a dual **browser + server** setup with deduplication restores that signal — correctly implemented CAPI setups routinely report meaningful ROAS lifts once Event Match Quality is optimized.

## 1. The one‑contract principle (`packages/analytics`)

One typed `track()` per user action; destinations are adapters. Product code never calls `gtag`/`fbq` directly.

```
packages/analytics/
├── events.ts        # Zod-typed catalog: ViewItem, AddToCart, BeginCheckout, Purchase…
├── client.ts        # track() → dataLayer (GTM) + fbq + posthog.capture
├── server.ts        # emit() → GA4 Measurement Protocol + Meta CAPI + posthog
├── identity.ts      # event_id minting, client_id/fbp/fbc capture, SHA-256 hashing
└── consent.ts       # Consent Mode v2 state ↔ DPDP banner bridge
```

**Event ID strategy (the keystone):** mint a UUID `event_id` per action at the source (checkout Server Action for purchase; client for browse events), persist on the order (`tracking_events` ledger), and send the **same ID** to the browser pixel and the server event. Meta dedupes on `event_name + event_id` (48‑hour window — server event must not lag days behind); keep the same ID across retries; Events Manager should show **"1 event from 2 sources."**

## 2. E‑commerce event schema (single source for GA4 + Meta + PostHog)

| Action | GA4 event | Meta standard event | Fired from |
|---|---|---|---|
| List/collection view | `view_item_list` | — | client |
| Product click in list | `select_item` | — | client |
| PDP view | `view_item` | `ViewContent` | client |
| Search | `search` | `Search` | client |
| Add to cart | `add_to_cart` | `AddToCart` | client (+ server echo) |
| Remove from cart | `remove_from_cart` | — | client |
| View cart | `view_cart` | — | client |
| Wishlist | `add_to_wishlist` | `AddToWishlist` | client |
| Checkout start | `begin_checkout` | `InitiateCheckout` | client + server |
| Shipping chosen | `add_shipping_info` | — | client |
| Payment chosen | `add_payment_info` | `AddPaymentInfo` | client |
| **Order placed** | `purchase` | `Purchase` | **client + server (dedup)** |
| Refund | `refund` | (custom `Refund`) | **server only** |
| Signup / OTP verified | `sign_up` | `CompleteRegistration` | client + server |
| COD delivered (see §6) | (custom `cod_delivered`) | custom/delayed `Purchase` | server only |

**Items payload (GA4 `items[]` ↔ Meta `contents[]`):** `item_id` (=SKU=`content_ids`), `item_name`, `price` (GST‑inclusive, `currency:"INR"`), `quantity`, `item_category`, `item_variant`, `item_brand`; order‑level `value`, `transaction_id` (order number), `coupon`, `shipping`, `tax` (from the GST engine). Meta adds `content_type:"product"` — ids must match the **Meta catalog feed** exactly or Advantage+ catalog ads break.

## 3. Google stack

**3.1 Tag delivery.** GTM web container loaded via `@next/third-parties/google` (`<GoogleTagManager/>`, afterInteractive). Then upgrade delivery with **Google Tag Gateway (GTG)**: serves Google tags (GA4, Ads, GTM) from **your first‑party domain via Cloudflare** — free, no servers, materially more resilient to blockers; it improves delivery but is *not* full server‑side processing. Google's own recommended end‑state is **GTG + server‑side GTM together**: CDN serves scripts first‑party, an sGTM container processes/enriches data. Our Cloudflare edge (see 01) makes GTG a config task.

**3.2 GA4 property.** All events of §2 with the items schema; `purchase` also sent server‑side via **Measurement Protocol** (needs the browser `client_id` — capture it into the order at checkout) as the reliability backstop, and `refund` server‑only from the RMA workflow. Define key events (purchase, begin_checkout, sign_up), audiences (cart abandoners, high‑LTV, category viewers), and custom dimensions: `payment_method` (upi/card/cod…), `channel` (web/agentic/ondc/whatsapp), `rto_risk_band`, `city_tier`. **BigQuery export (free)** on day one — raw events join ad spend + orders + RTO for the dashboards in §8.

**3.3 Google Ads.** Link GA4↔Ads; import GA4 purchase or use the Ads tag with **Enhanced Conversions** — hashed (SHA‑256) email/phone attached to conversions for better matching; in India, **hashed phone is your strongest key** (phone‑first auth). Note: Google consolidated its Enhanced Conversions products in mid‑2026 — follow the current Ads UI flow when configuring. Remarketing audiences flow from GA4; Performance Max + Shopping run off Merchant Center.

**3.4 Merchant Center.** Product feed from the shared feed builder (same canonical catalog as Meta/ACP/ONDC): GST‑inclusive INR prices, availability, GTIN/MPN where present, image rules honored. Free listings on day one; Shopping/PMax when ads start. Feed regenerates on `product.updated`; disapprovals surface in the admin Marketing‑health panel.

## 4. Meta stack — Pixel + Conversions API

**4.1 Dual‑send.** Meta Pixel in the browser (base + §2 events) **and** CAPI server‑side, deduplicated per §1. CAPI implementation: **direct from our stack** — Medusa subscribers → Trigger.dev task → Graph API (best control, no extra vendor); alternative: route through the sGTM container so one server endpoint fans out to GA4+Meta (+future platforms).

**4.2 Server event payload (every CAPI event):**
- `event_name`, `event_id` (shared), `event_time`, `action_source:"website"`, `event_source_url`
- `user_data`: SHA‑256 hashed `ph` (E.164, no `+`) and `em`; hashed `external_id` (customer id); **unhashed `fbp` and `fbc` cookies** captured client‑side and stored with the session/order — they raise match quality and tie server events back to the ad click; `client_ip_address` + `client_user_agent`
- `custom_data`: value/currency/contents per §2.

**4.3 Event Match Quality (EMQ).** Monitor per event in Events Manager (0–10). Targets: **Purchase ≥ 8.5** (rich identifiers at purchase), AddToCart ≥ 8, PageView 6.5–7.5 is normal; below ~6 overall = money left on the table. Levers: send `ph`+`em`+`external_id`+`fbp`/`fbc` on every server event; normalize before hashing (lowercase, trim, E.164).

**4.4 Meta surfaces (India‑relevant).** Domain verification + Pixel/dataset per environment. **Meta catalog** (shared feed) → Advantage+ catalog ads (retargeting/prospecting), Instagram Shopping tags, and the **WhatsApp catalog** (same feed) for Click‑to‑WhatsApp ads — a top‑performing Indian ad format that lands buyers in the WhatsApp AI agent ([09](09-search-ai.md)).

## 5. Consent & privacy (DPDP‑aligned)

- **CMP banner** (granular: analytics / ads / personalization) writing to `consent_log`; **Google Consent Mode v2** signals (`analytics_storage`, `ad_storage`, `ad_user_data`, `ad_personalization`) as the control plane for all Google tags; Meta Pixel and marketing events fire **only after ads consent**; strictly‑necessary + server‑side order records are lawful regardless.
- PII discipline: only SHA‑256‑hashed identifiers leave for ad platforms (CAPI/Enhanced Conversions); nothing raw in the dataLayer; consent state attached to every server emit so worker sends respect revocation.
- Retention: GA4 14 months + BigQuery ownership; honor DPDP erasure by deleting `tracking_events` identity links + PostHog person deletion + Meta/Google data‑deletion requests.

## 6. COD & the purchase‑event timing problem (India‑specific)

COD breaks the "purchase = revenue" assumption (RTO). Two patterns:

| Pattern | How | Trade‑off |
|---|---|---|
| **A — fire at order‑placed (start here)** | `Purchase` for prepaid *and* COD at placement (fresh signal keeps Meta/Google learning fast); send server `refund`/negative adjustment on RTO where supported; track true ROAS in BigQuery/PostHog with RTO joined | Platforms slightly over‑report; your own dashboards correct it |
| **B — split by payment** | Prepaid → `Purchase` at placement; COD → custom `PlaceOrderCOD` at placement + real `Purchase` via CAPI on **delivered** webhook | Cleaner platform ROAS, but delayed conversions (2–7 day delivery) weaken learning & clip attribution windows |

Recommendation: **Pattern A + an RTO‑adjusted ROAS dashboard** (§8); move COD to Pattern B only if RTO stays >20% after the [05](05-orders-logistics.md) playbook. Either way, `cod_delivered` is always emitted server‑side — it's the truth event for finance.

## 7. Performance rules (protect [02](02-frontend.md)'s budget)

GTM/gtag via `@next/third-parties` afterInteractive; Pixel loaded lazily post‑consent, post‑LCP; zero marketing JS on the critical path; heavy vendors (heatmaps etc.) rejected by default — PostHog covers replay/funnels; tags reviewed in the perf budget CI check (bundle + request count). GTG keeps Google requests first‑party without adding client JS.

## 8. QA, monitoring & dashboards

- **QA:** GA4 DebugView + Tag Assistant; **Meta Test Events** (verify "1 event from 2 sources" dedup); Playwright E2E asserts `dataLayer` purchase + server ledger row for every test checkout — a broken pixel fails CI.
- **Runtime monitoring (Marketing‑health admin panel, [07](07-admin-automation.md)):** GA4 purchases vs Medusa orders parity (alert >5% drift), CAPI error rates/retries, EMQ trend, consent opt‑in rate, feed disapprovals.
- **Dashboards (BigQuery + PostHog):** spend ⨝ orders ⨝ RTO → **RTO‑adjusted ROAS by channel/campaign/pincode‑tier**; CAC by channel incl. AI/agentic referrals; abandoned‑cart recovery revenue; UTM governance (enforced param schema, first+last touch stored on order metadata).

## 9. Setup checklist & costs

**Phase‑0/1 checklist:** GA4 property + streams → GTM container (+ GTG on Cloudflare) → Consent Mode v2 + CMP → §2 events client → server `purchase`/`refund` (MP + CAPI, dedup verified) → Google Ads link + Enhanced Conversions → Merchant Center feed → Meta Business Manager: domain verify, dataset/Pixel, catalog, CAPI token → WhatsApp catalog link → BigQuery export → dashboards → CI assertions.

**Costs:** GA4/GTM/GTG/Merchant/BigQuery‑export — free (BQ storage/query pennies at this scale); Meta Pixel/CAPI — free; sGTM if adopted — Cloud Run ~$50+/mo or Stape managed cheaper; CMP — ₹0–3k/mo. The spend is media, not infra.
