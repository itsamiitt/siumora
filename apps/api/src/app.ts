import Fastify, { type FastifyError, type FastifyInstance } from "fastify";

import {
  PLACEHOLDER_SELLER,
  deriveKey,
  parseAdminPhones,
  parseAdminRoles,
  type Role,
  type Seller,
} from "@siumora/core";
import { createDb, createPool, migrate, type Database } from "@siumora/db";

import { registerAuthRoutes } from "./routes/auth.ts";
import { registerCatalogRoutes } from "./routes/catalog.ts";
import { registerCartRoutes } from "./routes/cart.ts";
import { registerCheckoutRoutes } from "./routes/checkout.ts";
import { registerOrderRoutes } from "./routes/orders.ts";
import { registerWebhookRoutes } from "./routes/webhooks.ts";
import { registerAdminRoutes } from "./routes/admin.ts";
import { registerGstRoutes } from "./routes/gst.ts";
import { registerRemittanceRoutes } from "./routes/remittance.ts";
import { registerPrivacyRoutes } from "./routes/privacy.ts";
import { registerTwoFactorRoutes } from "./routes/two-factor.ts";
import { registerWishlistRoutes } from "./routes/wishlist.ts";
import { createRateLimiter, type RateLimiter } from "./lib/rate-limit.ts";

export interface AppConfig {
  connectionString: string;
  ssl?: boolean;
  corsOrigins?: string[];
  razorpayWebhookSecret?: string;
  courierWebhookSecret?: string;
  /**
   * Who may open the ops dashboard, comma separated.
   *
   * `9876543210` or `9876543210:operator`. An unsuffixed number is an owner —
   * a one-person shop sets one number and expects to do everything, and a
   * default that quietly removed the GST desk would surprise worse than a
   * permissive one. See `parseAdminRoles`.
   */
  adminPhones?: string;
  /** Set once a WhatsApp/DLT sender is wired up. */
  otpDeliveryConfigured?: boolean;
  /** Return the code in the response. Development only; refused in production. */
  otpEcho?: boolean;
  /**
   * Let a non-operator drive courier transitions.
   *
   * On in development so the delivered/NDR/returns paths can be walked without
   * a courier account. Off in production, where the signed webhook is the only
   * thing that should be moving a parcel.
   */
  courierSimulation?: boolean;
  /**
   * Whether each conversion destination is actually wired up.
   *
   * When it is not, conversions are still built and written to the ledger —
   * marked `skipped` rather than `pending`, so the queue does not fill with
   * work no worker can do while the parity report still shows the event existed.
   */
  ga4Configured?: boolean;
  metaConfigured?: boolean;
  /**
   * The registered seller, for the tax invoice.
   *
   * Left unset the invoice endpoint refuses rather than printing a document
   * with a dash where the GSTIN belongs — which would look official enough that
   * nobody would check.
   */
  seller?: Partial<Seller>;
  /**
   * Passphrase for sealing TOTP secrets at rest.
   *
   * Unset, enrolment is refused rather than storing the shared secret in
   * plaintext — a column that looks like a second factor and is not one is
   * worse than no second factor at all.
   */
  totpEncryptionKey?: string;
  /**
   * Send HSTS. Off by default because it is a promise a browser remembers for a
   * year, and making it on a plain-HTTP development origin pins that browser to
   * an https://localhost that does not exist.
   */
  hsts?: boolean;
  /**
   * Trust `X-Forwarded-For`.
   *
   * Behind Cloudflare or a load balancer this must be on, or every request
   * arrives from the proxy and the whole internet shares one rate-limit bucket.
   * Directly exposed it must be off, or a client sets its own address and the
   * limit means nothing.
   */
  trustProxy?: boolean;
  /** Injected in tests, where the real windows are too slow to exercise. */
  rateLimiter?: RateLimiter;
  logger?: boolean;
}

export interface App {
  server: FastifyInstance;
  db: Database;
  /** Exposed so the process can drain it on shutdown. */
  pool: ReturnType<typeof createPool>;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
    config: AppConfig;
    /** Parsed once at boot, so every request is not re-parsing an env string. */
    adminPhones: string[];
    /** Phone to role. Read on every request; a demotion takes effect at once. */
    adminRoles: Map<string, Role>;
    seller: Seller;
    /** Derived once at boot. Undefined when no passphrase is configured. */
    totpKey: Buffer | undefined;
    rateLimiter: RateLimiter;
  }
}

export async function buildApp(config: AppConfig): Promise<App> {
  if (config.otpEcho && process.env.NODE_ENV === "production") {
    // Refuse at boot rather than at the first sign-in. A production deploy that
    // hands sign-in codes back over HTTP is every account on the site.
    throw new Error(
      "OTP_ECHO must not be set in production — it returns sign-in codes to the caller.",
    );
  }

  const pool = createPool({
    connectionString: config.connectionString,
    ssl: config.ssl ?? false,
  });
  await migrate(pool);
  const db = createDb(pool);

  const server = Fastify({
    logger: config.logger ?? false,
    trustProxy: config.trustProxy ?? false,
    // The raw body is needed to verify webhook signatures; re-serialising the
    // parsed JSON reorders keys and breaks a perfectly genuine signature.
    bodyLimit: 1_048_576,
  });

  server.decorate("db", db);
  server.decorate("config", config);
  server.decorate("adminPhones", parseAdminPhones(config.adminPhones));
  server.decorate("adminRoles", parseAdminRoles(config.adminPhones));
  server.decorate("seller", { ...PLACEHOLDER_SELLER, ...config.seller });
  server.decorate(
    "totpKey",
    // Derived at boot: scrypt is deliberately slow, and doing it per request
    // would put that cost on every enrolment check.
    config.totpEncryptionKey ? deriveKey(config.totpEncryptionKey) : undefined,
  );

  server.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      (request as { rawBody?: string }).rawBody = body as string;
      try {
        done(null, body === "" ? {} : JSON.parse(body as string));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  // CORS is an explicit allow-list. A wildcard with credentials would let any
  // site read a signed-in customer's cart.
  const origins = new Set(config.corsOrigins ?? []);
  server.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && origins.has(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Credentials", "true");
      reply.header("Vary", "Origin");
    }
    reply.header(
      "Access-Control-Allow-Headers",
      "content-type,idempotency-key,authorization",
    );
    reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");

    if (request.method === "OPTIONS") reply.code(204).send();
  });

  /**
   * Response headers that apply to every reply.
   *
   * This is a JSON API, not a document server, so most of the browser-facing
   * policy is short: never sniff the type, never frame it, never leak the URL
   * on an outbound link. `default-src 'none'` is the honest CSP for a service
   * that returns no HTML and loads nothing — it costs nothing and it means an
   * error page rendered by a proxy cannot pull in a script.
   */
  server.addHook("onRequest", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    reply.header("Cross-Origin-Resource-Policy", "same-site");
    // Only over TLS: sent on a plain-HTTP local request it would pin
    // developers' browsers to https://localhost.
    if (config.hsts) {
      reply.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
  });

  // Per-origin limits on the endpoints that cost money to serve. Registered
  // after CORS so a pre-flight is answered rather than throttled, and before
  // the routes so a refusal never reaches the database.
  const limiter = config.rateLimiter ?? createRateLimiter();
  server.decorate("rateLimiter", limiter);

  server.addHook("onRequest", async (request, reply) => {
    if (request.method === "OPTIONS") return;

    const decision = limiter.check(
      request.ip,
      request.url.split("?")[0] ?? request.url,
      request.method,
    );
    if (decision.allowed) return;

    reply.header("Retry-After", String(decision.retryAfterSeconds));
    return reply.code(429).send({
      error: "rate_limited",
      message: "Too many requests. Try again shortly.",
      retryAfterSeconds: decision.retryAfterSeconds,
    });
  });

  server.setErrorHandler((error: FastifyError, request, reply) => {
    request.log?.error?.(error);
    // Never return the raw message: it can carry SQL, table names and
    // connection details straight to the caller.
    const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    reply.code(status).send({
      error: status === 500 ? "internal_error" : (error.code ?? "request_error"),
      message: status === 500 ? "Something went wrong." : error.message,
    });
  });

  server.get("/health", async () => {
    // Prove the database is reachable rather than only that the process is up —
    // a health check that cannot fail is not a health check.
    await pool.query("SELECT 1");
    return { ok: true };
  });

  await registerAuthRoutes(server);
  await registerCatalogRoutes(server);
  await registerCartRoutes(server);
  await registerCheckoutRoutes(server);
  await registerOrderRoutes(server);
  await registerWebhookRoutes(server);
  await registerWishlistRoutes(server);
  await registerAdminRoutes(server);
  await registerGstRoutes(server);
  await registerRemittanceRoutes(server);
  await registerPrivacyRoutes(server);
  await registerTwoFactorRoutes(server);

  return { server, db, pool };
}
