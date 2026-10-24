import type { CatalogCategory } from "@siumora/sdk/medusa";
import type { Collection } from "@siumora/core";

export interface NavigationLink { href: string; label: string }

export function shopNavigation(categories: readonly CatalogCategory[]): NavigationLink[] {
  return [{ href: "/shop", label: "All jewellery" }, ...categories.map((category) => ({
    href: "/shop?category=" + encodeURIComponent(category.handle), label: category.name,
  }))];
}

export function collectionNavigation(collections: readonly Collection[]): NavigationLink[] {
  return collections.map((collection) => ({
    href: "/collections/" + encodeURIComponent(collection.handle), label: collection.title,
  }));
}
