import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ChartBar } from "@medusajs/icons";
import { Container, Heading, Select, Table, Text } from "@medusajs/ui";
import { useEffect, useState } from "react";

import { OpsError, opsFetch } from "../../../lib/ops";

/**
 * Siumora · Sign-in health (auth plan phase 3): is sign-in working?
 *
 * The funnel from code requested to signed in, and delivery per channel.
 * Low delivery on one channel is a provider or template problem; good
 * delivery with low verification is a UX problem or a flood of sends
 * nobody reads; a jump in refusals is an attack (see Abuse).
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

const pct = (value: number | null) => (value === null ? "—" : `${Math.round(value * 1000) / 10}%`);

const Stat = ({ label, value, hint }: { label: string; value: string | number; hint?: string }) => (
  <div className="rounded-md border border-ui-border-base p-4">
    <Text size="small" className="text-ui-fg-subtle">
      {label}
    </Text>
    <Heading level="h2" className="mt-1">
      {value}
    </Heading>
    {hint && (
      <Text size="xsmall" className="mt-1 text-ui-fg-muted">
        {hint}
      </Text>
    )}
  </div>
);

const SignInHealthPage = () => {
  const [window, setWindow] = useState("24h");
  const [health, setHealth] = useState<Health | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    opsFetch<{ health: Health }>(`/admin/siumora/auth/health?window=${window}`)
      .then((payload) => setHealth(payload.health))
      .catch((error) => setRefusal(error instanceof OpsError ? error.message : "Could not load."));
  }, [window]);

  return (
    <div className="flex flex-col gap-4">
      <Container className="flex items-center justify-between p-6">
        <Heading level="h1">Sign-in health</Heading>
        <Select value={window} onValueChange={setWindow}>
          <Select.Trigger className="w-40">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="24h">Last 24 hours</Select.Item>
            <Select.Item value="7d">Last 7 days</Select.Item>
            <Select.Item value="30d">Last 30 days</Select.Item>
          </Select.Content>
        </Select>
      </Container>

      {refusal && (
        <Container className="p-6">
          <Text className="text-ui-fg-subtle">{refusal}</Text>
        </Container>
      )}

      {health && (
        <>
          <Container className="grid grid-cols-2 gap-4 p-6 md:grid-cols-4">
            <Stat label="Codes requested" value={health.requested} />
            <Stat label="Delivered" value={health.sent} hint={`${health.sendFailed} failed to send`} />
            <Stat label="Verified" value={health.verified} hint={`${pct(health.verifyRate)} of delivered`} />
            <Stat label="Signed in" value={health.signedIn} hint={`${health.blockedSignIns} blocked accounts refused`} />
            <Stat label="Wrong or expired codes" value={health.failedCodes} />
            <Stat label="Refused by caps" value={health.rateLimited} />
            <Stat label="Failed the bot check" value={health.challengeFailed} />
            <Stat label="New-device alerts sent" value={health.newDeviceAlerts} />
          </Container>

          <Container className="p-0">
            <div className="px-6 py-4">
              <Heading level="h2">Delivery by channel</Heading>
            </div>
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
                {health.channels.length === 0 ? (
                  <Table.Row>
                    <Table.Cell>No sends in this window.</Table.Cell>
                    <Table.Cell />
                    <Table.Cell />
                    <Table.Cell />
                  </Table.Row>
                ) : (
                  health.channels.map((row) => (
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
        </>
      )}
    </div>
  );
};

export const config = defineRouteConfig({
  label: "Sign-in health",
  icon: ChartBar,
});

export default SignInHealthPage;
