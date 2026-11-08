import { createProductsWorkflow, updateProductsWorkflow } from "@medusajs/medusa/core-flows";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";

import { publishRefusal, type PublishCandidate } from "../../lib/product-publish-guard";

/**
 * Refuse a published product without its HSN, GST slab, INR prices or a
 * storefront sales channel, server-side.
 *
 * The admin widget validates what it writes, but the dashboard's own Publish
 * button, the product import and any API caller never pass through it — and
 * one published product without a slab used to take the whole storefront
 * catalogue down. Medusa 2.21's product workflows expose only an
 * after-the-fact hook, so this throws there: the workflow fails, its steps
 * compensate (the create is deleted, the update restored), and the caller
 * gets a 400 naming what is missing. Every path — single, batch, import —
 * runs these two workflows.
 *
 * The products are re-read rather than trusted from the hook payload: an
 * update returns what it changed, and the gate is about the product as it
 * now stands.
 */
async function guard(
  ids: readonly string[],
  container: { resolve(key: string): unknown },
): Promise<void> {
  if (ids.length === 0) return;
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as {
    graph(input: { entity: string; fields: string[]; filters: Record<string, unknown> }): Promise<{ data: unknown[] }>;
  };
  const { data } = await query.graph({
    entity: "product",
    fields: [
      "id", "handle", "title", "status", "metadata",
      "variants.id", "variants.title", "variants.prices.amount", "variants.prices.currency_code",
      "sales_channels.id",
    ],
    filters: { id: [...ids] },
  });
  const refusal = publishRefusal(data as PublishCandidate[], await storefrontChannels(query));
  if (refusal) throw new MedusaError(MedusaError.Types.INVALID_DATA, refusal);
}

/**
 * Sales channels the storefront can read: those behind a live publishable
 * key. With no live key at all (a fresh install mid-setup) the check is
 * skipped rather than refusing every publish.
 */
async function storefrontChannels(query: {
  graph(input: { entity: string; fields: string[]; filters: Record<string, unknown> }): Promise<{ data: unknown[] }>;
}): Promise<ReadonlySet<string> | undefined> {
  const { data } = await query.graph({
    entity: "api_key",
    fields: ["id", "revoked_at", "sales_channels.id"],
    filters: { type: "publishable" },
  });
  const live = (data as Array<{ revoked_at?: string | null; sales_channels?: Array<{ id?: string } | null> | null }>)
    .filter((key) => !key.revoked_at);
  if (live.length === 0) return undefined;
  return new Set(live.flatMap((key) => (key.sales_channels ?? []).flatMap((c) => (c?.id ? [c.id] : []))));
}

createProductsWorkflow.hooks.productsCreated(async ({ products }, { container }) => {
  await guard(products.map((product) => product.id), container);
});

updateProductsWorkflow.hooks.productsUpdated(async ({ products }, { container }) => {
  await guard((products ?? []).map((product) => product.id), container);
});
