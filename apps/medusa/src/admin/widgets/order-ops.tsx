import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { ArrowPath, ArrowUturnLeft, ArchiveBox, CheckCircle, CurrencyDollar, PencilSquare, TruckFast, XCircle } from "@medusajs/icons";
import { Container, Input, Prompt, toast } from "@medusajs/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  CardSkeleton,
  EditDrawer,
  FormField,
  KeyValueRow,
  OrderStatusBadge,
  SectionHeader,
  humanize,
  inr,
  orderStatusLabel,
  type Action,
} from "../components/kit";
import { OpsError, opsFetch } from "../lib/ops";
import { keys } from "../lib/queries";

/**
 * Siumora · Order, in the order page's side column (plan 16 Phase E): the
 * SIU number, the status-machine truth, how it was paid and where the
 * parcel is — and every operator lever in the header's "⋯" menu instead of
 * rows of buttons. Only the transitions core's machine allows are offered
 * (the lookup serves them), so no item 409s.
 *
 * Booking the courier is the page's own "Create fulfillment" (Shiprocket,
 * plan 16 Phase F); this card then shows the AWB and the tracking link.
 * "Delivered" and "Cancelled" ask first: one recognises revenue and opens
 * the returns window, the other ends the order.
 *
 * Plan 16 Phase H adds the two once-only levers: "Record COD payout" on a
 * COD order's open return (the UPI/UTR reference, in a drawer), and "Put
 * back in stock" on an rto/returned order whose goods are back in hand.
 */

interface OpsCard {
  number: string;
  status: string;
  ndrReason: string | null;
  deliveryAttempts: number;
  nextStatuses: string[];
  permissions: string[];
  return: { id: string; status: string; reason: string; resolution: string; payoutReference: string | null } | null;
  awaitsRestock: boolean;
  giftMessage: string | null;
  payment: { method: string; codFee: number; reference: string | null };
  shipment: { awb: string; courier: string | null; trackingUrl: string; pickupScheduled: boolean } | null;
}

const METHOD_LABEL: Record<string, string> = {
  cod: "Cash on delivery",
  upi: "UPI",
  card: "Card",
  netbanking: "Netbanking",
};

const NDR_ACTIONS = [
  { action: "reattempt", label: "Deliver again" },
  { action: "update_address", label: "Customer updated the address" },
  { action: "cancel", label: "Customer cancelled" },
] as const;

const OrderOpsWidget = ({ data }: { data: { id: string } }) => {
  const client = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payingOut, setPayingOut] = useState(false);
  const [reference, setReference] = useState("");
  const card = useQuery({
    queryKey: keys.orderCard(data.id),
    queryFn: () => opsFetch<OpsCard>(`/admin/siumora/orders/lookup?order_id=${encodeURIComponent(data.id)}`),
    retry: false,
  });

  if (card.isLoading) return <CardSkeleton rows={3} />;
  // A draft order (no SIU number) or an operator without access: the card
  // simply is not there, rather than a box saying so.
  if (card.error instanceof OpsError && (card.error.status === 404 || card.error.status === 403)) return null;
  if (!card.data) return null;
  const c = card.data;
  const mayWrite = c.permissions.includes("orders:write");

  const refresh = () => client.invalidateQueries({ queryKey: keys.orderCard(data.id) });

  const post = async (path: string, body: unknown, done: string | ((result: Record<string, unknown>) => string)) => {
    setBusy(true);
    try {
      const result = await opsFetch<Record<string, unknown>>(`/admin/siumora/orders/${encodeURIComponent(c.number)}/${path}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      toast.success(typeof done === "string" ? done : done(result));
      await refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Refused.");
      return false;
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  const walk = (to: string) => post("status", { status: to }, `Moved to ${orderStatusLabel(to).toLowerCase()}.`);

  const moves: Action[] = mayWrite
    ? c.nextStatuses
        .filter((to) => to !== "cancelled")
        .map((to) => ({
          label: `Mark ${orderStatusLabel(to).toLowerCase()}`,
          icon: to === "delivered" ? <CheckCircle /> : <TruckFast />,
          disabled: busy,
          onClick: () => (to === "delivered" ? setConfirming(to) : void walk(to)),
        }))
    : [];
  const ndr: Action[] =
    mayWrite && c.status === "ndr"
      ? NDR_ACTIONS.map(({ action, label }) => ({
          label,
          icon: action === "reattempt" ? <ArrowPath /> : action === "update_address" ? <PencilSquare /> : <ArrowUturnLeft />,
          disabled: busy,
          onClick: () => void post("ndr", { action }, `Recorded: ${label.toLowerCase()}.`),
        }))
      : [];
  const cancel: Action[] =
    mayWrite && c.nextStatuses.includes("cancelled")
      ? [{ label: "Cancel order", icon: <XCircle />, destructive: true, disabled: busy, onClick: () => setConfirming("cancelled") }]
      : [];
  const afterwards: Action[] = [
    ...(c.permissions.includes("remittance:write") && c.payment.method === "cod" && c.return && !c.return.payoutReference
      ? [{ label: "Record COD payout", icon: <CurrencyDollar />, disabled: busy, onClick: () => setPayingOut(true) }]
      : []),
    ...(mayWrite && c.awaitsRestock
      ? [{ label: "Put back in stock", icon: <ArchiveBox />, disabled: busy, onClick: () => setConfirming("restock") }]
      : []),
  ];

  const restock = () =>
    post("restock", {}, (result) =>
      result.ok === false
        ? String(result.message ?? "Already back in stock.")
        : `${String(result.units ?? 0)} pieces back in stock.`,
    );

  const PROMPTS: Record<string, { title: string; description: string }> = {
    delivered: {
      title: "Mark as delivered?",
      description: "Delivered opens the 7-day returns window and counts the revenue.",
    },
    cancelled: {
      title: "Cancel this order?",
      description: "Cancelling ends this order. A prepaid payment is refunded from the native Payments section.",
    },
    restock: {
      title: "Put these goods back in stock?",
      description: "Only once the parcel is in your hands and checked. Every piece on this order is added back to inventory, once.",
    },
  };
  const prompt = confirming ? PROMPTS[confirming] : undefined;

  return (
    <Container className="divide-y p-0">
      <SectionHeader title={c.number} subtitle="Siumora order" badge={<OrderStatusBadge status={c.status} />} actions={[ndr, moves, afterwards, cancel]} />

      <KeyValueRow label="Payment">
        {METHOD_LABEL[c.payment.method] ?? humanize(c.payment.method)}
        {c.payment.codFee > 0 ? ` · ${inr(c.payment.codFee)} COD fee` : ""}
      </KeyValueRow>
      {c.payment.reference && <KeyValueRow label="Razorpay payment">{c.payment.reference}</KeyValueRow>}
      {c.giftMessage && (
        <KeyValueRow label="Gift message">
          <span className="italic">“{c.giftMessage}”</span> — write it on the card in the parcel
        </KeyValueRow>
      )}

      <KeyValueRow label="Courier">
        {c.shipment ? (
          <>
            {c.shipment.courier ?? "Courier"} ·{" "}
            <a href={c.shipment.trackingUrl} target="_blank" rel="noreferrer" className="text-ui-fg-interactive hover:underline">
              {c.shipment.awb}
            </a>
            {!c.shipment.pickupScheduled && " · pickup not scheduled"}
          </>
        ) : (
          "Not booked — use Create fulfillment"
        )}
      </KeyValueRow>

      {c.status === "ndr" && (
        <KeyValueRow label="Failed delivery">
          Attempt {c.deliveryAttempts}
          {c.ndrReason ? ` · ${humanize(c.ndrReason)}` : ""}
        </KeyValueRow>
      )}
      {c.return && (
        <KeyValueRow label="Open return">
          {humanize(c.return.status)} · {humanize(c.return.reason)} · {humanize(c.return.resolution)}
        </KeyValueRow>
      )}
      {c.return?.payoutReference && <KeyValueRow label="COD payout">Paid · {c.return.payoutReference}</KeyValueRow>}
      {c.awaitsRestock && <KeyValueRow label="Stock">Not back on the shelf yet</KeyValueRow>}

      <Prompt open={prompt !== undefined} onOpenChange={(open) => !open && setConfirming(null)}>
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>{prompt?.title}</Prompt.Title>
            <Prompt.Description>{prompt?.description}</Prompt.Description>
          </Prompt.Header>
          <Prompt.Footer>
            <Prompt.Cancel>Keep as is</Prompt.Cancel>
            <Prompt.Action
              onClick={() => {
                if (confirming === "restock") void restock();
                else if (confirming) void walk(confirming);
              }}
            >
              Confirm
            </Prompt.Action>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>

      <EditDrawer
        open={payingOut}
        onOpenChange={(open) => {
          setPayingOut(open);
          if (!open) setReference("");
        }}
        title="Record COD payout"
        description="A COD return has no payment to reverse: pay the customer's UPI by hand, then record the reference here. It can be recorded once."
        saving={busy}
        saveLabel="Record payout"
        onSave={async () => {
          const ok = await post("returns/payout", { reference: reference.trim() }, "Payout recorded.");
          if (ok) {
            setPayingOut(false);
            setReference("");
          }
        }}
      >
        <FormField label="UPI / UTR reference" hint="From your bank or UPI app's payment receipt.">
          <Input size="small" value={reference} onChange={(event) => setReference(event.target.value)} />
        </FormField>
      </EditDrawer>
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
});

export default OrderOpsWidget;
