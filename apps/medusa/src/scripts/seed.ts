/**
 * M1 seed port — the canonical catalog into Medusa's native modules.
 *
 * Run from apps/medusa:
 *
 *   npx medusa exec ./src/scripts/seed.ts
 *
 * Idempotent by create-if-missing, not wipe-and-reinsert. The Fastify seed
 * (packages/db/src/seed.ts) clears its tables first; here that would tear
 * through cross-module links (sales channels, price sets, inventory), so
 * every step queries before it creates and re-running is a no-op. The flip
 * side: this seed does not reconcile drift — if a seeded row was edited by
 * hand, the edit wins.
 *
 * MRP decision: the source models a statutory MRP alongside the selling
 * price per variant. Medusa has no first-class compare-at price, and price
 * lists model time-bound override campaigns — the wrong shape for "the
 * number printed on the tag". So the variant's Medusa price is the selling
 * price, and BOTH canonical figures ride on variant metadata in the repo's
 * canonical unit: `metadata.mrp_paise` and `metadata.price_paise` (integer
 * paise). The M1 adapter reads metadata for MRP and can cross-check the
 * calculated price against `price_paise` without ever touching floats.
 *
 * Collection membership: the source is many-to-many (petal-studs sits in
 * both "everyday" and "gifting"); a Medusa product carries a single
 * `collection_id`. The first source collection is the primary one and
 * becomes `collection_id`; the full ordered list is preserved verbatim at
 * `product.metadata.collections` for the adapter to reconstruct facets.
 */

import type { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  createCollectionsWorkflow,
  createInventoryLevelsWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";

import { CATALOG, COLLECTIONS, paiseToInrMajor } from "./seed-data";

const SALES_CHANNEL_NAME = "Default Sales Channel";
const REGION_NAME = "India";
const CURRENCY = "inr";
const COUNTRY = "in";
const STOCK_LOCATION_NAME = "Siumora Warehouse";
const PUBLISHABLE_KEY_TITLE = "Siumora Storefront";

export default async function seed({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  // ── Sales channel ─────────────────────────────────────────────────────
  const findSalesChannel = () =>
    query.graph({
      entity: "sales_channel",
      fields: ["id", "name"],
      filters: { name: SALES_CHANNEL_NAME },
    });
  let { data: salesChannels } = await findSalesChannel();
  if (salesChannels.length === 0) {
    await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ name: SALES_CHANNEL_NAME }] },
    });
    logger.info(`seed: created sales channel "${SALES_CHANNEL_NAME}"`);
    ({ data: salesChannels } = await findSalesChannel());
  }
  const salesChannel = salesChannels[0]!;

  // ── Region: India / INR ───────────────────────────────────────────────
  const findRegion = () =>
    query.graph({
      entity: "region",
      fields: ["id", "name", "currency_code"],
      filters: { name: REGION_NAME },
    });
  let { data: regions } = await findRegion();
  if (regions.length === 0) {
    await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: REGION_NAME,
            currency_code: CURRENCY,
            countries: [COUNTRY],
            payment_providers: ["pp_system_default"],
          },
        ],
      },
    });
    logger.info(`seed: created region "${REGION_NAME}" (${CURRENCY})`);
    ({ data: regions } = await findRegion());
  }
  const region = regions[0]!;

  // ── Tax region for IN (base rate; GST proper is the M2 module) ────────
  const { data: taxRegions } = await query.graph({
    entity: "tax_region",
    fields: ["id", "country_code"],
    filters: { country_code: COUNTRY },
  });
  if (taxRegions.length === 0) {
    await createTaxRegionsWorkflow(container).run({
      input: [{ country_code: COUNTRY, provider_id: "tp_system" }],
    });
    logger.info(`seed: created tax region "${COUNTRY}"`);
  }

  // ── Stock location, linked to the sales channel ───────────────────────
  const findStockLocation = () =>
    query.graph({
      entity: "stock_location",
      fields: ["id", "name", "sales_channels.id"],
      filters: { name: STOCK_LOCATION_NAME },
    });
  let { data: stockLocations } = await findStockLocation();
  if (stockLocations.length === 0) {
    await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: STOCK_LOCATION_NAME,
            address: { city: "Mumbai", country_code: COUNTRY, address_1: "" },
          },
        ],
      },
    });
    logger.info(`seed: created stock location "${STOCK_LOCATION_NAME}"`);
    ({ data: stockLocations } = await findStockLocation());
  }
  const stockLocation = stockLocations[0]!;

  const linkedChannelIds = (stockLocation.sales_channels ?? []).map(
    (sc: { id: string } | null) => sc?.id,
  );
  if (!linkedChannelIds.includes(salesChannel.id)) {
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: stockLocation.id, add: [salesChannel.id] },
    });
    logger.info("seed: linked stock location to sales channel");
  }

  // ── Shipping profile (migrations create the default; hold the line) ───
  const findShippingProfile = () =>
    query.graph({
      entity: "shipping_profile",
      fields: ["id", "name", "type"],
      filters: { type: "default" },
    });
  let { data: shippingProfiles } = await findShippingProfile();
  if (shippingProfiles.length === 0) {
    await createShippingProfilesWorkflow(container).run({
      input: { data: [{ name: "Default Shipping Profile", type: "default" }] },
    });
    logger.info("seed: created default shipping profile");
    ({ data: shippingProfiles } = await findShippingProfile());
  }
  const shippingProfile = shippingProfiles[0]!;

  // ── Store: INR-only, Siumora, sane defaults ───────────────────────────
  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "name"],
  });
  const store = stores[0];
  if (store) {
    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: store.id },
        update: {
          name: "Siumora",
          supported_currencies: [{ currency_code: CURRENCY, is_default: true }],
          default_sales_channel_id: salesChannel.id,
          default_region_id: region.id,
        },
      },
    });
  }

  // ── Publishable API key, linked to the sales channel ──────────────────
  // Reuse an existing live publishable key (first boot creates a default
  // one) rather than minting a second; the storefront needs exactly one.
  const findApiKey = async () => {
    const { data } = await query.graph({
      entity: "api_key",
      fields: ["id", "title", "token", "type", "revoked_at", "sales_channels.id"],
      filters: { type: "publishable" },
    });
    return data.find((key) => !key.revoked_at);
  };
  let apiKey = await findApiKey();
  if (!apiKey) {
    await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [
          { title: PUBLISHABLE_KEY_TITLE, type: "publishable", created_by: "seed" },
        ],
      },
    });
    logger.info(`seed: created publishable API key "${PUBLISHABLE_KEY_TITLE}"`);
    apiKey = await findApiKey();
  }
  if (!apiKey) {
    throw new Error("seed: no live publishable API key after creation");
  }
  const keyChannelIds = (apiKey.sales_channels ?? []).map(
    (sc: { id: string } | null) => sc?.id,
  );
  if (!keyChannelIds.includes(salesChannel.id)) {
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: { id: apiKey.id, add: [salesChannel.id] },
    });
    logger.info("seed: linked publishable API key to sales channel");
  }

  // ── Collections ───────────────────────────────────────────────────────
  const collectionHandles = COLLECTIONS.map((c) => c.handle);
  const findCollections = () =>
    query.graph({
      entity: "product_collection",
      fields: ["id", "handle"],
      filters: { handle: collectionHandles },
    });
  let { data: collectionRows } = await findCollections();
  const missingCollections = COLLECTIONS.filter(
    (c) => !collectionRows.some((row) => row.handle === c.handle),
  );
  if (missingCollections.length > 0) {
    await createCollectionsWorkflow(container).run({
      input: {
        collections: missingCollections.map((c) => ({
          handle: c.handle,
          title: c.title,
          // Medusa collections have no description column; keep the source
          // copy on metadata so the storefront can render it.
          metadata: { description: c.description },
        })),
      },
    });
    logger.info(
      `seed: created collections ${missingCollections.map((c) => c.handle).join(", ")}`,
    );
    ({ data: collectionRows } = await findCollections());
  }
  const collectionByHandle = new Map(
    collectionRows.map((row) => [row.handle, row.id]),
  );

  // ── Products ──────────────────────────────────────────────────────────
  const { data: existingProducts } = await query.graph({
    entity: "product",
    fields: ["id", "handle"],
    filters: { handle: CATALOG.map((p) => p.handle) },
  });
  const existingHandles = new Set(existingProducts.map((p) => p.handle));
  const toCreate = CATALOG.filter((p) => !existingHandles.has(p.handle));

  if (toCreate.length > 0) {
    await createProductsWorkflow(container).run({
      input: {
        products: toCreate.map((entry) => ({
          handle: entry.handle,
          title: entry.title,
          subtitle: entry.subtitle,
          description: entry.description,
          status: ProductStatus.PUBLISHED,
          // Primary collection; full membership on metadata (header comment).
          collection_id: collectionByHandle.get(entry.collections[0]!)!,
          images: entry.images.map((image) => ({
            // Storefront-relative paths, verbatim from the source seed; the
            // web app serves them from its public/ directory.
            url: image.url,
            metadata: { alt: image.alt, width: image.width, height: image.height },
          })),
          shipping_profile_id: shippingProfile.id,
          sales_channels: [{ id: salesChannel.id }],
          options: [
            {
              title: entry.optionTitle,
              values: entry.variants.map((v) => v.title),
            },
          ],
          variants: entry.variants.map((variant) => ({
            title: variant.title,
            sku: variant.sku,
            options: { [entry.optionTitle]: variant.title },
            manage_inventory: true,
            prices: [
              {
                // paise → rupee major units; see paiseToInrMajor for the
                // full mapping decision.
                amount: paiseToInrMajor(variant.price),
                currency_code: CURRENCY,
              },
            ],
            // Canonical money in canonical units — see MRP decision above.
            metadata: { mrp_paise: variant.mrp, price_paise: variant.price },
          })),
          metadata: {
            hsn: entry.hsn,
            gst_slab: entry.gstSlab,
            material: entry.material,
            pierced_jewellery: entry.piercedJewellery,
            collections: [...entry.collections],
          },
        })),
      },
    });
    logger.info(
      `seed: created products ${toCreate.map((p) => p.handle).join(", ")}`,
    );
  }

  // ── Inventory levels at the warehouse ─────────────────────────────────
  const inventoryBySku = new Map<string, number>();
  for (const entry of CATALOG) {
    for (const variant of entry.variants) {
      inventoryBySku.set(variant.sku, variant.inventory);
    }
  }
  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku", "location_levels.location_id"],
    filters: { sku: [...inventoryBySku.keys()] },
  });
  const levelsToCreate = inventoryItems
    .filter(
      (item) =>
        !(item.location_levels ?? []).some(
          (level: { location_id: string } | null) =>
            level?.location_id === stockLocation.id,
        ),
    )
    .map((item) => ({
      inventory_item_id: item.id,
      location_id: stockLocation.id,
      stocked_quantity: inventoryBySku.get(item.sku ?? "") ?? 0,
    }));
  if (levelsToCreate.length > 0) {
    await createInventoryLevelsWorkflow(container).run({
      input: { inventory_levels: levelsToCreate },
    });
    logger.info(`seed: created ${levelsToCreate.length} inventory levels`);
  }

  // ── What the storefront needs ─────────────────────────────────────────
  logger.info("seed: done");
  logger.info(`  products:            ${CATALOG.length} (${existingHandles.size} pre-existing)`);
  logger.info(`  collections:         ${COLLECTIONS.length}`);
  logger.info(`  region:              ${region.id} (${REGION_NAME}, ${CURRENCY})`);
  logger.info(`  sales channel:       ${salesChannel.id}`);
  logger.info(`  stock location:      ${stockLocation.id} (${STOCK_LOCATION_NAME})`);
  logger.info(`  publishable API key: ${apiKey.token}`);
  logger.info(
    "  storefront: send this token as the x-publishable-api-key header " +
      "(MEDUSA_PUBLISHABLE_KEY env for the Medusa transport)",
  );
}
