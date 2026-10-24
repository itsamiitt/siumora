import assert from "node:assert/strict";
import { test } from "node:test";
import { shopNavigation, collectionNavigation } from "../components/site-navigation.ts";
import { catalogPresentationImage } from "./catalog-presentation.ts";

test("navigation reflects backend names, new categories and deleted collections", () => {
  assert.deepEqual(shopNavigation([{ id: "cat_1", handle: "bracelets", name: "Bracelets", parent_category_id: null }]), [
    { href: "/shop", label: "All jewellery" },
    { href: "/shop?category=bracelets", label: "Bracelets" },
  ]);
  assert.deepEqual(collectionNavigation([]), []);
  assert.deepEqual(collectionNavigation([{ id: "col_1", handle: "new-edit", title: "New edit", description: "" }]), [
    { href: "/collections/new-edit", label: "New edit" },
  ]);
});

test("catalog images are displayed exactly as supplied by the backend", () => {
  const image = { url: "/catalog/petal-studs.svg", alt: "Actual catalog image", width: 100, height: 100 };
  assert.deepEqual(catalogPresentationImage(image), image);
});
