# 12 · Roadmap, Costs & Alternatives

## 1. Phased roadmap (~13–15 weeks, 2–3 senior devs; paperwork starts Day 1)

| Phase | Wks | Code | Paperwork/parallel |
|---|---|---|---|
| 0 Foundation | 1–2 | Monorepo, CI/CD, Mumbai infra, tokens, phone‑OTP auth | Company+current a/c, **GSTIN**, **Razorpay/Cashfree KYC**, **TRAI DLT** (entity+header+templates, 1–2 wk), **Meta Business verification + WhatsApp** name/templates (1–2 wk), Shiprocket KYC, policy pages, grievance officer, **GA4/GTM/Merchant/Meta Business Manager accounts + domain verification** |
| 1 Catalog+storefront | 2–3 | Medusa config, import, PDP/PLP/home (PPR), search v1, media, CMS, pincode/EDD on PDP | Merchant Center feed draft |
| 2 Checkout+payments | 2 | Cart (optimistic), single‑page checkout, Razorpay (UPI intent/cards/netbanking), **COD v1+fees**, GST engine v1, webhooks, E2E | **Tracking v1: GA4 events + Consent Mode + Pixel; purchase dedup (client+CAPI) verified in Test Events** |
| 3 Logistics+orders | 2 | Shiprocket, tracking, GST invoice PDFs, portal, returns | — |
| 4 Notifications+automation | 1–2 | WhatsApp journeys, NDR automation v1, DLT SMS, ops alerts, dashboards | — |
| 5 SEO foundation | 1 | Metadata/JSON‑LD/sitemaps/OG, CWV gates | GSC verified |
| 6 AI v1 | 2 | Embeddings+hybrid search, assistant (incl. Hinglish), address intelligence, **RTO scoring v1** | — |
| 7 Growth layer | 1–2 | AI‑SEO/GEO pipelines, llms.txt, ACP feed, **Google Ads Enhanced Conversions, Meta catalog + Advantage+, RTO‑adjusted ROAS dashboard, BigQuery export** | Ad accounts funded |
| 8 Harden+launch | 1 | Festival load test, PG failover drill, DPDP request flow, security pass | Soft launch → GA |
| Post‑launch | — | ONDC via TSP, marketplaces, loyalty, `hi-IN`, `apps/mobile`, WhatsApp AI agent GA | — |

## 2. Indicative monthly costs (₹, early stage; ₹≈86/USD)

| Item | ₹/mo |
|---|---|
| Vercel Pro | 1,700–3,400 |
| API+worker+Meili (DO BLR / small ECS) | 2,500–8,000 |
| Supabase Postgres (Mumbai) | 2,200–6,000 |
| Upstash Redis | 850–1,700 |
| ZeptoMail | 200–800 |
| MSG91 SMS/OTP (~₹0.15–0.25/SMS) | 500–2,500 (+DLT one‑time ~6,000) |
| WhatsApp utility msgs + BSP plan | 1,000–5,000 |
| Novu / Trigger.dev | 0–2,500 |
| Cloudflare (R2/Images/WAF) | 400–2,000 |
| Sentry+Axiom+uptime | 2,500–5,000 |
| PostHog | 0–4,000 |
| LLM APIs (capped) | 2,500–12,000 |
| **GA4/GTM/Tag Gateway/Merchant/BigQuery export** | **0** (BQ pennies) · sGTM if adopted ~1,700–4,500 · CMP 0–3,000 |
| Shiprocket plan | 0–2,000 (+freight ~₹28–45/500g; COD fee ~₹40–60 or 1.5–2%) |
| **Infra total (ex‑freight/PG/media spend)** | **≈ 15,000–60,000** |
| Razorpay | ~2%+GST cards/most methods; UPI cheapest rail (confirm current terms) |

COD/RTO discipline ([05](05-orders-logistics.md)) moves unit economics more than any infra line.

## 3. Alternatives (honest India comparison)

| Stack | Best when | Trade‑offs |
|---|---|---|
| **A. This doc (Next.js+Medusa)** | Ownership, AI‑native, no platform fees, full COD/RTO/GST/tracking control | You run the backend |
| B. Shopify (India) + Razorpay/PayU app + GoKwik/Shiprocket Checkout | Fastest launch (standard D2C combo) | No Shopify Payments in India; checkout/customization ceilings; app costs stack; GST/e‑invoice via paid apps; data outside |
| C. WooCommerce | Tight budget, WP familiarity | Plugin sprawl, perf/security upkeep |
| D. Indian SaaS (Fynd/StoreHippo‑class) | Non‑technical founder, ONDC bundled | Lock‑in, limited extensibility |
| E. Magento/Adobe | Enterprise legacy | Heavy ops/cost |

Rule: need to launch in <4 weeks → **B** now with this set as the migration target; building a brand on owned data + AI‑led ops → **A** compounds fastest.

## 4. Key sources

Next.js 16.x (nextjs.org/blog) · Medusa 2.0 (medusajs.com/v2-overview) · Stripe India invite‑only (docs.stripe.com/india-accept-international-payments) · UPI share & apps (PPRO; NPCI cap news) · India checkout ~35–45% & COD/prepaid shift (productgrowth.in 2026) · GST 2.0 slabs (ClearTax/PIB) · DPDP Rules Nov 2025 → 13 May 2027 (Shardul Amarchand; TCSA) · ONDC 2026 (Shiprocket; indiapolicyhub) · ACP (Stripe/OpenAI docs) · GEO 2026 (Search Engine Land) · **Google Tag Gateway + sGTM combined setup (developers.google.com/tag-platform; Bounteous/XPON 2026) · Meta CAPI dedup + EMQ (Meta docs ecosystem; implementation guides 2025–26)**. Verify live pricing/thresholds with providers and your CA — they move often in India.
