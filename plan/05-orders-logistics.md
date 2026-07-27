# 05 · Orders, Logistics & the RTO War

## 1. Shipping stack

- **Aggregator first: Shiprocket** (or NimbusPost): 25+ couriers (Delhivery, Blue Dart, Ecom Express, XpressBees, DTDC, India Post), ~29k+ pincode serviceability, rates, labels/manifests, tracking webhooks, COD remittance (T+4/T+7; early‑COD for a fee), NDR panel.
- **Scale (≳2–3k orders/mo):** direct **Delhivery** API for rates/SLAs; aggregator as overflow. `pincode` module abstracts both.
- **Courier allocation:** rules by lane performance (delivery %, RTO%, TAT) from your own `ndr_events`/`rto_scores` data.

## 2. Order lifecycle (Medusa workflows, compensated steps)

```
ORDER PLACED
 ├─ prepaid → capture → allocate → ship
 └─ COD → RTO score
      ├─ low → ship
      ├─ medium → WhatsApp OTP confirm → ship
      └─ high → partial-payment link OR prepaid-only
SHIPPED → in transit → OFD → DELIVERED ✅
   └─ NDR ⚠ → WhatsApp buttons: [Reattempt] [Update address] [Cancel]
        → replies write back to courier API
        → unresolved ×3 → RTO → receipt → QC → restock (+refund if prepaid)
POST: D+2 WhatsApp review ask → D+7 email → self-serve RMA
```

Every transition emits an event → notifications ([06](06-notifications.md)) **and marketing events** (e.g., `delivered` powers COD purchase‑confirmation to Meta/GA4 — [08](08-marketing-tracking.md) §6).

## 3. RTO reduction playbook (margins live here)

1. **Predict** — `rto` scores every order: pincode/courier history, COD vs prepaid, value, address‑quality (AI), OTP reachability, customer history, category, time. Transparent weighted rules → trained model on your own labels later.
2. **Prevent** — checkout address intelligence; COD gating/partials; prepaid incentives.
3. **Intervene** — NDR automation answers failed‑contact (the #1 RTO cause) in minutes.
4. **Measure** — RTO% by pincode/courier/payment/product in admin; each point of RTO removed ≈ 2× freight + handling + capital days.

## 4. Returns, invoices, inventory

Customer portal: live tracking, GST invoice download, **self‑serve return/exchange** (reason codes → policy auto‑approve in window → reverse pickup booked via aggregator → QC → refund/exchange). RMA analytics by product/reason. Invoices/packing slips: worker‑rendered PDFs (`@react-pdf/renderer`) in R2. Inventory: Medusa reservations, multi‑location, per‑variant backorder, buffers for sales, nightly reconciliation. COD cash‑position digest daily (prepaid settled + COD in transit + remittance due).
