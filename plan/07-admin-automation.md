# 07 · Admin Dashboard & Automation

**Base:** Medusa Admin (orders, products, inventory, promotions, customers, RBAC free) extended via **Widgets** and **UI Routes**. Swap to a standalone Next.js admin later only if pixel‑perfect control is needed — same Admin API, contained change.

## 1. Custom surfaces

| Surface | Function |
|---|---|
| Ops dashboard | Today's revenue/orders/AOV, live feed, low stock, fulfilment SLA (Tremor/Recharts on Postgres rollups) |
| **NDR command center** | Failed‑delivery queue from courier webhooks; automation status (WA sent → reply → reattempt booked); aging/escalation |
| **RTO analytics** | RTO% by pincode/courier/payment/product; risk‑decision log; ₹ saved |
| **COD reconciliation** | Remittance vs expected by courier; weight‑discrepancy dispute tracker |
| **GST desk** | HSN‑wise monthly summary, GSTR‑1 export, invoice‑series health, e‑invoice status |
| **Marketing health** | Pixel/CAPI dedup status, EMQ score, GA4 purchase parity vs orders, consent rates — see [08](08-marketing-tracking.md) §8 |
| Compliance panel | Grievance SLAs (48h ack / 1‑month close), DPDP access/erasure workflow |
| AI Copilot (widget) | Chat over your data with permissioned tools ("refund #1042", "write summer copy for X", "which SKUs stalled?") |
| AI content studio | Bulk generate/regenerate descriptions/meta/alt‑text → diff → approve (`ai-content`) |
| SEO console | Snippet preview, JSON‑LD validation, GSC clicks for the entity |
| Festival console | Sale scheduling: banners, price rules, stock buffers, courier capacity |
| Returns center | RMA queue, labels, refunds |

## 2. Automations (event → workflow)

Inventory low‑stock → alert + reorder suggestion (velocity‑based). Price‑edit margin floor check; scheduled promos auto start/stop. Review → LLM authenticity/toxicity screen → publish or queue. CSV import → validate → AI enrich (descriptions/attributes/meta) → approve → publish. Hourly anomaly watch (orders/traffic/conversion vs forecast — catches broken checkout **and broken pixels**). NDR → WhatsApp flow → courier write‑back. RTO score refresh on address edit. COD remittance ingest + mismatch flags. Weekly AI digest (sales, movers, stock risk, SEO wins, ad ROAS incl. RTO‑adjusted).

## 3. Governance

Roles: `owner / manager / support / content / marketing`. Audit log on destructive actions. AI copilot actions pass the same permission layer as buttons. Admin 2FA required.
