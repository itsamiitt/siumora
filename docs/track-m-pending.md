# Track M — pending work

State as of 2026-08-26. The Medusa re-platform (design doc
`...design-20260730-123957.md`) through M2 wave A plus the **admin wave**
(M4 pulled forward, 2026-08-26): stock Medusa Admin live at `/app` with
email+password sign-in, India-fields + order-ops widgets, four Siumora ops
pages, the scoped ops API surface (rows 3 and 8 below), and the SDK admin
reads flipped — contract **21 of 24** ported, 24/24 green both modes.
Companion to [`medusa-parity-checklist.md`](medusa-parity-checklist.md) (the
207-behavior bar, 24 ticked) and the repo-root `TODOS.md` (trigger-pulled
items, none of which belong here).

## Done, for orientation

- **M0** — dist builds, Medusa app + boot guards, CI cold-boot job, parity
  checklist, SDK contract suite (24 recorded shapes).
- **M1** — order identity (SIU numbers + guest access keys), phone-OTP auth
  provider, rate-limit middleware, COD checkout + guest order read, the
  Medusa transport (`@siumora/sdk/medusa`) with catalogue/cart/auth/checkout,
  `COMMERCE_BACKEND` seam live in the storefront.
- **M2 wave A** — gst module (statutory series, stored invoice, PDF),
  returns-ndr (status machine, NDR→RTO, returns policy), serviceability
  (pincode card + risk quote), settings (kill-switch), wishlist. Contract
  suite: **20 of 24 ported**, 24/24 green both modes.

## M2 wave B — next code to write

| # | Work | Detail |
|---|---|---|
| 1 | **privacy module** | Anonymize-then-soft-delete (`erased:<uuid>` via Medusa's own update APIs, never raw writes), own tombstone table in the `siumora` schema, and the reconciliation test proving **no row in either schema** keeps PII for a tombstoned id — including outbox recipients/variables. Flips `exportMyData and requestErasure`. |
| 2 | **operator identity — REMAINDER (waiver active)** | Landed 2026-08-26: dual-actor gate (`src/lib/operator.ts` + `operator-gate.ts`) — emailpass dashboard user OR phone-OTP customer on `ADMIN_PHONES`, core RBAC (roles/permissions per request), audited actor identity (audit module). **WAIVED to this row, read aloud at M5:** TOTP 2FA (parity P0 rows "never stores the TOTP secret in the clear", "requires a live code to remove the factor", "refuses to store a second factor it cannot seal", step-up on permission-gated writes) and role granularity for dashboard users (Medusa OSS users are all owners — stated in the gate, not pretended). Founder decision 2026-08-26: email+password now, TOTP next wave. |
| 3 | ~~ops API surface~~ **done 2026-08-26** (scoped) | Landed as `/admin/siumora/{metrics,audit,remittances,cash-position,gstr1,restock-queue,settings,orders/:number/status,orders/:number/ndr,orders/lookup}` behind the dual-actor gate; audit + remittance modules own their tables; `admin reads` contract flipped (21/24). Still open here: `/admin/privacy-requests` (needs row 1), the dedicated restock ACTION (queue exists; putting goods back is a stock adjustment in the dashboard until the outbox wave lands the audited once-only action). |
| 4 | **outbox port** | Notification/conversion outbox in the shared `siumora` schema, `(event_key, template_key)` unique dedup, the atomic status+invoice+conversion+message transaction as a Medusa workflow with compensation steps. |
| 5 | **session port remainder** | `updateProfile` over `/store/customers/me` landed 2026-09-30. `signOut`/`signOutEverywhere` still need a token revocation strategy because Medusa JWTs are stateless. Flips the remaining session test. |
| 6 | **order ownership** | `listOrders` for the signed-in customer; claim guest orders at sign-in (`claimedOrders` is honestly 0 today). Flips `listOrders`. |
| 7 | **gst-recon-daily** | The reconciliation job both gst hooks name (`TODO(gst-recon-daily)`): proves books daily, alarms on drift — the accepted price of losing cross-table CHECKs. |
| 8 | ~~read-route status wiring~~ **done 2026-08-26** | The order read serves the status row's truth (read-only — a guest read creates no rows) and the open return in the card's `return` slot; verified live (operator walk → guest card shows `shipped`). |
| 9 | **middlewares authenticate entry** | The `authenticate(..., allowUnauthenticated)` route entry that lets the quote route see a signed-in customer — `phoneVerified` is hard-false until then (serviceability REGISTER.md §3). |
| 10 | **boot-guard parity** | Production refusals for `COURIER_SIMULATION=true` and OTP echo on the Medusa side boot guards (both currently fail closed at the route/provider layer). |

## M3 — providers

- 1-day spikes: `@devx-commerce/razorpay` / SGFGOV vs porting our Razorpay
  adapter; `medusa-fulfillment-shiprocket` vs ours. Bar = the 10
  provider-client tests (recon semantics, idempotent capture, resume-aware
  AWB, token refresh). Plugin that cannot meet it loses to the port.
- Prepaid checkout (transport refuses non-COD today), payment webhooks,
  reverse-pickup booking on return approval (reversePickup envelope).

## M4 — admin (pulled forward, largely done 2026-08-26)

- **Done:** stock Medusa admin serving at `/app` (built bundle copied to
  `apps/medusa/public/admin` by the build script — `medusa start` reads
  `<cwd>/public/admin`); email+password admin user (`npx medusa user`);
  file-local image uploads (R2 via `S3_*` env when credentials exist);
  India-fields widget (product hsn/gst_slab + variant mrp_paise/price_paise,
  validated, incomplete-banner = the NOT-NULL bar); order-ops widget
  (SIU number, legal transitions only, NDR answers, open return); Siumora
  pages: Overview, GST desk, Ops settings, Audit log.
- **Open:** re-home the web `/admin` readout post-cutover (TODOS row), and
  whatever the design doc's second named M4 piece adds beyond the above.

## M5 — cutover gate

- Every P0 behavior green or waivered aloud; contract suite green on both
  transports; E2E 3/3 with `E2E_BACKEND=medusa` (still refused — the
  storefront can flip only after wave B closes the remaining surface);
  invoice-series violation tests; rollback = env flip back; Fastify runs two
  weeks post-cutover, archived at M5.8.

## CI

- Grow the `medusa` job: fresh DB → migrate → seed (+ serviceability seed) →
  boot → `SDK_CONTRACT_BACKEND=medusa` contract run. Local truth: reseed
  before every live run (each contract pass drains ~4 units of stock; the
  seed converges inventory to canonical + reserved).

## Founder-blocked (no code moves these)

- Entity form → GSTIN → Razorpay KYC, DLT registration, Meta + BSP
  verification, Shiprocket account, domain.
- Hosting accounts (Vercel / DO / Supabase) → unblocks the T6 deploy job.
- Deploy the current Fastify stack to the apex for KYC site reviews (the
  design doc wants this NOW, during the rebuild).
- Photography, Track-D phone number + deploy, legal env values
  (`NEXT_PUBLIC_LEGAL_*` are empty).
