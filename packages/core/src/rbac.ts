import { normalisePhone } from "./auth.ts";

/**
 * Who may do what, and the record of who did.
 *
 * Until now operator access was one flag: on the `ADMIN_PHONES` list or not,
 * and everyone on it could do everything — move a parcel, file the GST return,
 * erase a customer. plan/11 §4 asks for roles and an audit log, and the reason
 * is the same for both: the person who packs boxes should not be able to erase
 * a customer, and when one is erased there should be a record of who did it.
 *
 * Roles are read from the environment on every request rather than stored on
 * the session, exactly as the allow-list already was. Demoting somebody takes
 * effect immediately instead of whenever a thirty-day session happens to lapse.
 */

export type Role =
  /** Can see the dashboard and nothing else. A new hire, an accountant. */
  | "viewer"
  /** The everyday job: move parcels, work the NDR queue, reconcile COD. */
  | "operator"
  /** Everything, including the statutory desks and erasing a person. */
  | "owner";

export type Permission =
  /** Read the ops dashboard and order list. */
  | "metrics:read"
  /** Move an order through its states, restock, work NDR and returns. */
  | "orders:write"
  /** Ingest a courier remittance file and read the cash position. */
  | "remittance:write"
  /** The GST desk: GSTR-1 and the invoice tables behind it. */
  | "gst:read"
  /** See and complete data-principal requests, including erasure. */
  | "privacy:write"
  /** Read the audit log. */
  | "audit:read";

/**
 * The grants, written out per role rather than as a hierarchy.
 *
 * A hierarchy reads well and hides exactly the question worth asking — "can an
 * operator do this?" — behind a rank comparison. Spelled out, the answer is
 * visible and a new permission has to be placed deliberately.
 */
const GRANTS: Record<Role, readonly Permission[]> = {
  viewer: ["metrics:read"],
  operator: ["metrics:read", "orders:write", "remittance:write"],
  owner: [
    "metrics:read",
    "orders:write",
    "remittance:write",
    // The statutory desks. A GSTR-1 export is every customer's state and every
    // registered buyer's GSTIN in one file.
    "gst:read",
    // Irreversible, and it is the one action nobody should be able to take by
    // being on a list somebody forgot to prune.
    "privacy:write",
    "audit:read",
  ],
};

export const ROLES: readonly Role[] = ["viewer", "operator", "owner"];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function can(role: Role | undefined, permission: Permission): boolean {
  if (!role) return false;
  return GRANTS[role].includes(permission);
}

/** Every permission a role holds, for the dashboard to render against. */
export function permissionsFor(role: Role): readonly Permission[] {
  return GRANTS[role];
}

/**
 * Parse `ADMIN_PHONES`.
 *
 * `9876543210` or `9876543210:operator`, comma separated. Splitting on
 * whitespace as well would tear "+91 98765 43210" into three fragments and
 * silently drop a configured operator.
 *
 * **An unsuffixed number is an owner.** A one-person shop sets one number and
 * expects to be able to do everything, and a default that quietly removed the
 * GST desk from the only configured account would be a worse surprise than a
 * permissive default. Roles are opt-in — the moment there are two numbers on
 * the list, they should be used.
 *
 * An unrecognised role is dropped rather than downgraded. `:oprator` is a typo,
 * and silently granting the least privilege would look like a permissions bug
 * for as long as it took somebody to notice.
 */
export function parseAdminRoles(
  raw: string | undefined,
): Map<string, Role> {
  const roles = new Map<string, Role>();
  if (!raw) return roles;

  for (const entry of raw.split(",")) {
    const [rawPhone, rawRole] = entry.split(":");
    const phone = normalisePhone(rawPhone ?? "");
    if (!phone) continue;

    if (rawRole === undefined) {
      roles.set(phone, "owner");
      continue;
    }

    const role = rawRole.trim().toLowerCase();
    if (isRole(role)) roles.set(phone, role);
  }

  return roles;
}

export function roleFor(
  phone: string,
  roles: ReadonlyMap<string, Role>,
): Role | undefined {
  return roles.get(phone);
}

/**
 * Actions worth recording.
 *
 * A closed list, so the log is queryable and a new admin write has to name
 * itself rather than landing as a free-text string nobody can group by.
 */
export type AuditAction =
  | "order.status"
  | "order.restock"
  | "remittance.ingest"
  | "privacy.erase"
  | "privacy.refuse"
  | "gst.export"
  | "auth.admin_signin";

export const AUDIT_ACTIONS: readonly AuditAction[] = [
  "order.status",
  "order.restock",
  "remittance.ingest",
  "privacy.erase",
  "privacy.refuse",
  "gst.export",
  "auth.admin_signin",
];

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

/** The permission an action implies, so the log and the gate cannot diverge. */
export const ACTION_PERMISSION: Record<AuditAction, Permission> = {
  "order.status": "orders:write",
  "order.restock": "orders:write",
  "remittance.ingest": "remittance:write",
  "privacy.erase": "privacy:write",
  "privacy.refuse": "privacy:write",
  "gst.export": "gst:read",
  "auth.admin_signin": "metrics:read",
};
