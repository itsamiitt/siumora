# Medusa parity checklist — the 207-behavior bar

Generated from the live suites on 2026-07-30 (design doc
`...design-20260730-123957.md`, M0). This is the **reviewed enumeration**;
executable contracts land per the resequencing rule — cross-cutting
invariants in M0, each module's contracts WITH that module in M1–M3.

Tiers: **P0** gates cutover absolutely (commerce-critical: checkout, payment,
invoice, refund, erasure, OTP, stock, webhooks). **tail** must be green or
carry a written waiver, waivers read out at the M5 gate. Tier assignments are
keyword-derived and get human review as each contract is ported — move rows
between tiers by editing this file (it is the source of truth, reviewed in
PRs like code).

Every schema-constraint row needs a **written disposition** (survives as
constraint / app-assertion + recon) with a feasibility check — price≤MRP is
already reclassified to assertion+recon (eng review D13).

Total: 207 behaviors · P0: 97 · tail: 110

## API integration (125)

| done | tier | behavior | source |
|------|------|----------|--------|
| [ ] | tail | health check proves the database is reachable | apps/api/src/api.test.ts |
| [ ] | tail | serves the catalogue review-free until customers write them | apps/api/src/api.test.ts |
| [ ] | tail | search matches Hinglish through the API | apps/api/src/api.test.ts |
| [x] | P0 | rejects a malformed pincode rather than querying with it | apps/api/src/api.test.ts |
| [x] | P0 | reports an unknown pincode as not serviceable | apps/api/src/api.test.ts |
| [ ] | P0 | refuses to add more than the stock on hand | apps/api/src/api.test.ts |
| [x] | P0 | places an order and issues an invoice | apps/api/src/api.test.ts |
| [ ] | P0 | does not create a second order when a checkout is retried | apps/api/src/api.test.ts |
| [ ] | P0 | refuses an idempotency key reused for a different request | apps/api/src/api.test.ts |
| [ ] | P0 | derives the COD fee server-side rather than trusting the client | apps/api/src/api.test.ts |
| [ ] | P0 | withholds COD where the courier does not carry it | apps/api/src/api.test.ts |
| [ ] | P0 | rejects an unsigned payment webhook | apps/api/src/api.test.ts |
| [ ] | P0 | rejects a payment webhook signed with the wrong secret | apps/api/src/api.test.ts |
| [ ] | P0 | confirms an order on a correctly signed payment webhook | apps/api/src/api.test.ts |
| [ ] | P0 | a replayed payment webhook does not issue a second invoice | apps/api/src/api.test.ts |
| [x] | P0 | refuses an illegal order transition | apps/api/src/api.test.ts |
| [x] | tail | returns the parcel to origin once attempts are exhausted | apps/api/src/api.test.ts |
| [x] | tail | refuses a return on pierced jewellery with a broken seal | apps/api/src/api.test.ts |
| [x] | P0 | refuses a second open return on one order | apps/api/src/api.test.ts |
| [ ] | tail | admin metrics keep transit value out of recognised revenue | apps/api/src/api.test.ts |
| [ ] | tail | does not echo an origin that is not allow-listed | apps/api/src/api.test.ts |
| [ ] | P0 | signs in with a code and returns a usable session | apps/api/src/api.test.ts |
| [ ] | tail | accepts a number however it is typed and keeps one customer | apps/api/src/api.test.ts |
| [ ] | P0 | refuses a wrong code and counts the attempt down | apps/api/src/api.test.ts |
| [ ] | P0 | locks a code after five wrong guesses | apps/api/src/api.test.ts |
| [ ] | P0 | will not let one code sign in twice | apps/api/src/api.test.ts |
| [ ] | P0 | throttles a second code to the same number | apps/api/src/api.test.ts |
| [ ] | tail | rejects a number that is not an Indian mobile before spending a send | apps/api/src/api.test.ts |
| [ ] | P0 | never stores the code in the clear | apps/api/src/api.test.ts |
| [ ] | P0 | a signed-out session stops working | apps/api/src/api.test.ts |
| [ ] | P0 | will not hand an order to someone holding only its number | apps/api/src/api.test.ts |
| [ ] | P0 | attaches an order to the customer who was signed in | apps/api/src/api.test.ts |
| [ ] | P0 | keeps one customer's order out of another's hands | apps/api/src/api.test.ts |
| [ ] | P0 | claims a guest order when its number signs in later | apps/api/src/api.test.ts |
| [ ] | P0 | an operator can read any order | apps/api/src/api.test.ts |
| [ ] | tail | refuses the ops dashboard to an anonymous caller | apps/api/src/api.test.ts |
| [ ] | tail | refuses the ops dashboard to a customer who is not on the allow-list | apps/api/src/api.test.ts |
| [ ] | P0 | gives a verified repeat buyer the trusted COD terms | apps/api/src/api.test.ts |
| [ ] | P0 | issues an invoice however an order reaches confirmed | apps/api/src/api.test.ts |
| [ ] | P0 | lets a signed courier webhook move an order it has no session for | apps/api/src/api.test.ts |
| [ ] | P0 | puts stock back at once when an order is cancelled before dispatch | apps/api/src/api.test.ts |
| [ ] | P0 | holds stock back until a returning parcel is actually received | apps/api/src/api.test.ts |
| [ ] | tail | will not put the same goods back twice | apps/api/src/api.test.ts |
| [ ] | P0 | refuses to restock an order that is still live | apps/api/src/api.test.ts |
| [ ] | tail | lists what is still owed back, and drops it once returned | apps/api/src/api.test.ts |
| [ ] | P0 | keeps the restock queue away from a customer | apps/api/src/api.test.ts |
| [ ] | P0 | counts a prepaid order at confirmation | apps/api/src/api.test.ts |
| [ ] | P0 | does not count a COD order until it is actually delivered | apps/api/src/api.test.ts |
| [ ] | P0 | a prepaid order that is returned keeps its purchase, and only one | apps/api/src/api.test.ts |
| [ ] | P0 | a replayed payment webhook does not count the sale twice | apps/api/src/api.test.ts |
| [ ] | P0 | the payment webhook reports revenue at all | apps/api/src/api.test.ts |
| [ ] | P0 | carries the order's own event id, so the pixel and the server agree | apps/api/src/api.test.ts |
| [ ] | P0 | reports orders that produced no conversion at all | apps/api/src/api.test.ts |
| [ ] | P0 | refuses a GSTIN whose check digit is wrong | apps/api/src/api.test.ts |
| [ ] | P0 | stores a valid GSTIN, normalised | apps/api/src/api.test.ts |
| [ ] | P0 | files a registered buyer invoice-wise and a consumer as a summary | apps/api/src/api.test.ts |
| [ ] | P0 | the HSN table reconciles to the invoice tables | apps/api/src/api.test.ts |
| [ ] | P0 | leaves uninvoiced orders out of the return | apps/api/src/api.test.ts |
| [ ] | tail | exports the return as CSV with every table | apps/api/src/api.test.ts |
| [ ] | tail | refuses a malformed period rather than guessing one | apps/api/src/api.test.ts |
| [ ] | tail | keeps the return away from a customer | apps/api/src/api.test.ts |
| [ ] | P0 | passes a remittance line that collected the invoice | apps/api/src/api.test.ts |
| [ ] | tail | names the money a short collection left behind | apps/api/src/api.test.ts |
| [ ] | tail | re-uploading a file books nothing twice | apps/api/src/api.test.ts |
| [ ] | P0 | refuses to pay for the same order in a second batch | apps/api/src/api.test.ts |
| [ ] | tail | refuses a collection nobody was owed | apps/api/src/api.test.ts |
| [ ] | tail | spots a parcel billed on more weight than it was booked at | apps/api/src/api.test.ts |
| [ ] | tail | separates cash in the bank from cash the courier is holding | apps/api/src/api.test.ts |
| [ ] | tail | reports batches and the open exception queue | apps/api/src/api.test.ts |
| [ ] | tail | refuses a batch with no rows rather than recording an empty one | apps/api/src/api.test.ts |
| [ ] | P0 | keeps the remittance desk away from a customer | apps/api/src/api.test.ts |
| [ ] | tail | sends the browser policy on every reply | apps/api/src/api.test.ts |
| [ ] | tail | does not pin a plain-HTTP origin to https | apps/api/src/api.test.ts |
| [ ] | tail | refuses a flood of sign-in attempts from one origin | apps/api/src/api.test.ts |
| [ ] | tail | hands a signed-in person everything held about them | apps/api/src/api.test.ts |
| [ ] | tail | does not put a live credential in the export | apps/api/src/api.test.ts |
| [ ] | tail | refuses an export to someone who is not signed in | apps/api/src/api.test.ts |
| [ ] | P0 | erases a settled customer and keeps the invoice | apps/api/src/api.test.ts |
| [ ] | P0 | will not erase while a parcel is still moving | apps/api/src/api.test.ts |
| [ ] | tail | does not restart the clock when somebody asks twice | apps/api/src/api.test.ts |
| [ ] | P0 | signs an erased person out everywhere | apps/api/src/api.test.ts |
| [ ] | P0 | does not leave a queued conversion carrying an erased identity | apps/api/src/api.test.ts |
| [ ] | P0 | does not leave a notification carrying an erased identity | apps/api/src/api.test.ts |
| [ ] | P0 | forgets an erased person's messaging preferences | apps/api/src/api.test.ts |
| [ ] | tail | puts the queue and its deadline in front of an operator | apps/api/src/api.test.ts |
| [ ] | P0 | keeps the privacy queue away from a customer | apps/api/src/api.test.ts |
| [ ] | tail | keeps a packer away from the things that cannot be undone | apps/api/src/api.test.ts |
| [ ] | tail | names the permission it is refusing for | apps/api/src/api.test.ts |
| [ ] | P0 | records who moved an order, and does not blame the courier on a person | apps/api/src/api.test.ts |
| [ ] | P0 | records a remittance batch and a bulk export | apps/api/src/api.test.ts |
| [ ] | tail | refuses a customer-driven transition when the courier simulation is off | apps/api/src/api.test.ts |
| [ ] | P0 | a prepaid checkout hands the browser a provider order | apps/api/src/api.test.ts |
| [ ] | P0 | a captured payment confirms the order and remembers the payment id | apps/api/src/api.test.ts |
| [ ] | P0 | a bare authorized payment is captured — the drop-off case | apps/api/src/api.test.ts |
| [ ] | P0 | the recon sweep confirms what the webhook missed | apps/api/src/api.test.ts |
| [ ] | P0 | a returned prepaid order is refunded once, never twice | apps/api/src/api.test.ts |
| [ ] | tail | booking takes an AWB and the shipped notice carries it | apps/api/src/api.test.ts |
| [ ] | tail | booking is an operator lever behind a real courier account | apps/api/src/api.test.ts |
| [ ] | tail | an approved return books its reverse pickup | apps/api/src/api.test.ts |
| [ ] | P0 | a COD return's payout is recorded once, with who recorded it | apps/api/src/api.test.ts |
| [ ] | tail | a prepaid return has nothing to pay out by hand | apps/api/src/api.test.ts |
| [ ] | P0 | the sign-in code goes out synchronously on the resolved channel | apps/api/src/api.test.ts |
| [ ] | P0 | a failing OTP channel is reported, not hidden | apps/api/src/api.test.ts |
| [ ] | tail | sign-in refuses honestly with no channel and no echo | apps/api/src/api.test.ts |
| [ ] | P0 | delivery receipts move a message to the truth, once, in order | apps/api/src/api.test.ts |
| [ ] | tail | a post-acceptance failure receipt records the reason | apps/api/src/api.test.ts |
| [ ] | tail | serves the public config, uncacheable | apps/api/src/api.test.ts |
| [ ] | P0 | the kill-switch pauses checkout and flips back without a restart | apps/api/src/api.test.ts |
| [ ] | tail | settings are owner levers, not public ones | apps/api/src/api.test.ts |
| [ ] | tail | refuses a nonsense setting at the boundary | apps/api/src/api.test.ts |
| [ ] | P0 | the COD cap is a runtime dial, not a compile-time constant | apps/api/src/api.test.ts |
| [ ] | tail | will not let the application rewrite its own log | apps/api/src/api.test.ts |
| [ ] | tail | shows an operator the log without the phone numbers | apps/api/src/api.test.ts |
| [ ] | tail | tells the dashboard what this operator may do | apps/api/src/api.test.ts |
| [ ] | P0 | serves the tax invoice as a PDF | apps/api/src/api.test.ts |
| [ ] | P0 | will not issue an invoice for an order that never raised one | apps/api/src/api.test.ts |
| [ ] | P0 | refuses to print a tax invoice for an unconfigured seller | apps/api/src/api.test.ts |
| [ ] | P0 | keeps an invoice away from someone holding only the order number | apps/api/src/api.test.ts |
| [ ] | tail | enrols a second factor and enforces it thereafter | apps/api/src/api.test.ts |
| [ ] | P0 | will not accept the same code twice | apps/api/src/api.test.ts |
| [ ] | P0 | lets a recovery code in exactly once | apps/api/src/api.test.ts |
| [ ] | tail | will not swap a confirmed factor for a new one | apps/api/src/api.test.ts |
| [ ] | P0 | requires a live code to remove the factor | apps/api/src/api.test.ts |
| [ ] | tail | refuses to store a second factor it cannot seal | apps/api/src/api.test.ts |
| [ ] | P0 | never stores the TOTP secret in the clear | apps/api/src/api.test.ts |

## Database — repositories, settings, schema constraints (33)

| done | tier | behavior | source |
|------|------|----------|--------|
| [ ] | tail | reads the catalogue with variants and collections | packages/db (repositories/settings/schema) |
| [ ] | tail | refuses to add a sold-out variant | packages/db (repositories/settings/schema) |
| [ ] | P0 | refuses to add more than the stock on hand | packages/db (repositories/settings/schema) |
| [ ] | P0 | places an order, decrements stock and empties the cart | packages/db (repositories/settings/schema) |
| [ ] | tail | stores tax that balances against the total | packages/db (repositories/settings/schema) |
| [ ] | P0 | charges IGST on an inter-state order | packages/db (repositories/settings/schema) |
| [ ] | P0 | issues an invoice only for a confirmed order | packages/db (repositories/settings/schema) |
| [ ] | P0 | does not oversell the last unit under concurrent checkout | packages/db (repositories/settings/schema) |
| [ ] | P0 | gives concurrent orders distinct numbers and invoice sequences | packages/db (repositories/settings/schema) |
| [ ] | P0 | rolls back everything when an order fails mid-flight | packages/db (repositories/settings/schema) |
| [ ] | P0 | accepts an order whose tax balances against the total | packages/db (repositories/settings/schema) |
| [ ] | P0 | refuses an order where tax does not add up to the total | packages/db (repositories/settings/schema) |
| [ ] | tail | refuses a total that is not subtotal plus shipping and fee | packages/db (repositories/settings/schema) |
| [ ] | P0 | refuses an order charged both IGST and CGST | packages/db (repositories/settings/schema) |
| [ ] | tail | refuses negative money | packages/db (repositories/settings/schema) |
| [ ] | P0 | refuses two invoices with the same number in one financial year | packages/db (repositories/settings/schema) |
| [ ] | tail | allows the same sequence in a different financial year | packages/db (repositories/settings/schema) |
| [ ] | P0 | refuses an invalid GST slab on a product | packages/db (repositories/settings/schema) |
| [ ] | tail | refuses a selling price above MRP | packages/db (repositories/settings/schema) |
| [ ] | tail | refuses a rating outside one to five | packages/db (repositories/settings/schema) |
| [ ] | tail | refuses a duplicate tracking send to one destination | packages/db (repositories/settings/schema) |
| [ ] | P0 | is idempotent when migrations run twice | packages/db (repositories/settings/schema) |
| [ ] | tail | stores mobile numbers in exactly one normalised form | packages/db (repositories/settings/schema) |
| [ ] | P0 | refuses a sign-in code that expires before it is issued | packages/db (repositories/settings/schema) |
| [ ] | P0 | will not let one session token hash exist twice | packages/db (repositories/settings/schema) |
| [ ] | P0 | gives every order its own access key | packages/db (repositories/settings/schema) |
| [ ] | tail | an empty table reads as the compiled defaults | packages/db (repositories/settings/schema) |
| [ ] | tail | a write is read back merged over the defaults | packages/db (repositories/settings/schema) |
| [ ] | tail | writing the same key twice keeps one row and the latest value | packages/db (repositories/settings/schema) |
| [ ] | tail | refuses an unknown key | packages/db (repositories/settings/schema) |
| [ ] | tail | refuses a wrong-shaped value | packages/db (repositories/settings/schema) |
| [ ] | tail | refuses a floor above the cap, whichever side moves | packages/db (repositories/settings/schema) |
| [ ] | tail | a malformed stored value degrades to the default, not a crash | packages/db (repositories/settings/schema) |

## Worker (22)

| done | tier | behavior | source |
|------|------|----------|--------|
| [ ] | tail | sends a queued conversion and marks it | apps/worker |
| [ ] | tail | leaves an unconfigured destination alone | apps/worker |
| [ ] | tail | schedules a refused send instead of retrying it at once | apps/worker |
| [ ] | tail | does not pick a row back up before it is due | apps/worker |
| [ ] | tail | stops retrying a payload that will never be accepted | apps/worker |
| [ ] | tail | gives up after the attempt cap | apps/worker |
| [ ] | tail | does not hand the same row to two workers | apps/worker |
| [ ] | tail | puts a dead worker's claim back on the queue | apps/worker |
| [ ] | tail | does not steal a claim that is still in flight | apps/worker |
| [ ] | tail | refuses a ledger row with no payload rather than posting null | apps/worker |
| [ ] | tail | does not strand a row when the transport throws | apps/worker |
| [ ] | tail | reports what is in flight, not just what is queued | apps/worker |
| [ ] | tail | drains a batch without posting them all at once | apps/worker |
| [ ] | tail | sends a queued message and renders it in full | apps/worker |
| [ ] | tail | falls through to the next channel when the first refuses | apps/worker |
| [ ] | tail | skips a message no configured channel can carry | apps/worker |
| [ ] | tail | does not queue the same event twice | apps/worker |
| [ ] | tail | queues nothing for someone who asked to be left alone | apps/worker |
| [ ] | tail | records an unrenderable message rather than dropping it | apps/worker |
| [ ] | tail | holds a marketing message until the morning | apps/worker |
| [ ] | tail | does not hand the same message to two workers | apps/worker |
| [ ] | tail | reports what is queued, sent and stuck | apps/worker |

## API lib — providers, rate limit, boot guards (27)

| done | tier | behavior | source |
|------|------|----------|--------|
| [ ] | P0 | authenticates with basic auth and creates an auto-capture order | apps/api/src/lib/razorpay.test.ts |
| [ ] | tail | a provider refusal comes back as an outcome, not a throw | apps/api/src/lib/razorpay.test.ts |
| [ ] | tail | a dropped socket is an outcome too | apps/api/src/lib/razorpay.test.ts |
| [ ] | P0 | lists an order's payments from the provider's envelope | apps/api/src/lib/razorpay.test.ts |
| [ ] | P0 | captures and refunds against the payment id | apps/api/src/lib/razorpay.test.ts |
| [ ] | tail | logs in once, then rides the bearer token | apps/api/src/lib/shiprocket.test.ts |
| [ ] | tail | an expired token refreshes exactly once, then the call retries | apps/api/src/lib/shiprocket.test.ts |
| [ ] | tail | an AWB nobody assigned is an error the operator can act on | apps/api/src/lib/shiprocket.test.ts |
| [ ] | tail | an assigned AWB carries the courier's name | apps/api/src/lib/shiprocket.test.ts |
| [ ] | tail | a return is created with the customer's address as the pickup | apps/api/src/lib/shiprocket.test.ts |
| [x] | tail | allows up to the limit and refuses the next | apps/api/src/lib/rate-limit.test.ts |
| [x] | tail | keeps origins apart | apps/api/src/lib/rate-limit.test.ts |
| [x] | tail | shares one budget across the paths that name a bucket | apps/api/src/lib/rate-limit.test.ts |
| [x] | tail | counts methods separately when a rule names one | apps/api/src/lib/rate-limit.test.ts |
| [x] | tail | forgets the window once it rolls over | apps/api/src/lib/rate-limit.test.ts |
| [x] | tail | says how long to wait, never zero | apps/api/src/lib/rate-limit.test.ts |
| [x] | tail | does not limit a path no rule names | apps/api/src/lib/rate-limit.test.ts |
| [x] | tail | drops windows that have rolled over instead of growing forever | apps/api/src/lib/rate-limit.test.ts |
| [x] | tail | the shipped rules cover what plan/11 §4 names | apps/api/src/lib/rate-limit.test.ts |
| [ ] | tail | APP_ENV wins over NODE_ENV for every tier | apps/api/src/lib/env.test.ts |
| [ ] | tail | without APP_ENV the tier derives from NODE_ENV | apps/api/src/lib/env.test.ts |
| [ ] | tail | a typo'd APP_ENV refuses to boot rather than becoming development | apps/api/src/lib/env.test.ts |
| [ ] | P0 | OTP_ECHO refuses to boot in production | apps/api/src/lib/env.test.ts |
| [ ] | P0 | staging permits the OTP echo and the courier simulation | apps/api/src/lib/env.test.ts |
| [ ] | tail | an explicit courier simulation refuses to boot in production | apps/api/src/lib/env.test.ts |
| [x] | tail | disabled rate limits refuse to boot in production | apps/api/src/lib/env.test.ts |
| [ ] | tail | a clean production config boots | apps/api/src/lib/env.test.ts |
