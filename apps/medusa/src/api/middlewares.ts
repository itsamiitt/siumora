/**
 * Route middleware — the Medusa port of the Fastify app's onRequest limiter
 * (apps/api/src/app.ts registers it globally; here defineMiddlewares mounts
 * it by matcher). The limiter itself, its rules and the DISABLE_RATE_LIMITS
 * boot guard live in src/lib/rate-limit.ts and are tested there without
 * booting the framework.
 *
 * Matchers are express mount points: routes registered without `methods` go
 * through `app.use(matcher, ...)`, so "/store/siumora" covers every route in
 * that namespace — including the checkout/orders routes still landing in M1
 * that this file cannot see yet. The rate-limited mounts are disjoint, so no
 * request is ever counted twice; within a mount, the rule table in
 * src/lib/rate-limit.ts decides class, window and limit (and leaves unlisted
 * paths alone).
 */

import { allowFields, authenticate, defineMiddlewares } from "@medusajs/framework/http";
import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";

import { limiterFromEnv, rateLimitMiddleware } from "../lib/rate-limit";
import { connectRedis, logRedisError } from "../lib/redis";
import {
  closedCustomerAuthRoute,
  refuseCustomerTokenMinting,
  sessionAuth,
} from "../lib/session-auth";

// Built once at module load — Medusa loads this file at boot, before the
// server listens, so a refused DISABLE_RATE_LIMITS fails the boot rather than
// the first request (same posture as apps/api's assertBootSafety).
const limit = rateLimitMiddleware(
  limiterFromEnv(process.env, { connectRedis, onRedisError: logRedisError }),
);

function rateLimit(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
): void {
  limit(req, res, next);
}

export default defineMiddlewares({
  routes: [
    // Customer sessions (auth plan phase 1): an `sst_` bearer becomes the
    // signed-in customer for the rest of the request, or is dropped if the
    // session is dead — see src/lib/session-auth.ts. A single-segment global
    // matcher sorts ahead of every route-level authenticate() below it.
    { matcher: "/store", middlewares: [sessionAuth] },
    // Medusa auth — the strictest rate class.
    { matcher: "/auth", middlewares: [rateLimit] },
    // Doors that would mint a customer credential outside the session
    // table: the built-in route for our provider (sign-in goes through
    // /store/siumora-auth/verify), and refresh/session exchange for a
    // customer JWT. Dashboard users pass the latter two untouched.
    { matcher: "/auth/customer/phone-otp", middlewares: [closedCustomerAuthRoute] },
    { matcher: "/auth/token/refresh", middlewares: [refuseCustomerTokenMinting] },
    { matcher: "/auth/session", middlewares: [refuseCustomerTokenMinting] },
    // The OTP send step. Its own mount: "/store/siumora" below does not
    // cover "/store/siumora-auth" (express mounts match whole segments).
    { matcher: "/store/siumora-auth", middlewares: [rateLimit] },
    // The M2 ops routes. Every route under this mount exports
    // AUTHENTICATE=false to opt out of Medusa's default admin-user-only
    // gate, and this authenticate() readmits BOTH actor kinds — the
    // emailpass dashboard user (session cookie or bearer) and the phone-OTP
    // operator the SDK's admin reads sign in as (bearer). Authorisation
    // (role + permission) happens per-route in src/lib/operator-gate.ts;
    // this middleware only establishes who is asking.
    {
      matcher: "/admin/siumora/*",
      middlewares: [
        rateLimit,
        sessionAuth,
        authenticate(["user", "customer"], ["session", "bearer"]),
      ],
    },
    // The custom checkout/orders namespace, present and future routes alike.
    { matcher: "/store/siumora", middlewares: [rateLimit] },
    // Browse class, loosest. Medusa 2.21 refuses any store `fields` path not
    // on the route's allow-list, and the SDK's PRODUCT_FIELDS / CART_FIELDS
    // (packages/sdk/src/medusa.ts) read the metadata our India fields live in
    // — catalogue data, public by design. Keep these lists in step with the SDK.
    {
      matcher: "/store/carts",
      middlewares: [
        rateLimit,
        allowFields(
          "items.variant.metadata",
          "items.variant.product.metadata",
          "items.variant.product.images",
        ),
      ],
    },
    {
      matcher: "/store/products",
      middlewares: [rateLimit, allowFields("variants.metadata")],
    },
  ],
});
