/**
 * Deployment tier, decoupled from NODE_ENV.
 *
 * Managed hosts (DO App Platform, Vercel, most PaaS) run NODE_ENV=production
 * on staging deploys too — it controls framework optimisations, not intent.
 * Behavior gates that key on NODE_ENV therefore break staging: the OTP echo
 * refuses to boot and the courier simulation switches off in the exact
 * environment the launch-gate drills depend on. APP_ENV states the intent
 * explicitly; NODE_ENV stays "production" everywhere deployed.
 */
export type AppEnv = "development" | "staging" | "production";

const APP_ENVS: readonly string[] = ["development", "staging", "production"];

export function resolveAppEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  const explicit = env.APP_ENV;
  if (explicit !== undefined) {
    if (!APP_ENVS.includes(explicit)) {
      // A typo'd tier must not silently become "development" on a production
      // box — that would re-enable every gate this variable exists to close.
      throw new Error(
        `APP_ENV must be one of ${APP_ENVS.join(", ")} — got "${explicit}".`,
      );
    }
    return explicit as AppEnv;
  }
  return env.NODE_ENV === "production" ? "production" : "development";
}
