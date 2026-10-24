# Siumora store control center

The Medusa admin route `/app/siumora/settings` owns homepage content, checkout controls, provider configuration, and account notifications. Owners can edit settings without enrolling in MFA; enrolled accounts still complete their normal two-factor sign-in.

## Implemented

- Publish hero image, accessible description, headline, copy, buttons, note, and announcement as one validated setting. Upload JPEG, PNG, or WebP through native Medusa uploads. Use HTTPS image hosting in production.
- Homepage and header read the public content endpoint through the commerce SDK with five-second revalidation. The public endpoint returns only content, never payment or messaging settings.
- Configure Razorpay, WhatsApp BSP, MSG91 SMS, and Resend credentials. Store provider records with AES-256-GCM authenticated encryption; responses show presence only and audits omit values. Saved settings override environment values.
- Enable or disable WhatsApp, SMS, and email. Runtime OTP, account security alerts, and email verification use these settings. Disabling and re-enabling retains credentials. An unreadable encrypted record disables that channel instead of silently using environment credentials.
- Retain checkout pause, COD fee/minimum/maximum, and new-device notification controls. Link native product, category, collection, inventory, order, promotion, shipping, and region settings, plus existing customer sign-in and staff security pages.

## Deployment prerequisites and remaining work

Set `SETTINGS_ENCRYPTION_KEY` in the Medusa server environment to a random secret of at least 32 characters. Back it up separately from the database; changing it without re-encrypting records makes them unreadable. Do not put this key in storefront environment variables. Existing provider environment credentials remain usable until overridden.

Deploy both backend/admin and storefront with `COMMERCE_BACKEND=medusa`. The legacy Fastify storefront retains its default homepage content. No new database migration is necessary; records use the existing `siumora_settings` table.

WhatsApp uses the existing BSP adapter, not an arbitrary direct Meta API endpoint. Approved WhatsApp templates, MSG91 DLT configuration, and a verified Resend sender are required. Configured status indicates value presence, not a successful delivery test.

Razorpay credentials can be saved, but prepaid checkout and verified payment webhooks still need the Medusa payment integration. The storefront does not offer prepaid payment merely because credentials exist. Order/shipping notifications, marketing campaigns, and delivery logs also remain pending; the panel labels these limitations explicitly.

Deployment and live message/payment delivery have not been verified against siumora.com.

## Validation

Settings, OTP, security-alert, encryption, and SDK tests cover persistence, channel disabling, credential redaction, unsafe content rejection, and short content revalidation. SDK and application TypeScript checks pass. Medusa backend and admin production builds passed. A production Next.js build and Chrome browser against a controlled HTTP backend verified that edited hero title, image, and announcement appear after revalidation. Catalog, mobile navigation, and product detail update checks also passed.
