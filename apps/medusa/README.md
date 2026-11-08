# @siumora/medusa

## Coming Soon waiting list

With `COMMERCE_BACKEND=medusa`, the storefront sends waiting list signups to
`POST /store/siumora/waitlist`. The `siumoraWaitlist` module stores one record
per normalized email. Run `medusa db:migrate` after deploying this module.
Medusa Admin has **Siumora → Waiting list** at `/app/siumora/waitlist`; it uses
the normal dashboard login, and the API allows only owners to read the paged
list. Set the web app's `MEDUSA_ADMIN_URL` to the browser-reachable Medusa origin
so its Admin sign in link can reach the dashboard.
The list also shows a matching Medusa customer and orders whose email matches
the signup, including guest orders. Those matches are read live; joining the
list does not create a customer account or change an order. An email match is
an operational clue, not proof that the same person controls both records.

The Medusa 2.x commerce backend (Track M). Store API for the storefront's
Medusa transport, plus the **Admin dashboard** — the CMS-style ops surface —
at `<backend>/app`.

## Local run

```bash
# one-time / after schema changes
pnpm db:migrate
npx medusa exec ./src/scripts/seed.ts              # prints the publishable key
npx medusa exec ./src/scripts/seed-serviceability.ts

# build (backend dist + admin bundle; copies the bundle to public/admin,
# which is where a source-run `medusa start` serves it from)
pnpm build

# the local no-watcher convention (the file watcher crashes on parallel
# writes; CI's cold-boot job uses `medusa develop` instead).
# NODE_ENV=development matters: `medusa start` defaults to production, which
# marks the dashboard's session cookie Secure — over plain http://localhost
# the browser never stores it and login silently loops. Behind TLS in real
# production the default is correct; do not carry this override there.
NODE_ENV=development \
PORT=9101 OTP_ECHO=true DISABLE_RATE_LIMITS=true COURIER_SIMULATION=true \
ADMIN_PHONES=9000000001 \
SELLER_NAME="Siumora (dev)" SELLER_ADDRESS="…" SELLER_GSTIN="…" \
SELLER_STATE_CODE=27 SELLER_EMAIL="…" SELLER_PHONE="…" \
npx medusa start
```

Dashboard: http://localhost:9101/app

## Admin access (email + password)

Operators sign in to the dashboard with **email + password** (the emailpass
provider — `authMethodsPerActor.user` in `medusa-config.ts`; the phone-OTP
provider is customers-only). Create an admin user:

```bash
npx medusa user -e you@example.com -p <password>
```

Never commit credentials. TOTP 2FA and per-user roles are the deferred
remainder of the operator-identity wave — see
`docs/track-m-pending.md` row 2 (waiver active): every dashboard user is an
owner today.

The **ops API** (`/admin/siumora/*`) additionally admits a phone-OTP
customer whose number is on `ADMIN_PHONES` (`9876543210` or
`9876543210:operator`, comma-separated — packages/core rbac semantics).
That is how the SDK's admin reads authenticate; the dashboard uses its own
session.

## Product images

Uploads land on Medusa's file-local provider under `./static` (gitignored)
and serve from the backend. Production is Cloudflare R2 through the
S3-compatible provider: the module block in `medusa-config.ts` engages only
when `S3_FILE_URL` is set (see `.env.example`).

## Getting a product onto the storefront

Publishing is refused (400, naming what is missing) unless the product has:
an HSN code and GST slab (India tax card), an **INR price on every variant**,
and at least one sales channel behind a live publishable key (the default
channel, unless you've added others). Save as draft, fill these in, then
publish. The product page's India tax card shows **Storefront: Visible to
shoppers** or what still blocks it.

- Changes reach the storefront within ~5 seconds (catalogue reads are
  revalidated on that interval) — no deploy or restart.
- Categories show in the header/footer only once they are active, not
  internal, and hold at least one published product (directly or in a child
  category). Children appear on their parent's `/shop?category=` page, and a
  parent's page lists its children's products too.
- A collection's intro line is the **Storefront description** card on the
  collection page (stored as `metadata.description`).
- A published product the storefront still has to leave out (e.g. a price
  removed later) is logged as `[catalog] skipped product …` and reported to
  Sentry as a warning per product.

## Seed vs hand-edited products

`seed.ts` is create-if-missing and **converges inventory for the four
canonical handles only** (stocked = want + reserved — run it before every
live contract run; each run drains ~4 units). Products created by hand in
the dashboard are untouched by a reseed; hand edits to the four canonical
products' inventory revert. Statutory metadata is the India-fields widget's
job: `hsn`/`gst_slab` on product metadata, `mrp_paise`/`price_paise` on
variant metadata — the gst module invoices from exactly those keys.

## Contract run (medusa mode)

```bash
# reseed first — standing rule
npx medusa exec ./src/scripts/seed.ts
cd ../api
SDK_CONTRACT_BACKEND=medusa MEDUSA_URL=http://localhost:9101 \
MEDUSA_PUBLISHABLE_KEY=<printed by seed> \
node --test --experimental-strip-types src/sdk-contract.test.ts
```

The operator sign-in uses the fixed number `9000000001` (must be on the
instance's `ADMIN_PHONES`); every other flow draws random phones to dodge
the OTP resend cooldown.
