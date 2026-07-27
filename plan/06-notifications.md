# 06 · Notification System — WhatsApp‑First

## 1. Architecture

```
Medusa event → subscriber → Trigger.dev → Novu workflow
  Channel priority (India): WhatsApp ▶ Push ▶ SMS ▶ Email
  Rules: template category (utility vs marketing), opt-in state,
         quiet hours, per-channel cost caps, fallback on failure
```

## 2. Channels

- **WhatsApp Business Platform (Meta Cloud API)** via BSP (**Interakt / AiSensy / Gupshup**) or direct once verified. Needs Meta Business verification, display name, **pre‑approved templates**; per‑message billing with **utility** (order/shipping — cheap) vs **marketing** (offers — pricier, strict opt‑in). Order confirm, payment links, shipping, NDR resolution, delivery OTP = utility.
- **SMS:** MSG91 (or Kaleyra/Gupshup). **TRAI DLT is mandatory** — register entity, sender header, and every template on a DLT platform *before* go‑live (1–2 weeks; do in Phase 0). OTP route for auth; transactional route for order events.
- **Email:** ZeptoMail (very economical, strong Indian deliverability) or Resend; marketing on a separate domain/stream. Templates in `packages/emails` (React Email).
- **Push:** FCM + Web Push via the PWA — free re‑engagement (price drop, back in stock).
- **In‑app:** Novu Inbox in storefront account + admin.

## 3. Event → channel matrix (customer)

| Event | WhatsApp | SMS | Push | Email |
|---|---|---|---|---|
| Order confirmed (+GST invoice) | ✅ | — | — | ✅ |
| Payment failed → retry link | ✅ | — | — | ✅ |
| Shipped / OFD / Delivered | ✅ | opt‑in | ✅ | ✅ |
| **NDR** (delivery failed) | ✅ interactive buttons | ✅ | ✅ | ✅ |
| COD confirm (medium risk) | ✅ OTP | fallback | — | — |
| Abandoned cart 1h/24h/72h | ✅ utility+link | 3rd touch opt‑in | ✅ | 2nd touch |
| Back in stock / price drop | ✅ | — | ✅ | ✅ |
| Review ask D+2/D+7 | ✅ | — | — | ✅ |
| Refund processed | ✅ | — | — | ✅ |

Ops (Slack/admin): new order, high‑value review, low stock, failed webhook, error spikes, daily cash‑position digest.

## 4. Rules

Transactional and marketing strictly separated (deliverability + DLT/Meta categories + DPDP consent); preference center spans all channels; idempotent sends (event‑ID keys), retries with backoff, delivery receipts logged (`wa_message_log`); localized + timezone‑aware; digest mode for noisy events. AI‑generated marketing copy can never ship through a utility template (lint in CI).
