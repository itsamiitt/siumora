# The COD refund payout rail (manual, at launch)

A prepaid return refunds itself: the order reaching `returned` reverses the
captured payment automatically, idempotent on the stored refund id. A COD
return has **no capture to reverse** — the customer paid cash to a courier —
so at launch the payout is a hand that moves money, plus a record that it
moved (design doc, OV-2).

## The loop, per COD return

1. The return is approved and the reverse pickup books itself (or is booked
   from the courier panel). Wait for the parcel to arrive back — the refund
   follows the goods, not the request.
2. The order reaches `returned`. The customer's VPA is on the return request
   (`refund_to`).
3. **Pay the order's total** to that VPA from the business account (UPI).
4. **Record it, immediately**, with the UPI/UTR reference:

```bash
curl -X POST "$API/orders/<number>/returns/payout" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"reference":"<UTR>"}'
```

The recording is once-only — a second attempt answers `409 already_paid` with
the original reference, so the same parcel can never be paid out twice. Every
recording lands in the audit log (`action = return.payout`) with the amount
and who recorded it. Requires the money desk (`remittance:write`).

## Rules

- **Never pay without recording.** Money owed with a record beats money owed
  silently — and money paid without a record is indistinguishable from money
  not paid.
- Full order total, same as the automatic prepaid refund.
- The drill (launch gate box 3): one COD return walked through this loop
  end-to-end before GA.

## When this rail retires

Lake trigger: the first week with more than 3 COD refunds → build the
RazorpayX payout automation (`refund_to` becomes an API call). The recording
endpoint and the audit trail stay; only the hand is replaced.
