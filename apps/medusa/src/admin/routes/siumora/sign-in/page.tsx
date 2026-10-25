import { Container, Heading, Select, Table, Tabs, Text } from "@medusajs/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { CardError, CardSkeleton, SectionHeader, when } from "../../../components/kit";
import { opsFetch } from "../../../lib/ops";

/**
 * Siumora › Sign-in (plan 16 Phase E) — sign-in health and abuse, one page
 * with two tabs instead of two sidebar entries. Opened from the Siumora
 * home's menu; the levers are under Settings › Customer sign-in.
 *
 * Health: is sign-in working? The funnel from code requested to signed in,
 * and delivery per channel. Low delivery on one channel is a provider or
 * template problem; good delivery with low verification is a UX problem or
 * a flood of sends nobody reads; a jump in refusals is an attack.
 * Abuse: who is hammering it — busiest networks, most-targeted numbers,
 * the accounts blocked now.
 */

interface Health {
  requested: number;
  sent: number;
  sendFailed: number;
  verified: number;
  failedCodes: number;
  rateLimited: number;
  challengeFailed: number;
  signedIn: number;
  blockedSignIns: number;
  newDeviceAlerts: number;
  verifyRate: number | null;
  channels: Array<{ channel: string; sent: number; failed: number; deliveryRate: number | null }>;
}

interface Abuse {
  networks: Array<{ network: string; attempts: number }>;
  numbers: Array<{ maskedPhone: string | null; attempts: number }>;
  blocked: Array<{ customerId: string; blockedAt: string; reason: string | null; by: string | null }>;
}

const pct = (value: number | null) => (value === null ? "—" : `${Math.round(value * 1000) / 10}%`);

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="flex flex-col gap-y-1 px-6 py-4">
      <Text size="small" className="text-ui-fg-subtle">
        {label}
      </Text>
      <Heading level="h2">{value}</Heading>
      {hint && (
        <Text size="xsmall" className="text-ui-fg-muted">
          {hint}
        </Text>
      )}
    </div>
  );
}

function HealthTab() {
  const [range, setRange] = useState("24h");
  const health = useQuery({
    queryKey: ["siumora", "auth-health", range],
    queryFn: () => opsFetch<{ health: Health }>(`/admin/siumora/auth/health?window=${range}`).then((p) => p.health),
  });

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <Heading level="h2">The sign-in funnel</Heading>
          <Select value={range} onValueChange={setRange}>
            <Select.Trigger className="w-40">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="24h">Last 24 hours</Select.Item>
              <Select.Item value="7d">Last 7 days</Select.Item>
              <Select.Item value="30d">Last 30 days</Select.Item>
            </Select.Content>
          </Select>
        </div>
        {health.isLoading ? (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">
              Loading…
            </Text>
          </div>
        ) : !health.data ? (
          <Text size="small" className="px-6 py-4 text-ui-fg-subtle">
            {health.error?.message ?? "Could not load."}
          </Text>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4">
            <Stat label="Codes requested" value={health.data.requested} />
            <Stat label="Delivered" value={health.data.sent} hint={`${health.data.sendFailed} failed to send`} />
            <Stat label="Verified" value={health.data.verified} hint={`${pct(health.data.verifyRate)} of delivered`} />
            <Stat label="Signed in" value={health.data.signedIn} hint={`${health.data.blockedSignIns} blocked accounts refused`} />
            <Stat label="Wrong or expired codes" value={health.data.failedCodes} />
            <Stat label="Refused by caps" value={health.data.rateLimited} />
            <Stat label="Failed the bot check" value={health.data.challengeFailed} />
            <Stat label="New-device alerts sent" value={health.data.newDeviceAlerts} />
          </div>
        )}
      </Container>

      {health.data && (
        <Container className="divide-y p-0">
          <SectionHeader title="Delivery by channel" />
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Channel</Table.HeaderCell>
                <Table.HeaderCell>Delivered</Table.HeaderCell>
                <Table.HeaderCell>Failed</Table.HeaderCell>
                <Table.HeaderCell>Delivery rate</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {health.data.channels.length === 0 ? (
                <Table.Row>
                  <Table.Cell>No sends in this window.</Table.Cell>
                  <Table.Cell />
                  <Table.Cell />
                  <Table.Cell />
                </Table.Row>
              ) : (
                health.data.channels.map((row) => (
                  <Table.Row key={row.channel}>
                    <Table.Cell>{row.channel === "whatsapp" ? "WhatsApp" : row.channel.toUpperCase()}</Table.Cell>
                    <Table.Cell>{row.sent}</Table.Cell>
                    <Table.Cell>{row.failed}</Table.Cell>
                    <Table.Cell>{pct(row.deliveryRate)}</Table.Cell>
                  </Table.Row>
                ))
              )}
            </Table.Body>
          </Table>
        </Container>
      )}
    </div>
  );
}

function AbuseTab() {
  const abuse = useQuery({
    queryKey: ["siumora", "auth-abuse"],
    queryFn: () => opsFetch<Abuse>("/admin/siumora/auth/abuse?window=24h"),
  });
  if (abuse.isLoading) return <CardSkeleton rows={4} />;
  if (!abuse.data) return <CardError title="Abuse" message={abuse.error?.message ?? "Could not load."} />;
  const a = abuse.data;

  const rankTable = (title: string, rows: Array<{ key: string; label: string; attempts: number }>) => (
    <Container className="divide-y p-0">
      <SectionHeader title={title} subtitle="Last 24 hours" />
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>{title === "Busiest networks" ? "Network" : "Number"}</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Requests</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.length === 0 ? (
            <Table.Row>
              <Table.Cell>Nothing unusual.</Table.Cell>
              <Table.Cell />
            </Table.Row>
          ) : (
            rows.map((row) => (
              <Table.Row key={row.key}>
                <Table.Cell>{row.label}</Table.Cell>
                <Table.Cell className="text-right">{row.attempts}</Table.Cell>
              </Table.Row>
            ))
          )}
        </Table.Body>
      </Table>
    </Container>
  );

  return (
    <div className="flex flex-col gap-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        {rankTable(
          "Busiest networks",
          a.networks.map((row) => ({ key: row.network, label: row.network, attempts: row.attempts })),
        )}
        {rankTable(
          "Most-targeted numbers",
          a.numbers.map((row, index) => ({ key: `${row.maskedPhone}-${index}`, label: row.maskedPhone ?? "—", attempts: row.attempts })),
        )}
      </div>
      <Container className="divide-y p-0">
        <SectionHeader title="Blocked accounts" />
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
            {a.blocked.length === 0 ? (
              <Table.Row>
                <Table.Cell>Nobody is blocked.</Table.Cell>
                <Table.Cell />
                <Table.Cell />
                <Table.Cell />
              </Table.Row>
            ) : (
              a.blocked.map((row) => (
                <Table.Row key={row.customerId}>
                  <Table.Cell>
                    <Link to={`/customers/${row.customerId}`} className="text-ui-fg-interactive hover:underline">
                      View customer
                    </Link>
                  </Table.Cell>
                  <Table.Cell>{when(row.blockedAt)}</Table.Cell>
                  <Table.Cell>{row.reason ?? "—"}</Table.Cell>
                  <Table.Cell>{row.by ?? "—"}</Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </Container>
    </div>
  );
}

const SignInPage = () => (
  <div className="flex flex-col gap-y-3">
    <Container className="p-0">
      <SectionHeader
        level="h1"
        title="Sign-in"
        subtitle={
          <>
            Is sign-in working, and who is hammering it. Change the limits under{" "}
            <Link to="/settings/customer-sign-in" className="text-ui-fg-interactive hover:underline">
              Customer sign-in
            </Link>
            .
          </>
        }
      />
    </Container>
    <Tabs defaultValue="health">
      <Tabs.List>
        <Tabs.Trigger value="health">Health</Tabs.Trigger>
        <Tabs.Trigger value="abuse">Abuse</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="health" className="mt-3">
        <HealthTab />
      </Tabs.Content>
      <Tabs.Content value="abuse" className="mt-3">
        <AbuseTab />
      </Tabs.Content>
    </Tabs>
  </div>
);

// No route config: reached from the Siumora home's menu, not the sidebar.
export default SignInPage;
