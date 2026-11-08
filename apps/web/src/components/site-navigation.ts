import type { CatalogCategory } from "@siumora/sdk/medusa";
import type { Collection } from "@siumora/core";

export interface NavigationLink { href: string; label: string }

/** The /shop link for a category. */
export function categoryHref(category: Pick<CatalogCategory, "handle">): string {
  return "/shop?category=" + encodeURIComponent(category.handle);
}

/**
 * Top-level categories only. A child is reached from its parent's shop page
 * (subcategoryNavigation), not as a flat sibling in the header and footer.
 * A category whose parent is not in the list (inactive, internal, or hidden
 * for having no products) is treated as top-level so it is still reachable.
 */
export function shopNavigation(categories: readonly CatalogCategory[]): NavigationLink[] {
  const ids = new Set(categories.map((category) => category.id));
  return [{ href: "/shop", label: "All jewellery" }, ...categories
    .filter((category) => !category.parent_category_id || !ids.has(category.parent_category_id))
    .map((category) => ({ href: categoryHref(category), label: category.name }))];
}

export function collectionNavigation(collections: readonly Collection[]): NavigationLink[] {
  return collections.map((collection) => ({
    href: "/collections/" + encodeURIComponent(collection.handle), label: collection.title,
  }));
}

/** The category and every category beneath it, ids only — what a category page lists products from. */
export function categoryBranch(categories: readonly CatalogCategory[], rootId: string): string[] {
  const branch = [rootId];
  for (let i = 0; i < branch.length; i++) {
    for (const category of categories) {
      if (category.parent_category_id === branch[i] && !branch.includes(category.id)) branch.push(category.id);
    }
  }
  return branch;
}

/** Root-first chain from the top-level ancestor down to `category`. */
export function categoryTrail(categories: readonly CatalogCategory[], category: CatalogCategory): CatalogCategory[] {
  const byId = new Map(categories.map((entry) => [entry.id, entry]));
  const trail = [category];
  let parentId = category.parent_category_id;
  while (parentId && byId.has(parentId) && !trail.some((entry) => entry.id === parentId)) {
    const parent = byId.get(parentId)!;
    trail.unshift(parent);
    parentId = parent.parent_category_id;
  }
  return trail;
}

/**
 * On a category page: the children of its top-level ancestor, so a shopper
 * on "Rings" sees "Stacking", "Statement", and can move between them.
 */
export function subcategoryNavigation(categories: readonly CatalogCategory[], selected: CatalogCategory): NavigationLink[] {
  const root = categoryTrail(categories, selected)[0]!;
  const children = categories.filter((category) => category.parent_category_id === root.id);
  if (children.length === 0) return [];
  return [{ href: categoryHref(root), label: `All ${root.name.toLowerCase()}` },
    ...children.map((category) => ({ href: categoryHref(category), label: category.name }))];
}

/**
 * Categories worth a link: those with at least one listable product in them
 * or beneath them. An empty category in the nav is a dead end for shoppers.
 */
export function nonEmptyCategories(
  categories: readonly CatalogCategory[],
  products: ReadonlyArray<{ categories?: readonly string[] }>,
): CatalogCategory[] {
  const stocked = new Set(products.flatMap((product) => product.categories ?? []));
  return categories.filter((category) =>
    categoryBranch(categories, category.id).some((id) => {
      const entry = categories.find((candidate) => candidate.id === id);
      return entry !== undefined && stocked.has(entry.handle);
    }));
}

/** The deepest of a product's categories the store shows, as a root-first trail; [] when none. */
export function productCategoryTrail(
  categories: readonly CatalogCategory[],
  product: { categories?: readonly string[] },
): CatalogCategory[] {
  const trails = (product.categories ?? [])
    .map((handle) => categories.find((category) => category.handle === handle))
    .filter((category): category is CatalogCategory => category !== undefined)
    .map((category) => categoryTrail(categories, category));
  return trails.sort((a, b) => b.length - a.length)[0] ?? [];
}
