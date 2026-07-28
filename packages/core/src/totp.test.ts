import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RECOVERY_CODE_COUNT,
  STEP_UP_TTL_SECONDS,
  TOTP_DIGITS,
  TOTP_DRIFT_STEPS,
  TOTP_STEP_SECONDS,
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  normaliseRecoveryCode,
  otpauthUri,
  stepFor,
  stepUpValid,
  totpCode,
  totpCodeAtStep,
  verifyTotp,
} from "./totp.ts";

/**
 * RFC 6238 publishes test vectors against the ASCII secret "12345678901234567890"
 * with SHA-1. Base32 of those twenty bytes is GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ —
 * checking against the standard's own numbers is the only way to know this
 * implementation agrees with every authenticator app rather than merely with
 * itself.
 */
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

test("matches the RFC 6238 test vectors", () => {
  // The published SHA-1 vectors, truncated to six digits.
  const vectors: Array<[number, string]> = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ];

  for (const [seconds, expected] of vectors) {
    assert.equal(
      totpCode(RFC_SECRET, new Date(seconds * 1000)),
      expected,
      `t=${seconds}`,
    );
  }
});

test("base32 round-trips arbitrary bytes", () => {
  for (const bytes of [[0], [255], [1, 2, 3], [0, 0, 0, 0, 0], [7, 200, 91, 3, 44, 199]]) {
    const buffer = Buffer.from(bytes);
    assert.deepEqual([...base32Decode(base32Encode(buffer))], bytes);
  }
});

test("accepts a secret the way an app hands it back", () => {
  // People paste with spaces, hyphens and padding depending on where they
  // copied it from. Refusing those is a support ticket, not security.
  const secret = generateTotpSecret();
  const spaced = secret.replace(/(.{4})/g, "$1 ").trim();

  assert.equal(
    totpCode(spaced, new Date(1_700_000_000_000)),
    totpCode(secret, new Date(1_700_000_000_000)),
  );
  assert.equal(base32Decode(`${secret}==`).length, 20);
});

test("refuses base32 that is not", () => {
  assert.throws(() => base32Decode("0189"), RangeError);
});

test("generates a full-entropy secret", () => {
  const secret = generateTotpSecret();
  assert.equal(base32Decode(secret).length, 20, "160 bits, per RFC 4226");
  assert.notEqual(secret, generateTotpSecret());
});

test("accepts the code from a clock that drifted a little", () => {
  const secret = generateTotpSecret();
  const now = new Date(1_700_000_000_000);
  const previous = totpCodeAtStep(secret, stepFor(now) - 1);

  // A phone's clock drifts and a person takes a moment to type.
  assert.equal(verifyTotp(secret, previous, { at: now }).valid, true);

  const distant = totpCodeAtStep(secret, stepFor(now) - 5);
  assert.equal(verifyTotp(secret, distant, { at: now }).valid, false);
  assert.equal(TOTP_DRIFT_STEPS, 1, "each extra step is another live code");
});

test("refuses a code that has already been spent", () => {
  // This is what makes it one-time rather than thirty-seconds-long. Without it,
  // reading the code over a shoulder grants access twice.
  const secret = generateTotpSecret();
  const now = new Date(1_700_000_000_000);
  const code = totpCode(secret, now);

  const first = verifyTotp(secret, code, { at: now });
  assert.equal(first.valid, true);

  const again = verifyTotp(secret, code, {
    at: now,
    lastUsedStep: first.valid ? first.step : 0,
  });
  assert.equal(again.valid, false);
  assert.equal(again.valid === false && again.reason, "replayed");
});

test("refuses an older code once a newer one has been used", () => {
  // The drift window would otherwise re-open a code from the previous step
  // after the current one was spent.
  const secret = generateTotpSecret();
  const now = new Date(1_700_000_000_000);
  const step = stepFor(now);

  const previous = totpCodeAtStep(secret, step - 1);
  const result = verifyTotp(secret, previous, { at: now, lastUsedStep: step });
  assert.equal(result.valid, false);
  assert.equal(result.valid === false && result.reason, "replayed");
});

test("tells a wrong code from a malformed one", () => {
  const secret = generateTotpSecret();
  const now = new Date(1_700_000_000_000);

  assert.equal(verifyTotp(secret, "000000", { at: now }).valid, false);
  for (const bad of ["12345", "1234567", "abcdef", ""]) {
    const result = verifyTotp(secret, bad, { at: now });
    assert.equal(result.valid === false && result.reason, "malformed", bad);
  }
});

test("ignores the spaces an app puts in the middle of a code", () => {
  const secret = generateTotpSecret();
  const now = new Date(1_700_000_000_000);
  const code = totpCode(secret, now);

  assert.equal(
    verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, { at: now }).valid,
    true,
  );
});

test("builds a URI an authenticator app can read", () => {
  const uri = otpauthUri({ secret: "ABCDEFGH", account: "9000000001" });

  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /secret=ABCDEFGH/);
  // Twice on purpose: older apps read the label prefix, newer ones the
  // parameter, and "Unknown account" tells an operator nothing.
  assert.match(uri, /Siumora%3A9000000001/);
  assert.match(uri, /issuer=Siumora/);
  assert.match(uri, new RegExp(`digits=${TOTP_DIGITS}`));
  assert.match(uri, new RegExp(`period=${TOTP_STEP_SECONDS}`));
});

test("expires a step-up long before the session it rides on", () => {
  const now = new Date(1_700_000_000_000);
  const fresh = new Date(now.getTime() - 3600_000);
  const stale = new Date(now.getTime() - (STEP_UP_TTL_SECONDS + 60) * 1000);

  assert.equal(stepUpValid(fresh, now), true);
  assert.equal(stepUpValid(stale, now), false);
  // Never verified is not the same as verified long ago, but both are refused.
  assert.equal(stepUpValid(null, now), false);
  assert.equal(stepUpValid(undefined, now), false);

  // The session lasts thirty days, which is exactly why this cannot ride along
  // with it.
  assert.ok(STEP_UP_TTL_SECONDS < 30 * 86400);
});

test("issues recovery codes for the phone that fell in a river", () => {
  const codes = generateRecoveryCodes();

  assert.equal(codes.length, RECOVERY_CODE_COUNT);
  assert.equal(new Set(codes).size, RECOVERY_CODE_COUNT, "all distinct");
  for (const code of codes) assert.match(code, /^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
});

test("takes a recovery code however it was typed back", () => {
  const [code] = generateRecoveryCodes(1);
  const typed = ` ${(code as string).toLowerCase().replace("-", " ")} `;
  assert.equal(normaliseRecoveryCode(typed), normaliseRecoveryCode(code as string));
});
