import { createProductsWorkflow, updateProductsWorkflow } from "@medusajs/medusa/core-flows";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";

import { publishRefusal, type PublishCandidate } from "../../lib/product-publish-guard";

/**
 * Refuse a published product without its HSN and GST slab, server-side.
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
    graph(input: { entity: string; fields: string[]; filters: Record<string, unknown> }): Promise<{ data: PublishCandidate[] }>;
  };
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "handle", "title", "status", "metadata"],
    filters: { id: [...ids] },
  });
  const refusal = publishRefusal(data);
  if (refusal) throw new MedusaError(MedusaError.Types.INVALID_DATA, refusal);
}

createProductsWorkflow.hooks.productsCreated(async ({ products }, { container }) => {
  await guard(products.map((product) => product.id), container);
});

updateProductsWorkflow.hooks.productsUpdated(async ({ products }, { container }) => {
  await guard((products ?? []).map((product) => product.id), container);
});
