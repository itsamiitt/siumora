import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { Badge, Button, Container, Heading, Prompt, Text, toast } from "@medusajs/ui";
import { useCallback, useEffect, useState } from "react";

import { OpsError, opsFetch } from "../lib/ops";

/**
 * Siumora order ops (M2 wave B): the SIU number, the status-machine truth,
 * and the operator levers — legal transitions as buttons (the lookup route
 * serves only what core's canTransition allows, so no button 409s), NDR
 * answers, and the open return — on the Admin order-detail page.
 *
 * "delivered" opens the returns window and recognises revenue, so that one
 * transition asks for confirmation before it fires.
 */

interface OpsCard {
  number: string;
  status: string;
  ndrReason: string | null;
  deliveryAttempts: number;
  nextStatuses: string[];
  permissions: string[];
  return: { id: string; status: string; reason: string; resolution: string } | null;
}

const NDR_ACTIONS = ["reattempt", "update_address", "cancel"] as const;

const STATUS_COLOR: Record<string, "green" | "orange" | "red" | "blue" | "grey"> = {
  delivered: "green",
  ndr: "orange",
  rto: "red",
  cancelled: "red",
  returned: "red",
  shipped: "blue",
  out_for_delivery: "blue",
};

const OrderOpsWidget = ({ data }: { data: { id: string } }) => {
  const [card, setCard] = useState<OpsCard | null>(null);
  const [notOps, setNotOps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(() => {
    opsFetch<OpsCard>(`/admin/siumora/orders/lookup?order_id=${encodeURIComponent(data.id)}`)
      .then(setCard)
      .catch((error) => {
        // 404 = a draft order with no SIU identity; anything else the page
        // reports once, quietly.
        if (error instanceof OpsError && error.status === 404) setNotOps(true);
      });
  }, [data.id]);

  useEffect(load, [load]);

  if (notOps) {
    return (
      <Container className="p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Siumora ops</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Not a storefront order — no SIU identity, no status machine.
          </Text>
        </div>
      </Container>
    );
  }
  if (!card) return null;

  const mayWrite = card.permissions.includes("orders:write");

  const walk = async (to: string) => {
    setBusy(true);
    try {
      await opsFetch(`/admin/siumora/orders/${encodeURIComponent(card.number)}/status`, {
        method: "POST",
        body: JSON.stringify({ status: to }),
      });
      toast.success(`Order moved to ${to}.`);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Transition refused.");
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  const answerNdr = async (action: (typeof NDR_ACTIONS)[number]) => {
    setBusy(true);
    try {
      await opsFetch(`/admin/siumora/orders/${encodeURIComponent(card.number)}/ndr`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      toast.success(`NDR answer recorded: ${action}.`);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "NDR answer refused.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <Heading level="h2">Siumora ops</Heading>
          <Text size="small" weight="plus">{card.number}</Text>
        </div>
        <Badge color={STATUS_COLOR[card.status] ?? "grey"}>{card.status}</Badge>
      </div>

      {card.status === "ndr" && (
        <div className="px-6 py-4">
          <Text size="small" weight="plus">
            NDR — attempt {card.deliveryAttempts}
            {card.ndrReason ? ` (${card.ndrReason.replaceAll("_", " ")})` : ""}
          </Text>
          {mayWrite && (
            <div className="mt-2 flex gap-2">
              {NDR_ACTIONS.map((action) => (
                <Button
                  key={action}
                  size="small"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => answerNdr(action)}
                >
                  {action.replaceAll("_", " ")}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {card.return && (
        <div className="px-6 py-4">
          <Text size="small" weight="plus">
            Open return — {card.return.status} ({card.return.reason.replaceAll("_", " ")},{" "}
            {card.return.resolution})
          </Text>
        </div>
      )}

      {mayWrite && card.nextStatuses.length > 0 && (
        <div className="px-6 py-4">
          <Text size="small" weight="plus" className="mb-2">Move to</Text>
          <div className="flex flex-wrap gap-2">
            {card.nextStatuses.map((to) => (
              <Button
                key={to}
                size="small"
                variant={to === "cancelled" ? "danger" : "secondary"}
                disabled={busy}
                onClick={() =>
                  to === "delivered" || to === "cancelled" ? setConfirming(to) : walk(to)
                }
              >
                {to.replaceAll("_", " ")}
              </Button>
            ))}
          </div>
        </div>
      )}

      <Prompt open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>Move to {confirming?.replaceAll("_", " ")}?</Prompt.Title>
            <Prompt.Description>
              {confirming === "delivered"
                ? "Delivered opens the returns window and recognises the revenue."
                : "Cancelling ends this order's journey."}
            </Prompt.Description>
          </Prompt.Header>
          <Prompt.Footer>
            <Prompt.Cancel>Keep as is</Prompt.Cancel>
            <Prompt.Action onClick={() => confirming && walk(confirming)}>
              Confirm
            </Prompt.Action>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "order.details.after",
});

export default OrderOpsWidget;
