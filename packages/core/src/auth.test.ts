import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_WINDOW,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_SEND_WINDOW_SECONDS,
  evaluateOtpRequest,
  evaluateOtpVerification,
  isAdminPhone,
  maskPhone,
  normalisePhone,
  parseAdminPhones,
  toE164,
} from "./auth.ts";

const NOW = new Date("2026-07-28T10:00:00+05:30");

function ago(seconds: number): Date {
  return new Date(NOW.getTime() - seconds * 1000);
}

test("normalises every shape a person types a mobile number in", () => {
  for (const raw of [
    "9876543210",
    "09876543210",
    "919876543210",
    "+91 98765 43210",
    "+91-98765-43210",
    "0091 9876543210",
  ]) {
    assert.equal(normalisePhone(raw), "9876543210", raw);
  }
});

test("rejects numbers that are not Indian mobiles", () => {
  // Landline prefixes, short numbers and long numbers all cost money to send
  // to and never arrive.
  for (const raw of ["1234567890", "5876543210", "98765", "98765432101234"]) {
    assert.equal(normalisePhone(raw), undefined, raw);
  }
});

test("keeps a genuine 10-digit number starting 91 intact", () => {
  // Stripping a country code off a number that never had one would sign the
  // wrong person in.
  assert.equal(normalisePhone("9187654321"), "9187654321");
});

test("masks the reachable middle, keeps the recognisable tail", () => {
  assert.equal(maskPhone("9876543210"), "98••••3210");
  assert.equal(maskPhone("nonsense"), "••••");
});

test("formats E.164 for the provider", () => {
  assert.equal(toE164("9876543210"), "+919876543210");
});

test("allows a first code", () => {
  assert.deepEqual(evaluateOtpRequest({ now: NOW, sentAt: [] }), {
    allowed: true,
  });
});

test("holds a resend inside the cooldown and says how long", () => {
  const decision = evaluateOtpRequest({ now: NOW, sentAt: [ago(10)] });
  assert.equal(decision.allowed, false);
  assert.ok(!decision.allowed && decision.retryAfterSeconds > 0);
  assert.ok(
    !decision.allowed &&
      decision.retryAfterSeconds <= OTP_RESEND_COOLDOWN_SECONDS,
  );
});

test("allows a resend once the cooldown has passed", () => {
  const decision = evaluateOtpRequest({
    now: NOW,
    sentAt: [ago(OTP_RESEND_COOLDOWN_SECONDS + 1)],
  });
  assert.equal(decision.allowed, true);
});

test("caps codes per number per hour", () => {
  // Spaced past the cooldown, so it is the hourly cap being tested and not the
  // cooldown standing in for it.
  const sentAt = Array.from({ length: OTP_MAX_SENDS_PER_WINDOW }, (_, index) =>
    ago(60 * (index + 1)),
  );
  const decision = evaluateOtpRequest({ now: NOW, sentAt });
  assert.equal(decision.allowed, false);
  assert.ok(!decision.allowed && /Too many/.test(decision.reason));
});

test("lifts the cap when the oldest send ages out of the window", () => {
  const sentAt = [
    ago(OTP_SEND_WINDOW_SECONDS + 1),
    ...Array.from({ length: OTP_MAX_SENDS_PER_WINDOW - 1 }, (_, index) =>
      ago(60 * (index + 2)),
    ),
  ];
  assert.equal(evaluateOtpRequest({ now: NOW, sentAt }).allowed, true);
});

test("counts sends regardless of the order they are handed over in", () => {
  const sentAt = [ago(600), ago(60), ago(300), ago(120), ago(400)];
  const decision = evaluateOtpRequest({ now: NOW, sentAt });
  assert.equal(decision.allowed, false);
  assert.ok(!decision.allowed && /Too many/.test(decision.reason));
});

function verification(overrides: Record<string, unknown> = {}) {
  return evaluateOtpVerification({
    now: NOW,
    expiresAt: new Date(NOW.getTime() + 60_000),
    attempts: 0,
    matches: true,
    ...overrides,
  });
}

test("verifies a matching code inside its window", () => {
  assert.equal(verification().status, "verified");
});

test("refuses a correct code that has expired", () => {
  assert.equal(
    verification({ expiresAt: new Date(NOW.getTime() - 1) }).status,
    "expired",
  );
});

test("refuses a correct code that has already signed someone in", () => {
  // A code read over a shoulder is a code that already worked once.
  assert.equal(verification({ consumedAt: NOW }).status, "consumed");
});

test("locks the code once the guesses are used up", () => {
  const result = verification({ attempts: OTP_MAX_ATTEMPTS, matches: false });
  assert.equal(result.status, "locked");
  assert.equal(result.attemptsRemaining, 0);
});

test("locks even when the last guess is right", () => {
  // Otherwise the lock is decorative: keep guessing until one lands.
  assert.equal(
    verification({ attempts: OTP_MAX_ATTEMPTS, matches: true }).status,
    "locked",
  );
});

test("counts down the guesses left on a wrong code", () => {
  const result = verification({ attempts: 1, matches: false });
  assert.equal(result.status, "mismatch");
  assert.equal(result.attemptsRemaining, OTP_MAX_ATTEMPTS - 2);
});

test("reads the admin allow-list in whatever shape it is configured", () => {
  const list = parseAdminPhones("+91 98765 43210, 08123456789 junk");
  assert.deepEqual(list, ["9876543210", "8123456789"]);
  assert.equal(isAdminPhone("9876543210", list), true);
  assert.equal(isAdminPhone("9000000000", list), false);
});

test("treats an unset admin allow-list as nobody", () => {
  assert.deepEqual(parseAdminPhones(undefined), []);
  assert.equal(isAdminPhone("9876543210", parseAdminPhones("")), false);
});
