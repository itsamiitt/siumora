# TODOS

Deferred work, each item pulled by its trigger — not scheduled. Canonical source:
the launch design doc (`~/.gstack/projects/siumora/aamya-claude-unzip-plan-push-git-4hbvlx-design-20260729-093221.md`,
eng-reviewed 2026-07-29). Context for every row lives there.

| Item | Pull trigger |
|---|---|
| Back-in-stock alerts | First sold-out SKU |
| Product admin CRUD + R2 images (catalog is seed-only) | >1 catalog edit/week, or first non-founder operator |
| Reviews POST route (read-only today) | 50 delivered orders |
| Recommendations | Catalog >60 SKUs or ≥500 sessions/day |
| Meilisearch swap (`packages/core/src/search.ts` names it) | Catalog >500 SKUs or search p95 >100 ms |
| AI assistant + AI-SEO pipeline (plan/09–10 remainder) | ≥1k sessions/day |
| BigQuery export | First funded ad campaign |
| Redis rate limiting + multi-instance API | Sustained CPU >70% or API p95 >300 ms |
| Load test (festival profile, plan/12 Phase 8) | Before first planned campaign/festival spike |
| COD cap raise toward ₹10,000 | Two clean weekly remittance reviews |
| Second PSP (Cashfree, per plan/04) | First Razorpay outage or payment success <95% |
| RazorpayX COD-refund payout automation | First week with >3 COD refunds |
| WhatsApp Cloud API direct (off the BSP) | BSP fees exceed migration cost |
| hi-IN locale | ≥20% Hindi-locale traffic |
| ONDC via TSP, marketplaces | Post-PMF |
| GTM depth — run `/plan-ceo-review` on the launch plan | Before first paid-ad rupee (flagged by eng-review outside voice: success criteria had no acquisition mechanism; a one-paragraph launch channel now exists, the full strategy does not) |
| Server-action flight stream drops "Connection closed." (~1-in-4 E2E runs on Windows `next start`, Next 16.2 canary; E2E recovers like a user — see `apps/e2e/tests/storefront.spec.ts` `addToBag`) | Reproduces on linux CI, or a Next upgrade lands, or it bites a real user |
