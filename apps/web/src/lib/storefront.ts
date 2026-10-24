import "server-only";
import { DEFAULT_STOREFRONT } from "@siumora/core/storefront";
import { api } from "./api";

export async function getStorefrontContent() {
  const client = api();
  return "getStorefrontContent" in client ? client.getStorefrontContent() : DEFAULT_STOREFRONT;
}
