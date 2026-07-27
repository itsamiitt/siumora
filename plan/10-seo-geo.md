# 10 · SEO Architecture + Automated AI‑SEO & GEO

## 1. Technical foundation

Every indexable page server‑rendered (PPR/ISR) with full HTML; clean URLs (`/products/[handle]`, `/collections/[handle]`, `/blog/[slug]`); curated facet pages indexed, the rest canonicalized. **Metadata** via `packages/seo` builders (titles, descriptions, canonicals, OG/Twitter); dynamic **OG images** per product/collection (`ImageResponse`). **JSON‑LD everywhere:** Product+Offer (INR, availability, priceValidUntil), AggregateRating+Review, BreadcrumbList, Organization+WebSite, FAQPage, Article — CI‑validated; dual‑purpose (rich results **and** AI‑engine machine‑readability). Segmented `generateSitemaps` + image sitemaps, publish pings; preview envs noindexed. `hreflang` scaffolding: `en-IN` now, `hi-IN` later. Core Web Vitals budgets ([02](02-frontend.md)) enforced; GSC + Speed Insights watched by a weekly job that auto‑files issues. Google dominates Indian search — this is the main game; Merchant Center free listings ride the same feed ([08](08-marketing-tracking.md) §3.4).

## 2. Automated AI‑SEO pipeline (worker)

```
Nightly: crawl own catalog/content → missing/stale/thin titles, metas, alt, FAQs
         + GSC API pull (queries, positions, CTR)
         → LLM fixes → ai-content drafts
         → auto-publish low-risk (alt text, missing metas); rest → approval queue
         → revalidateTag + sitemap ping
Weekly:  striking-distance report (pos 5–20) → AI briefs → human edit → publish
         zero-result search terms + GSC gaps → collection/guide proposals
         content decay refresh · CWV regression check → issues
On publish/update: JSON-LD regen+validate · OG render · embeddings · feeds
```

Human‑in‑the‑loop default; every AI edit diffed, attributed, reversible. **Bilingual ops:** pipeline drafts `hi-IN`/Hinglish variants of top guides/FAQs into the queue.

## 3. GEO — Generative Engine Optimization

AI platforms (ChatGPT, Google AI Overviews, Gemini, Perplexity, Claude, Copilot) cite only a handful of domains per answer; GEO is earning those citations. India is among the largest user bases for ChatGPT and Gemini, and AI Overviews are live here — and AI‑referred retail traffic is growing triple‑digit while converting above baseline.

**Content patterns:** answer‑ready opening blocks (what/for whom/key specs); entity clarity (consistent naming, Organization schema, plain‑fact About/policy pages); honest FAQs from real search+support logs; comparison/"best for X" guides kept fresh; original data (review stats, sizing data) that earns citations.

**Machine access:** `llms.txt` (store, key URLs, policies); complete JSON‑LD + semantic HTML; ACP/merchant feeds as canonical product data; AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google‑Extended) **allowed** with Cloudflare rate limits.

**Measurement:** AI‑visibility tracking (Profound/Otterly‑class or a sampling worker) — share of voice vs competitors; AI‑referral sessions segmented in GA4/PostHog with conversion tracked separately; classic GSC + rich‑result coverage.
