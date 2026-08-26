// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { can, normalisePhone, parseAdminRoles, permissionsFor, roleFor, type Permission, type Role } from "@siumora/core";

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
export function decideRole(
  identity: ActorIdentity,
  env: { ADMIN_PHONES?: string },
): RoleDecision {
  if (identity.actorType === "user") {
    return { ok: true, role: "owner", permissions: permissionsFor("owner") };
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
