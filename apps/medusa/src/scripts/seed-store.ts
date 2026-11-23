/**
 * The production seed (plan 18 L1.5): the store setup with no demo catalog.
 *
 *   npx medusa exec ./src/scripts/seed-store.ts
 *   npx medusa exec ./src/scripts/seed-serviceability.ts
 *
 * Sales channel, India region (INR; system + Razorpay payment), tax region,
 * warehouse, shipping profile, Standard Delivery on Shiprocket, store
 * defaults and the storefront's publishable key — everything checkout needs
 * except products, which are entered in the dashboard with real photography
 * (the product publish guard refuses an incomplete one). Never touches
 * products or stock, so unlike seed.ts it runs against production without
 * SEED_FORCE. Convergent: a second run changes nothing.
 */

import type { ExecArgs } from "@medusajs/framework/types";

import { seedStore } from "./seed";

export default async function seedStoreOnly({ container }: ExecArgs) {
  const { logger, region, salesChannel, stockLocation, apiKey } = await seedStore(container);
  logger.info("seed-store: done (no products — add the catalog in the dashboard)");
  logger.info(`  region:              ${region.id}`);
  logger.info(`  sales channel:       ${salesChannel.id}`);
  logger.info(`  stock location:      ${stockLocation.id}`);
  logger.info(`  publishable API key: ${apiKey.token}`);
  logger.info(
    "  storefront: set MEDUSA_PUBLISHABLE_KEY to this token (sent as x-publishable-api-key)",
  );
}
