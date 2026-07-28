import Fastify, { type FastifyError, type FastifyInstance } from "fastify";

import { parseAdminPhones } from "@siumora/core";
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
import { registerWishlistRoutes } from "./routes/wishlist.ts";

export interface AppConfig {
  connectionString: string;
  ssl?: boolean;
  corsOrigins?: string[];
  razorpayWebhookSecret?: string;
  courierWebhookSecret?: string;
  /** Numbers that may open the ops dashboard. Comma separated. */
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
    // The raw body is needed to verify webhook signatures; re-serialising the
    // parsed JSON reorders keys and breaks a perfectly genuine signature.
    bodyLimit: 1_048_576,
  });

  server.decorate("db", db);
  server.decorate("config", config);
  server.decorate("adminPhones", parseAdminPhones(config.adminPhones));

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

  return { server, db, pool };
}
