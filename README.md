# Siumora

Single-vendor e-commerce platform for the Indian market. Demi-fine jewellery,
₹1,500–10,000, built to the architecture in [`plan/`](plan/) and the identity in
[`brand-kit/`](brand-kit/).

## Status

| Area | State |
|---|---|
| Turborepo + pnpm monorepo | done |
| Design system from the brand kit | done |
| ₹ formatting, GST, RTO, NDR, returns, search | done, unit-tested |
| Postgres schema, migrations, seed | done, constraint-tested |
| Commerce API (catalog, cart, checkout, orders, returns, webhooks) | done, integration-tested |
| Storefront on the API | done |
| Razorpay, Shiprocket, WhatsApp | not connected — needs credentials |
| Phone-OTP sign-in, operator access, order ownership | done, integration-tested |
| Second factor for operators, back-in-stock, recommendations | not built |

## Layout

```
apps/
  api/            Fastify commerce API over Postgres
  web/            Next.js 16 storefront
packages/
  core/           Domain logic — GST, RTO, NDR, returns, search, metrics
  db/             Drizzle schema, migrations, repositories
  sdk/            Typed client for the API
  ui/             Design system — brand tokens, logo, primitives
  analytics/      Typed event contract (GA4 / Meta / PostHog adapters)
  seo/            JSON-LD, metadata, sitemap, robots, llms.txt
  in-locale/      ₹ formatting, Indian states, pincode validation
  config-ts/      Shared tsconfig bases
tooling/          Local Postgres helper
plan/             Architecture and roadmap documents
brand-kit/        Brand guidelines, logo, tokens, pattern, motion
```

## Running it

Requires Node 22+, pnpm 10+, and Postgres.

```bash
pnpm install
./tooling/postgres.sh start          # prints the DATABASE_URL to use
cp .env.example .env                 # then fill in DATABASE_URL

pnpm --filter @siumora/db migrate
pnpm --filter @siumora/db seed

pnpm --filter @siumora/api start     # API on :4000
pnpm --filter @siumora/web dev       # storefront on :3000
```

The storefront calls the API during static generation as well as at request
time, so **the API must be reachable when `apps/web` builds**.

```bash
pnpm build       # all workspaces
pnpm typecheck   # strict tsc
pnpm test        # unit + integration
```

Database-backed tests skip when `DATABASE_URL` is unset, so the suite still
runs without a server. With one set, each suite provisions its own database —
they run in parallel and would otherwise delete each other's rows.

## Decisions that are load-bearing

**Money is integer paise, everywhere.** Never numeric, never float. A rupee
value through a float loses paise, and a tax total out by one is a mismatched
invoice. Formatting happens only at the edge.

**Displayed prices include GST**, so tax is extracted *out of* the price rather
than added on top. Getting that direction wrong overcharges the customer.

**A parcel in transit is not revenue.** Booked, recognised, in-flight and lost
are four separate numbers. Collapsing them is how RTO silently inflates the
books.

**Invariants that would corrupt an invoice live in the database**, not in
application code — a CHECK constraint cannot be bypassed by a migration script
or a future service. Postgres refuses an order whose tax does not sum to its
total, one charged both IGST and CGST, and a duplicate invoice number within a
financial year.

**Every money decision is made server-side.** COD eligibility, the handling fee
and the RTO band are re-derived at checkout from the address submitted; a
client-supplied fee is ignored.

**Webhooks are signed and idempotent.** Without a signature check anyone who
learns the payment URL can mark any order paid. Providers retry for days, so a
replayed capture must not issue a second invoice number.

**Checkout is idempotent.** A retried tap would otherwise create a second order
and charge again.

## Brand rules enforced in code

- Body is always Kohl Ink on Kagaz Ivory — set in the base layer, not per page.
- Mulberry is the one accent per view: buttons, focus ring, discount chip.
- Brass is foil only — a hairline rule or the kernel of the mark.
- The mark swaps to a sturdier cut below 24px automatically. 16px is the floor.
- The jaali band never carries the logo; the pattern is what the mark is made of.
- Tracked caps settings are bundled with `uppercase` so the two cannot separate.
- A test asserts generated metadata never uses the words the guidelines forbid.

Colour and type values live in
[`brand-kit/03-colour-type/siumora-tokens.json`](brand-kit/03-colour-type/siumora-tokens.json)
and are mirrored into `packages/ui/src/theme.css`. Change the brand kit first.

One caveat found while building: **Jost has no rupee glyph** at any weight. In a
browser the font stack falls back per glyph and it is invisible; anywhere
without a stack — print, packaging, generated images — it needs a deliberate
choice. The OG cards set prices in Cormorant for that reason.

## Not yet safe to publish

- `/admin` is behind sign-in, but operator access is a phone allow-list with no
  second factor. Anyone who can receive a code on a listed number gets in.
- The statutory disclosures — registered entity, GSTIN, CIN, grievance officer —
  are unset. Any page carrying them renders a "not ready to publish" notice.
  They are deliberately not invented; a plausible GSTIN is a false regulatory
  disclosure.
