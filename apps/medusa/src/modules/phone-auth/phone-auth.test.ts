/**
 * Unit tests for the phone-otp auth provider, run exactly like
 * boot-guards.test.ts:
 *
 *   node --test --experimental-strip-types src/modules/phone-auth/phone-auth.test.ts
 *
 * The provider is exercised against an in-memory AuthIdentityProviderService
 * that mimics the auth module's semantics (retrieve throws a `not_found`
 * MedusaError shape, update replaces provider_metadata wholesale). The
 * behaviors asserted here are the Fastify OTP contract from
 * apps/api/src/api.test.ts, ported test for test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { OTP_TTL_SECONDS } from "@siumora/core";
import type { OtpSender } from "@siumora/messaging" with { "resolution-mode": "import" };
import type { AuthIdentityProviderService } from "@medusajs/framework/types";

import { issueChallenge, judgeChallenge, type OtpChallengeState } from "./challenge.ts";
import {
  PhoneOtpAuthService,
  type PhoneOtpAuthenticationResponse,
} from "./service.ts";

// ── Harness ───────────────────────────────────────────────────

interface StoredIdentity {
  entity_id: string;
  provider_metadata: Record<string, unknown>;
}

/** In-memory stand-in for the injected AuthIdentityProviderService. */
function fakeIdentityStore() {
  const identities = new Map<string, StoredIdentity>();

  const notFound = (entityId: string) =>
    Object.assign(
      new Error(`AuthIdentity with entity_id "${entityId}" not found`),
      { type: "not_found" },
    );

  const toDto = (row: StoredIdentity) => ({
    id: `authid_${row.entity_id}`,
    provider_identities: [
      {
        id: `pid_${row.entity_id}`,
        provider: "phone-otp",
        entity_id: row.entity_id,
        provider_metadata: structuredClone(row.provider_metadata),
      },
    ],
  });

  const service = {
    retrieve: async ({ entity_id }: { entity_id: string }) => {
      const row = identities.get(entity_id);
      if (!row) throw notFound(entity_id);
      return toDto(row);
    },
    create: async (data: {
      entity_id: string;
      provider_metadata?: Record<string, unknown>;
    }) => {
      const row: StoredIdentity = {
        entity_id: data.entity_id,
        provider_metadata: structuredClone(data.provider_metadata ?? {}),
      };
      identities.set(data.entity_id, row);
      return toDto(row);
    },
    // The real module replaces provider_metadata wholesale on update; the
    // provider spreads the previous metadata itself.
    update: async (
      entity_id: string,
      data: { provider_metadata?: Record<string, unknown> },
    ) => {
      const row = identities.get(entity_id);
      if (!row) throw notFound(entity_id);
      if (data.provider_metadata) {
        row.provider_metadata = structuredClone(data.provider_metadata);
      }
      return toDto(row);
    },
    // Faithful to a no-cache-module deployment — the reason challenge state
    // lives in provider_metadata rather than setState/getState.
    setState: async () => {
      throw new Error("Cache module dependency is required");
    },
    getState: async () => {
      throw new Error("Cache module dependency is required");
    },
  };

  return {
    identities,
    service: service as unknown as AuthIdentityProviderService,
  };
}

/** Echo-mode provider over an empty transport — hermetic, no env leakage. */
function echoService() {
  return new PhoneOtpAuthService({}, { otpEcho: true, transport: {} });
}

function plugSender(
  service: PhoneOtpAuthService,
  sender: OtpSender | undefined,
) {
  (service as unknown as { sender_?: OtpSender }).sender_ = sender;
}

type Response = PhoneOtpAuthenticationResponse;

async function requestCode(
  service: PhoneOtpAuthService,
  ids: AuthIdentityProviderService,
  phone: string,
): Promise<Response> {
  return (await service.authenticate({ body: { phone } }, ids)) as Response;
}

async function verifyCode(
  service: PhoneOtpAuthService,
  ids: AuthIdentityProviderService,
  phone: string,
  code: string,
): Promise<Response> {
  return (await service.authenticate({ body: { phone, code } }, ids)) as Response;
}

/** The stored challenge blob for a number — the tests' clock seam. */
function storedOtp(
  identities: Map<string, StoredIdentity>,
  phone: string,
): Record<string, unknown> {
  const row = identities.get(phone);
  assert.ok(row, `no identity stored for ${phone}`);
  return row.provider_metadata.otp as Record<string, unknown>;
}

// ── Challenge issue + echo ────────────────────────────────────

test("issues a six-digit code with the core TTL and echoes it under OTP_ECHO", async () => {
  const { service: ids } = fakeIdentityStore();
  const before = Date.now();
  const response = await requestCode(echoService(), ids, "9812345678");

  assert.equal(response.success, true);
  assert.equal(response.location, "phone-otp:challenge");
  assert.ok(response.otp);
  assert.match(response.otp.code ?? "", /^\d{6}$/);
  assert.equal(response.otp.maskedPhone, "98••••5678");
  assert.equal(response.otp.delivery, "not_configured");

  const ttlMs = new Date(response.otp.expiresAt).getTime() - before;
  assert.ok(
    ttlMs > (OTP_TTL_SECONDS - 5) * 1000 && ttlMs <= OTP_TTL_SECONDS * 1000 + 5000,
    `expiry ${ttlMs}ms should be the core OTP_TTL_SECONDS`,
  );
});

test("does not echo the code without the explicit development flag", async () => {
  const { service: ids } = fakeIdentityStore();
  const service = new PhoneOtpAuthService({}, { otpEcho: false, transport: {} });
  plugSender(service, { channel: "sms", send: async () => ({ ok: true }) });

  const response = await requestCode(service, ids, "9812345678");

  assert.equal(response.success, true);
  assert.equal(response.otp?.delivery, "sent");
  assert.equal(response.otp?.code, undefined);
});

test("refuses sign-in when no channel is configured and echo is off", async () => {
  const { service: ids, identities } = fakeIdentityStore();
  const service = new PhoneOtpAuthService({}, { otpEcho: false, transport: {} });

  const response = await requestCode(service, ids, "9812345678");

  assert.equal(response.success, false);
  assert.equal(response.errorCode, "sign_in_unavailable");
  // Refusal happens before anything is issued or stored.
  assert.equal(identities.size, 0);
});

test("a failing send is reported and the code stays valid", async () => {
  const { service: ids } = fakeIdentityStore();
  const service = echoService();
  plugSender(service, {
    channel: "sms",
    send: async () => ({ ok: false, error: "provider down" }),
  });

  const issued = await requestCode(service, ids, "9812345678");
  assert.equal(issued.otp?.delivery, "send_failed");

  const verified = await verifyCode(service, ids, "9812345678", issued.otp!.code!);
  assert.equal(verified.success, true);
});

// ── Verify: the sign-in path ──────────────────────────────────

test("signs in with a code and returns the identity for the normalized phone", async () => {
  const { service: ids } = fakeIdentityStore();
  const service = echoService();

  const issued = await requestCode(service, ids, "9812345678");
  const verified = await verifyCode(service, ids, "9812345678", issued.otp!.code!);

  assert.equal(verified.success, true);
  const providerIdentity = verified.authIdentity!.provider_identities![0]!;
  assert.equal(providerIdentity.entity_id, "9812345678");
  // The challenge blob (code hash, counters) never leaves the module.
  assert.equal(providerIdentity.provider_metadata?.otp, undefined);
});

test("accepts a number however it is typed and keeps one identity", async () => {
  const { service: ids, identities } = fakeIdentityStore();
  const service = echoService();

  const issued = await requestCode(service, ids, "+91 98123 45678");
  const verified = await verifyCode(service, ids, "98123-45678", issued.otp!.code!);

  assert.equal(verified.success, true);
  assert.equal(identities.size, 1);
  assert.ok(identities.has("9812345678"));
});

test("rejects a number that is not an Indian mobile before issuing anything", async () => {
  const { service: ids, identities } = fakeIdentityStore();
  const response = await requestCode(echoService(), ids, "1234567890");

  assert.equal(response.success, false);
  assert.equal(response.errorCode, "invalid_phone");
  assert.equal(identities.size, 0);
});

// ── Anti-abuse: attempts, lockout, replay, invalidation ───────

test("refuses a wrong code and counts the attempt down", async () => {
  const { service: ids } = fakeIdentityStore();
  const service = echoService();

  const issued = await requestCode(service, ids, "9812345679");
  const wrong = issued.otp!.code === "000000" ? "111111" : "000000";
  const response = await verifyCode(service, ids, "9812345679", wrong);

  assert.equal(response.success, false);
  assert.equal(response.errorCode, "wrong_code");
  assert.equal(response.attemptsRemaining, 4);
});

test("locks a code after five wrong guesses", async () => {
  const { service: ids } = fakeIdentityStore();
  const service = echoService();

  const issued = await requestCode(service, ids, "9812345670");
  // Deliberately never the real code, so the lock is what stops it.
  const wrong = issued.otp!.code === "000000" ? "111111" : "000000";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await verifyCode(service, ids, "9812345670", wrong);
  }

  // Even the right code no longer works: otherwise the limit is decorative.
  const correct = await verifyCode(service, ids, "9812345670", issued.otp!.code!);
  assert.equal(correct.success, false);
  assert.equal(correct.errorCode, "code_unusable");
});

test("will not let one code sign in twice", async () => {
  const { service: ids } = fakeIdentityStore();
  const service = echoService();

  const issued = await requestCode(service, ids, "9812345671");
  const first = await verifyCode(service, ids, "9812345671", issued.otp!.code!);
  const replay = await verifyCode(service, ids, "9812345671", issued.otp!.code!);

  assert.equal(first.success, true);
  assert.equal(replay.success, false);
  assert.equal(replay.errorCode, "code_unusable");
});

test("throttles a second code to the same number", async () => {
  const { service: ids } = fakeIdentityStore();
  const service = echoService();

  await requestCode(service, ids, "9812345672");
  const again = await requestCode(service, ids, "9812345672");

  assert.equal(again.success, false);
  assert.equal(again.errorCode, "rate_limited");
  assert.ok((again.retryAfterSeconds ?? 0) > 0);
});

test("requesting a new code invalidates the previous", async () => {
  const { service: ids, identities } = fakeIdentityStore();
  const service = echoService();

  const first = await requestCode(service, ids, "9812345673");

  // Age the send history past the 45s resend cooldown — the tests' clock
  // seam is the stored state, since the provider reads the real clock.
  const otp = storedOtp(identities, "9812345673");
  otp.sent_at = [new Date(Date.now() - 46_000).toISOString()];

  const second = await requestCode(service, ids, "9812345673");
  assert.equal(second.success, true);

  // The single challenge slot means the old code is judged against the new
  // hash and refused; only the fresh code signs in.
  const stale = await verifyCode(service, ids, "9812345673", first.otp!.code!);
  assert.equal(stale.success, false);

  const fresh = await verifyCode(service, ids, "9812345673", second.otp!.code!);
  assert.equal(fresh.success, true);
});

test("an expired code cannot verify", async () => {
  const { service: ids, identities } = fakeIdentityStore();
  const service = echoService();

  const issued = await requestCode(service, ids, "9812345674");
  const otp = storedOtp(identities, "9812345674");
  otp.expires_at = new Date(Date.now() - 1000).toISOString();

  const response = await verifyCode(service, ids, "9812345674", issued.otp!.code!);
  assert.equal(response.success, false);
  assert.equal(response.errorCode, "code_unusable");
});

test("rejects a malformed code without consuming an attempt", async () => {
  const { service: ids } = fakeIdentityStore();
  const service = echoService();

  const issued = await requestCode(service, ids, "9812345675");
  const malformed = await verifyCode(service, ids, "9812345675", "12345");
  assert.equal(malformed.success, false);
  assert.equal(malformed.errorCode, "invalid_code");

  // All five attempts are still there — the malformed guess cost nothing.
  const wrong = issued.otp!.code === "000000" ? "111111" : "000000";
  const counted = await verifyCode(service, ids, "9812345675", wrong);
  assert.equal(counted.attemptsRemaining, 4);
});

test("never stores the code in the clear", async () => {
  const { service: ids, identities } = fakeIdentityStore();
  const issued = await requestCode(echoService(), ids, "9812345676");

  const otp = storedOtp(identities, "9812345676");
  assert.equal(typeof otp.code_hash, "string");
  assert.ok(!(otp.code_hash as string).includes(issued.otp!.code!));
  // Nothing else in the stored state carries the code either.
  assert.equal(otp.code, undefined);
});

// ── Register and options ──────────────────────────────────────

test("register runs the same two-step flow", async () => {
  const { service: ids } = fakeIdentityStore();
  const service = echoService();

  const issued = (await service.register(
    { body: { phone: "9812345677" } },
    ids,
  )) as Response;
  assert.equal(issued.success, true);
  assert.match(issued.otp?.code ?? "", /^\d{6}$/);

  const verified = (await service.register(
    { body: { phone: "9812345677", code: issued.otp!.code! } },
    ids,
  )) as Response;
  assert.equal(verified.success, true);
});

test("validateOptions refuses OTP_ECHO in production", () => {
  assert.throws(
    () =>
      PhoneOtpAuthService.validateOptions({
        otpEcho: true,
        appEnv: "production",
      }),
    /OTP_ECHO must not be set in production/,
  );
  // Anywhere below production it is an ordinary development convenience.
  PhoneOtpAuthService.validateOptions({ otpEcho: true, appEnv: "development" });
});

// ── Challenge math (pure, with an explicit clock) ─────────────

test("issueChallenge refuses a sixth code inside the window and says how long to wait", async () => {
  const now = new Date("2026-07-31T10:00:00Z");
  let state: OtpChallengeState | undefined;

  for (let send = 0; send < 5; send += 1) {
    const at = new Date(now.getTime() + send * 60_000);
    const outcome = await issueChallenge(state, at);
    assert.equal(outcome.allowed, true);
    if (outcome.allowed) state = outcome.state;
  }

  const sixth = await issueChallenge(state, new Date(now.getTime() + 5 * 60_000));
  assert.equal(sixth.allowed, false);
  if (!sixth.allowed) assert.ok(sixth.retryAfterSeconds > 0);
});

test("issueChallenge trims send history older than the window", async () => {
  const past = new Date("2026-07-31T08:00:00Z");
  const first = await issueChallenge(undefined, past);
  assert.equal(first.allowed, true);

  // Two hours later the old send has aged out of the 1h window entirely.
  const later = new Date("2026-07-31T10:00:00Z");
  const next = await issueChallenge(
    first.allowed ? first.state : undefined,
    later,
  );
  assert.equal(next.allowed, true);
  if (next.allowed) {
    assert.deepEqual(next.state.sent_at, [later.toISOString()]);
  }
});

test("judgeChallenge refuses a correct code once the TTL has passed", async () => {
  const now = new Date("2026-07-31T10:00:00Z");
  const issued = await issueChallenge(undefined, now);
  assert.equal(issued.allowed, true);
  if (!issued.allowed) return;

  const afterTtl = new Date(now.getTime() + (OTP_TTL_SECONDS + 1) * 1000);
  const verdict = await judgeChallenge(issued.state, issued.code, afterTtl);
  assert.equal(verdict.status, "expired");

  const inTime = new Date(now.getTime() + 1000);
  const good = await judgeChallenge(issued.state, issued.code, inTime);
  assert.equal(good.status, "verified");
  assert.equal(good.state?.consumed_at, inTime.toISOString());
});
