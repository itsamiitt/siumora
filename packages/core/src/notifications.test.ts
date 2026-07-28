import assert from "node:assert/strict";
import { test } from "node:test";

import {
  QUIET_FROM_HOUR,
  QUIET_UNTIL_HOUR,
  TEMPLATES,
  evaluateSend,
  inQuietHours,
  istHour,
  nextSendableAt,
  renderTemplate,
  sendableOn,
  templateFor,
  templateForStatus,
  templateHygiene,
  type Template,
} from "./notifications.ts";

const DAYTIME = new Date("2026-07-15T09:00:00Z"); // 14:30 IST
const NIGHT = new Date("2026-07-15T18:00:00Z"); // 23:30 IST

test("every shipped template passes the hygiene lint", () => {
  // The check plan/06 §4 asks CI to run, run as a test so a bad template fails
  // the build rather than the WhatsApp account.
  assert.deepEqual(templateHygiene(), []);
});

test("catches promotional copy smuggled into a utility template", () => {
  // The exact mistake the lint exists for: marketing through a utility
  // template is a policy violation that costs the number, not the message.
  const bad: Template = {
    key: "order_confirmed",
    category: "utility",
    channels: ["whatsapp"],
    variables: ["name"],
    body: "Hi {{name}}, your order is in. Exclusive offer: 20% off your next one.",
  };

  const problems = templateHygiene([bad]);
  assert.equal(problems.length, 1);
  assert.match(problems[0]?.problem ?? "", /promotional language/);
});

test("catches a variable in the body that nobody declared", () => {
  // The quiet failure: it renders as an empty string in production and reads
  // perfectly in review.
  const bad: Template = {
    key: "x",
    category: "utility",
    channels: ["whatsapp"],
    variables: ["name"],
    body: "Hi {{name}}, order {{orderNumber}} is on its way.",
  };

  assert.match(templateHygiene([bad])[0]?.problem ?? "", /not declared/);
});

test("catches a declared variable the body forgot", () => {
  const bad: Template = {
    key: "x",
    category: "utility",
    channels: ["whatsapp"],
    variables: ["name", "orderNumber"],
    body: "Hi {{name}}.",
  };

  assert.match(templateHygiene([bad])[0]?.problem ?? "", /never uses/);
});

test("sends a delivery notice whatever the marketing preference", () => {
  // A parcel arriving is not advertising. Withholding it because somebody
  // unticked an offers box would be its own kind of failure.
  const decision = evaluateSend("order_shipped", {
    marketingConsent: false,
    now: DAYTIME,
  });
  assert.equal(decision.send, true);
});

test("will not send marketing without opt-in", () => {
  const decision = evaluateSend("back_in_stock", { now: DAYTIME });
  assert.equal(decision.send, false);
  assert.equal(decision.send === false && decision.reason, "no_marketing_consent");
});

test("stops everything for somebody who asked to be left alone", () => {
  // An opt-out outranks even a utility message. It is a person asking.
  const decision = evaluateSend("order_shipped", {
    optedOut: true,
    now: DAYTIME,
  });
  assert.equal(decision.send, false);
  assert.equal(decision.send === false && decision.reason, "opted_out");
});

test("holds marketing at night and lets a failed delivery through", () => {
  const marketing = evaluateSend("back_in_stock", {
    marketingConsent: true,
    now: NIGHT,
  });
  assert.equal(marketing.send, false);
  assert.equal(marketing.send === false && marketing.reason, "quiet_hours");

  // An NDR at nine in the evening is the entire point of an NDR message.
  const ndr = evaluateSend("delivery_failed", { now: NIGHT });
  assert.equal(ndr.send, true);
});

test("reads the clock in IST, not the server's zone", () => {
  // 18:00 UTC is 23:30 in India. A UTC read would send at half past eleven at
  // night and call it the afternoon.
  assert.equal(istHour(NIGHT), 23);
  assert.equal(inQuietHours(NIGHT), true);
  assert.equal(inQuietHours(DAYTIME), false);
  assert.ok(QUIET_FROM_HOUR > QUIET_UNTIL_HOUR, "quiet hours span midnight");
});

test("reschedules a held message to the morning rather than dropping it", () => {
  const held = nextSendableAt(NIGHT);
  assert.ok(held > NIGHT);
  assert.equal(inQuietHours(held), false);
  assert.equal(istHour(held), QUIET_UNTIL_HOUR);

  // Already sendable: left alone rather than pushed to tomorrow.
  assert.equal(nextSendableAt(DAYTIME).getTime(), DAYTIME.getTime());
});

test("holds a message sent just before midnight to the same morning", () => {
  // 22:00 IST on the 15th should go at 09:00 IST on the 16th, not the 17th.
  const lateEvening = new Date("2026-07-15T16:30:00Z"); // 22:00 IST
  const held = nextSendableAt(lateEvening);
  assert.equal(istHour(held), 9);
  assert.ok(held.getTime() - lateEvening.getTime() < 12 * 3600_000);
});

test("refuses to render with a variable missing", () => {
  // WhatsApp rejects an empty parameter, and "your order  has shipped" is the
  // message that makes a customer ring support.
  const result = renderTemplate("order_shipped", {
    name: "Asha",
    orderNumber: "SIU-00001",
    courier: "",
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.ok === false && [...result.missing].sort(), [
    "courier",
    "trackingId",
  ]);
});

test("fills every placeholder when it has the values", () => {
  const result = renderTemplate("order_shipped", {
    name: "Asha",
    orderNumber: "SIU-00001",
    courier: "Bluedart",
    trackingId: "BD123456",
  });

  assert.equal(result.ok, true);
  const body = result.ok ? result.body : "";
  assert.match(body, /Asha/);
  assert.match(body, /SIU-00001/);
  assert.match(body, /Bluedart/);
  // Nothing left unfilled.
  assert.equal(/\{\{/.test(body), false);
});

test("will not send an SMS on a template that is not DLT registered", () => {
  // The operator drops it with no error, which looks like a delivery problem
  // for however long it takes somebody to check the registration.
  const cod = templateFor("cod_confirm") as Template;
  assert.ok(cod.channels.includes("sms"));
  assert.equal(sendableOn(cod, "sms"), false);
  assert.equal(sendableOn(cod, "whatsapp"), true);

  const registered: Template = { ...cod, dltTemplateId: "1107xxxxxxxxxxxxxxx" };
  assert.equal(sendableOn(registered, "sms"), true);
});

test("maps the order transitions that are worth a message", () => {
  assert.equal(templateForStatus("shipped"), "order_shipped");
  assert.equal(templateForStatus("ndr"), "delivery_failed");
  // Not every transition earns one. "processing" is a warehouse fact.
  assert.equal(templateForStatus("processing"), undefined);
  assert.equal(templateForStatus("rto"), undefined);
});

test("every template a status maps to actually exists", () => {
  for (const status of [
    "confirmed",
    "shipped",
    "out_for_delivery",
    "delivered",
    "ndr",
    "awaiting_cod_confirmation",
  ]) {
    const key = templateForStatus(status);
    assert.ok(key, status);
    assert.ok(templateFor(key), `${status} -> ${key}`);
  }
});

test("refuses a template nobody registered", () => {
  const decision = evaluateSend("free_diamonds", { now: DAYTIME });
  assert.equal(decision.send, false);
  assert.equal(decision.send === false && decision.reason, "unknown_template");
});

test("falls back to the channels this environment actually has", () => {
  // WhatsApp unconfigured: the message still goes by email rather than not at
  // all.
  const decision = evaluateSend("order_confirmed", { now: DAYTIME }, ["email"]);
  assert.equal(decision.send, true);
  assert.deepEqual(decision.send === true && decision.channels, ["email"]);

  const none = evaluateSend("out_for_delivery", { now: DAYTIME }, ["email"]);
  assert.equal(none.send, false);
  assert.equal(none.send === false && none.reason, "no_channel");
});

test("keeps WhatsApp first, because that is what gets read here", () => {
  for (const template of TEMPLATES) {
    assert.equal(template.channels[0], "whatsapp", template.key);
  }
});
