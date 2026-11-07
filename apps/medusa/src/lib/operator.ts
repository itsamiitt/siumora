// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { can, isRole, normalisePhone, parseAdminRoles, permissionsFor, roleFor, type Permission, type Role } from "@siumora/core";

export type { Permission, Role };

/**
 * Pure operator-identity decisions — no Medusa imports, so node --test can
 * strip-type it (settings module convention). The I/O half (reading
 * auth_context, loading the actor's contact, writing refusals) lives in
 * operator-gate.ts; every refusal envelope and the role resolution are
 * decided here, where they are testable.
 *
 * TWO kinds of operator, one gate (M2 wave B, scoped):
 *
 * - an emailpass DASHBOARD USER (Medusa's `user` actor). Medusa OSS users
 *   are all-powerful admins — there is no role model to read — so a user is
 *   an `owner`, stated rather than pretended otherwise. The full RBAC +
 *   TOTP port (pending row 2) narrows this in the operator-identity wave.
 * - a phone-OTP CUSTOMER on the ADMIN_PHONES allow-list — the Fastify
 *   posture ported whole: role read from the environment on every request
 *   (parseAdminRoles/roleFor, @siumora/core rbac), so demoting somebody
 *   takes effect immediately.
 */

export interface Refusal {
  readonly code: 401 | 403;
  readonly body: {
    error: string;
    message: string;
    needs?: Permission;
    role?: Role;
  };
}

export const NOT_SIGNED_IN: Refusal = {
  code: 401,
  body: { error: "not_signed_in", message: "Sign in to continue." },
};

export const NOT_AN_OPERATOR: Refusal = {
  code: 403,
  body: {
    error: "not_an_operator",
    message: "This account cannot open the ops dashboard.",
  },
};

/** "An operator", "an owner", "a viewer" — two of the three roles need "An". */
function article(role: Role): string {
  return /^[aeiou]/i.test(role) ? "An" : "A";
}

export function insufficientRole(role: Role, permission: Permission): Refusal {
  return {
    code: 403,
    body: {
      error: "insufficient_role",
      message: `${article(role)} ${role} cannot do this. Needs: ${permission}.`,
      needs: permission,
      role,
    },
  };
}

export interface ActorIdentity {
  readonly actorType: "user" | "customer";
  /** The user's email or the customer's phone, as stored. */
  readonly contact: string | null;
}

export type RoleDecision =
  | { readonly ok: true; readonly role: Role; readonly permissions: readonly Permission[] }
  | { readonly ok: false; readonly refusal: Refusal };

/**
 * Decide the actor's role. A signed-in actor with no role gets the same 403
 * a Fastify customer off the allow-list gets — a known person refused, not a
 * pretend-404.
 */
/**
 * Dashboard users' roles (auth plan phase 3): `ADMIN_USER_ROLES`, comma
 * separated `email:role` (`ops@siumora.in:operator,help@siumora.in:support`).
 *
 * Unset, every dashboard user is an owner outside production — Medusa OSS
 * has no roles of its own (production requires the list: boot-guards.ts,
 * and decideRole falls back to viewer there). Set, it is the list:
 * a user not on it is a viewer, and an unrecognised role is dropped rather
 * than guessed (the same rule as ADMIN_PHONES).
 */
export function parseUserRoles(raw: string | undefined): Map<string, Role> | undefined {
  if (!raw || !raw.trim()) return undefined;
  const roles = new Map<string, Role>();
  for (const entry of raw.split(",")) {
    const at = entry.lastIndexOf(":");
    if (at <= 0) continue;
    const email = entry.slice(0, at).trim().toLowerCase();
    const role = entry.slice(at + 1).trim().toLowerCase();
    if (email && isRole(role)) roles.set(email, role);
  }
  return roles;
}

export function decideRole(
  identity: ActorIdentity,
  env: { ADMIN_PHONES?: string; ADMIN_USER_ROLES?: string; APP_ENV?: string },
): RoleDecision {
  if (identity.actorType === "user") {
    const listed = parseUserRoles(env.ADMIN_USER_ROLES);
    // The everyone-is-owner fallback is a development convenience. The boot
    // guard refuses production without the list; should it ever be cleared
    // at runtime anyway, production fails closed to viewer, not open to owner.
    const fallback: Role = env.APP_ENV === "production" ? "viewer" : "owner";
    const role: Role = listed
      ? (listed.get((identity.contact ?? "").trim().toLowerCase()) ?? "viewer")
      : fallback;
    return { ok: true, role, permissions: permissionsFor(role) };
  }

  const phone = normalisePhone(identity.contact ?? "");
  const role = phone
    ? roleFor(phone, parseAdminRoles(env.ADMIN_PHONES))
    : undefined;
  if (!role) return { ok: false, refusal: NOT_AN_OPERATOR };
  return { ok: true, role, permissions: permissionsFor(role) };
}

/**
 * The contact the gate carries forward (audit rows, the metrics header). A
 * customer's stored phone may be +91-prefixed; normalising here keeps the
 * audit mask meaningful (core maskPhone shows first-two/last-four only on a
 * bare 10-digit number). Emails pass through untouched.
 */
export function operatorContact(
  actorType: "user" | "customer",
  contact: string | null,
): string {
  if (actorType === "customer") {
    return normalisePhone(contact ?? "") ?? contact ?? "";
  }
  return contact ?? "";
}

/** The permission check, refusal worded exactly as the Fastify gate words it. */
export function decidePermission(
  role: Role,
  permission: Permission,
): { ok: true } | { ok: false; refusal: Refusal } {
  if (!can(role, permission)) {
    return { ok: false, refusal: insufficientRole(role, permission) };
  }
  return { ok: true };
}

export const MFA_REQUIRED: Refusal = {
  code: 403,
  body: {
    error: "mfa_required",
    message:
      "Turn on two-step sign-in to use the Siumora pages: open your profile (bottom left), then Two-step authentication.",
  },
};

/**
 * Staff two-step sign-in (auth plan phase 3, closing track-m row 2's
 * waiver). A dashboard user without an enabled authenticator is refused
 * the Siumora ops surface while the setting requires it. Medusa itself
 * already demands the code at sign-in once a factor is enabled
 * (authenticate()'s requireMfa); this closes the "never enrolled" gap.
 *
 * Phone operators prove a second thing already — the OTP on a number on
 * ADMIN_PHONES — and their sessions are 12 hours; they pass.
 */
export function decideStaffMfa(input: {
  actorType: "user" | "customer";
  mfaEnabled: boolean;
  required: boolean;
  /**
   * General settings (kill-switch, COD caps, storefront content) stay open to
   * permission-checked owners without enrollment (1ae25eb: a one-person shop
   * must not lock itself out of its own levers). Provider credentials
   * (providers:write) and sign-in/staff security (auth:settings) are NOT
   * exempt: a stolen password alone must not repoint Razorpay or switch the
   * MFA requirement off.
   */
  permission?: Permission;
}): { ok: true } | { ok: false; refusal: Refusal } {
  if (input.permission === "settings:write") return { ok: true };
  if (input.actorType !== "user" || !input.required || input.mfaEnabled) return { ok: true };
  return { ok: false, refusal: MFA_REQUIRED };
}

/**
 * Settings keys that are sign-in / staff security rather than shop levers —
 * written through the same PATCH /admin/siumora/settings, but gated as
 * auth:settings (and so MFA) instead of settings:write.
 */
export const AUTH_SETTING_KEYS: ReadonlySet<string> = new Set([
  "otp_ttl_seconds",
  "otp_resend_cooldown_seconds",
  "otp_max_sends_per_window",
  "otp_send_window_seconds",
  "otp_max_attempts",
  "otp_max_sends_per_ip_hour",
  "otp_max_sends_per_day",
  "otp_daily_sms_cap",
  "new_device_alerts",
  "google_signin_enabled",
  "google_signin_percent",
  "staff_mfa_required",
]);

/** The permission a settings PATCH needs, from the keys it touches. */
export function settingsWritePermission(keys: readonly unknown[]): Permission {
  return keys.some((key) => typeof key === "string" && AUTH_SETTING_KEYS.has(key))
    ? "auth:settings"
    : "settings:write";
}
