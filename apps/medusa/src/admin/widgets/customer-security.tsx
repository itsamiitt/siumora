import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { ArrowPath, Eye, SquareTwoStack, XCircle, CheckCircle, ArrowUturnLeft } from "@medusajs/icons";
import { Badge, Button, Container, Input, Prompt, StatusBadge, Table, Text, Textarea, toast } from "@medusajs/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { CardSkeleton, SectionHeader, when, type Action } from "../components/kit";
import { OpsError, opsFetch } from "../lib/ops";

/**
 * Siumora · Sign-in and security, on the customer page (auth plan phase 3;
 * made native in plan 16 Phase E).
 *
 * Identity (phone masked — "Show number" reveals it, and that reveal is
 * audited), state, signed-in devices and the recent sign-in log, with every
 * action in the header's "⋯" menu:
 *
 * - support: sign one device or every device out (the lost-phone call);
 * - ops lead / owner: force a fresh code, block and unblock, merge a
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

const PROMPT: Record<Pending["kind"], { title: string; description: string }> = {
  "revoke-all": { title: "Sign out every device?", description: "Every session ends now. Recorded in the audit log with your name." },
  "revoke-one": { title: "Sign out this device?", description: "Recorded in the audit log with your name." },
  block: {
    title: "Block this customer?",
    description: "Every device is signed out now and sign-in is refused until unblocked. Say why — it is kept in the audit log.",
  },
  unblock: { title: "Unblock this customer?", description: "They can sign in again. Recorded in the audit log." },
  reverify: {
    title: "Force a fresh code?",
    description: "Every device is signed out; the customer signs back in with a code on their phone.",
  },
  merge: {
    title: "Merge this account?",
    description:
      "Orders, wishlist and sign-in numbers move to the other account; this one is signed out and marked merged. It cannot be undone here.",
  },
};

const CustomerSecurityWidget = ({ data }: { data: { id: string } }) => {
  const client = useQueryClient();
  const base = `/admin/siumora/customers/${encodeURIComponent(data.id)}`;
  const key = ["siumora", "customer-security", data.id];
  const card = useQuery({
    queryKey: key,
    queryFn: () => opsFetch<SecurityCard>(`${base}/security`),
    retry: false,
  });
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [mergeInto, setMergeInto] = useState("");
  const [phone, setPhone] = useState<string | null>(null);

  if (card.isLoading) return <CardSkeleton rows={3} />;
  // Not an operator with customers:read, or two-step sign-in is missing:
  // the card simply stays out of the way.
  if (card.error instanceof OpsError && (card.error.status === 403 || card.error.status === 401)) return null;
  if (!card.data) return null;
  const c = card.data;
  const { security } = c;

  const act = async (path: string, body: unknown, done: string) => {
    setBusy(true);
    try {
      await opsFetch(`${base}/${path}`, { method: "POST", body: JSON.stringify(body) });
      toast.success(done);
      await client.invalidateQueries({ queryKey: key });
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

  const reveal = () =>
    opsFetch<{ phone: string | null }>(`${base}/reveal`, { method: "POST" })
      .then((payload) => setPhone(payload.phone))
      .catch((error) => toast.error(error instanceof Error ? error.message : "Refused."));

  const sessionsGroup: Action[] = c.can.revokeSessions
    ? [{ label: "Sign out every device", icon: <ArrowUturnLeft />, disabled: busy || c.sessions.length === 0, onClick: () => setPending({ kind: "revoke-all" }) }]
    : [];
  const adminGroup: Action[] =
    c.can.admin && !security.mergedInto
      ? [
          ...(c.customer.maskedPhone && !phone ? [{ label: "Show full number", icon: <Eye />, onClick: () => void reveal() }] : []),
          { label: "Force a fresh code", icon: <ArrowPath />, disabled: busy, onClick: () => setPending({ kind: "reverify" }) },
          { label: "Merge into another account", icon: <SquareTwoStack />, disabled: busy, onClick: () => setPending({ kind: "merge" }) },
        ]
      : [];
  const blockGroup: Action[] =
    c.can.admin && !security.mergedInto
      ? [
          security.blockedAt
            ? { label: "Unblock", icon: <CheckCircle />, disabled: busy, onClick: () => setPending({ kind: "unblock" }) }
            : { label: "Block", icon: <XCircle />, destructive: true, disabled: busy, onClick: () => setPending({ kind: "block" }) },
        ]
      : [];

  return (
    <Container className="divide-y p-0">
      <SectionHeader
        title="Sign-in and security"
        subtitle={
          <>
            {phone ?? c.customer.maskedPhone ?? "No phone"}
            {phone && " · revealed (audited)"}
          </>
        }
        badge={
          security.mergedInto ? (
            <StatusBadge color="grey">Merged</StatusBadge>
          ) : security.blockedAt ? (
            <StatusBadge color="red">Blocked</StatusBadge>
          ) : (
            <StatusBadge color="green">Active</StatusBadge>
          )
        }
        actions={[sessionsGroup, adminGroup, blockGroup]}
      />

      {security.blockedAt && (
        <div className="px-6 py-4">
          <Text size="small">
            Blocked {when(security.blockedAt)} by {security.blockedBy ?? "an operator"}: {security.blockedReason ?? "no reason recorded"}
            {security.mergedInto && ` — merged into ${security.mergedInto}`}
          </Text>
        </div>
      )}

      <div>
        <div className="px-6 py-4">
          <Text size="small" weight="plus">
            Signed-in devices
          </Text>
        </div>
        {c.sessions.length === 0 ? (
          <Text size="small" className="px-6 pb-4 text-ui-fg-subtle">
            None.
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Device</Table.HeaderCell>
                <Table.HeaderCell>Network</Table.HeaderCell>
                <Table.HeaderCell>Last seen</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {c.sessions.map((session) => (
                <Table.Row key={session.id}>
                  <Table.Cell>
                    {session.device ?? "Unknown"}
                    {session.kind === "operator" && (
                      <Badge size="2xsmall" className="ml-2">
                        operator
                      </Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-ui-fg-subtle">{session.network ?? "—"}</Table.Cell>
                  <Table.Cell className="text-ui-fg-subtle">{when(session.lastSeenAt)}</Table.Cell>
                  <Table.Cell className="text-right">
                    {c.can.revokeSessions && (
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

      <div>
        <div className="px-6 py-4">
          <Text size="small" weight="plus">
            Recent sign-in activity
          </Text>
        </div>
        {c.events.length === 0 ? (
          <Text size="small" className="px-6 pb-4 text-ui-fg-subtle">
            Nothing recorded yet.
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>When</Table.HeaderCell>
                <Table.HeaderCell>What</Table.HeaderCell>
                <Table.HeaderCell>Where</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {c.events.slice(0, 20).map((event) => (
                <Table.Row key={event.id}>
                  <Table.Cell className="text-ui-fg-subtle">{when(event.at)}</Table.Cell>
                  <Table.Cell>
                    {EVENT_LABEL[event.type] ?? event.type}
                    {event.channel ? ` (${event.channel})` : ""}
                  </Table.Cell>
                  <Table.Cell className="text-ui-fg-subtle">
                    {[event.device, event.network].filter(Boolean).join(" · ") || "—"}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>

      <Prompt open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>{pending ? PROMPT[pending.kind].title : ""}</Prompt.Title>
            <Prompt.Description>{pending ? PROMPT[pending.kind].description : ""}</Prompt.Description>
          </Prompt.Header>
          {pending?.kind === "block" && (
            <div className="px-6">
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why — at least a few words" />
            </div>
          )}
          {pending?.kind === "merge" && (
            <div className="flex flex-col gap-y-1 px-6">
              <Input value={mergeInto} onChange={(event) => setMergeInto(event.target.value)} placeholder="cus_…" />
              <Text size="xsmall" className="text-ui-fg-subtle">
                The ID of the account to keep — copy it from that customer&apos;s page.
              </Text>
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
