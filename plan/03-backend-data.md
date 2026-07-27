# 03 · Backend, Custom Modules & Data Layer

## 1. Commerce engine — Medusa 2.x

Decoupled commerce modules (Product, Cart, Order, Payment, Inventory, Promotion, Customer, Fulfillment, Auth, Tax) orchestrated by a **workflow engine** (retries + compensation), a built‑in **event bus**, module links, API routes, scheduled jobs, and an extensible Admin (widgets/UI routes). TypeScript end‑to‑end; `packages/core` schemas shared verbatim.

## 2. Custom modules

| Module | Purpose |
|---|---|
| `gst` | Tax provider: HSN→slab, inclusive‑price math, CGST/SGST vs IGST, invoices (§3) |
| `cod` | COD eligibility, fees, OTP confirm, partial‑payment links |
| `rto` | Risk features + scores + decision log (see [05](05-orders-logistics.md)) |
| `pincode` | Serviceability cache, EDD, state/zone mapping |
| `reviews` | Verified‑buyer reviews → AggregateRating schema + AI summaries |
| `wishlist` | Saved items, back‑in‑stock intent |
| `ai-content` | AI drafts with approve/publish states (human‑in‑the‑loop) |
| `seo-meta` | Per‑entity overrides, canonical rules |
| `agent-commerce` | ACP feed + agentic checkout endpoints |
| `ondc` | Beckn/TSP bridge (phase 2+) |

## 3. The GST engine (post–GST 2.0)

1. **HSN registry** on every variant → slab under the 22 Sep 2025 structure: **0% · 5% · 18% · 40%** (e.g., garments ≤ ₹2,500 → 5%, above → 18%).
2. **Inclusive‑MRP math:** `taxable = price × 100/(100+rate)` at invoice time.
3. **Place of supply:** ship‑to state vs registered state → CGST+SGST (intra) or IGST (inter).
4. **Composite supply:** shipping taxed at principal‑goods rate.
5. **Invoices:** FY‑sequential series, seller GSTIN, optional buyer GSTIN (B2B), HSN‑wise summary, tax breakup → PDF in worker → R2 → WhatsApp/email.
6. **E‑invoicing ready:** feature‑flagged GSP push (ClearTax/Cygnet) for IRN+QR once turnover crosses the mandate threshold (₹5 crore under current rules).
7. **Reports:** GSTR‑1‑friendly export; monthly summary in admin.

## 4. API strategy

Store API via generated typed client (`packages/sdk`, Zod‑validated); Admin API for dashboards; webhook routes (Razorpay, couriers, Novu, **Meta/Google diagnostics**) signature‑verified + idempotent (Redis event‑ID dedup); idempotency keys on order/payment mutations; Upstash rate limits on auth/OTP/checkout/agent endpoints.

## 5. Data layer (Mumbai)

| Store | Tech | Use |
|---|---|---|
| Primary DB | Postgres 16/17 — Supabase (aws ap‑south‑1) or RDS Mumbai | Commerce (Medusa), CMS (Payload), custom tables |
| Vectors | pgvector (HNSW) | Product/content embeddings — search, recs, RAG |
| Cache/queues | Redis (Upstash Mumbai) + BullMQ | Sessions, locks, rate limits, fan‑out |
| Search | Meilisearch (hybrid) | Faceted + typo‑tolerant + semantic |
| Objects | Cloudflare R2 (APAC hint) | Media originals, invoice PDFs, exports |
| Events | PostHog + GA4/BigQuery (see 08) | Behavioral + marketing analytics |

Auxiliary tables (Drizzle, `packages/db`): `rto_scores`, `ndr_events`, `cod_remittances`, `pincode_serviceability`, `gst_invoices`, `wa_message_log`, `dlt_templates`, `consent_log`, **`tracking_events` (event_id ledger for dedup/audit — see 08)**.

**Sync pipeline:** `product.updated` → worker → Meilisearch doc + embedding + `revalidateTag` + **Merchant/Meta feed rows**. One event, five projections. Neon‑style DB branching per PR via Supabase branching or a seeded preview DB; PITR backups + quarterly restore drill.
