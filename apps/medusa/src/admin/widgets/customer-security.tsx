import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { Badge, Button, Container, Heading, Input, Prompt, Table, Text, Textarea, toast } from "@medusajs/ui";
import { useCallback, useEffect, useState } from "react";

import { OpsError, opsFetch } from "../lib/ops";

/**
 * Siumora · Customer security (auth plan phase 3), on the customer page.
 *
 * Identity (phone masked — "Show number" reveals it, and that reveal is
 * audited), state (blocked, merged), signed-in devices, and the recent
 * sign-in log. Actions by role:
 *
 * - support: sign one device or every device out (the lost-phone call);
 * - ops lead / owner: block and unblock, force a fresh OTP, merge a
 *   duplicate account into another, see the whole number.
 *
 * Every action asks first and lands in the audit log with the operator's
 * identity.
 */

interface SecurityCard {
  customer: { id: string; name: string; maskedPhone: string | null; email: string | null };
  security: { blockedAt: string | null; blockedReason: string | null; blockedBy: string | null; mergedInto: string | null };
  sessions: Array<{ id: string; device: string | null; network: string | null; kind: string; createdAt: string; lastSeenAt: string }>;
  events: Array<{ id: string; type: string; channel: string | null; device: string | null; network: string | null; at: string }>;
  can: { revokeSessions: boolean; admin: boolean };
}

type Pending =
  | { kind: "revoke-all" }
  | { kind: "revoke-one"; sessionId: string }
  | { kind: "block" }
  | { kind: "unblock" }
  | { kind: "reverify" }
  | { kind: "merge" };

const EVENT_LABEL: Record<string, string> = {
  otp_requested: "Code requested",
  otp_sent: "Code sent",
  otp_send_failed: "Code not delivered",
  otp_rate_limited: "Refused by a cap",
  otp_verified: "Code verified",
  otp_failed: "Wrong or expired code",
  signin_completed: "Signed in",
  signin_blocked: "Sign-in refused (blocked)",
  signout: "Signed out",
  signout_everywhere: "Signed out everywhere",
  session_revoked: "Device signed out",
  step_up: "Confirmed with a fresh code",
  new_device_alert: "New-device alert sent",
  turnstile_failed: "Failed the bot check",
  google_linked: "Google account linked",
  email_verified: "Email verified",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const CustomerSecurityWidget = ({ data }: { data: { id: string } }) => {
  const [card, setCard] = useState<SecurityCard | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [mergeInto, setMergeInto] = useState("");
  const [phone, setPhone] = useState<string | null>(null);

  const base = `/admin/siumora/customers/${encodeURIComponent(data.id)}`;

  const load = useCallback(() => {
    opsFetch<SecurityCard>(`${base}/security`)
      .then(setCard)
      .catch((error) => {
        // Not an operator with customers:read, or two-step sign-in is
        // missing: the widget simply stays out of the way.
        if (error instanceof OpsError && (error.status === 403 || error.status === 401)) setHidden(true);
        else toast.error(error instanceof Error ? error.message : "Could not load security details.");
      });
  }, [base]);

  useEffect(load, [load]);

  const act = async (path: string, body: unknown, done: string) => {
    setBusy(true);
    try {
      await opsFetch(`${base}/${path}`, { method: "POST", body: JSON.stringify(body) });
      toast.success(done);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Refused.");
    } finally {
      setBusy(false);
      setPending(null);
      setReason("");
      setMergeInto("");
    }
  };

  const confirm = () => {
    if (!pending) return;
    switch (pending.kind) {
      case "revoke-all":
        return act("revoke-sessions", {}, "Every device signed out.");
      case "revoke-one":
        return act("revoke-sessions", { sessionId: pending.sessionId }, "Device signed out.");
      case "block":
        return act("block", { reason }, "Customer blocked.");
      case "unblock":
        return act("unblock", {}, "Customer unblocked.");
      case "reverify":
        return act("reverify", {}, "The customer must verify their phone again.");
      case "merge":
        return act("merge", { intoCustomerId: mergeInto.trim() }, "Merged.");
    }
  };

  if (hidden || !card) return null;
  const { security } = card;

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Sign-in and security</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {phone ?? card.customer.maskedPhone ?? "No phone"}
            {card.can.admin && !phone && card.customer.maskedPhone && (
              <>
                {" · "}
                <button
                  type="button"
                  className="text-ui-fg-interactive"
                  onClick={() =>
                    opsFetch<{ phone: string | null }>(`${base}/reveal`, { method: "POST" })
                      .then((payload) => setPhone(payload.phone))
                      .catch((error) => toast.error(error instanceof Error ? error.message : "Refused."))
                  }
                >
                  Show number (audited)
                </button>
              </>
            )}
          </Text>
        </div>
        {security.mergedInto ? (
          <Badge color="grey">Merged</Badge>
        ) : security.blockedAt ? (
          <Badge color="red">Blocked</Badge>
        ) : (
          <Badge color="green">Active</Badge>
        )}
      </div>

      {security.blockedAt && (
        <div className="px-6 py-3">
          <Text size="small">
            Blocked {when(security.blockedAt)} by {security.blockedBy ?? "an operator"}: {security.blockedReason ?? "no reason recorded"}
            {security.mergedInto && ` — merged into ${security.mergedInto}`}
          </Text>
        </div>
      )}

      <div className="flex flex-wrap gap-2 px-6 py-4">
        {card.can.revokeSessions && (
          <Button size="small" variant="secondary" disabled={busy || card.sessions.length === 0} onClick={() => setPending({ kind: "revoke-all" })}>
            Sign out every device
          </Button>
        )}
        {card.can.admin && !security.mergedInto && (
          <>
            <Button size="small" variant="secondary" disabled={busy} onClick={() => setPending({ kind: "reverify" })}>
              Force a fresh OTP
            </Button>
            {security.blockedAt ? (
              <Button size="small" variant="secondary" disabled={busy} onClick={() => setPending({ kind: "unblock" })}>
                Unblock
              </Button>
            ) : (
              <Button size="small" variant="danger" disabled={busy} onClick={() => setPending({ kind: "block" })}>
                Block
              </Button>
            )}
            <Button size="small" variant="secondary" disabled={busy} onClick={() => setPending({ kind: "merge" })}>
              Merge into…
            </Button>
          </>
        )}
      </div>

      <div className="px-6 py-4">
        <Text weight="plus">Signed-in devices</Text>
        {card.sessions.length === 0 ? (
          <Text size="small" className="mt-1 text-ui-fg-subtle">
            None.
          </Text>
        ) : (
          <Table className="mt-2">
            <Table.Body>
              {card.sessions.map((session) => (
                <Table.Row key={session.id}>
                  <Table.Cell>
                    {session.device ?? "Unknown"}
                    {session.kind === "operator" && <Badge size="2xsmall" className="ml-2">operator</Badge>}
                  </Table.Cell>
                  <Table.Cell className="text-ui-fg-subtle">{session.network ?? "—"}</Table.Cell>
                  <Table.Cell className="text-ui-fg-subtle">last {when(session.lastSeenAt)}</Table.Cell>
                  <Table.Cell className="text-right">
                    {card.can.revokeSessions && (
                      <Button size="small" variant="transparent" disabled={busy} onClick={() => setPending({ kind: "revoke-one", sessionId: session.id })}>
                        Sign out
                      </Button>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>

      <div className="px-6 py-4">
        <Text weight="plus">Recent sign-in activity</Text>
        {card.events.length === 0 ? (
          <Text size="small" className="mt-1 text-ui-fg-subtle">
            Nothing recorded yet.
          </Text>
        ) : (
          <ul className="mt-2 space-y-1">
            {card.events.slice(0, 20).map((event) => (
              <li key={event.id}>
                <Text size="small">
                  <span className="text-ui-fg-subtle">{when(event.at)}</span> · {EVENT_LABEL[event.type] ?? event.type}
                  {event.channel ? ` (${event.channel})` : ""}
                  {event.device ? ` · ${event.device}` : ""}
                  {event.network ? ` · ${event.network}` : ""}
                </Text>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Prompt open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>
              {pending?.kind === "block"
                ? "Block this customer?"
                : pending?.kind === "unblock"
                  ? "Unblock this customer?"
                  : pending?.kind === "reverify"
                    ? "Force a fresh OTP?"
                    : pending?.kind === "merge"
                      ? "Merge this account?"
                      : "Sign out?"}
            </Prompt.Title>
            <Prompt.Description>
              {pending?.kind === "block"
                ? "Every device is signed out now and sign-in is refused until unblocked. Say why — it is kept in the audit log."
                : pending?.kind === "merge"
                  ? "Orders, wishlist and sign-in numbers move to the other account; this one is signed out and marked merged. It cannot be undone here."
                  : pending?.kind === "reverify"
                    ? "Every device is signed out; the customer signs back in with a code on their phone."
                    : "This is recorded in the audit log with your name."}
            </Prompt.Description>
          </Prompt.Header>
          {pending?.kind === "block" && (
            <div className="px-6">
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason" />
            </div>
          )}
          {pending?.kind === "merge" && (
            <div className="px-6">
              <Input value={mergeInto} onChange={(event) => setMergeInto(event.target.value)} placeholder="cus_… (the account to keep)" />
            </div>
          )}
          <Prompt.Footer>
            <Prompt.Cancel>Cancel</Prompt.Cancel>
            <Prompt.Action
              disabled={
                busy ||
                (pending?.kind === "block" && reason.trim().length < 3) ||
                (pending?.kind === "merge" && !mergeInto.trim().startsWith("cus_"))
              }
              onClick={confirm}
            >
              Confirm
            </Prompt.Action>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "customer.details.after",
});

export default CustomerSecurityWidget;
