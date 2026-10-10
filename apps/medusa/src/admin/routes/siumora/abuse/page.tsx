import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ShieldCheck } from "@medusajs/icons";
import { Container, Heading, Table, Text } from "@medusajs/ui";
import { useEffect, useState } from "react";

import { OpsError, opsFetch } from "../../../lib/ops";

/**
 * Siumora · Abuse (auth plan phase 3): who is hammering sign-in.
 *
 * The networks (/24) and numbers (masked) behind the most code requests,
 * failures and refusals in the last day, and the accounts blocked now.
 * Levers to pull live in Settings → Customer sign-in: per-connection and
 * per-number caps, the SMS budget; Turnstile is switched on in the server
 * environment.
 */

interface Abuse {
  networks: Array<{ network: string; attempts: number }>;
  numbers: Array<{ maskedPhone: string | null; attempts: number }>;
  blocked: Array<{ customerId: string; blockedAt: string; reason: string | null; by: string | null }>;
}

const AbusePage = () => {
  const [data, setData] = useState<Abuse | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    opsFetch<Abuse>("/admin/siumora/auth/abuse?window=24h")
      .then(setData)
      .catch((error) => setRefusal(error instanceof OpsError ? error.message : "Could not load."));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Container className="p-6">
        <Heading level="h1">Abuse</Heading>
        <Text size="small" className="mt-1 text-ui-fg-subtle">
          Last 24 hours. Tighten the caps under Settings → Customer sign-in.
        </Text>
        {refusal && <Text className="mt-4 text-ui-fg-subtle">{refusal}</Text>}
      </Container>

      {data && (
        <div className="grid gap-4 md:grid-cols-2">
          <Container className="p-0">
            <div className="px-6 py-4">
              <Heading level="h2">Busiest networks</Heading>
            </div>
            <Table>
              <Table.Body>
                {data.networks.length === 0 ? (
                  <Table.Row>
                    <Table.Cell>Nothing unusual.</Table.Cell>
                  </Table.Row>
                ) : (
                  data.networks.map((row) => (
                    <Table.Row key={row.network}>
                      <Table.Cell>{row.network}</Table.Cell>
                      <Table.Cell className="text-right">{row.attempts}</Table.Cell>
                    </Table.Row>
                  ))
                )}
              </Table.Body>
            </Table>
          </Container>

          <Container className="p-0">
            <div className="px-6 py-4">
              <Heading level="h2">Most-targeted numbers</Heading>
            </div>
            <Table>
              <Table.Body>
                {data.numbers.length === 0 ? (
                  <Table.Row>
                    <Table.Cell>Nothing unusual.</Table.Cell>
                  </Table.Row>
                ) : (
                  data.numbers.map((row, index) => (
                    <Table.Row key={`${row.maskedPhone}-${index}`}>
                      <Table.Cell>{row.maskedPhone ?? "—"}</Table.Cell>
                      <Table.Cell className="text-right">{row.attempts}</Table.Cell>
                    </Table.Row>
                  ))
                )}
              </Table.Body>
            </Table>
          </Container>
        </div>
      )}

      {data && (
        <Container className="p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Blocked accounts</Heading>
          </div>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Customer</Table.HeaderCell>
                <Table.HeaderCell>Since</Table.HeaderCell>
                <Table.HeaderCell>Reason</Table.HeaderCell>
                <Table.HeaderCell>By</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.blocked.map((row) => (
                <Table.Row key={row.customerId}>
                  <Table.Cell>
                    <a href={`/app/customers/${row.customerId}`} className="text-ui-fg-interactive">
                      {row.customerId}
                    </a>
                  </Table.Cell>
                  <Table.Cell>{new Date(row.blockedAt).toLocaleString("en-IN")}</Table.Cell>
                  <Table.Cell>{row.reason ?? "—"}</Table.Cell>
                  <Table.Cell>{row.by ?? "—"}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Container>
      )}
    </div>
  );
};

export const config = defineRouteConfig({
  label: "Abuse",
  icon: ShieldCheck,
});

export default AbusePage;
