# 02 · Frontend — Storefront (`apps/web`)

**Goal:** instant‑feeling, premium‑looking, fully indexable — on a ₹15k Android over 4G.

## 1. Framework & rendering

Next.js 16 (App Router, Turbopack default). Caching via **Cache Components** (`"use cache"` + PPR): static shell from the edge, dynamic holes streamed. React 19.2: View Transitions, `Activity`, `useOptimistic`, React Compiler on. Track 16.3 **Instant Navigations** as it stabilizes.

| Route | Strategy |
|---|---|
| `/` + landing/festival pages | PPR, revalidate hours; personalized rails stream |
| `/products/[handle]` | PPR/ISR, tag‑revalidated on `product.updated`; price/stock streamed fresh |
| `/collections/[handle]` | ISR + Meilisearch client facets; URL‑driven filters |
| `/search` | Dynamic, edge |
| `/cart` `/checkout` `/account` | Fully dynamic; Server Actions |
| `/blog` guides | Static from Payload, ISR on publish |

## 2. Design system & "modern look"

Tailwind v4 + shadcn/ui (Radix) restyled with brand tokens in `packages/ui`; light+dark; `next/font` variable fonts (zero CLS); Motion micro‑interactions with `prefers-reduced-motion`. Component inventory: product card, gallery+zoom, variant picker, sticky mobile add‑to‑cart, reviews block, trust badges, skeletons everywhere async.

## 3. India UX specifics

- **Pincode checker** on PDP + header → serviceability, EDD, COD availability (persisted, feeds checkout).
- **Price convention:** MRP struck through · selling price **inclusive of all taxes** · % off chip · EMI line when eligible ("or ₹1,249/mo · No‑Cost EMI").
- ₹ via `Intl.NumberFormat('en-IN')` (1,00,000 grouping) from `packages/in-locale`.
- `next-intl` scaffolding now; launch `en-IN`, add `hi-IN` later as content. Voice‑search mic on the search bar.
- Festival theming (banners/sales) scheduled from Payload CMS.

## 4. Performance budget (CI‑enforced)

| Metric | Budget |
|---|---|
| LCP (PDP, mid‑range Android/4G) | ≤ 1.8 s |
| INP | ≤ 200 ms |
| CLS | ≤ 0.05 |
| Client JS on PDP | ≤ 150 kB gzip |

Tactics: RSC‑first; `next/dynamic` below the fold; AVIF/WebP via `next/image` + CDN; prefetch on viewport (connection‑aware); PWA installable with offline shell; Vercel functions pinned **bom1**; Lighthouse CI + Speed Insights regression gates. **Marketing tags must respect this budget** — loading rules in [08](08-marketing-tracking.md) §7.

## 5. State & data

Server Components fetch via `packages/sdk`; Server Actions mutate cart with `useOptimistic`; TanStack Query for session/account sync; Zustand for ephemeral UI. Cart ID in HTTP‑only cookie, merged on login. Every meaningful interaction also calls the **typed `track()`** from `packages/analytics` — see [08](08-marketing-tracking.md).
