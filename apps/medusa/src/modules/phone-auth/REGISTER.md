# Registering the `phone-otp` auth provider

This module is complete but **not registered** — `medusa-config.ts` is owned
elsewhere. Everything the config owner needs is below, verbatim.

## 1. medusa-config.ts snippet

Add this entry to the existing `modules: []` array in
`apps/medusa/medusa-config.ts`:

```ts
{
  // Phone-OTP sign-in (design doc M1): the Fastify OTP contract as a Medusa
  // auth provider, reusing packages/messaging's ordered channel resolution
  // (WhatsApp when its template is approved, else DLT SMS).
  resolve: "@medusajs/medusa/auth",
  options: {
    providers: [
      // Overriding the auth module REPLACES its default provider list, it
      // does not merge — emailpass must stay or the admin login dies.
      { resolve: "@medusajs/medusa/auth-emailpass", id: "emailpass" },
      {
        resolve: "./src/modules/phone-auth",
        id: "phone-otp",
        options: {
          // Echoes the issued code in the request-step payload. Development
          // only — the provider's validateOptions refuses the combination
          // otpEcho && appEnv === "production" at boot (the same guard the
          // Fastify app.ts enforces).
          otpEcho: process.env.OTP_ECHO === "true",
          appEnv: process.env.APP_ENV,
          // Explicit rather than process.env wholesale, so the wiring is
          // readable off the config. Missing credentials mean no sender;
          // sign-in then refuses unless otpEcho covers development.
          transport: {
            WHATSAPP_BSP_URL: process.env.WHATSAPP_BSP_URL,
            WHATSAPP_BSP_KEY: process.env.WHATSAPP_BSP_KEY,
            WHATSAPP_TEXT_TEMPLATE: process.env.WHATSAPP_TEXT_TEMPLATE,
            WHATSAPP_OTP_TEMPLATE: process.env.WHATSAPP_OTP_TEMPLATE,
            MSG91_AUTH_KEY: process.env.MSG91_AUTH_KEY,
            MSG91_OTP_TEMPLATE_ID: process.env.MSG91_OTP_TEMPLATE_ID,
          },
        },
      },
    ],
  },
},
```

Optional but recommended, in `projectConfig.http` (absent means every provider
serves every actor type):

```ts
authMethodsPerActor: {
  user: ["emailpass"],
  customer: ["phone-otp"],
},
```

No migration step: challenge state lives in the auth module's existing
`provider_identity.provider_metadata` column (see service.ts header for the
decision record), so `db:migrate` picks up nothing new from this module.

## 2. Environment variables

| Variable | Purpose |
| --- | --- |
| `OTP_ECHO` | `"true"` echoes the code in the request-step response. Development/E2E only; refused at boot when `APP_ENV=production`. |
| `APP_ENV` | Already part of the boot guards; the echo guard reads it. |
| `WHATSAPP_BSP_URL`, `WHATSAPP_BSP_KEY`, `WHATSAPP_TEXT_TEMPLATE`, `WHATSAPP_OTP_TEMPLATE` | WhatsApp channel. The OTP template is the gate: without it WhatsApp is not used for sign-in. |
| `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID` | DLT SMS fallback channel. |

Channel resolution is packages/messaging's `createOtpSender`: WhatsApp when
its authentication template is approved, else MSG91 SMS, else no sender
(sign-in refuses with 503 semantics unless `OTP_ECHO` covers development).

## 3. Endpoints once registered (what the wave-2 transport calls)

### Step 1 — request a code

`POST /store/siumora-auth/otp` (this repo's custom route; requires the
standard `x-publishable-api-key` header)

```
{ "phone": "+91 98123 45678" }
```

- `200 {"ok":true,"maskedPhone":"98••••5678","expiresAt":"...","delivery":"sent|send_failed|not_configured","code":"123456"?}`
  — `code` present only under `OTP_ECHO=true`.
- `400 {"error":"invalid_phone"}` — not a 10-digit Indian mobile.
- `429 {"error":"rate_limited","retryAfterSeconds":N}` + `Retry-After` header
  — 45s resend cooldown / 5 codes per hour per number.
- `503 {"error":"sign_in_unavailable"}` — no channel configured and no echo.

(The built-in `POST /auth/customer/phone-otp` also accepts a phone-only body
and answers `200 {"location":"phone-otp:challenge"}`, but it cannot carry the
maskedPhone/expiry/echo payload — that is why the store route exists. The
built-in `/register` variant has no `location` branch and answers 401 to a
phone-only body; do not use it for step 1.)

### Step 2 — verify the code (Medusa's built-in auth route)

`POST /auth/customer/phone-otp`

```
{ "phone": "9812345678", "code": "123456" }
```

- `200 {"token":"<jwt>"}` — entity_id is the normalized 10-digit phone.
- `401 {"message":"That code is not right."}` — wrong code (attempts count
  down; the provider returns `attemptsRemaining` but Medusa's route surfaces
  only the message).
- `401 {"message":"That code has expired. Ask for a new one."}` — expired,
  consumed, locked after 5 wrong guesses, or never issued. One message for
  all four, deliberately.

### Step 3 — first sign-in only: create the customer actor

The verify token is actorless on first sign-in (no `actor_id` claim yet):

1. `POST /store/customers` with `Authorization: Bearer <token>` +
   `x-publishable-api-key` (body may carry name/email later — phone identity
   needs `{}`).
2. `POST /auth/token/refresh` with the same bearer → token now carries the
   customer `actor_id`.

Returning customers get an actor-carrying token straight from step 2. This is
the standard Medusa auth-identity flow — the Fastify `upsertCustomer` +
`claimGuestOrders` equivalents belong to the wave-2 transport and the order
module, not to this provider.

`POST /auth/customer/phone-otp/register` also exists (Medusa convention) and
runs the same two-step logic — registration is not a separate act for phone
sign-in.

## 4. Parity notes for reviewers

Ported from the Fastify contract (apps/api/src/routes/auth.ts + api.test.ts):
6-digit `randomInt` code hashed with scrypt (never stored in the clear),
300s TTL, 45s resend cooldown, 5 codes/hour/number, 5 wrong guesses lock the
code, a consumed code never verifies twice, a new code invalidates the
previous, `normalisePhone` keeps one identity per number, no
account-existence oracle in any response.

Not ported into the provider (documented in service.ts): the per-IP send cap
(20/hour) needs a cross-identity query no provider gets — it belongs in front
of the auth route; and the Fastify `SELECT ... FOR UPDATE` attempt-counter
lock has no metadata equivalent (read-modify-write; the scrypt cost keeps the
race out of brute-force territory).
