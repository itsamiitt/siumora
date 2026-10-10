import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Badge, Container, Heading, Table, Text } from "@medusajs/ui";
import { useEffect, useState } from "react";

import { OpsError, opsFetch } from "../../../lib/ops";
import { ToggleSetting, useSiumoraSettings } from "../../../lib/settings-controls";

/**
 * Settings → Staff security (auth plan phase 3): who operates the shop,
 * with what role, and whether they have two-step sign-in. Owner only.
 *
 * Two-step sign-in itself is Medusa's: each user turns it on under their
 * own profile (authenticator app plus recovery codes). With the policy on,
 * a dashboard user without it cannot use the Siumora ops pages.
 */

interface StaffSecurity {
  policy: { staffMfaRequired: boolean; breakGlass: boolean; userRolesConfigured: boolean };
  users: Array<{ id: string; email: string; name: string; role: string | null; mfaEnabled: boolean }>;
  phoneOperators: Array<{ maskedPhone: string; role: string }>;
}

const ROLE_LABEL: Record<string, string> = {
  viewer: "Viewer",
  support: "Support",
  operator: "Ops lead",
  owner: "Owner",
};

const StaffSecurityPage = () => {
  const [data, setData] = useState<StaffSecurity | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const { settings, busy, write } = useSiumoraSettings();

  useEffect(() => {
    opsFetch<StaffSecurity>("/admin/siumora/staff-security")
      .then(setData)
      .catch((error) => setRefusal(error instanceof OpsError ? error.message : "Could not load."));
  }, [settings]);

  return (
    <div className="flex flex-col gap-4">
      <Container className="p-6">
        <Heading level="h1">Staff security</Heading>
        {refusal && <Text className="mt-2 text-ui-fg-subtle">{refusal}</Text>}
        {settings && (
          <ToggleSetting
            label="Require two-step sign-in for staff"
            hint="Dashboard users without an authenticator are refused the Siumora pages until they turn it on in their profile."
            checked={settings.staffMfaRequired === true}
            disabled={busy}
            onChange={(next) => write("staff_mfa_required", next)}
          />
        )}
        {data?.policy.breakGlass && (
          <Text className="mt-4 text-ui-fg-error">
            SIUMORA_STAFF_MFA=off is set on the server: the requirement is suspended. Remove it once
            the locked-out owner has a new authenticator.
          </Text>
        )}
        {data && !data.policy.userRolesConfigured && (
          <Text size="small" className="mt-4 text-ui-fg-subtle">
            ADMIN_USER_ROLES is not set, so every dashboard user is an owner. List them as
            email:role (viewer, support, operator, owner) to narrow that.
          </Text>
        )}
      </Container>

      {data && (
        <Container className="p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Dashboard users</Heading>
          </div>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>User</Table.HeaderCell>
                <Table.HeaderCell>Role</Table.HeaderCell>
                <Table.HeaderCell>Two-step sign-in</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.users.map((user) => (
                <Table.Row key={user.id}>
                  <Table.Cell>
                    {user.name || user.email}
                    {user.name && <span className="text-ui-fg-subtle"> · {user.email}</span>}
                  </Table.Cell>
                  <Table.Cell>{ROLE_LABEL[user.role ?? ""] ?? "—"}</Table.Cell>
                  <Table.Cell>
                    <Badge color={user.mfaEnabled ? "green" : "orange"}>
                      {user.mfaEnabled ? "On" : "Off"}
                    </Badge>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Container>
      )}

      {data && data.phoneOperators.length > 0 && (
        <Container className="p-6">
          <Heading level="h2">Phone operators</Heading>
          <Text size="small" className="mt-1 text-ui-fg-subtle">
            Numbers on ADMIN_PHONES sign in to the storefront ops readout with an OTP; sessions
            last 12 hours.
          </Text>
          {data.phoneOperators.map((entry) => (
            <Text key={entry.maskedPhone} className="mt-2">
              {entry.maskedPhone} — {ROLE_LABEL[entry.role] ?? entry.role}
            </Text>
          ))}
        </Container>
      )}
    </div>
  );
};

export const config = defineRouteConfig({
  label: "Staff security",
});

export default StaffSecurityPage;
