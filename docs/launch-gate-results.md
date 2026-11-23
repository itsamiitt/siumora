# Launch-gate results

The evidence the go-live decision rests on (plan 18, Track 3). Run every check
on **staging** with provider **test** credentials, except G13 (production in
coming-soon mode). Fill in each row as it is done: the date, who ran it, the
order numbers / AWBs / screenshots it produced, and pass or a written waiver.
A row left blank is a row not run.

Staging: `https://staging.siumora.com` / `https://api-staging.siumora.com`
(infra: `infra/aws`, deploy: `.github/workflows/deploy.yml`).

| # | Check | How | Passes when | Date · who | Evidence | Result |
|---|---|---|---|---|---|---|
| G1 | Migrations and seeds | The deploy runs `db:migrate`. Then `seed-store.ts`, `seed-serviceability.ts`, and `seed.ts` (staging only), each **twice** | No errors; the second run changes nothing | | | |
| G2 | E2E against Medusa | CI `E2E (medusa)`, blocking since 23 Nov 2026 | Two consecutive green runs on `main` | 23 Nov 2026 · CI | runs 45198309422, 45198970997 | ✅ |
| G3 | Money invariant | One coupon order COD to an inter-state pincode; one coupon order prepaid intra-state | quote total = Pay label = Razorpay amount = order total = invoice total; GST split right; both in the GSTR-1 export; `gst-recon` clean | | | |
| G4 | Razorpay (test keys) | (a) prepaid order (b) force paid-but-not-placed: stock to 0 between prepare and complete (c) block the webhook at the WAF, pay, wait for recon | (a) confirmed + invoiced (b) refunded, `payment.refund_unplaced` audit row (c) recon confirms within 15 min, no duplicate | | | |
| G5 | Shiprocket (test) | Book from the order card; tracking webhook; one return with reverse pickup | AWB + label; shipped → delivered by webhook, audited as the courier; reverse pickup booked; **plan includes push webhooks (in writing)** | | | |
| G6 | Outbox worker | Real WhatsApp/SMS test templates, GA4 DebugView, Meta Test Events | Confirmation message received; one purchase in GA4 and Meta with the **same event id** as the browser's; a delivery receipt moves the message to delivered; a 22:00 cart reminder held to morning | | | |
| G7 | Admin pass | Owner with MFA: order card (gift message, payout, restock), privacy queue (one erasure), remittance CSV, Store → Checkout & COD. As `support`: money desk refused | Every action audited with the right actor; erasure leaves no PII in the outbox | | | |
| G8 | Kill-switch drill | `docs/incident-runbook.md` | Checkout paused within 30 s, no deploy; back on restores it; audit row | | | |
| G9 | COD payout drill | `docs/cod-refund-payout.md` on one COD order (₹1 UPI) | Recorded once; a second attempt is `409 already_paid`; restock counts the unit once | | | |
| G10 | Load test | `tooling/load/checkout.k6.js` and `tooling/load/otp-routes.k6.js` against staging | Thresholds in each script pass: browse p95 < 300 ms, zero 5xx, refusals are 429s | | | |
| G11 | Security pass | `/cso`; response headers (CSP, HSTS); unsigned webhooks refused; every staff user on MFA | No open high or critical | | | |
| G12 | Backup restore | `docs/deploy-runbook.md` "Restoring the database" into a scratch instance | Restores and boots; time recorded in the runbook | | | |
| G13 | Razorpay KYC review | Production with `SITE_PHASE=coming-soon`, legal contact block filled, policies live | Razorpay accepts the site for review | | | |

## Waivers

A check that cannot pass before launch is waived here, in writing, with who
accepted the risk and until when.

| # | Why it is waived | Risk accepted by | Until |
|---|---|---|---|
| | | | |
