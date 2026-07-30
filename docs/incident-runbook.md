# Incident runbook — the payments kill-switch

One page, for the person on the worst call of the week. The switch stops new
money in seconds; everything else can be fixed forward.

## When to pull it

Any of these, sustained (more than one occurrence, or one that is clearly
systemic):

- **Capture failures** — orders stuck `pending_payment` while customers say
  they paid; the recon log shows capture errors.
- **AWB/booking failures** — `/orders/:number/ship` answering 502 repeatedly.
- **Any invoice CHECK-constraint violation** in the API log. This is the
  database refusing corrupted books; treat it as fire.

## Pulling it

The switch is a settings row served by the API — no deploy, no restart,
visible within the 30-second cache window (immediately on the instance that
takes the write).

```bash
# 1. Sign in as an owner (OTP arrives on the admin phone):
curl -X POST "$API/auth/otp"    -H 'content-type: application/json' -d '{"phone":"<owner phone>"}'
curl -X POST "$API/auth/verify" -H 'content-type: application/json' -d '{"phone":"<owner phone>","code":"<code>"}'
# → { "token": "..." }

# 2. Pause:
curl -X PATCH "$API/admin/settings" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"key":"payments_enabled","value":false}'
```

Effect: `POST /checkout` refuses with `503 payments_paused` before any order
is created; the storefront's checkout renders the paused page; browsing, bag
and wishlist keep serving. Verify: `curl "$API/config"` →
`"paymentsEnabled": false`.

## While it is off

1. **Money first.** Razorpay dashboard → Payments → refund anything captured
   against an order that did not confirm. Customers who paid and got nothing
   are the only emergency in this building.
2. Read the API log for the root cause. Fix forward — the switch buys time,
   it does not fix anything.
3. Parcels already booked keep moving; the courier webhook keeps landing.

## Turning it back on

Same PATCH with `"value": true`. Then place one real small order end-to-end
before announcing anything.

## The drill (launch gate box 7)

Before GA, once: pull the switch, watch checkout pause without a rebuild,
push it back, watch checkout return. If any step surprises you, that is the
drill working.

Every pull and push of this lever lands in the audit log
(`action = settings.update`) with who did it.
