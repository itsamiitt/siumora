# Registering the `gst` module

This module is complete but **not registered** — `medusa-config.ts` is owned
elsewhere. Everything the config owner needs is below, verbatim.

## 1. medusa-config.ts snippet

Add this entry to the existing `modules: []` array in
`apps/medusa/medusa-config.ts`:

```ts
// GST invoices (design doc M2): the statutory invoice series as a
// module-owned table. Series integrity is database-enforced module-locally
// (FY-unique partial index + same-table allocation lock, MAX+1 drawn inside
// the INSERT — see src/modules/gst/allocate.ts and the migration header for
// the full disposition); cross-table money checks are write-time app
// assertions + the daily recon job (TODO(gst-recon-daily), separate M2
// work-item).
{ resolve: "./src/modules/gst" },
```

Then run, from `apps/medusa`:

```bash
npx medusa db:migrate
```

The migration is `IF NOT EXISTS`-guarded throughout, so it converges: a
database where the table was already created during M2 verification (the
migration SQL applied by hand before registration) migrates cleanly, as does
a fresh one.

Note for later schema work: the migration is hand-written (the module could
not be registered when it was authored, so `medusa db:generate` was not
available). If you run `medusa db:generate gst` for a future change, check
the generated migration against `migrations/Migration20260731130000.ts`
before applying — the generator starts from an empty snapshot.

## 2. Runtime coupling (why nothing breaks before registration)

The request-path reads and writes go through the shared pg connection
(`ContainerRegistrationKeys.PG_CONNECTION`), not through the module service
— the sequence draw, number formatting and row insert must be one atomic
SQL statement, which the generated service cannot express. Registration is
what gives the module ownership of its migrations (db:migrate) and a
resolvable service for the M2 admin/GSTR-1/recon reads; the storefront
routes only need the table to exist.

## 3. Environment variables (the invoice.pdf route)

The exact names `apps/api/src/server.ts` reads — one set of seller facts for
both stacks:

| Variable | Purpose |
| --- | --- |
| `SELLER_NAME` | Registered legal name printed on the tax invoice. |
| `SELLER_ADDRESS` | Registered place of business. |
| `SELLER_GSTIN` | The registration the invoice is issued under. |
| `SELLER_STATE_CODE` | Two-digit state code; decides IGST vs CGST+SGST on the printed document. Defaults to core's `ORIGIN_STATE_CODE` (27). |
| `SELLER_EMAIL`, `SELLER_PHONE` | Contact block on the invoice. |

With name/address/GSTIN missing the PDF route answers
`503 seller_not_configured` rather than printing a document with a dash
where the registration number belongs — the same refusal, same words, as
the Fastify route.

## 4. Endpoints once the table exists

- `POST /store/siumora/carts/:cartId/complete` — envelope's `invoiceNumber`
  now carries the real series number (`SIU/<fy>/<seq>`), issued right after
  identity allocation; `null` only when issue was refused (logged loudly)
  or for replays of pre-gst orders.
- `GET /store/siumora/orders/:number?key=` — `invoice` is the stored
  `{ rows, totals }` card and `order.invoiceNumber` the stored number;
  both `null` for orders that predate the module (no 500).
- `GET /store/siumora/orders/:number/invoice.pdf?key=` — the tax invoice as
  PDF bytes. Correct key or signed-in owner → `application/pdf`; anyone
  else → 404; malformed key → 400; uninvoiced order → 409 `no_invoice`;
  unconfigured seller → 503.

## 5. Parity notes for reviewers

Ported from the Fastify contract (apps/api/src/lib/invoicing.ts,
packages/db placeOrder, apps/api/src/routes/orders.ts + api.test.ts):
sequential-within-FY numbering in core `invoiceNumber()` format, issue at
confirmation (COD confirms at placement, which here is completion), one
invoice per order ever, the series serialised on a same-table lock, the
HSN-wise card from core's `hsnSummary`/`summariseInvoice`, and the PDF from
core's `buildInvoice`/`renderInvoicePdf`.

Deliberately different, written down: the Fastify cross-table CHECK-style
guarantees (totals vs the orders table) do not survive module isolation —
replaced by the write-time reconciliation assertion (refuses the write on
any drift) plus the daily recon job, per the design doc's disposition list.
`TODO(gst-recon-daily)` in `issue.ts` and the migration header is the named
hook that job plugs into.
