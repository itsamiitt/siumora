import { toRupees, type AnalyticsItem } from "@siumora/analytics";
import { lowestPrice, type CartLine, type Product, type Variant } from "@siumora/core";

/**
 * Adapters from domain objects to the analytics item shape.
 *
 * The single place paise become decimal rupees for ad platforms. `item_id` is
 * always the SKU, because Merchant Center and the Meta catalog key on it — an
 * id that does not match the feed breaks catalog ads silently.
 */

export function itemFromVariant(
  product: Product,
  variant: Variant,
  quantity = 1,
): AnalyticsItem {
  return {
    item_id: variant.sku,
    item_name: product.title,
    price: toRupees(variant.price.selling),
    quantity,
    item_category: product.collections[0],
    item_variant: variant.title,
    item_brand: "Siumora",
  };
}

/** Product-level item for list and PDP views, using the lowest variant price. */
export function itemFromProduct(product: Product, quantity = 1): AnalyticsItem {
  const variant = product.variants[0]!;
  return {
    item_id: variant.sku,
    item_name: product.title,
    price: toRupees(lowestPrice(product).selling),
    quantity,
    item_category: product.collections[0],
    item_brand: "Siumora",
  };
}

export function itemFromCartLine(line: CartLine): AnalyticsItem {
  return {
    item_id: line.sku,
    item_name: line.title,
    price: toRupees(line.unitPrice),
    quantity: line.quantity,
    item_variant: line.variantTitle,
    item_brand: "Siumora",
  };
}

export function cartValue(lines: readonly CartLine[]): number {
  return toRupees(lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0));
}
