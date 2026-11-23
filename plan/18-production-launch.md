# 18 · Production Launch Plan

**Status:** Plan · 23 Nov 2026
**Question:** What stands between `main` and a live store taking real orders, and in what order do we do it?
**Short answer:** About **3 engineer-weeks** of work across six tracks, plus a founder track (company registration, KYC, DLT and messaging approvals) that runs in parallel and is the real critical path. Nothing in the engineering tracks waits on the founder track until Track 3 (staging checks with test credentials) and Track 6 (live keys).

This plan sits on top of the existing launch documents. It does not replace them:
- `docs/fastify-retirement.md` holds the launch gate (§1) and the retirement edits (§2).
- `docs/medusa-parity-checklist.md` holds the P0 behaviour bar.
- `docs/track-m-pending.md` holds the "Founder-blocked" list.
- `plan/11-infra-security-compliance.md` holds the target infrastructure.

---

## Progress (updated 23 Nov 2026)

| Track | State | Where |
|---|---|---|
| 0 · Green `main` | ✅ Done. All CI jobs green, including the Medusa contract suite and the Medusa E2E for the first time since October. The Medusa E2E is now blocking (L0.5). Dependabot majors held (L0.6). | `023b999`, `ed298f1`, `5044bc2` |
| 1 · Code gaps | ✅ Done. GST recon job, refund audit rows, phone operators off in production, storefront launch guards, `seed-store.ts`, runbooks. Live check of the recon job pending (Track 3). | `bd9920b` |
| 2 · Infra + deploy | ✅ Code done for AWS Mumbai + Vercel (D1): Dockerfiles (built and booted in CI), Terraform in `infra/aws` (validated in CI) with WAF, CloudWatch alarms (incl. every `[money-alert]`), PITR backups and an optional image domain; `deploy.yml`. **Waiting on:** an AWS account, `terraform apply`, Vercel project, GitHub Environments. | `cbe210f`, `e98eea1`, this commit |
| 3 · Tooling for the checks | ✅ `tooling/load/checkout.k6.js` (G10) and `docs/launch-gate-results.md` (the evidence sheet; G2 recorded). | this commit |
| 3 · Staging checks | ⬜ Needs Track 2 applied and provider test accounts (F3, F5, F6). | — |
| 4 · Retire Fastify | ⬜ After Track 3, by decision. | — |
| 5 · Founder track | ⬜ Not started from the code side. | §Track 5 |
| 6 · Go-live | ⬜ | — |

Found and fixed along the way: on Medusa the order page's `purchase` event had no `event_id`, so GA4/Meta would have counted every sale twice (`ed298f1`).

## 0. Where we are (checked 23 Nov 2026)

| Area | State | Evidence |
|---|---|---|
| CI on `main` | **Red since 25 Oct.** Every job except the secret scan fails. | Run `42475686495` (8 Nov). The runs for `afd8b6f` and `d35ef7b` are also red. |
| Medusa features (plan 16 phases A–I) | Built and unit-tested. **Never run live** against Postgres plus provider test keys. | Plan 16 §7, "Pending" column |
| Fastify | Frozen but still wired in. 47 references block its deletion. | `node scripts/retire-fastify.mjs` |
| Deployment | **Nothing exists.** No Dockerfile, no hosting config, no deploy workflow. | Repo tree |
| Launch gate | 0 of 7 boxes run | `docs/fastify-retirement.md` §1 |
| Legal disclosures | All `NEXT_PUBLIC_LEGAL_*` values are empty. Policy pages show "not ready to publish". | `.env.example`, `apps/web/src/lib/legal.ts` |
| Open Dependabot PRs | 16, all red because `main` is red. They include risky majors: TypeScript 7, ESLint 10, Vite 8, MikroORM 7, awilix 13, ioredis 6. | `gh pr list` |

---

## 1. Decisions needed before work starts

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| D1 | Hosting providers | **Decided 23 Nov 2026: AWS Mumbai + Vercel.** Medusa server, Medusa worker and the outbox worker on **ECS Fargate** in ap-south-1, **RDS Postgres 16** (PITR, Multi-AZ in production), **ElastiCache Redis** (TLS), **S3 + CloudFront** for images, ALB + ACM. Storefront on **Vercel** (`bom1`). Terraform in `infra/aws`, deploys by `.github/workflows/deploy.yml`. Supersedes the DigitalOcean/Supabase/Upstash/R2 topology in L2.1. | Track 2 |
| D2 | Phone-OTP operators (`ADMIN_PHONES`) in production | **Turn the path off in production.** Operators use the Medusa dashboard at `/app`, which has staff MFA. The web `/admin` readout redirects there. This closes the README's "operator access has no second factor" gap without building TOTP. | L1.3 |
| D3 | Launch mode | **Soft launch COD-only, then turn on prepaid** once Razorpay live KYC clears. The kill-switch and `razorpayConfigured` already hide prepaid when keys are absent (plan 16 Phase C). Opening sale no longer waits on KYC. | Track 6 |
| D4 | Launch date | Set it only after the founder track has dates for GSTIN and DLT. These are the long poles (§8). | Track 6 |
| D5 | Google sign-in at launch | Optional. Phone OTP is the primary path. Ship it only if the OAuth consent screen is verified in time. | L5 |
| D6 | Dependabot majors | **Hold all majors until after launch.** Merge only the minor/patch group, once it is rebased on a green `main`. | L0.6 |

---

## 2. Tracks at a glance

| Track | What | Who | Size | Depends on |
|---|---|---|---|---|
| **0** | Make `main` green | Eng | 1 d | — |
| **1** | Close the remaining code gaps | Eng | 4–5 d | 0 |
| **2** | Infrastructure, containers, deploy pipeline, staging | Eng + founder accounts | 4–5 d | 0, D1 |
| **3** | Staging launch-gate checks with test credentials | Eng + founder | 4–5 d of work, about 1–2 weeks of calendar time | 1, 2, test accounts |
| **4** | Retire Fastify | Eng | 2–3 d | 3 green |
| **5** | Founder / business / compliance | Founder | 3–6 weeks of calendar time, parallel | — |
| **6** | Production cutover and go-live | Eng + founder | 2 d plus 72 h of watching | 3, 4, 5 |

---

## Track 0 — Make `main` green (1 day)

Every cause below was confirmed from the CI log and the uploaded E2E traces (`e2e-medusa-traces` artifact of run `42475686495`).

### L0.1 Fastify typecheck: `categories` missing
- **Failure:** `apps/api/src/routes/catalog.ts(16,3): error TS2741: Property 'categories' is missing`.
- **Cause:** f2840b9 added `categories: z.array(handle).default([])` to the core `Product` (`packages/core/src/catalog.ts:69`). The frozen Fastify mapper `toDomain` was not updated.
- **Change:** In `toDomain` in `apps/api/src/routes/catalog.ts`, add `categories: []` (Fastify has no categories). This is allowed under R7, which permits fixes that keep the frozen API running.
- **Done when:** `pnpm turbo run typecheck` passes.

### L0.2 Medusa CI build cannot find `@siumora/core/dist`
- **Failure:** `Cannot find module '.../@siumora/core/dist/index.cjs'` during `medusa build`, so the job never reaches boot or the contract run.
- **Cause:** In `.github/workflows/ci.yml`, the `medusa` job runs `pnpm --filter @siumora/medusa build`. That runs Medusa's own build script without building its workspace dependencies (`core`, `analytics`, `messaging`).
- **Change:** Replace that step with `pnpm turbo run build --filter=@siumora/medusa`. Turbo's `^build` then builds the dependencies first. Make the same change in the `apps/medusa/README.md` instructions if they show the bare filter.
- **Done when:** the `Medusa boots + contract` job reaches `/health` and the SDK contract run passes.

### L0.3 Sign-in E2E: two `alert` elements
- **Failure:** `strict mode violation: getByRole('alert') resolved to 2 elements`. The second element is Next.js's `<div id="__next-route-announcer__" role="alert">`.
- **Second failure, on retry:** the retry reuses the same phone number and hits the real 60-second resend cooldown ("Wait 44s before asking for another code"). The retry therefore cannot pass.
- **Change in `apps/e2e/tests/signin.spec.ts`:**
  - Scope the assertions to the form's alert, for example `page.locator("p[role=alert]")` or `page.getByRole("alert").filter({ hasText: /\S/ })`. A shared helper `formAlert(page)` keeps it in one place.
  - Derive each test's phone from `testInfo.retry`, for example `9811100002` becomes `98111${retry}0002`, so a retry is a fresh number.
- **Done when:** both sign-in tests pass on the first try, and also pass with `--retries=1 --repeat-each=2`.

### L0.4 COD purchase E2E stops at "Verify your number"
- **Failure:** `page.waitForURL(/\/orders\/SIU-\d{5}/)` times out. The trace snapshot shows the **"Verify your number"** sheet open over "Place order · ₹1,939".
- **Cause:** Plan 16 Phase C moved COD verification to a sheet that opens on COD selection. The `cod_requires_otp` setting is on by default. The test never answers the sheet.
- **Change in `apps/e2e/tests/storefront.spec.ts`:**
  - After `cod.check()`, if the sheet is visible, click **Send code**, read the echoed code (same notice the sign-in tests use), and enter it. Then place the order.
  - Move `requestCode`'s echo-reading into a shared `apps/e2e/tests/otp.ts`, used by both specs.
  - Do **not** turn `cod_requires_otp` off in the E2E seed. The test should prove the path a real COD buyer takes.
- **Done when:** the test completes end to end, and the `purchase` dataLayer assertion holds exactly once.

### L0.5 Make the Medusa E2E job blocking
- After two consecutive green runs on `main`, delete `continue-on-error: true` from the `e2e-medusa` job.
- This is required by `docs/fastify-retirement.md` §1, box 2.

### L0.6 Dependabot cleanup
- Close or label `hold-until-post-launch` these PRs: #7 (MikroORM 7), #8 (TypeScript 7), #9 (ESLint 10), #10 (Vite 8), #11 (awilix 13), #12 (tsup 9), #13 (ioredis 6).
- Medusa 2.21.2 pins its own MikroORM and awilix. Bumping either one independently will break the module loader.
- Add `ignore` rules for these majors in `.github/dependabot.yml` until launch + 30 days.
- Rebase #16 (the minor/patch group), and #14/#15 (React) only if they stay within React 19.x. Merge them when green.

### L0.7 (optional, same PR) Lint warnings
- 15 warnings (`setState` inside effects, refs read during render). Leave them for now; they are not errors. Log them in `TODOS.md`.

---

## Track 1 — Close the code gaps (4–5 days)

### L1.1 Daily GST reconciliation job (`TODO(gst-recon-daily)`)
The gst module dropped the Fastify cross-table CHECK constraints on the condition that a daily job proves the books (`modules/gst/issue.ts`, migration header). That job does not exist. It must exist before real invoices go out.

- **New `apps/medusa/src/modules/gst/recon.ts`:** a pure checker with no I/O. Input: orders plus invoices for a window. Output: a list of findings.
- **Rules it checks:**
  1. Every order that is confirmed or later, and not cancelled before confirmation, has **exactly one** invoice.
  2. No invoice exists without an order.
  3. Invoice total (paise) equals order total (paise), including shipping and the COD fee split from plan 16 B3.
  4. Taxable value plus tax equals the line value on every line. Lines sum to the invoice.
  5. IGST and CGST+SGST are mutually exclusive. The choice matches place of supply against `SELLER_STATE_CODE`.
  6. Invoice numbers are unique per financial year. Report any **gaps** in a series (a gap is legal but must be explained).
  7. Every invoiced line has a valid HSN and GST slab.
- **New `apps/medusa/src/modules/gst/recon.test.ts`:** one test per rule, plus a clean-books case.
- **New `apps/medusa/src/jobs/gst-recon.ts`:**
  - Runs daily at 02:30 IST (`schedule: "0 21 * * *"` UTC), using the same structure as `jobs/payment-recon.ts`.
  - Window: the last 7 days, plus a full pass of the current financial year on the 1st of each month.
- **Output of each run:**
  - One audit row per run: `action = gst.recon`, with counts.
  - If there are any findings: a Sentry event at error level, and a "Books need attention" card on the Siumora admin home (reuse the card pattern from the privacy queue).
  - Store the last run in settings (`gst_recon_last_run`) so the card can show "last proved".
- **Done when:** the job runs on staging over the orders from Track 3 with zero findings. A deliberately corrupted test invoice (edited by hand on staging) produces a finding and an alert.

### L1.2 Audit row for paid-but-not-placed refunds (plan 16 B12 remainder)
- **Where:** `apps/medusa/src/lib/checkout-cart.ts` and `api/store/siumora/carts/[cartId]/complete/route.ts`, at the `paid_not_placed` branch. Today it only logs at error level.
- **Change:**
  - Write an audit row with `action = payment.refund_unplaced`, the actor `system`, the cart id, the Razorpay payment id, the amount and the refund id.
  - Queue an operator alert through the outbox.
- **Test:** a unit test asserting the audit write happens once per refund, including on replay.

### L1.3 Phone operators off in production (decision D2)
- **`apps/medusa/src/boot-guards.ts`:** in production, refuse to boot if `ADMIN_PHONES` is set, unless `SIUMORA_PHONE_OPERATORS=allow` (break-glass, named loudly). Add tests to `boot-guards.test.ts`.
- **`apps/medusa/src/lib/customer-signin.ts`:** also return `"customer"` for every phone when the tier is production and the break-glass is not set. This is defence in depth.
- **`apps/web/src/app/admin/page.tsx`:**
  - In production, redirect to `${MEDUSA_ADMIN_URL}/app/siumora`.
  - The readout keeps working in development and staging.
  - Re-homing it later stays a `TODOS.md` row.
- **Docs:** update `README.md` "Not yet safe to publish" and `docs/track-m-pending.md` row 2.

### L1.4 Storefront production guards
- **Today:** `LEGAL_COMPLETE` ("gates opening sale", per `lib/legal.ts`) only changes the notice on policy pages. Checkout does not read it.
- **Change, in a new `apps/web/src/lib/launch-guards.ts` called from `instrumentation.ts`:** when `APP_ENV=production`:
  - Refuse to start if `CONTACT_COMPLETE` is false.
  - Refuse to start if `SITE_PHASE=storefront` and `LEGAL_COMPLETE` is false.
  - Refuse to start if any of these are missing: `MEDUSA_URL`, `MEDUSA_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL` (must not be localhost), `CLIENT_IP_SECRET`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_SENTRY_DSN`.
  - Refuse to start if `COMMERCE_BACKEND=fastify` (until Track 4 removes the seam).
- **Tests:** a unit-tested pure function, in the same style as `boot-guards.ts`.
- **Effect:** a production deploy with no legal details cannot open sale by accident. A coming-soon deploy still works, because it only needs `CONTACT_COMPLETE` for the KYC review.

### L1.5 Production seed split
- **Problem:** `apps/medusa/src/scripts/seed.ts` sets up the essentials (region, INR, sales channel, publishable key, shipping options, the Razorpay and Shiprocket providers on the region) **and** creates demo products with SVG art and demo stock.
- **Change:** split it into:
  - `seed-store.ts`: the essentials. Idempotent and production-safe; it does not reset stock. It needs no `SEED_FORCE`.
  - `seed-catalog.ts`: the demo products, for development, CI, E2E and staging only. Keep the production refusal there.
- Update CI, `apps/e2e/setup/prepare-medusa.ts` and the README to run both. Production runs only `seed-store.ts` plus `seed-serviceability.ts`.
- **Real catalogue:** products are entered through the Medusa dashboard with real photography uploaded to R2. The publish guard (f2840b9) refuses incomplete products.

### L1.6 Update the runbooks for Medusa
Both runbooks still describe Fastify endpoints and phone-OTP owner sign-in. After L1.3 those no longer exist in production.

- **`docs/incident-runbook.md`:**
  - **Primary path:** use the dashboard at `/app` → Store → **Checkout & COD** card → payments off.
  - **API fallback:** `PATCH /admin/siumora/settings` with a Medusa admin token (`{"entries":[{"key":"payments_enabled","value":false}]}`).
  - Verify with `GET /store/siumora/config`.
- **`docs/cod-refund-payout.md`:**
  - Use the order card → **Record COD payout** (`POST /admin/siumora/orders/:number/returns/payout`).
- **New `docs/deploy-runbook.md`** (output of Track 2): how to deploy, migrate, roll back, rotate a secret, and restore the database.

---

## Track 2 — Infrastructure and deploy pipeline (4–5 days)

### L2.1 Topology (from decision D1)

> **Superseded by the D1 decision (AWS Mumbai + Vercel).** The built version
> is `infra/aws` (Terraform) and `.github/workflows/deploy.yml`; see
> `infra/aws/README.md`. The diagram below is the original proposal.

```
Cloudflare (DNS, WAF, bot rules, TLS)
 ├─ siumora.com, www         → Vercel (apps/web, bom1)
 ├─ api.siumora.com          → Medusa server  (MEDUSA_WORKER_MODE=server)  ┐
 │     /store, /admin, /app, /hooks, /webhooks                              │ same image
 │                             Medusa worker  (MEDUSA_WORKER_MODE=worker)  ┘ jobs + subscribers
 ├─ (no public route)          apps/worker (outbox drain → WhatsApp/SMS/GA4/Meta)
 └─ images.siumora.com       → R2 bucket (public read)
Data: Supabase Postgres (ap-south-1, PITR on) · Upstash Redis (Mumbai, TLS)
Observability: Sentry (web, medusa, worker) · uptime monitor on /health and the storefront home
```

- Two environments: **staging** (`staging.siumora.com`, `api-staging.siumora.com`) and **production**.
- Each environment has its own database, Redis and R2 bucket.
- Staging runs `APP_ENV=staging` with test keys. `OTP_ECHO` is allowed there, but leave it off unless an E2E run needs it.

### L2.2 Containers
- **New `apps/medusa/Dockerfile`** (multi-stage):
  - Base image: `node:22-alpine`. Pin to the `.nvmrc` version.
  - Run `corepack enable`, then `pnpm fetch` and `pnpm install --frozen-lockfile --filter @siumora/medusa...`.
  - Run `pnpm turbo run build --filter=@siumora/medusa`.
  - The runtime stage copies `.medusa/server`, then runs `pnpm install --prod` inside it, and **copies `public/admin`** (`medusa start` reads `<cwd>/public/admin`).
  - `CMD ["npx","medusa","start"]`, with a `HEALTHCHECK` on `/health`.
  - The same image runs as server or worker, selected by `MEDUSA_WORKER_MODE`.
- **New `apps/worker/Dockerfile`:**
  - Install with `--filter @siumora/worker...` and build the workspace packages.
  - `CMD ["node","--experimental-strip-types","src/main.ts"]`.
- **New root `.dockerignore`:** exclude `node_modules`, `.next`, `.medusa`, `.git`, `.claude`, `brand-kit`, `plan`, `docs`, `apps/e2e` and `**/test-results`.
- **New CI job `docker`:** build both images on every PR, without pushing. A broken image then fails the PR, not the deploy.

### L2.3 Storefront on Vercel
- Set the project root to `apps/web`.
- Build command: `cd ../.. && pnpm turbo run build --filter=@siumora/web`.
- Node 22. Function region `bom1`.
- **Build ordering matters:** the storefront prerenders product and collection pages from Medusa at build time (README, "Running it"). Medusa must be deployed and reachable **before** the web build. The deploy workflow enforces this order (L2.5).
- Turn on Vercel's Sentry integration and source-map upload (`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`).

### L2.4 Secrets per service
All secrets live in the host's secret store (or Doppler or Infisical, per plan 11), never in git.

| Variable | web | medusa server + worker | apps/worker | Notes |
|---|:-:|:-:|:-:|---|
| `APP_ENV` (`staging`/`production`) | ✓ | ✓ | ✓ | Boot guards key on this, not `NODE_ENV` |
| `SITE_PHASE` | ✓ | | | `coming-soon` for the KYC review, `storefront` at launch |
| `COMMERCE_BACKEND=medusa`, `MEDUSA_URL`, `MEDUSA_PUBLISHABLE_KEY`, `MEDUSA_ADMIN_URL` | ✓ | | | The publishable key comes from `seed-store.ts` |
| `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_LEGAL_*`, `NEXT_PUBLIC_GSTIN`, `NEXT_PUBLIC_CIN`/`LLPIN`, support and grievance details | ✓ | | | From the founder track (F1, F7) |
| `COMING_SOON_PREVIEW_PASSWORD`, `COMING_SOON_PREVIEW_SECRET` | ✓ | | | Only while `SITE_PHASE=coming-soon` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | ✓ | ✓ | | The secret key is required by the Medusa boot guard |
| `CLIENT_IP_SECRET` (≥32 characters, **same value** on both) | ✓ | ✓ | | Required by the boot guard |
| `NEXT_PUBLIC_GTM_ID`, `NEXT_PUBLIC_META_PIXEL_ID` | ✓ | | | |
| `GOOGLE_CLIENT_ID`/`SECRET` | ✓ | ✓ | | Only if D5 is yes |
| `MEDUSA_DATABASE_URL` | | ✓ | ✓ | Use Supabase's pooled URL for the server and the direct URL for migrations |
| `MEDUSA_REDIS_URL` | | ✓ | | `rediss://` (TLS). Required by the boot guard |
| `MEDUSA_WORKER_MODE` | | ✓ | | `server` or `worker` |
| `JWT_SECRET`, `COOKIE_SECRET`, `SIUMORA_TOKEN_SECRET`, `AUTH_EVENT_SECRET` | | ✓ | | Random, ≥32 bytes. Must not be the dev defaults (boot guard) |
| `SETTINGS_ENCRYPTION_KEY` (≥32 characters) | | ✓ | | Seals provider credentials. **Losing it loses every saved credential**: back it up |
| `S3_FILE_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` (+ endpoint/region) | | ✓ | | R2. Required by the boot guard |
| `STOREFRONT_URL`, `STORE_CORS`, `ADMIN_CORS`, `AUTH_CORS` | | ✓ | | Must not be localhost (boot guard) |
| `ADMIN_USER_ROLES` (≥1 `email:owner`) | | ✓ | | Required by the boot guard |
| `SELLER_NAME`, `SELLER_ADDRESS`, `SELLER_GSTIN`, `SELLER_STATE_CODE`, `SELLER_EMAIL`, `SELLER_PHONE` | | ✓ | | Invoices refuse to print without them |
| `RAZORPAY_KEY_ID`/`SECRET`, `RAZORPAY_WEBHOOK_SECRET` | | ✓ | | Or saved in the dashboard under Settings → Integrations (encrypted) |
| `SHIPROCKET_*`, `COURIER_WEBHOOK_SECRET`, `SHIPROCKET_WEBHOOK_TOKEN` | | ✓ | | Same as above |
| `WHATSAPP_BSP_*`, MSG91/SMS, `RESEND_API_KEY`, `EMAIL_FROM`, `MESSAGING_WEBHOOK_SECRET` | | ✓ | ✓ | The OTP send is synchronous on Medusa; the worker drains the rest |
| `OUTBOX_BACKEND=medusa`, `WORKER_INTERVAL_MS` | | | ✓ | |
| `META_PIXEL_ID`, `META_CAPI_TOKEN`, GA4 measurement id and secret | | | ✓ | |
| `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` (= git SHA) | ✓ | ✓ | ✓ | |
| **Must be unset in production** | | `OTP_ECHO`, `COURIER_SIMULATION`, `DISABLE_RATE_LIMITS`, `ADMIN_PHONES` (after L1.3), `SEED_FORCE` | | The boot guard refuses most of these |

- Rotate secrets quarterly (plan 11).
- Write `SETTINGS_ENCRYPTION_KEY` and the database credentials into the founder's password manager as an offline backup.

### L2.5 New `.github/workflows/deploy.yml`
- **Triggers:**
  - `workflow_run` of CI on `main`, conclusion success → deploys to **staging**.
  - `workflow_dispatch` with an `environment: production` input → deploys to **production**. Use a GitHub Environment with required reviewers (the founder).
- **Steps, in order:**
  1. Build and push the `medusa` and `worker` images to GHCR, tagged with the git SHA.
  2. **Migrate:** a one-off run of the medusa image with `npx medusa db:migrate` against the target database. If this fails, stop.
  3. Roll out the Medusa server, then the Medusa worker, then `apps/worker`. Wait for `/health` on the server.
  4. Run `vercel deploy --prebuilt` for web (`--prod` for production) after Medusa is healthy.
  5. Smoke test: `curl /health`, `GET /store/siumora/config`, the storefront home returns 200, and one product page returns 200.
  6. Tag the Sentry release.
- **Rollback:**
  - Redeploy the previous image tag. Vercel's instant rollback covers web.
  - Migrations are forward-only. A migration that must be undone ships as a new migration. Write this rule down in `docs/deploy-runbook.md`.

### L2.6 Data safety
- Turn on Supabase PITR. Add a nightly logical backup (`pg_dump`) to a separate R2 bucket, kept for 30 days.
- **Restore drill:** before go-live, restore the staging backup into a scratch database once and boot Medusa against it. Record the time it took in the deploy runbook.

### L2.7 Monitoring and alerts
- **Sentry:** alerts on any error in `checkout`, `payment`, `webhook`, `gst.recon` or `money-alert` paths. `lib/money-alert-capture.ts` already exists; check that it reaches Sentry in staging.
- **Uptime monitor** (Better Stack or UptimeRobot): check `api.siumora.com/health` and `siumora.com` every minute. Page the founder's phone.
- **Webhook health:** an alert if no Razorpay webhook has landed in 24 h while prepaid orders exist. The recon job covers money, but this catches a broken webhook URL early.
- **Cloudflare WAF:** turn on rate-limit rules on `/store/siumora-auth/otp` and `/store/siumora/coupons` in addition to the app limits. Turn on bot fight mode. Add a carve-out for verified bots (SEO).

---

## Track 3 — Staging launch-gate checks (4–5 days of work, about 1–2 weeks of calendar time)

These are the boxes in `docs/fastify-retirement.md` §1, made concrete. Run them all on **staging** with provider **test** credentials. Record each one in a new `docs/launch-gate-results.md` with the date, the order numbers and screenshots. That file is the evidence the launch decision rests on.

| # | Check | Steps | Passes when |
|---|---|---|---|
| G1 | Migrations and seeds | Run `db:migrate`, `seed-store.ts`, `seed-serviceability.ts` and `seed-catalog.ts` (staging only). Run all three seeds twice. | No errors. The second run changes nothing (idempotent). The four new migrations are applied (returns-ndr `…120000`, `…150000`; outbox `…140000`, `…26100000`). |
| G2 | E2E against staging-shaped Medusa | CI `e2e-medusa` is green and blocking (L0.5). | Two consecutive green runs on `main`. |
| G3 | Money invariant | Place one coupon order with COD, to an inter-state pincode, and one coupon order prepaid, intra-state. | For each order, all five are equal: the quote total, the Pay label, the Razorpay amount, the order total and the invoice total. The GST split is correct (IGST or CGST+SGST). The GSTR-1 export includes both orders. `gst-recon` reports zero findings. |
| G4 | Razorpay (test keys) | (a) A normal prepaid order. (b) Force `paid_not_placed`: pay, then make the cart uncompletable (for example, set stock to 0 between prepare and complete). (c) Block the webhook URL in Cloudflare, pay, and wait for recon. | (a) The order is confirmed and the invoice issued. (b) The refund appears in Razorpay and the L1.2 audit row exists. (c) Recon confirms the order within 15 minutes and does not create a duplicate. |
| G5 | Shiprocket (test account) | Book one order from the order card. Trigger tracking (Shiprocket's test webhook or a signed manual post). Create one return with a reverse pickup. | AWB and label are present. The order moves to shipped, then delivered, from the webhook and is audited as the courier. The reverse pickup is booked. **The account plan includes push webhooks (written confirmation).** |
| G6 | Worker on the Medusa outbox | Use real WhatsApp/SMS test templates, GA4 debug mode and the Meta test-event code. | One order-confirmed message is received on a phone. One purchase conversion appears in GA4 DebugView and in Meta's Test Events with the same event id. One delivery receipt moves the message to delivered. One cart reminder queued at 22:00 is held until morning. |
| G7 | Admin pass in a browser | As an owner with MFA enrolled: the order card (gift message, payout, restock), the privacy queue (complete one erasure), a remittance CSV upload, and the Store → Checkout & COD switches. As a `support` role: confirm the money desk is refused. | Every action lands in the audit log with the right actor. The erasure leaves no PII in the outbox (spot-check SQL). |
| G8 | Kill-switch drill | Follow the updated `docs/incident-runbook.md`. | Checkout shows "paused" within 30 s with no deploy. Turning it back on restores checkout. The audit row is present. |
| G9 | COD return payout drill | Follow the updated `docs/cod-refund-payout.md` on one COD order: deliver, return, receive, pay (₹1 test UPI), record. | Recorded once; a second attempt gets `409 already_paid`. Restock puts the unit back once. |
| G10 | Load test | Run `tooling/load/otp-routes.k6.js` against staging. Add a browse-and-checkout scenario at 10× the expected launch-day peak. | p95 under 300 ms on the store API. No 5xx. Rate limits refuse rather than fall over. Redis and Postgres connection counts stay under their plan limits. |
| G11 | Security pass | Run `/cso` (gstack) on the repo. Check response headers on staging (CSP, HSTS). Confirm the webhook routes reject unsigned posts. Confirm `/app` requires MFA for every staff user. | No high or critical findings left open. |
| G12 | Backup restore | L2.6 drill. | Restore works. Time is recorded. |
| G13 | KYC site review (B33) | Deploy **production** with `SITE_PHASE=coming-soon`, `CONTACT_COMPLETE` true, policies published, and pricing visible through the PIN preview. Give the URL to Razorpay. | Razorpay accepts the site for review. |

---

## Track 4 — Retire Fastify (2–3 days, after G1–G12 pass)

Follow `docs/fastify-retirement.md` §2 exactly. In summary:

1. Tag the current commit `pre-fastify-retirement` and push the tag. This is the rollback point.
2. **CI:** delete the Fastify steps from the `check` job (`@siumora/db` migrate and seed, "Start the API", and the `E2E_BACKEND: fastify` run). Keep typecheck and test. The Medusa E2E becomes the only E2E.
3. **`.env.example`:** remove the Fastify-only blocks (`DATABASE_URL`, `API_URL`, `NEXT_PUBLIC_API_URL`, `CORS_ORIGINS`, `PORT`, `TOTP_ENCRYPTION_KEY` and `COMMERCE_BACKEND=fastify`).
4. **`apps/web/src/lib/commerce-backend.ts` (and its test):** construct the Medusa client only. Remove the Fastify branches from the waitlist route and from `coming-soon/admin`. Then drop the L1.4 `COMMERCE_BACKEND` guard (the seam no longer exists).
5. **`packages/sdk`:** move the shared types out of `SiumoraClient`. Delete the class, `createClient` and `paymentFlow: "order-first"`.
6. **`apps/worker`:**
   - Swap `@siumora/db`'s `createPool` for `pg`'s `Pool`.
   - Read only `MEDUSA_DATABASE_URL`.
   - Delete `drizzleStore` and the Fastify cases in `drain.test.ts`.
7. **`apps/e2e`:** delete `setup/prepare-db.ts` and the Fastify branches. Remove the backend skip from `signin.spec.ts`.
8. **`packages/dist-smoke`:** drop the `@siumora/db` entries.
9. Rewrite the run instructions in `README.md` and `apps/api/README.md` for Medusa only.
10. On a clean tree, `node scripts/retire-fastify.mjs` must report nothing. Then run `node scripts/retire-fastify.mjs --apply`, `pnpm install`, typecheck, test and E2E. Commit the deletion **on its own**.
11. Update plan 16 Phase J and the parity checklist's launch-scope table.

---

## Track 5 — Founder / business / compliance (parallel, starts day 1)

None of these can be done in code. The ones marked ⏱ have outside lead times and set the launch date.

| # | Item | Lead time | Unblocks |
|---|---|---|---|
| F1 ⏱ | Legal entity (private limited, LLP or proprietorship), then **CIN/LLPIN** | 1–3 weeks | F2, F3, the legal env values |
| F2 ⏱ | **GSTIN** registration | 1–3 weeks after F1 | Invoices (`SELLER_GSTIN`), `LEGAL_COMPLETE`, Razorpay KYC |
| F3 ⏱ | **Razorpay** account: test keys now, then live KYC (needs F2 plus G13) | Test keys immediately; KYC 3–10 working days | G4, prepaid at launch |
| F4 ⏱ | **DLT registration** (entity plus header plus content templates) for SMS OTP and transactional SMS | 1–2 weeks | SMS OTP fallback in production |
| F5 ⏱ | **Meta Business verification** and WhatsApp BSP onboarding. Get these templates approved: `order_confirmed`, `cod_confirm`, `order_shipped`, `out_for_delivery`, `delivery_failed`, `order_delivered`, `refund_processed`, `cart_reminder` (marketing category), plus the OTP authentication template | 1–3 weeks | G6, customer messages |
| F6 | **Shiprocket** account, KYC, pickup address (`SHIPROCKET_PICKUP_LOCATION`), a plan with push webhooks, and confirmed COD remittance terms | 3–7 days | G5 |
| F7 | Legal values: registered name and address, support email and phone, **grievance officer** name and email (Consumer Protection E-Commerce Rules 2020) | With F1 | L1.4 guard, policy pages, G13 |
| F8 | Have a lawyer review the privacy, terms, returns, shipping and grievance pages (DPDP notice and consent wording) | 1 week | Go-live |
| F9 | **Domain** registered and moved to Cloudflare. Business email. **Resend** sending domain (SPF, DKIM, DMARC) | 1–2 days | Track 2, email verification |
| F10 | Hosting accounts (Vercel, DigitalOcean, Supabase, Upstash, Cloudflare R2, Sentry, uptime monitor) with a company card. Add the engineer as a member | 1 day | Track 2 |
| F11 | Cloudflare **Turnstile** site. **GA4** property and measurement-protocol secret. **Meta Pixel** and CAPI token. Google OAuth client and consent screen (if D5 is yes) | 1–2 days (OAuth verification can take longer) | G6, L1.4 |
| F12 | Product **photography** and copy for the launch SKUs. Real stock counts. HSN and GST slab per product, MRP and price | 1–3 weeks | Catalogue entry (L1.5) |
| F13 | Pincode serviceability data from Shiprocket, imported through the admin serviceability CSV import (plan 16 B25) | 1 day after F6 | COD and serviceability accuracy |
| F14 | A business current account with UPI for COD refund payouts (G9) and Razorpay settlement | 1 week | G9, Razorpay live |
| F15 | Staff list for the dashboard. Each person enrols MFA. Set `ADMIN_USER_ROLES` | 1 day | Go-live |

---

## Track 6 — Production cutover and go-live (2 days, plus 72 h of watching)

**Entry criteria:**
- Tracks 0–4 are done.
- Every item in `docs/launch-gate-results.md` is green, or waived in writing.
- F1–F2, F5–F9, F12 and F15 are done.
- F3 is done if launching with prepaid; F4 is done if relying on the SMS fallback.

**Day −1:**
1. Deploy production with `SITE_PHASE=coming-soon` (it may already be live from G13).
2. Run migrations, `seed-store.ts` and `seed-serviceability.ts`. **Do not run `seed-catalog.ts`.**
3. Enter the real catalogue in the dashboard. The publish guard confirms each product is visible.
4. Save the **live** provider credentials in Settings → Integrations: Razorpay live (or leave it unset for COD-only, per D3), Shiprocket, WhatsApp/SMS.
5. Set the webhook URLs:
   - Razorpay → `https://api.siumora.com/hooks/payment/razorpay_razorpay`. Confirm the exact path from the provider id `pp_razorpay_razorpay` and the Medusa docs during G4.
   - Shiprocket → `https://api.siumora.com/webhooks/courier`.
   - BSP → `https://api.siumora.com/webhooks/messaging`.
6. Review the settings: COD cap and floor, `cod_requires_otp`, free-shipping threshold, `payments_enabled = true`, gift and cart-recovery switches.
7. Founder test with the PIN preview: one real COD order to the founder's own address. If prepaid is on, also one real ₹-paid order, which is then refunded. Check the WhatsApp message, the invoice PDF, the GA4 and Meta purchase, and the Shiprocket booking.

**Launch:**
1. Set `SITE_PHASE=storefront` on Vercel and redeploy. The L1.4 guard refuses this if the legal details are incomplete.
2. Smoke test as an anonymous visitor on mobile and desktop: home, collection page, PDP, bag, checkout to the payment step.
3. Announce.

**First 72 hours:**
- Look at Sentry and the uptime monitor every 2 hours during waking hours.
- Read `gst-recon` and `payment-recon` output each morning.
- Check the outbox card on the Siumora home for stuck messages.
- Check every order manually: payment, invoice, booking.

**Rollback levers, fastest first:**
1. The payments kill-switch (seconds, no deploy).
2. `SITE_PHASE=coming-soon` (one Vercel redeploy).
3. Vercel instant rollback, or redeploying the previous image tag.
4. Restore from PITR (only for data corruption; follow the deploy runbook).

---

## 7. Sequence and estimate

```
Week 1   T0 green main (d1) → T1 code gaps (d2–5)      ║ T2 infra starts once D1 + F10 are done
Week 2   T2 containers, deploy, staging (d1–5)          ║ F1–F6, F9–F11 in flight
Week 3   T3 staging checks G1–G12 (needs F3/F5/F6 test access)
Week 4   T4 retire Fastify · G13 KYC review on production coming-soon
Week 5+  Waiting on F2/F3/F4/F5 approvals → T6 go-live
```

- **Engineering:** about 15–18 days for one engineer. With two engineers, Tracks 1 and 2 overlap and it is about 10–12 days.
- **Critical path:** F1 → F2 → F3 live KYC, and F4/F5 template approvals. With D3 (COD-only soft launch), only F1, F2, F5 and F7 have to finish before the first real order.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Live provider behaviour differs from the ported unit tests (plan 16 B10/B14 were never run live) | G4 and G5 exist for this. Budget 2–3 days of fixes inside Track 3. |
| Redis is a single point of failure (accepted at eng review D4) | Upstash's paid tier has replication. The kill-switch and uptime alert are the response. The resilience work stays in `TODOS.md`. |
| The storefront build depends on Medusa being up | The deploy order is enforced in L2.5. A failed Medusa deploy blocks the web deploy instead of shipping a broken build. |
| Losing `SETTINGS_ENCRYPTION_KEY` makes every saved credential unreadable | Keep an offline backup (L2.4). Re-entering credentials in the dashboard is the recovery. |
| Medusa 2.21 upgrade drift from Dependabot majors | D6: hold majors until launch + 30 days. |
| The "Connection closed" server-action flake (`TODOS.md`) shows up on Linux CI | `addToBag` in the E2E suite already recovers like a user does. Watch G2. If it bites a real user, pull the TODO. |

## 9. Definition of done

- `main` is green with Medusa-only CI. Fastify is deleted, and the rollback tag is pushed.
- `docs/launch-gate-results.md` shows G1–G13 green, or waived in writing.
- Production boots with every boot guard satisfied. The storefront guard confirms the legal details are complete.
- One real order per enabled payment method has been placed, invoiced, booked and messaged in production.
- The incident, payout and deploy runbooks describe the Medusa stack and have each been followed once.
