import { defineRouteConfig } from "@medusajs/admin-sdk";
import { LockClosedSolid, LockOpenSolid } from "@medusajs/icons";
import { Button, Container, Prompt, Select, StatusBadge, Table, Text } from "@medusajs/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { CardError, CardSkeleton, KeyValueRow, SectionHeader, humanize, when } from "../../../components/kit";
import { opsFetch } from "../../../lib/ops";
import { useSaveSettings, useSiumoraSettings } from "../../../lib/queries";

/**
 * Settings › Staff security (auth plan phase 3; made native in plan 16
 * Phase E): who operates the shop, with what role, whether they have
 * two-step sign-in — and the audit log of what they did, which used to be a
 * separate sidebar entry. Owner only.
 *
 * Two-step sign-in itself is Medusa's: each user turns it on under their
 * own profile. With the requirement on, a user without it cannot use the
 * Siumora operations.
 */

interface StaffSecurity {
  policy: { staffMfaRequired: boolean; breakGlass: boolean; userRolesConfigured: boolean };
  users: Array<{ id: string; email: string; name: string; role: string | null; mfaEnabled: boolean }>;
  phoneOperators: Array<{ maskedPhone: string; role: string }>;
}

interface AuditEntry {
  id: string;
  actorPhone: string;
  actorRole: string;
  action: string;
  subject: string | null;
  createdAt: string;
}

const ROLE_LABEL: Record<string, string> = {
  viewer: "Viewer",
  support: "Support",
  operator: "Ops lead",
  owner: "Owner",
  courier: "Courier",
};

const PAGE = 25;

function AuditLog() {
  const log = useQuery({
    queryKey: ["siumora", "audit"],
    queryFn: () => opsFetch<{ entries: AuditEntry[] }>("/admin/siumora/audit").then((p) => p.entries),
  });
  const [action, setAction] = useState("all");
  const [page, setPage] = useState(0);
  const actions = useMemo(() => [...new Set((log.data ?? []).map((entry) => entry.action))].sort(), [log.data]);
  const shown = (log.data ?? []).filter((entry) => action === "all" || entry.action === action);
  const rows = shown.slice(page * PAGE, (page + 1) * PAGE);

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between gap-4 px-6 py-4">
        <SectionHeaderText />
        <Select
          value={action}
          onValueChange={(next) => {
            setAction(next);
            setPage(0);
          }}
        >
          <Select.Trigger className="w-56">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all">Every action</Select.Item>
            {actions.map((name) => (
              <Select.Item key={name} value={name}>
                {name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
      {log.isLoading ? (
        <Text size="small" className="px-6 py-4 text-ui-fg-subtle">
          Loading…
        </Text>
      ) : rows.length === 0 ? (
        <Text size="small" className="px-6 py-4 text-ui-fg-subtle">
          {log.error?.message ?? "Nothing recorded yet."}
        </Text>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>When</Table.HeaderCell>
              <Table.HeaderCell>Who</Table.HeaderCell>
              <Table.HeaderCell>Action</Table.HeaderCell>
              <Table.HeaderCell>On</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((entry) => (
              <Table.Row key={entry.id}>
                <Table.Cell className="text-ui-fg-subtle">{when(entry.createdAt)}</Table.Cell>
                <Table.Cell>
                  {entry.actorPhone}
                  <span className="text-ui-fg-subtle"> · {ROLE_LABEL[entry.actorRole] ?? humanize(entry.actorRole)}</span>
                </Table.Cell>
                <Table.Cell>{entry.action}</Table.Cell>
                <Table.Cell>{entry.subject ?? "—"}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
      {shown.length > PAGE && (
        <div className="flex items-center justify-end gap-x-2 px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            {page * PAGE + 1}–{Math.min((page + 1) * PAGE, shown.length)} of {shown.length}
          </Text>
          <Button size="small" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <Button size="small" variant="secondary" disabled={(page + 1) * PAGE >= shown.length} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </Container>
  );
}

function SectionHeaderText() {
  return (
    <div>
      <Text weight="plus">Audit log</Text>
      <Text size="small" className="text-ui-fg-subtle">
        Newest first. Nobody — including the people on this page — can edit or delete an entry.
      </Text>
    </div>
  );
}

const StaffSecurityPage = () => {
  const settings = useSiumoraSettings();
  const save = useSaveSettings("Two-step sign-in requirement saved.");
  const staff = useQuery({
    queryKey: ["siumora", "staff-security"],
    queryFn: () => opsFetch<StaffSecurity>("/admin/siumora/staff-security"),
  });
  const [confirming, setConfirming] = useState(false);

  if (staff.isLoading || settings.isLoading) return <CardSkeleton rows={4} />;
  if (!staff.data) return <CardError title="Staff security" message={staff.error?.message ?? "Could not load."} />;
  const d = staff.data;
  const required = settings.data?.staffMfaRequired === true;

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <SectionHeader
          level="h1"
          title="Staff security"
          subtitle="Who operates the shop, and how they sign in."
          badge={<StatusBadge color={required ? "green" : "orange"}>{required ? "Two-step required" : "Two-step optional"}</StatusBadge>}
          actions={[
            [
              required
                ? { label: "Make two-step optional", icon: <LockOpenSolid />, destructive: true, onClick: () => setConfirming(true) }
                : { label: "Require two-step sign-in", icon: <LockClosedSolid />, onClick: () => save.mutate([{ key: "staff_mfa_required", value: true }]) },
            ],
          ]}
        />
        <KeyValueRow label="Two-step sign-in">
          {required ? "Required for Siumora operations" : "Not required"} · owners can still change settings without it
        </KeyValueRow>
        {d.policy.breakGlass && (
          <Text size="small" className="px-6 py-4 text-ui-fg-error">
            The requirement is suspended on the server (break-glass). Remove that once the locked-out owner has a new authenticator.
          </Text>
        )}
        {!d.policy.userRolesConfigured && (
          <Text size="small" className="px-6 py-4 text-ui-fg-subtle">
            Staff roles are not set on the server, so every dashboard user is an owner. Ask whoever runs the server to list each
            person's role (viewer, support, ops lead, owner).
          </Text>
        )}
      </Container>

      <Container className="divide-y p-0">
        <SectionHeader title="Dashboard users" />
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>User</Table.HeaderCell>
              <Table.HeaderCell>Role</Table.HeaderCell>
              <Table.HeaderCell>Two-step sign-in</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {d.users.map((user) => (
              <Table.Row key={user.id}>
                <Table.Cell>
                  {user.name || user.email}
                  {user.name && <span className="text-ui-fg-subtle"> · {user.email}</span>}
                </Table.Cell>
                <Table.Cell>{ROLE_LABEL[user.role ?? ""] ?? "—"}</Table.Cell>
                <Table.Cell>
                  <StatusBadge color={user.mfaEnabled ? "green" : "orange"}>{user.mfaEnabled ? "On" : "Off"}</StatusBadge>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </Container>

      {d.phoneOperators.length > 0 && (
        <Container className="divide-y p-0">
          <SectionHeader title="Phone operators" subtitle="Sign in to the storefront's ops readout with a code; sessions last 12 hours." />
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Number</Table.HeaderCell>
                <Table.HeaderCell>Role</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {d.phoneOperators.map((entry) => (
                <Table.Row key={entry.maskedPhone}>
                  <Table.Cell>{entry.maskedPhone}</Table.Cell>
                  <Table.Cell>{ROLE_LABEL[entry.role] ?? humanize(entry.role)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Container>
      )}

      <AuditLog />

      <Prompt open={confirming} onOpenChange={setConfirming}>
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>Make two-step sign-in optional?</Prompt.Title>
            <Prompt.Description>
              Staff without an authenticator could then use the Siumora operations. Recorded in the audit log with your name.
            </Prompt.Description>
          </Prompt.Header>
          <Prompt.Footer>
            <Prompt.Cancel>Keep it required</Prompt.Cancel>
            <Prompt.Action onClick={() => save.mutate([{ key: "staff_mfa_required", value: false }], { onSettled: () => setConfirming(false) })}>
              Make optional
            </Prompt.Action>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>
    </div>
  );
};

export const config = defineRouteConfig({
  label: "Staff security",
});

export default StaffSecurityPage;
