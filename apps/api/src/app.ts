import Fastify, { type FastifyError, type FastifyInstance } from "fastify";

import { createDb, createPool, migrate, type Database } from "@siumora/db";

import { registerCatalogRoutes } from "./routes/catalog.ts";
import { registerCartRoutes } from "./routes/cart.ts";
import { registerCheckoutRoutes } from "./routes/checkout.ts";
import { registerOrderRoutes } from "./routes/orders.ts";
import { registerWebhookRoutes } from "./routes/webhooks.ts";
import { registerAdminRoutes } from "./routes/admin.ts";

export interface AppConfig {
  connectionString: string;
  ssl?: boolean;
  corsOrigins?: string[];
  razorpayWebhookSecret?: string;
  courierWebhookSecret?: string;
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
  }
}

export async function buildApp(config: AppConfig): Promise<App> {
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
    reply.header("Access-Control-Allow-Headers", "content-type,idempotency-key");
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

  await registerCatalogRoutes(server);
  await registerCartRoutes(server);
  await registerCheckoutRoutes(server);
  await registerOrderRoutes(server);
  await registerWebhookRoutes(server);
  await registerAdminRoutes(server);

  return { server, db, pool };
}
