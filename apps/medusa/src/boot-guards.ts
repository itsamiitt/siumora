/**
 * Boot guards, pure — the Medusa port of the Fastify assertBootSafety
 * contract (parity checklist: "API lib — boot guards"). The config loader
 * calls this before defineConfig; tests exercise it without booting anything.
 *
 * APP_ENV, not NODE_ENV, gates behavior: managed staging runs
 * NODE_ENV=production, so NODE_ENV cannot tell staging from production.
 * But NODE_ENV=production with no APP_ENV at all is refused: defaulting to
 * "development" there would boot a live box with every guard below off.
 */

export const DEV_SECRET = "supersecret-dev-only";
/** src/lib/signed-token.ts's last-resort fallback — never a real secret. */
export const DEV_TOKEN_SECRET = "siumora-dev-token-secret";

export type AppEnv = "development" | "staging" | "production";

export interface MedusaBootEnv {
  NODE_ENV?: string;
  APP_ENV?: string;
  JWT_SECRET?: string;
  COOKIE_SECRET?: string;
  SIUMORA_TOKEN_SECRET?: string;
  MEDUSA_DATABASE_URL?: string;
  MEDUSA_REDIS_URL?: string;
  MEDUSA_WORKER_MODE?: string;
  COURIER_SIMULATION?: string;
  OTP_ECHO?: string;
  SETTINGS_ENCRYPTION_KEY?: string;
  S3_FILE_URL?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_BUCKET?: string;
  STOREFRONT_URL?: string;
  STORE_CORS?: string;
  ADMIN_CORS?: string;
  AUTH_CORS?: string;
  ADMIN_USER_ROLES?: string;
  TURNSTILE_SECRET_KEY?: string;
  CLIENT_IP_SECRET?: string;
}

export type WorkerMode = "shared" | "worker" | "server";

export function resolveAppEnv(env: MedusaBootEnv): AppEnv {
  if (!env.APP_ENV && env.NODE_ENV === "production") {
    throw new Error(
      "boot refused: NODE_ENV=production but APP_ENV is not set — set APP_ENV=production (or staging)",
    );
  }
  const appEnv = env.APP_ENV ?? "development";
  if (appEnv !== "development" && appEnv !== "staging" && appEnv !== "production") {
    throw new Error(`APP_ENV must be development|staging|production, got "${appEnv}"`);
  }
  return appEnv;
}

/** MEDUSA_WORKER_MODE → projectConfig.workerMode; unset is Medusa's "shared". */
export function resolveWorkerMode(env: MedusaBootEnv): WorkerMode {
  const mode = env.MEDUSA_WORKER_MODE || "shared";
  if (mode !== "shared" && mode !== "worker" && mode !== "server") {
    throw new Error(`MEDUSA_WORKER_MODE must be shared|worker|server, got "${mode}"`);
  }
  return mode;
}

const isLocal = (value: string) => /\b(localhost|127\.0\.0\.1|0\.0\.0\.0)\b/i.test(value);

/** At least one `email:owner` entry — without one nobody can reach Settings. */
function hasOwner(raw: string): boolean {
  return raw.split(",").some((entry) => {
    const at = entry.lastIndexOf(":");
    return at > 0 && entry.slice(at + 1).trim().toLowerCase() === "owner";
  });
}

export function assertMedusaBootSafety(env: MedusaBootEnv): {
  appEnv: AppEnv;
  jwtSecret: string;
  cookieSecret: string;
  workerMode: WorkerMode;
} {
  const appEnv = resolveAppEnv(env);
  const workerMode = resolveWorkerMode(env);
  const jwtSecret = env.JWT_SECRET ?? DEV_SECRET;
  const cookieSecret = env.COOKIE_SECRET ?? DEV_SECRET;

  if (appEnv === "production") {
    const refuse = (why: string): never => {
      throw new Error(`production boot refused: ${why}`);
    };
    if (jwtSecret === DEV_SECRET || cookieSecret === DEV_SECRET) {
      refuse("JWT_SECRET/COOKIE_SECRET are dev defaults");
    }
    // Signed links (email verification, guest order access) fall back to
    // JWT_SECRET, then to a constant in the source. An explicit token secret
    // set to either dev value would be forgeable by anyone with the repo.
    if (env.SIUMORA_TOKEN_SECRET === DEV_TOKEN_SECRET || env.SIUMORA_TOKEN_SECRET === DEV_SECRET) {
      refuse("SIUMORA_TOKEN_SECRET is a dev default");
    }
    if (!env.MEDUSA_DATABASE_URL) refuse("MEDUSA_DATABASE_URL is not set");
    // Rate-limit counters (src/lib/rate-limit.ts), sessions, the event bus,
    // workflow engine and locks live in Redis. Without it every process
    // keeps its own counters, a restart forgets every window, and the OTP
    // endpoint's ceiling multiplies.
    if (!env.MEDUSA_REDIS_URL) refuse("MEDUSA_REDIS_URL is not set");
    // Provider credentials (Razorpay, Shiprocket, SMS) are sealed with this
    // key; without it the admin cannot save them and nothing can be read.
    if (!env.SETTINGS_ENCRYPTION_KEY || env.SETTINGS_ENCRYPTION_KEY.length < 32) {
      refuse("SETTINGS_ENCRYPTION_KEY must be set (at least 32 characters)");
    }
    // Without S3 the file module falls back to local disk and stamps
    // http://localhost into every uploaded image URL — broken on the
    // storefront and lost on the next redeploy.
    for (const key of ["S3_FILE_URL", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET"] as const) {
      if (!env[key]) refuse(`${key} is not set (product images need object storage)`);
    }
    // These default to localhost in medusa-config.ts: unset, the storefront
    // is CORS-refused and emailed links point at a developer's laptop.
    for (const key of ["STOREFRONT_URL", "STORE_CORS", "ADMIN_CORS", "AUTH_CORS"] as const) {
      const value = env[key];
      if (!value) refuse(`${key} is not set`);
      else if (isLocal(value)) refuse(`${key} points at localhost`);
    }
    // Unset, every dashboard user is an owner (src/lib/operator.ts).
    if (!env.ADMIN_USER_ROLES || !hasOwner(env.ADMIN_USER_ROLES)) {
      refuse("ADMIN_USER_ROLES must list at least one email:owner");
    }
    // Turnstile is off without its secret (src/lib/turnstile.ts) — the bot
    // check in front of the one route where every hit costs an SMS.
    if (!env.TURNSTILE_SECRET_KEY) refuse("TURNSTILE_SECRET_KEY is not set");
    // The storefront signs the shopper's IP it forwards; without the shared
    // secret every rate-limit window keys on the storefront's own address.
    if (!env.CLIENT_IP_SECRET || env.CLIENT_IP_SECRET.length < 32) {
      refuse("CLIENT_IP_SECRET must be set (at least 32 characters)");
    }
    // Development switches that would be holes in production (plan 16 B30):
    // the courier simulation lets a customer mark their own parcel
    // delivered, and OTP_ECHO hands the sign-in code back in the response.
    // Both are already inert there; a production env that sets them is a
    // misconfiguration worth refusing loudly rather than ignoring.
    if (env.COURIER_SIMULATION === "true") refuse("COURIER_SIMULATION must not be set");
    if (env.OTP_ECHO === "true") refuse("OTP_ECHO must not be set");
  }

  return { appEnv, jwtSecret, cookieSecret, workerMode };
}
