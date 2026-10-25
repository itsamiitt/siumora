# The `razorpay` payment provider

Registered in `apps/medusa/medusa-config.ts` (plan 16 Phase B):

```ts
{
  resolve: "@medusajs/medusa/payment",
  options: {
    providers: [{ resolve: "./src/modules/razorpay-payment", id: "razorpay" }],
  },
},
```

- **Provider id:** `pp_razorpay_razorpay`.
- **Webhook URL** to configure in the Razorpay dashboard:
  `https://<medusa-host>/hooks/payment/razorpay_razorpay`. Subscribe to
  `payment.authorized`, `payment.captured`, `payment.failed` and `order.paid`.
- **Credentials:** Admin › Settings › Integrations › Razorpay (encrypted), or the
  env fallback `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and
  `RAZORPAY_WEBHOOK_SECRET`. Without the webhook secret, every webhook is refused.
  The browser path and the recon job still confirm payments in that case.
- **Seed:** `npx medusa exec ./src/scripts/seed.ts` enables the provider on the
  India region.

| File | Holds |
|---|---|
| `client.ts` | The REST client, ported from `apps/api/src/lib/razorpay.ts`, with its five tests |
| `decide.ts` | Signatures, paise conversion, reading payments, parsing webhooks (pure) |
| `service.ts` | The `AbstractPaymentProvider` |
| `credentials.ts` | Settings-then-env credential resolution |
