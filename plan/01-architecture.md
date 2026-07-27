# 01 · System Architecture & Repository Plan

## 1. Principles

- **Headless & composable:** storefront, admin, agents, and channel adapters all consume the same commerce APIs.
- **Event‑driven:** Medusa emits (`order.placed`, `cart.updated`, `product.updated`, `shipment.updated`…); workers subscribe. User‑facing paths never block on email/tracking/SEO work — including marketing events (server‑side GA4/Meta sends ride the same bus, see 08).
- **Two render tiers:** cached/PPR for catalog & content; fully dynamic for cart/checkout/account.
- **One database, two superpowers:** Postgres for transactions + pgvector for AI.
- **Mumbai‑pinned:** compute and data near the users.

## 2. Architecture diagram

```
 Shoppers (80%+ mobile) · WhatsApp users · AI agents · ONDC buyer apps
 Google/Meta shopping surfaces · Googlebot/AI crawlers
                          │
             ┌────────────▼─────────────┐
             │  Cloudflare (India PoPs) │ CDN · WAF · Bot mgmt
             │  + Google Tag Gateway    │ (first‑party Google tags — see 08)
             └────────────┬─────────────┘
     ┌────────────────────┼──────────────────────────────┐
     ▼                    ▼                              ▼
┌───────────┐      ┌────────────┐             ┌────────────────────────┐
│ apps/web  │      │ apps/admin │             │ Channel adapters       │
│ Next.js 16│      │ Medusa Adm │             │ ONDC · WhatsApp comm.  │
│ Vercel    │      │ + ops ext. │             │ ACP agent feed ·       │
│ (bom1)    │      └─────┬──────┘             │ marketplace feeds      │
└─────┬─────┘            │                    └───────────┬────────────┘
      └─────────┬────────┘                                │
                ▼                                         │
   ┌──────────────────────────────┐                       │
   │ apps/api — Medusa 2.x        │◄──────────────────────┘
   │ core + custom modules:       │
   │ gst · cod · rto · pincode ·  │
   │ reviews · ai-content · ondc  │
   └───────┬──────────────┬───────┘
    events │              │ data
           ▼              ▼
┌────────────────┐  ┌───────────────────────────────┐
│ apps/worker    │  │ Postgres+pgvector · Redis ·   │
│ Trigger.dev:   │  │ Meilisearch · R2 media        │
│ NDR/RTO · COD  │  │ (all Mumbai region)           │
│ recon · AI-SEO │  └───────────────────────────────┘
│ WhatsApp flows │
│ GA4-MP + CAPI  │◄─ server-side marketing events (08)
└───────┬────────┘
        ▼
┌───────────────────────────────────────────────────────────────────┐
│ Integrations: Razorpay/Cashfree · Shiprocket/Delhivery · Meta     │
│ WhatsApp Cloud API · MSG91 · ZeptoMail · ClearTax · GA4/GTM/sGTM  │
│ · Google Ads/Merchant Center · Meta Pixel+CAPI · PostHog · Sentry │
│ · Anthropic/OpenAI · GSC API                                      │
└───────────────────────────────────────────────────────────────────┘
```

## 3. Monorepo (Turborepo + pnpm)

```
ecommerce/
├── apps/
│   ├── web/            # Next.js 16 storefront (route groups: marketing/shop/checkout/account)
│   ├── admin/          # Medusa Admin + custom widgets & UI routes (India ops panels)
│   ├── api/            # Medusa 2.x: modules, workflows, subscribers, webhook & agent routes
│   └── worker/         # Trigger.dev tasks: automations, AI pipelines, server-side tracking
├── packages/
│   ├── ui/             # Design system (shadcn/ui, Tailwind v4 preset, tokens)
│   ├── core/           # Domain types, Zod schemas, constants
│   ├── sdk/            # Typed client for Medusa Store/Admin APIs
│   ├── analytics/      # ★ Typed event contract + GA4/Meta/PostHog adapters (see 08)
│   ├── ai/             # Prompts, AI SDK helpers, embeddings/RAG, evals
│   ├── emails/         # React Email templates
│   ├── wa-templates/   # WhatsApp template payload builders
│   ├── seo/            # Metadata builders, JSON-LD, sitemap helpers
│   ├── gst-utils/      # HSN/slab types, invoice math (shared web+api+worker)
│   ├── in-locale/      # ₹ Indian formatting, en-IN/hi-IN, state lists
│   ├── db/             # Drizzle schema for auxiliary tables
│   └── config-*/       # eslint + tsconfig bases
├── tooling/            # docker compose (pg/redis/meili), scripts, seeders
├── .github/workflows/  # CI: lint → typecheck → test → build (affected) → E2E → deploy
├── turbo.json          # task graph + remote cache
└── pnpm-workspace.yaml
```

**Rules:** apps→packages only (never the reverse); cross‑app contracts live in `core`/`sdk`/`analytics`; `--filter=...[origin/main]` affected builds; syncpack‑aligned deps.

## 4. Other repositories

| Repo | When | Contents |
|---|---|---|
| `ecommerce-infra` | On moving to AWS Mumbai | Terraform/OpenTofu, env config, runbooks |
| `apps/mobile` (in monorepo) | Post-launch | Expo RN app reusing core/sdk/ui tokens |
| `ecommerce-ml` | Only if training custom models | Python pipelines (e.g., RTO model v2) |

Default: **one monorepo**; split only for different toolchains.
