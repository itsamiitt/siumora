import { Module } from "@medusajs/framework/utils";

import SiumoraWishlistModuleService from "./service";

export const SIUMORA_WISHLIST_MODULE = "siumoraWishlist";

export default Module(SIUMORA_WISHLIST_MODULE, {
  service: SiumoraWishlistModuleService,
});
