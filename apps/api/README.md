# apps/api — frozen

This Fastify API is **frozen** (2026-10-25, plan 16 rule R7). Siumora launches on
Medusa (`apps/medusa`), and this app is deleted at the launch gate (plan 16 Phase J).

- **Do not add features here.** Build them in `apps/medusa`.
- **Allowed:** fixes that keep the storefront's `COMMERCE_BACKEND=fastify` path
  working until cutover, and contract-test edits that pin Medusa behaviour
  (`src/sdk-contract.test.ts` drives both transports).
- Its tested adapters (`src/lib/razorpay.ts`, `src/lib/shiprocket.ts`,
  `src/lib/recon.ts`) are the reference implementations to port into Medusa
  providers and jobs (plan 16 W2, W3).

Why: [`plan/17-one-backend.md`](../../plan/17-one-backend.md).
