import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ChartBar } from "@medusajs/icons";
import { Badge, Container, Heading, Table, Text } from "@medusajs/ui";
import { useEffect, useState } from "react";

import { OpsError, inr, opsFetch } from "../../../lib/ops";

/**
 * Siumora · Overview — the ops dashboard (plan/07 "Ops dashboard" surface):
 * revenue, order-state counts, the NDR queue, invoice-series health and the
 * latest orders, all served by GET /admin/siumora/metrics (the same envelope
 * the SDK's getMetrics reads).
 */

interface Metrics {
  operator: string;
  role: string;
  permissions: string[];
  revenue: { booked: number; recognised: number; lost: number };
  ndrQueue: Array<{ number: string; attempts: number; pincode: string; reason?: string }>;
  statuses: Record<string, number>;
  invoiceSeries: { issued: number; gaps: number[]; healthy: boolean };
  recentOrders: Array<{
    number: string;
    status: string;
    total: number;
    pincode: string;
    placedAt: string;
    invoiceNumber: string | null;
  }>;
}

const OverviewPage = () => {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    opsFetch<Metrics>("/admin/siumora/metrics")
      .then(setMetrics)
      .catch((error) =>
        setRefusal(error instanceof OpsError ? error.message : "Could not load metrics."),
      );
  }, []);

  if (refusal) {
    return (
      <Container className="p-6">
        <Heading level="h1">Overview</Heading>
        <Text className="mt-2 text-ui-fg-subtle">{refusal}</Text>
      </Container>
    );
  }
  if (!metrics) return null;

  return (
    <div className="flex flex-col gap-4">
      <Container className="p-6">
        <div className="flex items-center justify-between">
          <Heading level="h1">Overview</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {metrics.operator} · {metrics.role}
          </Text>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4">
          <div>
            <Text size="small" className="text-ui-fg-subtle">Booked</Text>
            <Heading level="h2">{inr(metrics.revenue.booked)}</Heading>
          </div>
          <div>
            <Text size="small" className="text-ui-fg-subtle">Recognised (delivered)</Text>
            <Heading level="h2">{inr(metrics.revenue.recognised)}</Heading>
          </div>
          <div>
            <Text size="small" className="text-ui-fg-subtle">Lost (cancelled/RTO)</Text>
            <Heading level="h2">{inr(metrics.revenue.lost)}</Heading>
          </div>
        </div>
      </Container>

      <Container className="p-6">
        <Heading level="h2">Order states</Heading>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(metrics.statuses).map(([status, count]) => (
            <Badge key={status}>
              {status.replaceAll("_", " ")}: {count}
            </Badge>
          ))}
          {Object.keys(metrics.statuses).length === 0 && (
            <Text size="small" className="text-ui-fg-subtle">No orders yet.</Text>
          )}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Text size="small" weight="plus">Invoice series</Text>
          <Badge color={metrics.invoiceSeries.healthy ? "green" : "red"}>
            {metrics.invoiceSeries.issued} issued
            {metrics.invoiceSeries.healthy
              ? ", consecutive"
              : `, GAPS: ${metrics.invoiceSeries.gaps.join(", ")}`}
          </Badge>
        </div>
      </Container>

      {metrics.ndrQueue.length > 0 && (
        <Container className="p-6">
          <Heading level="h2">NDR queue</Heading>
          <Table className="mt-3">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Order</Table.HeaderCell>
                <Table.HeaderCell>Attempts</Table.HeaderCell>
                <Table.HeaderCell>Pincode</Table.HeaderCell>
                <Table.HeaderCell>Reason</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {metrics.ndrQueue.map((row) => (
                <Table.Row key={row.number}>
                  <Table.Cell>{row.number}</Table.Cell>
                  <Table.Cell>{row.attempts}</Table.Cell>
                  <Table.Cell>{row.pincode}</Table.Cell>
                  <Table.Cell>{row.reason?.replaceAll("_", " ") ?? "—"}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Container>
      )}

      <Container className="p-6">
        <Heading level="h2">Latest orders</Heading>
        <Table className="mt-3">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Order</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Total</Table.HeaderCell>
              <Table.HeaderCell>Pincode</Table.HeaderCell>
              <Table.HeaderCell>Invoice</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {metrics.recentOrders.map((row) => (
              <Table.Row key={row.number}>
                <Table.Cell>{row.number}</Table.Cell>
                <Table.Cell>{row.status.replaceAll("_", " ")}</Table.Cell>
                <Table.Cell>{inr(row.total)}</Table.Cell>
                <Table.Cell>{row.pincode}</Table.Cell>
                <Table.Cell>{row.invoiceNumber ?? "—"}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </Container>
    </div>
  );
};

export const config = defineRouteConfig({
  label: "Siumora",
  icon: ChartBar,
});

export default OverviewPage;
