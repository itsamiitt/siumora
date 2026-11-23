import { computeLegal } from "./legal.ts";
import { previewPasswordIsConfigured, previewSecretIsConfigured } from "./launch-preview.ts";

/**
 * Storefront launch guards (plan 18 L1.4) — the web twin of the Medusa
 * boot guards (apps/medusa/src/boot-guards.ts).
 *
 * `LEGAL_COMPLETE` was documented as "gates opening sale", but nothing read
 * it outside the policy-page notice: a production deploy with no GSTIN or
 * grievance officer would have sold anyway. With APP_ENV=production this
 * refuses the build (next.config.ts) and the server start
 * (instrumentation.ts) instead, so the deploy fails and the previous one
 * keeps serving.
 *
 * APP_ENV, not NODE_ENV: every `next build` runs NODE_ENV=production,
 * including CI, E2E and preview builds, which must keep working without
 * production secrets. Unset APP_ENV checks nothing.
 *
 * Pure so the tests drive it with a synthetic environment.
 */

type Env = Record<string, string | undefined>;

const isLocal = (value: string) => /\b(localhost|127\.0\.0\.1|0\.0\.0\.0)\b/i.test(value);

/** Every reason this environment must not serve production; empty when it may. */
export function launchProblems(env: Env): string[] {
  const appEnv = env.APP_ENV;
  if (appEnv !== undefined && appEnv !== "development" && appEnv !== "staging" && appEnv !== "production") {
    return [`APP_ENV must be development|staging|production, got "${appEnv}"`];
  }
  if (appEnv !== "production") return [];

  const problems: string[] = [];
  const need = (key: string, why: string) => {
    if (!env[key]?.trim()) problems.push(`${key} is not set (${why})`);
  };

  // Fastify is frozen and retired at launch (plan 17); production is Medusa.
  if (env.COMMERCE_BACKEND === "fastify") problems.push("COMMERCE_BACKEND=fastify — production runs on Medusa");
  need("MEDUSA_URL", "the storefront has no backend");
  need("MEDUSA_PUBLISHABLE_KEY", "Medusa's store routes refuse a request without it");
  for (const key of ["MEDUSA_URL", "MEDUSA_ADMIN_URL"] as const) {
    const value = env[key];
    if (value && isLocal(value)) problems.push(`${key} points at localhost`);
  }

  const site = env.NEXT_PUBLIC_SITE_URL;
  if (!site?.trim()) problems.push("NEXT_PUBLIC_SITE_URL is not set (canonical URLs, sitemap, OG cards)");
  else if (isLocal(site) || !site.startsWith("https://")) problems.push("NEXT_PUBLIC_SITE_URL must be the public https origin");

  // Signed forwarding of the shopper's IP — without it Medusa's rate limits
  // key every shopper on the storefront's own address.
  if (!env.CLIENT_IP_SECRET || env.CLIENT_IP_SECRET.length < 32) {
    problems.push("CLIENT_IP_SECRET must be set (at least 32 characters, the same value Medusa has)");
  }
  need("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "the bot check in front of every SMS-costing Send code");
  if (!env.NEXT_PUBLIC_SENTRY_DSN?.trim() && !env.SENTRY_DSN?.trim()) {
    problems.push("NEXT_PUBLIC_SENTRY_DSN is not set (production errors would go unseen)");
  }

  // Statutory disclosures (Consumer Protection (E-Commerce) Rules 2020): the
  // contact block before anyone outside sees the site, everything before sale.
  const { contactComplete, legalComplete } = computeLegal(env);
  if (!contactComplete) {
    problems.push(
      "the legal contact block is incomplete (NEXT_PUBLIC_LEGAL_NAME/ADDRESS, SUPPORT_EMAIL/PHONE, GRIEVANCE_OFFICER/EMAIL)",
    );
  }

  if (env.SITE_PHASE === "coming-soon") {
    if (!previewPasswordIsConfigured(env.COMING_SOON_PREVIEW_PASSWORD)) {
      problems.push("COMING_SOON_PREVIEW_PASSWORD must be exactly four digits while SITE_PHASE=coming-soon");
    }
    if (!previewSecretIsConfigured(env.COMING_SOON_PREVIEW_SECRET)) {
      problems.push("COMING_SOON_PREVIEW_SECRET must be set (at least 32 characters) while SITE_PHASE=coming-soon");
    }
  } else if (contactComplete && !legalComplete) {
    problems.push(
      "sale is open (SITE_PHASE is not coming-soon) but the GSTIN or CIN/LLPIN is missing — keep SITE_PHASE=coming-soon until they are set",
    );
  }

  return problems;
}

/** Throws with every problem at once, so one failed deploy names them all. */
export function assertLaunchReady(env: Env): void {
  const problems = launchProblems(env);
  if (problems.length > 0) {
    throw new Error(`production storefront refused:\n  - ${problems.join("\n  - ")}`);
  }
}
