# The `shiprocket` fulfillment provider

Registered in `apps/medusa/medusa-config.ts` (plan 16 Phase F):

```ts
{
  resolve: "@medusajs/medusa/fulfillment",
  options: {
    providers: [
      { resolve: "@medusajs/medusa/fulfillment-manual", id: "manual" },
      { resolve: "./src/modules/shiprocket-fulfillment", id: "shiprocket" },
    ],
  },
},
```

- **Provider id:** `shiprocket_shiprocket`. The seed links it to the stock location
  and puts "Standard Delivery" on it, including on an existing database.
- **Booking:** the order page's native **Create fulfillment** creates the
  Shiprocket order, assigns the AWB and schedules the pickup.
  - The label carries the AWB and a tracking link, and the Siumora status moves
    to `processing`.
  - Each step is recorded in `siumora_shipments`, so a retry after an AWB failure
    resumes from there instead of booking twice.
- **Tracking:** point Shiprocket's webhook at `https://<medusa-host>/webhooks/courier`
  and set the same token in Admin › Settings › Integrations › Shiprocket (sent as
  `x-api-key`).
  - Shiprocket reports push webhooks as Growth-plan-and-above. Verify this at
    signup.
- **Credentials:** API user email and password, pickup location name, and webhook
  token, set in Admin › Integrations. The env fallback is the `SHIPROCKET_*` variables.
  - Without credentials, a fulfillment goes through with "no courier booked" in
    its data.

| File | Holds |
|---|---|
| `client.ts` | The REST client, ported from `apps/api/src/lib/shiprocket.ts` with its tests, plus `cancelOrders` |
| `decide.ts` | Booking input, webhook status mapping, NDR reasons, authentication (pure) |
| `service.ts` | The `AbstractFulfillmentProviderService` |
| `credentials.ts` | Settings-then-env credential resolution |
