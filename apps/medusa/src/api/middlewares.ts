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
 * that this file cannot see yet. The four mounts are disjoint, so no request
 * is ever counted twice; within a mount, the rule table in
 * src/lib/rate-limit.ts decides class, window and limit (and leaves unlisted
 * paths alone).
 */

import { defineMiddlewares } from "@medusajs/framework/http";
import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";

import { limiterFromEnv, rateLimitMiddleware } from "../lib/rate-limit";

// Built once at module load — Medusa loads this file at boot, before the
// server listens, so a refused DISABLE_RATE_LIMITS fails the boot rather than
// the first request (same posture as apps/api's assertBootSafety).
const limit = rateLimitMiddleware(limiterFromEnv(process.env));

function rateLimit(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
): void {
  limit(req, res, next);
}

export default defineMiddlewares({
  routes: [
    // Medusa auth (the OTP flow lives here) — the strictest class.
    { matcher: "/auth", middlewares: [rateLimit] },
    // The custom checkout/orders namespace, present and future routes alike.
    { matcher: "/store/siumora", middlewares: [rateLimit] },
    // Browse class, loosest.
    { matcher: "/store/carts", middlewares: [rateLimit] },
    { matcher: "/store/products", middlewares: [rateLimit] },
  ],
});
