# Incident runbook — the payments kill-switch

One page, for the person on the worst call of the week. The switch stops new
money in seconds; everything else can be fixed forward.

## When to pull it

Any of these, sustained (more than one occurrence, or one that is clearly
systemic):

- **Capture failures** — orders stuck `pending_payment` while customers say
  they paid; the recon log shows capture errors.
- **AWB/booking failures** — **Create fulfillment** on orders failing
  repeatedly (Shiprocket refusing or timing out).
- **An invoice refusal or a `gst recon` finding** — `invoice refused:` or
  `[money-alert] gst recon:` in the Medusa log (and Sentry). This is the
  books refusing to drift; treat it as fire.

## Pulling it

The switch is a settings row served by Medusa — no deploy, no restart,
visible within the 30-second cache window (immediately on the instance that
takes the write). It needs an owner or operator with `settings:write`.

**From the dashboard (the normal way):**

1. Sign in at `https://api.siumora.com/app` (email, password, then your
   authenticator code).
2. **Settings → Store**, the **Checkout & COD** card → menu → **Pause
   checkout** → confirm.
3. The card's badge reads **Checkout paused**.

**From a terminal (the dashboard is down but the API is up):** with a
dashboard session token for a staff user (`$TOKEN`):

```bash
curl -X PATCH "https://api.siumora.com/admin/siumora/settings"   -H "authorization: Bearer $TOKEN" -H 'content-type: application/json'   -d '{"key":"payments_enabled","value":false}'
```

Effect: cart completion and payment preparation refuse with
`503 payments_paused` before any order or Razorpay order is created; the
storefront's checkout renders the paused page; browsing, bag and wishlist
keep serving. Verify:

```bash
curl "https://api.siumora.com/store/siumora/config"   -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY"
# → "paymentsEnabled": false
```

**If Medusa itself is down:** set `SITE_PHASE=coming-soon` on the storefront
and redeploy — the shop closes behind the coming-soon page until it is back.

## While it is off

1. **Money first.** Razorpay dashboard → Payments → refund anything captured
   against an order that did not confirm. Customers who paid and got nothing
   are the only emergency in this building.
2. Read Sentry and the Medusa log for the root cause. Fix forward — the switch buys time,
   it does not fix anything.
3. Parcels already booked keep moving; the courier webhook keeps landing.

## Turning it back on

**Resume checkout** on the same card (or the same PATCH with
`"value": true`). Then place one real small order end-to-end
before announcing anything.

## The drill (launch gate box 7)

Before GA, once: pull the switch, watch checkout pause without a rebuild,
push it back, watch checkout return. If any step surprises you, that is the
drill working.

Every pull and push of this lever lands in the audit log
(`action = settings.update`) with who did it.
