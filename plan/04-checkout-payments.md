# 04 · Checkout & Payments (India)

**North star:** Indian checkout completion averages ~35–45% vs 65–75% in the West — the gap is payment friction. Everything here attacks that number.

## 1. Payment architecture

```
Checkout (single page, mobile-first)
├── UPI ─────────── PRIMARY, pre-selected on mobile
│    ├─ Intent: deep-link into PhonePe/GPay/Paytm → approve → return
│    ├─ QR/collect fallback (desktop)
│    └─ RuPay credit-on-UPI automatic
├── Cards ───────── Razorpay tokenization (RBI CoF — PANs never touch us) + EMI/No-Cost EMI
├── Netbanking ──── 50+ banks (high-value orders)
├── Wallets ─────── Paytm · Amazon Pay · PhonePe
├── BNPL ────────── Simpl/LazyPay (phase 2)
└── COD ─────────── pincode ∩ RTO-score gated (§3)
```

- **Gateway: Razorpay** (Orders API; Standard Checkout first → custom UI later; Payment Links for WhatsApp recovery & partial COD; UPI Autopay if subscriptions). Webhooks = source of truth (signature‑verified, idempotent).
- **Backup: Cashfree** behind the same Medusa payment‑provider interface (bank‑side downtime failover); **HyperSwitch** (Juspay OSS) orchestration at scale for success‑rate routing.
- **Refunds:** instant to source; COD refunds via UPI payout link (Cashfree Payouts).
- **International (optional):** Stripe is invite‑only in India (exports; registered business + IEC for goods) — or Razorpay International/PayPal.

## 2. Checkout UX flow

1. **Phone first** → OTP or Truecaller one‑tap; returning users recognized.
2. Address: pincode → city/state autofill → **AI address intelligence** normalizes & flags gaps (pre‑empting RTO).
3. Delivery promise: EDD + fee before payment; free‑shipping progress bar.
4. Pay: UPI intent pre‑selected; saved tokenized cards; GST‑inclusive total.
5. **"Buying for a business?"** → GSTIN field → B2B invoice.
6. Confirm page + WhatsApp confirmation in seconds. Checkout state persists server‑side on the Medusa cart.

**Tracking hooks (see 08):** `begin_checkout`, `add_shipping_info`, `add_payment_info` fire from Server‑Action boundaries; a **checkout `event_id`** is minted here and travels to both browser pixels and server events for dedup.

## 3. COD, profitably

| Control | Mechanism |
|---|---|
| Eligibility | pincode ∩ value caps ∩ category rules ∩ RTO score |
| Verification | WhatsApp/SMS OTP (medium risk); IVR fallback |
| Commitment | Partial payment ₹49–199 via UPI link (high risk) |
| Pricing | COD fee ₹40–60, free above threshold, waived for trusted repeats |
| Shift to prepaid | "Pay online now: save ₹50 + faster dispatch" |
| Reconciliation | Courier remittance files auto‑matched (`cod_remittances`) |

## 4. Conversion mechanics

Abandoned cart: WhatsApp utility + Payment Link @1h → email @24h → optional SMS @72h (Novu, opt‑in, kill on purchase). Exit‑intent & back‑in‑stock capture. PostHog flags for A/B (threshold banner vs progress bar) measured to completed orders. Post‑purchase one‑click upsell window. Flash‑sale mode: edge‑cached PDPs, reservation TTLs, checkout queue, PG failover rehearsed.

## 5. Trust & PCI

Stripe‑class PCI posture via Razorpay Checkout/tokenization → **SAQ‑A scope**. Trust row at pay button: secure · GST invoice · 7‑day returns · rating count.

## 6. Agentic commerce & ONDC

- **ACP** (Stripe/OpenAI/Meta open standard powering ChatGPT Instant Checkout): expose product feed + quote→confirm agentic checkout via `agent-commerce`; orders land as `channel="agentic"` with policy guardrails (caps, region allow‑list, review flags). Watch **UPI Circle** (NPCI delegated payments) for India‑native agent rails.
- **ONDC** (phase 2+): DPIIT‑backed open network (Beckn), 500+ cities, buyer apps like Paytm/magicpin; integrate via TSP/seller app (Shiprocket ONDC, Mystore, Bitsila) → `channel="ondc"`. Real distribution, real seller effort (catalog quality, in‑app promotion) — treat as a channel, not free demand.
