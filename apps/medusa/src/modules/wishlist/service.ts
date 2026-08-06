import { MedusaService } from "@medusajs/framework/utils";

import { SiumoraWishlists } from "./models/siumora-wishlists";

/**
 * Generated CRUD over the wishlist table (listSiumoraWishlists etc.).
 *
 * The routes do NOT go through this service: the toggle needs ON CONFLICT
 * idempotency the generated create cannot express, so the store lives in
 * store.ts against the shared pg connection (the siumora-order convention).
 * This service exists so the module owns its model and its migrations.
 */
class SiumoraWishlistModuleService extends MedusaService({ SiumoraWishlists }) {}

export default SiumoraWishlistModuleService;
