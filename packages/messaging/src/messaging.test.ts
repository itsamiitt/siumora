import assert from "node:assert/strict";
import { test } from "node:test";

import { createTransport, unconfiguredTransport } from "./transport.ts";
import { createOtpSender } from "./otp.ts";
import { classifyHttp } from "./types.ts";

/** A fetch that answers from a script and records what it was asked. */
function fakeFetch(answers: Array<{ status: number; body: unknown }>) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  let call = 0;
  const impl = (async (url: string | URL, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    const answer = answers[Math.min(call, answers.length - 1)]!;
    call += 1;
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      text: async () => JSON.stringify(answer.body),
    };
  }) as unknown as typeof fetch;
  return { fetch: impl, requests };
}

const WA_ENV = {
  WHATSAPP_BSP_URL: "https://bsp.example",
  WHATSAPP_BSP_KEY: "bsp_key",
  WHATSAPP_TEXT_TEMPLATE: "siumora_text",
  WHATSAPP_OTP_TEMPLATE: "siumora_otp",
};
const SMS_ENV = { MSG91_AUTH_KEY: "authkey1", MSG91_OTP_TEMPLATE_ID: "dlt_otp" };
const EMAIL_ENV = { RESEND_API_KEY: "re_key", EMAIL_FROM: "care@siumora.example" };

test("channels mirror exactly what is configured", () => {
  assert.deepEqual(unconfiguredTransport().channels, []);
  assert.deepEqual(createTransport({}).channels, []);
  assert.deepEqual(createTransport(WA_ENV).channels, ["whatsapp"]);
  assert.deepEqual(
    createTransport({ ...WA_ENV, ...SMS_ENV, ...EMAIL_ENV }).channels,
    ["whatsapp", "sms", "email"],
  );
  // push never appears — no FCM exists to carry it.
  assert.ok(!createTransport({ ...WA_ENV, ...SMS_ENV, ...EMAIL_ENV }).channels.includes("push"));
});

test("whatsapp rides the pass-through template with the rendered body", async () => {
  const { fetch, requests } = fakeFetch([{ status: 201, body: { id: "wamid.9" } }]);
  const transport = createTransport(WA_ENV, { fetch });

  const outcome = await transport.send("whatsapp", "9876543210", "Shipped!", {
    templateKey: "order_shipped",
  });

  assert.deepEqual(outcome, { kind: "sent", providerMessageId: "wamid.9" });
  const body = JSON.parse(String(requests[0]!.init.body));
  assert.equal(body.template.name, "siumora_text");
  assert.deepEqual(body.template.bodyValues, ["Shipped!"]);
  assert.equal(body.phoneNumber, "9876543210");
  const headers = requests[0]!.init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Basic bsp_key");
});

test("sms refuses without a DLT template id — TRAI would anyway", async () => {
  const { fetch, requests } = fakeFetch([{ status: 200, body: { type: "success" } }]);
  const transport = createTransport(SMS_ENV, { fetch });

  const refused = await transport.send("sms", "9876543210", "Shipped!", {
    templateKey: "order_shipped",
  });
  assert.equal(refused.kind, "permanent");
  assert.equal(requests.length, 0, "nothing was posted");

  const sent = await transport.send("sms", "9876543210", "Shipped!", {
    templateKey: "order_shipped",
    dltTemplateId: "dlt_ship_1",
  });
  assert.equal(sent.kind, "sent");
  const body = JSON.parse(String(requests[0]!.init.body));
  assert.equal(body.template_id, "dlt_ship_1");
  assert.equal(body.recipients[0].mobiles, "919876543210");
});

test("msg91 refusals inside a 200 are permanent, not retried forever", async () => {
  const { fetch } = fakeFetch([
    { status: 200, body: { type: "error", message: "template not registered" } },
  ]);
  const transport = createTransport(SMS_ENV, { fetch });

  const outcome = await transport.send("sms", "9876543210", "x", {
    templateKey: "order_shipped",
    dltTemplateId: "dlt_ship_1",
  });
  assert.equal(outcome.kind, "permanent");
});

test("email carries a per-template subject and the body as text", async () => {
  const { fetch, requests } = fakeFetch([{ status: 200, body: { id: "em_1" } }]);
  const transport = createTransport(EMAIL_ENV, { fetch });

  const outcome = await transport.send(
    "email",
    "asha@example.com",
    "Your order is on its way.",
    { templateKey: "order_shipped" },
  );

  assert.deepEqual(outcome, { kind: "sent", providerMessageId: "em_1" });
  const body = JSON.parse(String(requests[0]!.init.body));
  assert.equal(body.from, "care@siumora.example");
  assert.equal(body.subject, "Your Siumora order is on its way");
  assert.equal(body.text, "Your order is on its way.");
});

test("an unconfigured channel refuses without touching the network", async () => {
  const { fetch, requests } = fakeFetch([{ status: 200, body: {} }]);
  const transport = createTransport(WA_ENV, { fetch });

  const outcome = await transport.send("email", "asha@example.com", "x", {
    templateKey: "order_shipped",
  });
  assert.equal(outcome.kind, "permanent");
  assert.equal(requests.length, 0);
});

test("the taxonomy splits retryable from final", () => {
  assert.equal(classifyHttp(429, "slow down").kind, "retry");
  assert.equal(classifyHttp(503, "upstream").kind, "retry");
  assert.equal(classifyHttp(400, "bad payload").kind, "permanent");
  assert.equal(classifyHttp(401, "bad key").kind, "permanent");
});

test("OTP resolves WhatsApp first, then SMS, then refuses to exist", async () => {
  const wa = createOtpSender({ ...WA_ENV, ...SMS_ENV });
  assert.equal(wa?.channel, "whatsapp");

  const sms = createOtpSender(SMS_ENV);
  assert.equal(sms?.channel, "sms");

  // Email credentials alone resolve nothing: a code delivered to an inbox
  // proves nothing about the phone (design doc, W1).
  assert.equal(createOtpSender(EMAIL_ENV), undefined);
  assert.equal(createOtpSender({}), undefined);
});

test("the OTP send carries the code as the template's one parameter", async () => {
  const { fetch, requests } = fakeFetch([{ status: 201, body: { id: "wamid.otp" } }]);
  const sender = createOtpSender({ ...WA_ENV }, fetch);

  const result = await sender!.send("9876543210", "482913");
  assert.deepEqual(result, { ok: true });

  const body = JSON.parse(String(requests[0]!.init.body));
  assert.equal(body.template.name, "siumora_otp");
  assert.deepEqual(body.template.bodyValues, ["482913"]);
});

test("an OTP provider failure is an outcome the route can route on", async () => {
  const { fetch } = fakeFetch([{ status: 500, body: { error: "down" } }]);
  const sender = createOtpSender({ ...WA_ENV }, fetch);

  const result = await sender!.send("9876543210", "482913");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /HTTP 500/);
});
