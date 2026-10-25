import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ArrowDownTray, BuildingStorefront, ChartBar, CurrencyDollar, Trash, XCircle } from "@medusajs/icons";
import { Container, Heading, Prompt, StatusBadge, Table, Text, Textarea, toast } from "@medusajs/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  ActionMenu,
  CardError,
  CardSkeleton,
  EditDrawer,
  FormField,
  OrderStatusBadge,
  SectionHeader,
  humanize,
  inr,
  when,
} from "../../components/kit";
import { opsFetch } from "../../lib/ops";

/**
 * Siumora — the one custom sidebar entry (plan 16 Phase E). The ops home:
 * money (booked, recognised, lost, and where the cash is), order states,
 * the NDR and restock queues, and the latest orders. The desks that used to
 * be separate sidebar items open from the header's "⋯" menu — GST returns,
 * sign-in health and COD remittances — and settings live on the native
 * Store page and under Settings.
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

interface Cash {
  prepaidSettled: number;
  codInTransit: number;
  codAwaitingRemittance: number;
  codRemitted: number;
}

interface Outbox {
  messages: Record<string, number>;
  conversions: Record<string, number>;
  failures: Array<{ templateKey: string; error: string | null; at: string }>;
}

const TEMPLATE_LABEL: Record<string, string> = {
  order_confirmed: "Order confirmed",
  cod_confirm: "Confirm COD order",
  order_shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivery_failed: "Delivery failed",
  order_delivered: "Delivered",
  refund_processed: "Refund processed",
};

interface PrivacyRequest {
  id: string;
  customerId: string;
  kind: string;
  status: string;
  note: string | null;
  resolveBy: string;
  overdue: boolean;
}

/**
 * Open data-principal requests (plan 16 B27) — mostly erasures the customer
 * could not finish because a parcel was still moving. "Erase now" re-runs
 * the same check; "Refuse" needs the reason the person will be given.
 */
function PrivacyCard({ requests }: { requests: PrivacyRequest[] }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [erasing, setErasing] = useState<PrivacyRequest | null>(null);
  const [refusing, setRefusing] = useState<PrivacyRequest | null>(null);
  const [note, setNote] = useState("");

  const answer = async (request: PrivacyRequest, body: unknown, done: string) => {
    setBusy(true);
    try {
      await opsFetch(`/admin/siumora/privacy-requests/${encodeURIComponent(request.id)}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      toast.success(done);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Refused.");
      return false;
    } finally {
      setBusy(false);
      // A blocked erasure stays open with its new reason — refresh either way.
      await client.invalidateQueries({ queryKey: ["siumora", "privacy-requests"] });
    }
  };

  return (
    <Container className="divide-y p-0">
      <SectionHeader
        title="Privacy requests"
        subtitle="Due within 30 days of the request (DPDP Act)."
        badge={
          requests.some((request) => request.overdue) ? (
            <StatusBadge color="red">Overdue</StatusBadge>
          ) : (
            <StatusBadge color="orange">{requests.length} open</StatusBadge>
          )
        }
      />
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Request</Table.HeaderCell>
            <Table.HeaderCell>Why it is open</Table.HeaderCell>
            <Table.HeaderCell>Due</Table.HeaderCell>
            <Table.HeaderCell />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {requests.map((request) => (
            <Table.Row key={request.id}>
              <Table.Cell>{humanize(request.kind)}</Table.Cell>
              <Table.Cell className="text-ui-fg-subtle">{request.note ?? "Waiting for an operator"}</Table.Cell>
              <Table.Cell>
                <span className={request.overdue ? "text-ui-fg-error" : undefined}>{when(request.resolveBy)}</span>
              </Table.Cell>
              <Table.Cell className="text-right">
                <ActionMenu
                  groups={[
                    request.kind === "erasure"
                      ? [{ label: "Erase now", icon: <Trash />, disabled: busy, onClick: () => setErasing(request) }]
                      : [],
                    [{ label: "Refuse", icon: <XCircle />, destructive: true, disabled: busy, onClick: () => setRefusing(request) }],
                  ]}
                />
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>

      <Prompt open={erasing !== null} onOpenChange={(open) => !open && setErasing(null)}>
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>Erase this account?</Prompt.Title>
            <Prompt.Description>
              Name, phone, addresses and sign-in go for good; orders are kept with the personal details redacted (GST
              records). If a parcel is still moving, nothing changes and the request stays open.
            </Prompt.Description>
          </Prompt.Header>
          <Prompt.Footer>
            <Prompt.Cancel>Keep as is</Prompt.Cancel>
            <Prompt.Action
              onClick={() => {
                const request = erasing;
                setErasing(null);
                if (request) void answer(request, { action: "complete" }, "Account erased.");
              }}
            >
              Erase
            </Prompt.Action>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>

      <EditDrawer
        open={refusing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRefusing(null);
            setNote("");
          }
        }}
        title="Refuse this request"
        description="The person is told why, so write it for them."
        saving={busy}
        saveLabel="Refuse request"
        onSave={async () => {
          if (!refusing) return;
          const ok = await answer(refusing, { action: "refuse", note: note.trim() }, "Request refused.");
          if (ok) {
            setRefusing(null);
            setNote("");
          }
        }}
      >
        <FormField label="Reason">
          <Textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} />
        </FormField>
      </EditDrawer>
    </Container>
  );
}

/** Messages and conversions: are they going out? (plan 16 Phase G) */
function OutboxCard({ health }: { health: Outbox }) {
  const line = (counts: Record<string, number>) =>
    `${counts.sent ?? 0} sent · ${(counts.pending ?? 0) + (counts.sending ?? 0)} waiting · ${counts.failed ?? 0} failed · ${counts.skipped ?? 0} not configured`;
  const stuck = (health.messages.pending ?? 0) + (health.conversions.pending ?? 0) > 50;
  return (
    <Container className="divide-y p-0">
      <SectionHeader
        title="Messages and conversions"
        subtitle="Sent by the worker from the outbox."
        badge={
          (health.messages.failed ?? 0) > 0 || stuck ? (
            <StatusBadge color="orange">{stuck ? "Backlog — is the worker running?" : "Some failed"}</StatusBadge>
          ) : (
            <StatusBadge color="green">Flowing</StatusBadge>
          )
        }
      />
      <div className="grid grid-cols-1 divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
        <Stat label="Customer messages" value={String(health.messages.sent ?? 0)} hint={line(health.messages)} />
        <Stat label="Ad conversions" value={String(health.conversions.sent ?? 0)} hint={line(health.conversions)} />
      </div>
      {health.failures.length > 0 && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Message</Table.HeaderCell>
              <Table.HeaderCell>Why it failed</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {health.failures.map((failure, index) => (
              <Table.Row key={`${failure.at}-${index}`}>
                <Table.Cell>{TEMPLATE_LABEL[failure.templateKey] ?? humanize(failure.templateKey)}</Table.Cell>
                <Table.Cell className="text-ui-fg-subtle">{failure.error ?? "—"}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </Container>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
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

const SiumoraHome = () => {
  const navigate = useNavigate();
  const metrics = useQuery({
    queryKey: ["siumora", "metrics"],
    queryFn: () => opsFetch<Metrics>("/admin/siumora/metrics"),
  });
  const cash = useQuery({
    queryKey: ["siumora", "cash-position"],
    queryFn: () => opsFetch<Cash>("/admin/siumora/cash-position"),
  });
  const restock = useQuery({
    queryKey: ["siumora", "restock-queue"],
    queryFn: () =>
      opsFetch<{ orders: Array<{ number: string; status: string; placedAt: string; total: number }> }>(
        "/admin/siumora/restock-queue",
      ).then((payload) => payload.orders),
    retry: false,
  });

  const outbox = useQuery({
    queryKey: ["siumora", "outbox"],
    queryFn: () => opsFetch<Outbox>("/admin/siumora/outbox"),
    retry: false,
  });
  const grants = metrics.data?.permissions ?? [];
  const privacy = useQuery({
    queryKey: ["siumora", "privacy-requests"],
    queryFn: () =>
      opsFetch<{ requests: PrivacyRequest[] }>("/admin/siumora/privacy-requests").then((payload) => payload.requests),
    enabled: grants.includes("privacy:write"),
    retry: false,
  });

  if (metrics.isLoading) {
    return (
      <div className="flex flex-col gap-y-3">
        <CardSkeleton rows={2} />
        <CardSkeleton rows={4} />
      </div>
    );
  }
  if (!metrics.data) {
    return <CardError title="Siumora" message={metrics.error?.message ?? "Could not load the overview."} />;
  }
  const m = metrics.data;
  const may = (permission: string) => m.permissions.includes(permission);

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <SectionHeader
          level="h1"
          title="Siumora"
          subtitle={`${m.operator} · ${humanize(m.role)}`}
          actions={[
            [
              ...(may("settings:write")
                ? [{ label: "GST returns", icon: <ArrowDownTray />, onClick: () => navigate("/siumora/gst") }]
                : []),
              { label: "COD remittances", icon: <CurrencyDollar />, onClick: () => navigate("/siumora/remittances") },
              { label: "Sign-in health", icon: <ChartBar />, onClick: () => navigate("/siumora/sign-in") },
            ],
            [{ label: "Checkout & storefront settings", icon: <BuildingStorefront />, onClick: () => navigate("/settings/store") }],
          ]}
        />
        <div className="grid grid-cols-1 divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
          <Stat label="Booked" value={inr(m.revenue.booked)} />
          <Stat label="Recognised" value={inr(m.revenue.recognised)} hint="Delivered" />
          <Stat label="Lost" value={inr(m.revenue.lost)} hint="Cancelled or returned to us" />
        </div>
        {cash.data && (
          <div className="grid grid-cols-2 divide-x md:grid-cols-4">
            <Stat label="Prepaid settled" value={inr(cash.data.prepaidSettled)} />
            <Stat label="COD in transit" value={inr(cash.data.codInTransit)} />
            <Stat label="COD with the courier" value={inr(cash.data.codAwaitingRemittance)} hint="Delivered, not yet remitted" />
            <Stat label="COD remitted" value={inr(cash.data.codRemitted)} />
          </div>
        )}
      </Container>

      <Container className="divide-y p-0">
        <SectionHeader
          title="Orders by state"
          badge={
            <StatusBadge color={m.invoiceSeries.healthy ? "green" : "red"}>
              {m.invoiceSeries.issued} invoices
              {m.invoiceSeries.healthy ? ", none missing" : ` — gaps at ${m.invoiceSeries.gaps.join(", ")}`}
            </StatusBadge>
          }
        />
        <div className="flex flex-wrap gap-2 px-6 py-4">
          {Object.keys(m.statuses).length === 0 ? (
            <Text size="small" className="text-ui-fg-subtle">
              No orders yet.
            </Text>
          ) : (
            Object.entries(m.statuses).map(([status, count]) => (
              <div key={status} className="flex items-center gap-x-1.5">
                <OrderStatusBadge status={status} />
                <Text size="small" weight="plus">
                  {count}
                </Text>
              </div>
            ))
          )}
        </div>
      </Container>

      {m.ndrQueue.length > 0 && (
        <Container className="divide-y p-0">
          <SectionHeader title="Failed deliveries" subtitle="Answer each from the order's page before the courier returns it." />
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Order</Table.HeaderCell>
                <Table.HeaderCell>Attempts</Table.HeaderCell>
                <Table.HeaderCell>Pincode</Table.HeaderCell>
                <Table.HeaderCell>Reason</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {m.ndrQueue.map((row) => (
                <Table.Row key={row.number}>
                  <Table.Cell>{row.number}</Table.Cell>
                  <Table.Cell>{row.attempts}</Table.Cell>
                  <Table.Cell>{row.pincode}</Table.Cell>
                  <Table.Cell>{row.reason ? humanize(row.reason) : "—"}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Container>
      )}

      {restock.data && restock.data.length > 0 && (
        <Container className="divide-y p-0">
          <SectionHeader title="Back to stock" subtitle="Returned or returning parcels — once checked, open the order and use “Put back in stock”." />
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Order</Table.HeaderCell>
                <Table.HeaderCell>State</Table.HeaderCell>
                <Table.HeaderCell>Value</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {restock.data.map((row) => (
                <Table.Row key={row.number}>
                  <Table.Cell>{row.number}</Table.Cell>
                  <Table.Cell>
                    <OrderStatusBadge status={row.status} />
                  </Table.Cell>
                  <Table.Cell>{inr(row.total)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Container>
      )}

      {privacy.data && privacy.data.length > 0 && <PrivacyCard requests={privacy.data} />}

      {outbox.data && <OutboxCard health={outbox.data} />}

      <Container className="divide-y p-0">
        <SectionHeader title="Latest orders" subtitle="Open one from Orders to book its courier or answer a failed delivery." />
        {m.recentOrders.length === 0 ? (
          <Text size="small" className="px-6 py-4 text-ui-fg-subtle">
            Nothing yet.
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Order</Table.HeaderCell>
                <Table.HeaderCell>State</Table.HeaderCell>
                <Table.HeaderCell>Total</Table.HeaderCell>
                <Table.HeaderCell>Pincode</Table.HeaderCell>
                <Table.HeaderCell>Invoice</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {m.recentOrders.map((row) => (
                <Table.Row key={row.number}>
                  <Table.Cell>{row.number}</Table.Cell>
                  <Table.Cell>
                    <OrderStatusBadge status={row.status} />
                  </Table.Cell>
                  <Table.Cell>{inr(row.total)}</Table.Cell>
                  <Table.Cell>{row.pincode}</Table.Cell>
                  <Table.Cell>{row.invoiceNumber ?? "—"}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>
    </div>
  );
};

export const config = defineRouteConfig({
  label: "Siumora",
  icon: ChartBar,
});

export default SiumoraHome;
