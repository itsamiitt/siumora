import assert from "node:assert/strict";
import { test } from "node:test";

import { drainConversions } from "./drain.ts";
import { medusaStore, type PgClient } from "./medusa-store.ts";
import { drainNotifications, type MessageTransport } from "./messages.ts";
import type { Transport } from "./transport.ts";

// The Medusa outbox store against a scripted pg client: the statements it
// runs, the parameters it binds, and a whole drain pass end to end. The SQL
// semantics themselves (SKIP LOCKED, backoff) mirror the Fastify repositories
// and are exercised against Postgres by the live worker suite.

function scripted(answers: Array<{ match: RegExp; rows: unknown[] }>) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const client: PgClient = {
    async query(text, values = []) {
      calls.push({ text, values });
      const answer = answers.find((candidate) => candidate.match.test(text));
      return { rows: answer?.rows ?? [] };
    },
  };
  return { client, calls };
}

const NOW = new Date("2026-10-25T10:00:00.000Z");

test("a conversion pass claims from siumora_tracking_events, posts, and records the send", async () => {
  const { client, calls } = scripted([
    {
      match: /UPDATE siumora_tracking_events t\s+SET status = 'sending'/,
      rows: [{ id: "sitev_1", destination: "ga4", attempts: 0, payload: { client_id: "1.2" } }],
    },
  ]);
  const posted: string[] = [];
  const transport: Transport = {
    async send(destination) {
      posted.push(destination);
      return { kind: "sent" };
    },
  };
  const report = await drainConversions(medusaStore(client), transport, { now: NOW });
  assert.deepEqual(report, { claimed: 1, sent: 1, retrying: 0, failed: 0, reclaimed: 0 });
  assert.deepEqual(posted, ["ga4"]);
  const claim = calls.find((call) => /FOR UPDATE SKIP LOCKED/.test(call.text))!;
  assert.deepEqual(claim.values, [NOW, 50]);
  assert.ok(calls.some((call) => /SET status = 'sent'/.test(call.text) && call.values[0] === "sitev_1"));
});

test("a refused post backs off with the error recorded; a permanent one is marked so", async () => {
  const { client, calls } = scripted([
    {
      match: /UPDATE siumora_tracking_events t\s+SET status = 'sending'/,
      rows: [
        { id: "sitev_1", destination: "meta", attempts: 0, payload: {} },
        { id: "sitev_2", destination: "meta", attempts: 0, payload: {} },
      ],
    },
  ]);
  let call = 0;
  const transport: Transport = {
    async send() {
      call += 1;
      return call === 1 ? { kind: "retry", error: "429" } : { kind: "permanent", error: "bad token" };
    },
  };
  const report = await drainConversions(medusaStore(client), transport, { now: NOW });
  assert.equal(report.retrying, 1);
  assert.equal(report.failed, 1);
  const fails = calls.filter((entry) => /SET attempts = attempts \+ 1/.test(entry.text));
  assert.deepEqual(fails.map((entry) => [entry.values[0], entry.values[1], entry.values[3]]), [
    ["sitev_1", false, "429"],
    ["sitev_2", true, "bad token"],
  ]);
});

test("a message pass renders the stored variables and sends on the first configured channel", async () => {
  const { client, calls } = scripted([
    {
      match: /UPDATE siumora_notifications t\s+SET status = 'sending'/,
      rows: [
        {
          id: "sintf_1",
          templateKey: "order_confirmed",
          recipient: "9876543210",
          variables: { name: "Asha", orderNumber: "SIU-00042", total: "INR 3,980.00" },
          attempts: 0,
        },
      ],
    },
  ]);
  const sent: Array<{ channel: string; body: string }> = [];
  const transport: MessageTransport = {
    channels: ["whatsapp"],
    async send(channel, _recipient, body) {
      sent.push({ channel, body });
      return { kind: "sent", providerMessageId: "wamid.1" };
    },
  } as MessageTransport;
  const report = await drainNotifications(medusaStore(client), transport, { now: NOW });
  assert.equal(report.sent, 1);
  assert.equal(sent[0]!.channel, "whatsapp");
  assert.match(sent[0]!.body, /SIU-00042/);
  const marked = calls.find((entry) => /SET status = 'sent', channel = \$2/.test(entry.text))!;
  assert.deepEqual(marked.values.slice(0, 3), ["sintf_1", "whatsapp", "wamid.1"]);
});

test("with no channel configured, a message is skipped with the reason, not retried", async () => {
  const { client, calls } = scripted([
    {
      match: /UPDATE siumora_notifications t\s+SET status = 'sending'/,
      rows: [
        {
          id: "sintf_1",
          templateKey: "order_delivered",
          recipient: "9876543210",
          variables: { name: "Asha", orderNumber: "SIU-00042" },
          attempts: 0,
        },
      ],
    },
  ]);
  const transport = { channels: [], async send() { throw new Error("unreachable"); } } as unknown as MessageTransport;
  const report = await drainNotifications(medusaStore(client), transport, { now: NOW });
  assert.equal(report.skipped, 1);
  assert.ok(calls.some((entry) => /SET status = 'skipped'/.test(entry.text)));
});

test("stalled claims go back to pending from both tables", async () => {
  const { client, calls } = scripted([{ match: /SET status = 'pending'/, rows: [{ id: "x" }] }]);
  const store = medusaStore(client);
  assert.equal(await store.reclaimConversions(NOW), 1);
  assert.equal(await store.reclaimMessages(NOW), 1);
  assert.ok(calls[0]!.text.includes("siumora_tracking_events"));
  assert.ok(calls[1]!.text.includes("siumora_notifications"));
  assert.equal((calls[0]!.values[0] as Date).toISOString(), "2026-10-25T09:55:00.000Z");
});
