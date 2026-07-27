# Single‑Vendor E‑Commerce Platform (India) — Documentation Set

**Version 3.0‑IN · July 2026 · Supersedes the single‑file global & India blueprints**

A production‑grade, AI‑ready architecture for a single‑vendor e‑commerce platform targeting the Indian market: Next.js 16 storefront + Medusa 2.x commerce engine in a Turborepo monorepo, UPI‑first payments, WhatsApp‑first notifications, GST engine, RTO intelligence — and a full **marketing & tracking layer (GA4 e‑commerce, Google Ads, Meta Pixel + Conversions API)** added in this version.

## How to read this set

| File | Covers |
|---|---|
| [01-architecture.md](01-architecture.md) | System architecture, monorepo & repo plan |
| [02-frontend.md](02-frontend.md) | Next.js 16 storefront, design system, India UX & performance |
| [03-backend-data.md](03-backend-data.md) | Medusa 2.x, custom modules, **GST engine**, data layer (Mumbai) |
| [04-checkout-payments.md](04-checkout-payments.md) | Razorpay, UPI‑first checkout, COD + RTO gating, agentic/ONDC |
| [05-orders-logistics.md](05-orders-logistics.md) | Shiprocket/Delhivery, NDR & RTO automation, returns, inventory |
| [06-notifications.md](06-notifications.md) | WhatsApp‑first matrix, DLT SMS, email, push — via Novu |
| [07-admin-automation.md](07-admin-automation.md) | Admin surfaces, India ops panels, AI copilot, automations |
| [08-marketing-tracking.md](08-marketing-tracking.md) | **NEW:** GA4 e‑commerce events, Google Tag/GTM + Tag Gateway + sGTM, Google Ads & Merchant Center, **Meta Pixel + CAPI** (dedup, EMQ), consent under DPDP, RTO‑adjusted ROAS |
| [09-search-ai.md](09-search-ai.md) | Hybrid search, recommendations, AI layer (incl. RTO & address AI) |
| [10-seo-geo.md](10-seo-geo.md) | Technical SEO, automated AI‑SEO pipeline, GEO/llms.txt |
| [11-infra-security-compliance.md](11-infra-security-compliance.md) | Mumbai infra, CI/CD, observability, RBI/DPDP/consumer‑law checklist |
| [12-roadmap-costs.md](12-roadmap-costs.md) | Phased roadmap (code + paperwork), ₹ costs, alternatives compared |

## Stack at a glance

| Layer | Choice |
|---|---|
| Storefront | Next.js 16 (App Router, Cache Components/PPR, Turbopack) · React 19.2 · TS strict |
| UI | Tailwind v4 · shadcn/ui · Motion · tokens in `packages/ui` |
| Commerce | Medusa 2.x (modules + workflows + events) |
| Payments | **Razorpay** (UPI intent, cards w/ tokenization, netbanking, wallets, EMI) · Cashfree backup · COD w/ RTO engine |
| Logistics | Shiprocket / NimbusPost → Delhivery direct at scale |
| Notifications | Novu → **WhatsApp (Meta Cloud API)** · MSG91 DLT SMS · ZeptoMail/Resend · FCM push |
| Data | Postgres+pgvector (Supabase Mumbai) · Redis (Upstash Mumbai) · Meilisearch · R2 |
| Jobs | Trigger.dev v4 · BullMQ |
| AI | Vercel AI SDK 5 · Claude/OpenAI · pgvector RAG |
| **Marketing/Tracking** | **GA4 (e‑com schema) · GTM + Google Tag Gateway + sGTM · Google Ads (Enhanced Conversions) · Merchant Center · Meta Pixel + Conversions API · PostHog · Consent Mode v2 under DPDP** |
| Tax/Compliance | Custom GST module (5/18/40/0) · e‑invoicing‑ready · DPDP · E‑Commerce Rules 2020 |
| Monorepo/CI | Turborepo + pnpm · GitHub Actions · Vercel + AWS Mumbai/DO BLR |

## Reading order

First build: 01 → 03 → 04 → 05 → 02. Growth: 08 → 10 → 09. Ops/legal: 06 → 07 → 11. Planning: 12.

## Decision log (why the big calls went this way)

1. **Medusa over Shopify/Saleor/custom** — ownership + module/workflow extensibility; every India‑specific system (GST, COD, RTO, ONDC) is a first‑class module, not an app‑store workaround.
2. **Razorpay over Stripe** — Stripe is invite‑only in India (exports focus); Razorpay covers UPI/cards/netbanking/wallets/EMI natively.
3. **WhatsApp before email** — it's where Indian customers read messages; utility templates are cheap and effective.
4. **Pixel + CAPI dual‑send with event_id dedup** — browser‑only tracking loses a large share of conversions to blockers/iOS; server events restore signal (see 08).
5. **One typed event contract (`packages/analytics`) feeding GA4, Meta, and PostHog** — a single `track()` per user action; destinations are adapters, so tags never drift from the product.
