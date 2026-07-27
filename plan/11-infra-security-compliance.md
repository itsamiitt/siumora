# 11 · Infrastructure, Security & India Compliance

## 1. Infrastructure (Mumbai‑pinned)

| Piece | Choice |
|---|---|
| Frontends | Vercel (functions **bom1**) + Cloudflare India PoPs (CDN/WAF/bots + **Google Tag Gateway**) |
| API + worker + Meilisearch | DigitalOcean Bangalore or Render (SGP) → AWS Mumbai ECS Fargate at scale |
| Postgres | Supabase (aws ap‑south‑1) or RDS Mumbai (+pgvector, PITR) |
| Redis | Upstash (Mumbai) |
| Objects | Cloudflare R2 (APAC hint) |
| Jobs | Trigger.dev cloud |
| Secrets | Doppler/Infisical → Vercel/host/Actions; quarterly rotation |

Environments: local (docker compose) → per‑PR preview (Vercel + branch/seeded DB) → staging → prod. Rollbacks instant on Vercel; blue‑green for API containers.

## 2. CI/CD & quality gates

GitHub Actions: lint+typecheck → Vitest → build affected (Turborepo remote cache) → **Playwright E2E: browse → add to cart → Razorpay test‑mode pay → order lands → `dataLayer` purchase + tracking‑ledger row asserted** → preview deploys → protected main auto‑deploy. Checkout E2E and the tracking assertion are required checks. Lighthouse CI budget gates ([02](02-frontend.md)). Renovate + `pnpm audit` + Trivy scans.

## 3. Observability & load

Sentry (FE+BE, release health) · OpenTelemetry traces storefront→API→worker · Axiom logs w/ request IDs · Better Stack uptime+status page. Alert policy: page on checkout/payment/webhook failures **and order↔GA4 parity drift >5%**; ticket the rest. k6 load tests before festival sales (size 10× baseline); sale‑day plan: static fallback PDPs, checkout entry queue, reservation TTLs, PG failover toggle rehearsed.

## 4. Security baseline

CSP + security headers · Zod at every boundary · CSRF‑safe Server Actions · output encoding · rate limits on auth/OTP/checkout/search/agent endpoints (OTP abuse is a favorite Indian bot target) · Cloudflare WAF + bot rules with carve‑outs for legit AI crawlers · webhook signature verification + idempotency everywhere · admin 2FA + passkeys · RBAC + audit logs · least‑privilege IAM.

## 5. India compliance checklist

**Payments (RBI):** card‑on‑file **tokenization** via the PG vault (never store PANs); payment‑system **data localization** is the PG's obligation — never proxy/store raw payment data.

**DPDP Act 2023 + Rules 2025** (notified 13–14 Nov 2025; Board live; consent‑manager phase from Nov 2026; **full compliance 13 May 2027**; penalties to ₹250 crore):
- Plain‑language notice + **granular consent** (checkout, marketing, cookies/tracking — the CMP of [08](08-marketing-tracking.md) §5) with itemized purposes → `consent_log`.
- Data‑principal rights: access/correction/erasure flows in admin spanning Medusa, PostHog, GA4/BigQuery, Novu, WhatsApp logs, Meta/Google deletion requests; 90‑day grievance ceiling.
- Breach playbook: notify Board + affected users with prescribed content within the 72‑hour window.
- Retention schedule (tax/order data per GST law; marketing minimized); cross‑border = blacklist model — Mumbai‑pinned data keeps it simple; 18+ guard where relevant, no tracking ads to minors.

**Consumer Protection (E‑Commerce) Rules 2020:** grievance officer appointed + published; **48h acknowledgment / 1‑month resolution** SLAs (tracked in admin); disclosures: legal entity, **country of origin per listing**, full price breakup, return/refund/warranty policy, shipper details; no manipulated reviews — align with **IS 19000** (verified‑purchase badges enforced by the `reviews` module).

**Legal Metrology:** MRP (inclusive of all taxes), net quantity, manufacturer/importer, best‑before where applicable on packaged‑goods listings.

**GST:** GSTIN displayed; correct invoice series; e‑invoicing switch ready ([03](03-backend-data.md) §3).
