# 09 · Search, Recommendations & the AI Layer

## 1. Hybrid search

Meilisearch indexes products (title, brand, category, attributes, price, popularity, review score): <50 ms, typo‑tolerant, faceted, synonyms, pin/boost merchandising. **Semantic layer:** worker embeds every product → pgvector + Meilisearch vector store; queries run keyword ⊕ vector, so "warm jacket for rainy commutes" works like "parka". **India tuning:** Hinglish/transliteration synonym sets (kurti/kurta, saree/sari/sadi, chappal/slipper…), festival‑aware boosts, voice‑query normalization. Zero‑results → vector nearest‑neighbors rescue + logged for SEO ([10](10-seo-geo.md)) and synonym mining. Search analytics (query→CTR→conversion) in PostHog.

## 2. Recommendations v1 (no ML team)

pgvector similarity ("similar items") · co‑purchase counts ("bought together") · decayed‑sales trending · session category‑vector personalization. Upgrade path: dedicated rec model later (`ecommerce-ml`).

## 3. AI capabilities (Vercel AI SDK 5, `packages/ai`)

| # | Capability | Notes |
|---|---|---|
| 1 | Shopping assistant (storefront chat) | RAG over catalog+policies; tools: searchProducts, checkStock, getOrderStatus (auth‑scoped), addToCart; streaming; human handoff |
| 2 | **WhatsApp AI agent** | Same assistant on WhatsApp Cloud API: product Q&A, WISMO deflection, size help, payment links — where Indian customers already are; entry point for Click‑to‑WhatsApp ads ([08](08-marketing-tracking.md) §4.4) |
| 3 | **Hinglish/vernacular support** | Prompt+eval sets for Hindi/Hinglish code‑switching; roadmap +2–3 languages |
| 4 | **RTO risk engine** | Scoring in `rto` ([05](05-orders-logistics.md)); LLM‑explained decisions in admin |
| 5 | **Address intelligence** | Normalizes messy Indian addresses (house/landmark extraction, pincode↔city check, completeness score) at checkout + batch cleanup |
| 6 | Content generation | Descriptions, variant copy, guides, subject lines → `ai-content` drafts, human‑approved |
| 7 | Review intelligence | "What customers say" summaries (+Review schema), issue flags |
| 8 | Admin copilot | Permissioned tools; audit‑logged |
| 9 | Vision | Alt‑text on upload (a11y + image SEO) |
| 10 | AI‑SEO/GEO pipelines | See [10](10-seo-geo.md) |
| 11 | Agent readiness | ACP endpoints + llms.txt + clean schema ([04](04-checkout-payments.md) §6) |

**Model strategy:** Claude for reasoning/copy quality, OpenAI alternate, small cheap model for classification; prompts versioned in‑repo; golden‑set evals in CI.

## 4. Guardrails

AI never mutates orders/prices except via permissioned, audited tools; customer answers cite store data only; PII redaction before external calls; per‑feature spend caps; graceful degradation (search→keyword, chat→FAQ); WhatsApp template‑category compliance lint.
