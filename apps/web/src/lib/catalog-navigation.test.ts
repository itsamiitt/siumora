import assert from "node:assert/strict";
import { test } from "node:test";
import {
  categoryBranch,
  collectionNavigation,
  nonEmptyCategories,
  productCategoryTrail,
  shopNavigation,
  subcategoryNavigation,
} from "../components/site-navigation.ts";
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


const rings = { id: "c_rings", handle: "rings", name: "Rings", parent_category_id: null };
const stacking = { id: "c_stack", handle: "stacking", name: "Stacking", parent_category_id: "c_rings" };
const bands = { id: "c_bands", handle: "bands", name: "Bands", parent_category_id: "c_stack" };
const earrings = { id: "c_ear", handle: "earrings", name: "Earrings", parent_category_id: null };
const tree = [rings, stacking, bands, earrings];

test("header and footer list top-level categories; children hang off their parent", () => {
  assert.deepEqual(shopNavigation(tree).map((link) => link.label), ["All jewellery", "Rings", "Earrings"]);
  // An orphan (its parent hidden) stays reachable at the top.
  assert.deepEqual(shopNavigation([stacking]).map((link) => link.label), ["All jewellery", "Stacking"]);
  assert.deepEqual(subcategoryNavigation(tree, bands).map((link) => link.label), ["All rings", "Stacking"]);
  assert.deepEqual(subcategoryNavigation(tree, earrings), []);
});

test("a category page lists its whole branch", () => {
  assert.deepEqual(categoryBranch(tree, "c_rings"), ["c_rings", "c_stack", "c_bands"]);
  assert.deepEqual(categoryBranch(tree, "c_ear"), ["c_ear"]);
});

test("empty categories are hidden; a parent with a stocked child is kept", () => {
  const visible = nonEmptyCategories(tree, [{ categories: ["bands"] }]);
  assert.deepEqual(visible.map((category) => category.handle), ["rings", "stacking", "bands"]);
  assert.deepEqual(nonEmptyCategories(tree, [{ categories: [] }, {}]), []);
});

test("a product's breadcrumb follows its deepest visible category", () => {
  assert.deepEqual(productCategoryTrail(tree, { categories: ["rings", "bands"] }).map((c) => c.handle), ["rings", "stacking", "bands"]);
  assert.deepEqual(productCategoryTrail(tree, { categories: ["internal-only"] }), []);
});
