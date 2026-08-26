import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ListBullet } from "@medusajs/icons";
import { Container, Heading, Table, Text } from "@medusajs/ui";
import { useEffect, useState } from "react";

import { OpsError, opsFetch } from "../../../lib/ops";

/**
 * Siumora · Audit — the log, owner only, read-only by construction
 * (GET /admin/siumora/audit). Actor contacts arrive masked from the API;
 * this page never sees a full phone number or email.
 */

interface AuditEntry {
  id: string;
  actorPhone: string;
  actorRole: string;
  action: string;
  subject: string | null;
  createdAt: string;
}

const AuditPage = () => {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    opsFetch<{ entries: AuditEntry[] }>("/admin/siumora/audit")
      .then((payload) => setEntries(payload.entries))
      .catch((error) =>
        setRefusal(error instanceof OpsError ? error.message : "Could not load the log."),
      );
  }, []);

  if (refusal) {
    return (
      <Container className="p-6">
        <Heading level="h1">Audit log</Heading>
        <Text className="mt-2 text-ui-fg-subtle">{refusal}</Text>
      </Container>
    );
  }
  if (!entries) return null;

  return (
    <Container className="p-6">
      <Heading level="h1">Audit log</Heading>
      <Text size="small" className="mt-1 text-ui-fg-subtle">
        Newest first. Nobody — including the people on this screen — can edit
        or delete an entry.
      </Text>
      <Table className="mt-4">
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>When</Table.HeaderCell>
            <Table.HeaderCell>Actor</Table.HeaderCell>
            <Table.HeaderCell>Role</Table.HeaderCell>
            <Table.HeaderCell>Action</Table.HeaderCell>
            <Table.HeaderCell>Subject</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {entries.map((entry) => (
            <Table.Row key={entry.id}>
              <Table.Cell>{new Date(entry.createdAt).toLocaleString()}</Table.Cell>
              <Table.Cell>{entry.actorPhone}</Table.Cell>
              <Table.Cell>{entry.actorRole}</Table.Cell>
              <Table.Cell>{entry.action}</Table.Cell>
              <Table.Cell>{entry.subject ?? "—"}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
      {entries.length === 0 && (
        <Text size="small" className="mt-3 text-ui-fg-subtle">
          Nothing recorded yet.
        </Text>
      )}
    </Container>
  );
};

export const config = defineRouteConfig({
  label: "Audit log",
  icon: ListBullet,
});

export default AuditPage;
