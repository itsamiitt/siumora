# Track M — pending work

State as of 2026-08-06. The Medusa re-platform (design doc
`...design-20260730-123957.md`) through M2 wave A. Companion to
[`medusa-parity-checklist.md`](medusa-parity-checklist.md) (the 207-behavior
bar, 17 ticked) and the repo-root `TODOS.md` (trigger-pulled items, none of
which belong here).

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
| 2 | **operator identity** | Phone-OTP admin auth + core RBAC + TOTP 2FA + audited actor identity, ported whole — the rebuild's admin must not launch weaker than the stack it replaces. Prerequisite for #3. |
| 3 | **ops API surface** | `/admin/metrics`, `/admin/audit`, `/admin/remittances`, `/admin/gstr1` (statutory, in the harness), `/admin/cash-position`, `/admin/restock-queue`, `/admin/privacy-requests`, `/admin/settings` — Medusa custom routes over the modules, each with a harness entry. Flips `admin reads` contract test. |
| 4 | **outbox port** | Notification/conversion outbox in the shared `siumora` schema, `(event_key, template_key)` unique dedup, the atomic status+invoice+conversion+message transaction as a Medusa workflow with compensation steps. |
| 5 | **session + profile port** | `signOut`/`signOutEverywhere` (needs token revocation strategy — Medusa JWTs are stateless), `updateProfile` over `/store/customers/me`. Flips the session trio test. |
| 6 | **order ownership** | `listOrders` for the signed-in customer; claim guest orders at sign-in (`claimedOrders` is honestly 0 today). Flips `listOrders`. |
| 7 | **gst-recon-daily** | The reconciliation job both gst hooks name (`TODO(gst-recon-daily)`): proves books daily, alarms on drift — the accepted price of losing cross-table CHECKs. |
| 8 | **read-route status wiring** | The order read still maps confirmed-unless-cancelled; wire it to `siumora_order_status` (returns-ndr exports `getStatusRow`/`findOpenReturn` for exactly this) so walked statuses and open returns show on the card. |
| 9 | **middlewares authenticate entry** | The `authenticate(..., allowUnauthenticated)` route entry that lets the quote route see a signed-in customer — `phoneVerified` is hard-false until then (serviceability REGISTER.md §3). |
| 10 | **boot-guard parity** | Production refusals for `COURIER_SIMULATION=true` and OTP echo on the Medusa side boot guards (both currently fail closed at the route/provider layer). |

## M3 — providers

- 1-day spikes: `@devx-commerce/razorpay` / SGFGOV vs porting our Razorpay
  adapter; `medusa-fulfillment-shiprocket` vs ours. Bar = the 10
  provider-client tests (recon semantics, idempotent capture, resume-aware
  AWB, token refresh). Plugin that cannot meet it loses to the port.
- Prepaid checkout (transport refuses non-COD today), payment webhooks,
  reverse-pickup booking on return approval (reversePickup envelope).

## M4 — admin

- Stock Medusa admin + two named custom pieces: India-fields Admin SDK
  widget (HSN, MRP, GST rate — NOT NULL, feed invoicing/GSTR-1) and the
  second piece per design doc M4.

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
