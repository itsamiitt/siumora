# Track D — the demand test page

One self-contained static page (`index.html`), rebuilt clean from the brand
kit (the `brand-kit/06-web` file is a design-canvas export, not deployable).
It goes to the apex domain on day 1 and is retired at milestone M1, when the
real storefront (payments paused) takes the apex for the KYC site reviews.

## Before publishing

1. **Fill the WhatsApp number** in `index.html` (`91XXXXXXXXXX`). The page
   must not ship a placeholder that looks real.
2. That number must **never become the WABA / Cloud API sender** — registering
   it deletes the consumer account and the chat threads that are the demand
   evidence (design doc, Track D rule a).
3. Confirm `hello@siumora.com` (or change it) actually receives mail.

## Running it

Any static host. Vercel: `vercel deploy track-d --prod` against the apex.

## The ops loop (design doc, Track D rules b–d)

- Export every opt-in — name, number, timestamp, source — **weekly** into the
  Postgres consent log, so DPDP export/erasure apply to the list from day one.
- Replies continue on the collecting number until launch; the first
  business-initiated contact is an opt-in-confirm utility template via the
  BSP, ramped within new-WABA tier limits.
- Signal rule: <50 opt-ins by gate-ready → launch anyway, paid ads stay
  frozen, positioning gets one revisit; ≥200 → ad budget unlocks at GA.

## Voice

The copy is checked by `apps/web/src/lib/track-d.test.ts` against the brand
kit's forbidden words. Edit copy here → run that test.
