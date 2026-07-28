import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import {
  MAX_SEND_ATTEMPTS,
  createDb,
  createPool,
  createTestDatabase,
  migrate,
  recordTrackingEvent,
  trackingHealth,
  type Database,
  type TestDatabase,
} from "@siumora/db";
import { drainConversions } from "./drain.ts";
import { classify, httpTransport, type SendOutcome, type Transport } from "./transport.ts";

/**
 * Worker tests against a real Postgres.
 *
 * The claim is the part worth testing against the database rather than a fake:
 * it is one statement whose whole purpose is to behave correctly when two
 * workers run it at once, and an in-memory stand-in would prove nothing about
 * that.
 */
const url = process.env.DATABASE_URL;
const workerTest = url ? test : test.skip;

let testDb: TestDatabase | undefined;
// Typed off the factory rather than importing `pg`: the worker talks to the
// database through @siumora/db, and a direct driver dependency here would be
// the first crack in that.
let pool: ReturnType<typeof createPool>;
let db: Database;

before(async () => {
  if (!url) return;
  testDb = await createTestDatabase("worker");
  pool = createPool({ connectionString: testDb!.url });
  await migrate(pool);
  db = createDb(pool);
});

beforeEach(async () => {
  if (!url) return;
  await pool.query("DELETE FROM tracking_events");
});

after(async () => {
  if (!pool) return;
  await pool.end();
});

/** A transport that answers however the test says, and counts the calls. */
function stub(answer: SendOutcome | ((n: number) => SendOutcome)) {
  const calls: Array<{ destination: string; payload: unknown }> = [];
  const transport: Transport = {
    async send(destination, payload) {
      calls.push({ destination, payload });
      return typeof answer === "function" ? answer(calls.length) : answer;
    },
  };
  return { transport, calls };
}

async function queue(overrides: Record<string, unknown> = {}) {
  const eventId = crypto.randomUUID();
  await recordTrackingEvent(db, {
    eventId,
    eventName: "purchase",
    destination: "ga4",
    payload: { client_id: "1.2", events: [{ name: "purchase", params: {} }] },
    ...overrides,
  });
  return eventId;
}

async function rowFor(eventId: string) {
  const { rows } = await pool.query(
    "SELECT * FROM tracking_events WHERE event_id = $1",
    [eventId],
  );
  return rows[0];
}

workerTest("sends a queued conversion and marks it", async () => {
  const eventId = await queue();
  const { transport, calls } = stub({ kind: "sent" });

  const report = await drainConversions(db, transport);

  assert.equal(report.claimed, 1);
  assert.equal(report.sent, 1);
  assert.equal(calls[0]?.destination, "ga4");

  const row = await rowFor(eventId);
  assert.equal(row.status, "sent");
  assert.equal(row.attempts, 1);
  assert.ok(row.sent_at);
});

workerTest("leaves an unconfigured destination alone", async () => {
  // `skipped` means nobody ever intended to send it. Draining those would post
  // events this environment was never given credentials for.
  await queue({ status: "skipped" });
  const { transport, calls } = stub({ kind: "sent" });

  const report = await drainConversions(db, transport);
  assert.equal(report.claimed, 0);
  assert.equal(calls.length, 0);
});

workerTest("schedules a refused send instead of retrying it at once", async () => {
  const eventId = await queue();
  const { transport } = stub({ kind: "retry", error: "HTTP 503: upstream" });
  const now = new Date();

  const report = await drainConversions(db, transport, { now });
  assert.equal(report.retrying, 1);

  const row = await rowFor(eventId);
  assert.equal(row.status, "pending");
  assert.equal(row.attempts, 1);
  assert.match(row.last_error, /503/);
  // Backed off, or the next pass fifteen seconds later hammers the same
  // endpoint that just asked for a pause.
  assert.ok(row.next_attempt_at > now, "next attempt is in the future");
});

workerTest("does not pick a row back up before it is due", async () => {
  await queue();
  const { transport, calls } = stub({ kind: "retry", error: "HTTP 503" });

  await drainConversions(db, transport);
  await drainConversions(db, transport);

  assert.equal(calls.length, 1, "the second pass found nothing due");
});

workerTest("stops retrying a payload that will never be accepted", async () => {
  // A rejected credential or a malformed event does not become valid by being
  // sent four more times; the retries only delay somebody noticing.
  const eventId = await queue();
  const { transport } = stub({ kind: "permanent", error: "HTTP 400: bad event" });

  const report = await drainConversions(db, transport);

  assert.equal(report.failed, 1);
  const row = await rowFor(eventId);
  assert.equal(row.status, "failed");
  assert.equal(row.attempts, 1, "it gave up rather than spending the budget");
});

workerTest("gives up after the attempt cap", async () => {
  const eventId = await queue();
  const { transport } = stub({ kind: "retry", error: "HTTP 500" });

  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
    // Each pass is run at a time past the backoff the last one set, which is
    // what a real worker does by waiting.
    await drainConversions(db, transport, {
      now: new Date(Date.now() + attempt * 60 * 60_000),
    });
  }

  const row = await rowFor(eventId);
  assert.equal(row.status, "failed");
  assert.equal(row.attempts, MAX_SEND_ATTEMPTS);
});

workerTest("does not hand the same row to two workers", async () => {
  // The unique index stops a duplicate row. Nothing but the claim stops a
  // duplicate *post*, and a duplicate post is a duplicate conversion.
  await queue();
  await queue();

  const a = stub({ kind: "sent" });
  const b = stub({ kind: "sent" });

  const [first, second] = await Promise.all([
    drainConversions(db, a.transport),
    drainConversions(db, b.transport),
  ]);

  assert.equal(first.claimed + second.claimed, 2);
  assert.equal(a.calls.length + b.calls.length, 2);
});

workerTest("puts a dead worker's claim back on the queue", async () => {
  const eventId = await queue();
  await pool.query(
    "UPDATE tracking_events SET status = 'sending' WHERE event_id = $1",
    [eventId],
  );

  // Six minutes on: past the claim timeout, so the row is assumed stranded.
  const later = new Date(Date.now() + 6 * 60_000);
  const { transport } = stub({ kind: "sent" });
  const report = await drainConversions(db, transport, { now: later });

  assert.equal(report.reclaimed, 1);
  // Reclaimed and drained in the same pass, rather than waiting for the next.
  assert.equal(report.sent, 1);

  const row = await rowFor(eventId);
  // Not charged for somebody else's crash: it was claimed, never refused.
  assert.equal(row.attempts, 1);
});

workerTest("does not steal a claim that is still in flight", async () => {
  const eventId = await queue();
  await pool.query(
    "UPDATE tracking_events SET status = 'sending' WHERE event_id = $1",
    [eventId],
  );

  const { transport, calls } = stub({ kind: "sent" });
  const report = await drainConversions(db, transport);

  assert.equal(report.reclaimed, 0);
  assert.equal(calls.length, 0);
});

workerTest("refuses a ledger row with no payload rather than posting null", async () => {
  const eventId = await queue({ payload: null });
  const { transport, calls } = stub({ kind: "sent" });

  const report = await drainConversions(db, transport);

  assert.equal(calls.length, 0, "nothing was posted");
  assert.equal(report.failed, 1);
  const row = await rowFor(eventId);
  assert.equal(row.status, "failed");
});

workerTest("does not strand a row when the transport throws", async () => {
  const eventId = await queue();
  const transport: Transport = {
    async send() {
      throw new Error("socket hang up");
    },
  };

  const report = await drainConversions(db, transport);

  assert.equal(report.retrying, 1);
  const row = await rowFor(eventId);
  // Back to pending, not left claimed forever.
  assert.equal(row.status, "pending");
  assert.match(row.last_error, /hang up/);
});

workerTest("reports what is in flight, not just what is queued", async () => {
  await queue();
  await pool.query("UPDATE tracking_events SET status = 'sending'");

  const health = await trackingHealth(db);
  // A persistently non-zero `sending` is a stuck worker, and a health object
  // that cannot express it hides the failure it exists to surface.
  assert.equal(health.sending, 1);
  assert.equal(health.pending, 0);
});

workerTest("drains a batch without posting them all at once", async () => {
  for (let i = 0; i < 12; i += 1) await queue();

  let inFlight = 0;
  let peak = 0;
  const transport: Transport = {
    async send() {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { kind: "sent" };
    },
  };

  const report = await drainConversions(db, transport, { concurrency: 3 });

  assert.equal(report.sent, 12);
  // An unbounded fan-out is how a backlog becomes a rate limit becomes a
  // longer backlog.
  assert.ok(peak <= 3, `peak concurrency was ${peak}`);
});

// ── Transport ─────────────────────────────────────────────────

test("treats a rate limit as worth retrying and a bad request as final", () => {
  assert.equal(classify(429, "slow down").kind, "retry");
  assert.equal(classify(503, "upstream").kind, "retry");
  // 400 will be exactly as wrong next time: the request is byte-identical.
  assert.equal(classify(400, "bad event").kind, "permanent");
  assert.equal(classify(401, "bad token").kind, "permanent");
  assert.equal(classify(204, "").kind, "sent");
});

test("refuses a destination this environment has no credentials for", async () => {
  const transport = httpTransport({});
  const outcome = await transport.send("ga4", { client_id: "1.2" });

  // Permanent, not retry: five attempts against an endpoint nobody gave this
  // process keys for is five identical refusals.
  assert.equal(outcome.kind, "permanent");
  assert.match(outcome.kind === "permanent" ? outcome.error : "", /not configured/);
});

test("wraps a Meta event in the envelope the API expects", async () => {
  let body: unknown;
  const transport = httpTransport({
    metaPixelId: "123",
    metaAccessToken: "token",
    fetch: (async (_url: string, init: { body: string }) => {
      body = JSON.parse(init.body);
      return { status: 200, text: async () => "" };
    }) as unknown as typeof fetch,
  });

  await transport.send("meta", { event_name: "Purchase" });

  // The ledger stores the event; the envelope is a transport concern, so a
  // stored payload stays replayable rather than becoming wire format.
  assert.deepEqual(body, { data: [{ event_name: "Purchase" }] });
});

test("posts a GA4 payload as-is", async () => {
  let body: unknown;
  let target = "";
  const transport = httpTransport({
    ga4MeasurementId: "G-XYZ",
    ga4ApiSecret: "secret",
    fetch: (async (url: string, init: { body: string }) => {
      target = url;
      body = JSON.parse(init.body);
      return { status: 204, text: async () => "" };
    }) as unknown as typeof fetch,
  });

  const payload = { client_id: "1.2", events: [{ name: "purchase", params: {} }] };
  await transport.send("ga4", payload);

  assert.deepEqual(body, payload);
  assert.match(target, /measurement_id=G-XYZ/);
  assert.match(target, /api_secret=secret/);
});

test("treats a network failure as retryable", async () => {
  const transport = httpTransport({
    ga4MeasurementId: "G-XYZ",
    ga4ApiSecret: "secret",
    fetch: (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch,
  });

  const outcome = await transport.send("ga4", {});
  // A dropped socket says nothing about the payload.
  assert.equal(outcome.kind, "retry");
});

// ── Notification outbox ───────────────────────────────────────

import {
  enqueueNotification,
  notificationHealth,
  setNotificationPreference,
} from "@siumora/db";

import { drainNotifications, unconfiguredTransport, type MessageTransport } from "./messages.ts";

const SHIPPED = {
  templateKey: "order_shipped",
  recipient: "9876543210",
  variables: {
    name: "Asha",
    orderNumber: "SIU-00001",
    courier: "Bluedart",
    trackingId: "BD123",
  },
};

/** A transport that answers however the test says, and records what it saw. */
function messenger(
  channels: Channel[],
  answer: (channel: Channel, n: number) => Awaited<ReturnType<MessageTransport["send"]>>,
) {
  const calls: Array<{ channel: string; recipient: string; body: string }> = [];
  const transport: MessageTransport = {
    channels,
    async send(channel, recipient, body) {
      calls.push({ channel, recipient, body });
      return answer(channel, calls.length);
    },
  };
  return { transport, calls };
}

type Channel = "whatsapp" | "sms" | "push" | "email";

workerTest("sends a queued message and renders it in full", async () => {
  await pool.query("DELETE FROM notifications; DELETE FROM notification_preferences");
  await enqueueNotification(db, { eventKey: crypto.randomUUID(), ...SHIPPED });

  const { transport, calls } = messenger(["whatsapp"], () => ({
    kind: "sent",
    providerMessageId: "wamid.1",
  }));

  const report = await drainNotifications(db, transport);

  assert.equal(report.sent, 1);
  assert.equal(calls[0]?.recipient, "9876543210");
  assert.match(calls[0]?.body ?? "", /Asha/);
  assert.match(calls[0]?.body ?? "", /Bluedart/);
  // Nothing left unfilled — WhatsApp rejects an empty parameter.
  assert.equal(/\{\{/.test(calls[0]?.body ?? ""), false);

  const { rows } = await pool.query("SELECT * FROM notifications");
  assert.equal(rows[0].status, "sent");
  assert.equal(rows[0].channel, "whatsapp");
  assert.equal(rows[0].provider_message_id, "wamid.1");
});

workerTest("falls through to the next channel when the first refuses", async () => {
  // A template pending re-approval must not cost somebody their delivery
  // notice — but the customer must not get the same message twice either.
  await pool.query("DELETE FROM notifications; DELETE FROM notification_preferences");
  await enqueueNotification(db, { eventKey: crypto.randomUUID(), ...SHIPPED });

  const { transport, calls } = messenger(["whatsapp", "push", "email"], (channel) =>
    channel === "whatsapp"
      ? { kind: "permanent", error: "template not approved" }
      : { kind: "sent" },
  );

  const report = await drainNotifications(db, transport);

  assert.equal(report.sent, 1);
  assert.deepEqual(calls.map((call) => call.channel), ["whatsapp", "push"]);
});

workerTest("skips a message no configured channel can carry", async () => {
  // The honest state of this environment: the rows exist, they say what they
  // wanted, and the gap between orders and messages stays visible.
  await pool.query("DELETE FROM notifications; DELETE FROM notification_preferences");
  await enqueueNotification(db, { eventKey: crypto.randomUUID(), ...SHIPPED });

  const report = await drainNotifications(db, unconfiguredTransport());

  assert.equal(report.skipped, 1);
  assert.equal(report.sent, 0);
  const { rows } = await pool.query("SELECT status, last_error FROM notifications");
  assert.equal(rows[0].status, "skipped");
  assert.match(rows[0].last_error, /no configured channel/);
});

workerTest("does not queue the same event twice", async () => {
  // A replayed courier webhook is one dispatch, not two notices.
  await pool.query("DELETE FROM notifications; DELETE FROM notification_preferences");
  const eventKey = crypto.randomUUID();

  const first = await enqueueNotification(db, { eventKey, ...SHIPPED });
  const second = await enqueueNotification(db, { eventKey, ...SHIPPED });

  assert.equal(first.queued, true);
  assert.equal(second.queued, false);
  assert.equal(second.reason, "duplicate");

  const { rows } = await pool.query("SELECT count(*)::int AS n FROM notifications");
  assert.equal(rows[0].n, 1);
});

workerTest("queues nothing for someone who asked to be left alone", async () => {
  await pool.query("DELETE FROM notifications; DELETE FROM notification_preferences");
  await setNotificationPreference(db, "9876543210", { optedOut: true });

  const result = await enqueueNotification(db, {
    eventKey: crypto.randomUUID(),
    ...SHIPPED,
  });

  assert.equal(result.queued, false);
  assert.equal(result.reason, "opted_out");
  // No row at all: a queue full of messages nobody may send is a queue nobody
  // reads.
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM notifications");
  assert.equal(rows[0].n, 0);
});

workerTest("records an unrenderable message rather than dropping it", async () => {
  await pool.query("DELETE FROM notifications; DELETE FROM notification_preferences");

  const result = await enqueueNotification(db, {
    eventKey: crypto.randomUUID(),
    templateKey: "order_shipped",
    recipient: "9876543210",
    variables: { name: "Asha", orderNumber: "SIU-00001" },
  });

  assert.equal(result.queued, false);
  assert.equal(result.reason, "unrenderable");
  // A bug upstream, and it should be visible rather than silently gone.
  const { rows } = await pool.query("SELECT status, last_error FROM notifications");
  assert.equal(rows[0].status, "failed");
  assert.match(rows[0].last_error, /courier/);
});

workerTest("holds a marketing message until the morning", async () => {
  await pool.query("DELETE FROM notifications; DELETE FROM notification_preferences");
  await setNotificationPreference(db, "9876543210", { marketingConsent: true });

  const night = new Date("2026-07-15T18:00:00Z"); // 23:30 IST
  const result = await enqueueNotification(db, {
    eventKey: crypto.randomUUID(),
    templateKey: "back_in_stock",
    recipient: "9876543210",
    variables: { name: "Asha", product: "Petal Studs" },
    now: night,
  });

  assert.equal(result.queued, true);
  const { rows } = await pool.query("SELECT next_attempt_at FROM notifications");
  // Held, not dropped: still owed, just not at half past eleven at night.
  assert.ok(rows[0].next_attempt_at > night);

  const nothingYet = await drainNotifications(db, unconfiguredTransport(), { now: night });
  assert.equal(nothingYet.claimed, 0);
});

workerTest("does not hand the same message to two workers", async () => {
  await pool.query("DELETE FROM notifications; DELETE FROM notification_preferences");
  for (let n = 0; n < 2; n += 1) {
    await enqueueNotification(db, { eventKey: crypto.randomUUID(), ...SHIPPED });
  }

  const a = messenger(["whatsapp"], () => ({ kind: "sent" }));
  const b = messenger(["whatsapp"], () => ({ kind: "sent" }));

  const [first, second] = await Promise.all([
    drainNotifications(db, a.transport),
    drainNotifications(db, b.transport),
  ]);

  assert.equal(first.claimed + second.claimed, 2);
  // Two messages, two sends. A duplicate here is a customer told twice.
  assert.equal(a.calls.length + b.calls.length, 2);
});

workerTest("reports what is queued, sent and stuck", async () => {
  await pool.query("DELETE FROM notifications; DELETE FROM notification_preferences");
  await enqueueNotification(db, { eventKey: crypto.randomUUID(), ...SHIPPED });

  const before = await notificationHealth(db);
  assert.equal(before.pending, 1);
  assert.equal(before.sent, 0);

  await drainNotifications(db, messenger(["whatsapp"], () => ({ kind: "sent" })).transport);

  const after = await notificationHealth(db);
  assert.equal(after.sent, 1);
  assert.equal(after.pending, 0);
});
