import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IAuthModuleService } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { parseAdminRoles } from "@siumora/core";

import { pgOf } from "../../../../lib/customer-signin";
import { decideRole } from "../../../../lib/operator";
import { requireOperator } from "../../../../lib/operator-gate";
import { settingsCache } from "../../../../modules/settings/cache";
import { readSettings, type SqlClient as SettingsSqlClient } from "../../../../modules/settings/read";

/**
 * GET /admin/siumora/staff-security — who can operate the shop and how
 * they prove it (auth plan phase 3, settings → Staff security). Owner only
 * (auth:settings).
 *
 * Dashboard users: their role (ADMIN_USER_ROLES) and whether two-step
 * sign-in is on. Phone operators: their role (ADMIN_PHONES), masked. Plus
 * the policy — the staff_mfa_required setting and whether the server's
 * break-glass override is engaged.
 */
export const AUTHENTICATE = false;

interface UserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string | Date;
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "auth:settings");
  if (!operator) return;

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const auth = req.scope.resolve<IAuthModuleService>(Modules.AUTH);
  const { data } = await query.graph({
    entity: "user",
    fields: ["id", "email", "first_name", "last_name", "created_at"],
  });

  const users = [];
  for (const user of data as UserRow[]) {
    const providers = await auth.listProviderIdentities({ entity_id: user.email, provider: "emailpass" });
    const identityId = providers[0]?.auth_identity_id;
    const factors = identityId
      ? await auth.listAuthMfa({ auth_identity_id: identityId, status: "enabled" })
      : [];
    const role = decideRole({ actorType: "user", contact: user.email }, process.env);
    users.push({
      id: user.id,
      email: user.email,
      name: [user.first_name ?? "", user.last_name ?? ""].join(" ").trim(),
      role: role.ok ? role.role : null,
      mfaEnabled: factors.length > 0,
      createdAt: user.created_at,
    });
  }

  const phoneOperators = [...(parseAdminRoles(process.env.ADMIN_PHONES) as Map<string, string>)].map(
    ([phone, role]) => ({ maskedPhone: `${phone.slice(0, 2)}••••${phone.slice(-4)}`, role }),
  );
  const settings = await settingsCache(() =>
    readSettings(pgOf(req) as unknown as SettingsSqlClient),
  ).get();

  res.setHeader("Cache-Control", "no-store");
  res.json({
    policy: {
      staffMfaRequired: settings.staffMfaRequired,
      breakGlass: process.env.SIUMORA_STAFF_MFA === "off",
      userRolesConfigured: Boolean(process.env.ADMIN_USER_ROLES?.trim()),
    },
    users,
    phoneOperators,
  });
}
