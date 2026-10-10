import assert from "node:assert/strict";
import { test } from "node:test";

import { SECURITY_URL, newDeviceMessage, phoneChangedMessage } from "./security-alert.ts";

const AT = new Date("2026-10-10T08:15:00Z"); // 13:45 IST

test("the new-device alert names the device, the time in IST, and the way out", () => {
  const message = newDeviceMessage("Chrome on Android", AT);
  assert.match(message, /Chrome on Android/);
  assert.match(message, /1:45\s?pm IST/i);
  assert.ok(message.includes(SECURITY_URL));
});

test("the phone-change notice shows the new number masked, never whole", () => {
  const message = phoneChangedMessage("98••••5678", AT);
  assert.match(message, /98••••5678/);
  assert.ok(!/\d{10}/.test(message));
});
