/**
 * Phone-OTP as a Medusa auth module provider (design doc M1: "Phone-OTP auth
 * as a Medusa auth provider reusing packages/messaging's OTP sender").
 *
 * The Fastify stack's OTP contract (apps/api/src/routes/auth.ts) is the bar:
 * 6-digit code, core TTL, five wrong guesses locks the code, a consumed code
 * never signs in twice, a new code invalidates the previous one, OTP_ECHO
 * returns the code only under the explicit development flag, and phone
 * normalization keeps one customer per number however it is typed.
 *
 * ── The two-step authenticate ────────────────────────────────────────────
 * Medusa auth providers get one `authenticate` entry point, so both steps
 * ride through it, split on the body:
 *
 *   { phone }        → REQUEST: issue + store a challenge, send the code via
 *                      packages/messaging's ordered channel (WhatsApp when
 *                      approved, else DLT SMS), echo it under OTP_ECHO=true.
 *                      Returns success with `location` set (the framework's
 *                      "auth continues elsewhere" signal — the built-in route
 *                      turns it into 200 {location}) plus an `otp` payload
 *                      that the custom store route surfaces in full.
 *   { phone, code }  → VERIFY: judge the code; on success returns the auth
 *                      identity whose entity_id is the normalized 10-digit
 *                      phone — the built-in route then issues the JWT.
 *
 * Neither step reveals whether a number already has an account (the same
 * enumeration stance as the Fastify routes): every failure to verify is one
 * of two messages, wrong-code or code-unusable.
 *
 * ── Challenge storage: provider_metadata, not a table ────────────────────
 * Challenge state lives in the provider identity's `provider_metadata`
 * (the auth module's own `provider_identity` JSONB column), via the
 * AuthIdentityProviderService the framework injects — the same place
 * emailpass keeps its password hashes. Decision record:
 *
 * - The framework offers exactly two provider-scoped stores: this metadata,
 *   and setState/getState. The latter throws without a cache module
 *   configured (verified in @medusajs/auth's auth-module.js) and dev runs
 *   with no Redis, so it is out.
 * - An own table would need a second custom module (module providers do not
 *   own migration chains, and Medusa's module isolation bars a provider from
 *   another module's services), doubling the registration surface for one
 *   small JSON blob.
 * - One metadata slot per phone gives "a new code invalidates the previous"
 *   for free, and the send history rides along for the resend throttle.
 *
 * Known deltas from the Fastify implementation, accepted and on record:
 * - No SELECT ... FOR UPDATE around the attempt counter: metadata updates are
 *   read-modify-write, so truly parallel wrong guesses could each read the
 *   same attempts value. The scrypt cost (~0.1s/guess) and the 5-guess lid
 *   keep this out of brute-force territory; the Fastify row lock remains the
 *   stricter implementation.
 * - The per-IP send cap (20/hour across all numbers) is not portable into a
 *   provider — it needs a cross-identity query the injected service does not
 *   offer. That control belongs to the transport in front of the auth route:
 *   src/lib/rate-limit.ts holds both steps to 10/min per IP in one shared
 *   (Redis) bucket; the hourly per-IP cap is auth plan phase 1.
 *
 * The limits themselves (TTL, cooldown, codes per window, guesses) are
 * core's OtpPolicy, read from siumora_settings so an operator can tighten
 * them mid-attack — see policy_().
 */

import {
  AbstractAuthModuleProvider,
  MedusaError,
} from "@medusajs/framework/utils";
import type {
  AuthenticationInput,
  AuthenticationResponse,
  AuthIdentityDTO,
  AuthIdentityProviderService,
  Logger,
} from "@medusajs/framework/types";

// Runtime: the M0 dist refactor's require condition (dist/*.cjs). The
// @ts-ignore mutes TS1479 (ESM-flavored types on a require import) — a
// packages/* exports-map concern shared app-wide, not a runtime one.
// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { DEFAULT_OTP_POLICY, maskPhone, normalisePhone, type OtpPolicy } from "@siumora/core";
// prettier-ignore -- single line so @ts-ignore reaches the specifier
// @ts-ignore -- TS1479 until @siumora/messaging ships require-condition types
import { createOtpSender, type OtpChannel, type OtpSender, type TransportEnv } from "@siumora/messaging";

import { readSettings, type SqlClient } from "../settings/read.ts";
import {
  createSettingsCache,
  otpPolicyOf,
  type SettingsReader,
} from "../settings/settings.ts";
import {
  isOtpCodeShape,
  issueChallenge,
  judgeChallenge,
  readChallengeState,
} from "./challenge.ts";

export interface PhoneOtpAuthOptions {
  /**
   * Echo the issued code in the request-step payload. Development only —
   * validateOptions refuses it in production (ported from apps/api's
   * app.ts boot guard).
   */
  otpEcho?: boolean;
  /** APP_ENV mirror, so the echo guard can tell production from dev. */
  appEnv?: string;
  /**
   * Credentials for packages/messaging's ordered channel resolution
   * (WhatsApp template when approved, else MSG91 DLT SMS). Defaults to
   * process.env, which carries the same variable names.
   */
  transport?: TransportEnv;
  /** Test hook: overrides the code lifetime whatever the policy says. */
  ttlSeconds?: number;
}

/** The request step's payload, surfaced verbatim by the custom store route. */
export interface PhoneOtpChallengeDetails {
  readonly maskedPhone: string;
  readonly expiresAt: string;
  readonly delivery: "sent" | "send_failed" | "not_configured";
  /** The channel that delivered (or was last tried); absent when nothing sent. */
  readonly channel?: OtpChannel;
  /** Every channel this environment can send on — the storefront offers
   *  "Send by SMS instead" only when SMS is one of them. */
  readonly channels: readonly OtpChannel[];
  /** Present only under the explicit development echo flag. */
  readonly code?: string;
}

/**
 * AuthenticationResponse plus the fields this provider adds. Extra fields
 * ride through AuthModuleService.authenticate untouched (it returns the
 * provider's object as-is on non-MFA paths), so the custom store route can
 * read them; the built-in auth route simply ignores them.
 */
export type PhoneOtpAuthenticationResponse = AuthenticationResponse & {
  /** Machine-readable refusal, mirroring the Fastify error taxonomy. */
  errorCode?:
    | "invalid_phone"
    | "invalid_code"
    | "sign_in_unavailable"
    | "rate_limited"
    | "wrong_code"
    | "code_unusable";
  retryAfterSeconds?: number;
  attemptsRemaining?: number;
  otp?: PhoneOtpChallengeDetails;
};

type InjectedDependencies = {
  logger?: Logger;
  /**
   * The shared knex connection (ContainerRegistrationKeys.PG_CONNECTION),
   * which Medusa registers in every module's container. Used for one thing:
   * reading the sign-in limits out of siumora_settings. Module isolation
   * bars this provider from the settings module's *service*, not from the
   * table — the read is the same raw SELECT the store routes run
   * (settings/read.ts), so there is one registry and one validation.
   */
  __pg_connection__?: SqlClient;
};

/** One message for every unusable-code mode — expired, consumed, locked,
 *  or never issued. Distinguishing them tells an attacker which half of the
 *  problem to work on (the Fastify routes collapse them the same way). */
const CODE_UNUSABLE = "That code has expired. Ask for a new one.";

export class PhoneOtpAuthService extends AbstractAuthModuleProvider {
  static identifier = "phone-otp";
  static DISPLAY_NAME = "Phone OTP";

  protected readonly options_: PhoneOtpAuthOptions;
  protected readonly logger_?: Logger;
  protected readonly container_: InjectedDependencies;
  protected sender_?: OtpSender;
  protected settings_?: SettingsReader;

  static validateOptions(options: Record<string, unknown>): void {
    if (options?.otpEcho === true && options?.appEnv === "production") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "OTP_ECHO must not be set in production — it returns sign-in codes to the caller.",
      );
    }
  }

  constructor(container: InjectedDependencies, options: PhoneOtpAuthOptions = {}) {
    super();
    this.options_ = options;
    this.container_ = container ?? {};
    this.logger_ = container?.logger;
    // Channel resolution happens once, here — WhatsApp when its template is
    // approved, else DLT SMS, else undefined (refuse or echo, below).
    this.sender_ = createOtpSender(
      options.transport ?? (process.env as TransportEnv),
    );
  }

  async authenticate(
    data: AuthenticationInput,
    authIdentityProviderService: AuthIdentityProviderService,
  ): Promise<AuthenticationResponse> {
    const body = (data.body ?? {}) as Record<string, unknown>;

    const rawPhone = typeof body.phone === "string" ? body.phone : "";
    const phone = normalisePhone(rawPhone);
    if (!phone) {
      return this.fail_({
        errorCode: "invalid_phone",
        error: "Enter a 10-digit Indian mobile number.",
      });
    }

    const code = typeof body.code === "string" ? body.code : "";
    // Delivery hints from the store route (src/api/store/siumora-auth/otp):
    // the customer's channel choice, and whether the day's SMS budget
    // still has room. Only that route reaches this provider's request step —
    // the built-in /auth/customer/phone-otp route is closed in middlewares.ts.
    const prefer = body.channel === "sms" || body.channel === "whatsapp" ? body.channel : undefined;
    const allowSms = body.allowSms !== false && body.allowSms !== "false";
    return code === ""
      ? this.requestCode_(phone, authIdentityProviderService, { prefer, allowSms })
      : this.verifyCode_(phone, code, authIdentityProviderService);
  }

  /**
   * Registration is not a separate act for phone sign-in: verifying a code
   * upserts the identity, exactly like the Fastify upsertCustomer. The
   * /register route therefore runs the same two steps.
   */
  async register(
    data: AuthenticationInput,
    authIdentityProviderService: AuthIdentityProviderService,
  ): Promise<AuthenticationResponse> {
    return this.authenticate(data, authIdentityProviderService);
  }

  /** Step one: issue a challenge and send (or echo) the code. */
  protected async requestCode_(
    phone: string,
    authIdentityProviderService: AuthIdentityProviderService,
    delivery_: { prefer?: OtpChannel; allowSms?: boolean } = {},
  ): Promise<AuthenticationResponse> {
    if (!this.sender_ && this.options_.otpEcho !== true) {
      // No approved messaging channel and no explicit development echo.
      // Refusing is the honest answer: issuing a code nobody can receive
      // would look like sign-in working and fail at the second step forever.
      return this.fail_({
        errorCode: "sign_in_unavailable",
        error: "Sign-in is not connected in this environment yet.",
      });
    }

    const now = new Date();

    let identity: AuthIdentityDTO | undefined;
    try {
      identity = await authIdentityProviderService.retrieve({ entity_id: phone });
    } catch (error) {
      if (!isNotFound(error)) {
        return this.fail_({ error: messageOf(error) });
      }
    }

    const existingMetadata = this.providerMetadataOf_(identity);
    const policy = await this.policy_();
    const issued = await issueChallenge(
      readChallengeState(existingMetadata),
      now,
      this.options_.ttlSeconds === undefined
        ? policy
        : { ...policy, ttlSeconds: this.options_.ttlSeconds },
    );

    if (!issued.allowed) {
      return this.fail_({
        errorCode: "rate_limited",
        error: issued.reason,
        retryAfterSeconds: issued.retryAfterSeconds,
      });
    }

    // Persist the challenge — the single otp slot replaces any previous one.
    const provider_metadata = { ...existingMetadata, otp: issued.state };
    try {
      if (identity) {
        await authIdentityProviderService.update(phone, { provider_metadata });
      } else {
        // First contact from this number. The identity is created bare (no
        // app_metadata), which Medusa treats as claimable — the customer
        // actor is attached by the framework after the verify step.
        await authIdentityProviderService.create({
          entity_id: phone,
          provider_metadata,
        });
      }
    } catch (error) {
      return this.fail_({ error: messageOf(error) });
    }

    // Synchronous, in the request — nobody waits at a sign-in form for an
    // outbox poll. A failed send is loud in the log (a failing OTP channel
    // is every sign-in on the site) but the code stays valid for a retry.
    let delivery: PhoneOtpChallengeDetails["delivery"] = "not_configured";
    let channel: OtpChannel | undefined;
    if (this.sender_) {
      const outcome = await this.sender_.send(phone, issued.code, {
        ...(delivery_.prefer ? { prefer: delivery_.prefer } : {}),
        allowSms: delivery_.allowSms !== false,
      });
      delivery = outcome.ok ? "sent" : "send_failed";
      channel = outcome.channel;
      if (!outcome.ok) {
        this.logger_?.error?.(`phone-otp send failed: ${outcome.error ?? "unknown"}`);
      } else if (outcome.fellBack) {
        this.logger_?.warn?.(`phone-otp fell back to ${outcome.channel}`);
      }
    }

    const response: PhoneOtpAuthenticationResponse = {
      // `location` is the framework's "authentication continues elsewhere"
      // signal: the built-in route answers 200 {location} instead of minting
      // a token. The custom store route reads the full `otp` payload.
      success: true,
      location: "phone-otp:challenge",
      otp: {
        maskedPhone: maskPhone(phone),
        expiresAt: issued.expiresAt.toISOString(),
        delivery,
        ...(channel ? { channel } : {}),
        channels: this.sender_?.channels ?? [],
        // Echoed only under the explicit development flag, never merely
        // because a provider happens to be missing.
        ...(this.options_.otpEcho === true ? { code: issued.code } : {}),
      },
    };
    return response;
  }

  /** Step two: judge the code and hand back the identity for the phone. */
  protected async verifyCode_(
    phone: string,
    code: string,
    authIdentityProviderService: AuthIdentityProviderService,
  ): Promise<AuthenticationResponse> {
    if (!isOtpCodeShape(code)) {
      // Malformed input is refused before the challenge is touched — the
      // Fastify schema does the same — so it never costs an attempt.
      return this.fail_({
        errorCode: "invalid_code",
        error: "Enter the 6-digit code.",
      });
    }

    let identity: AuthIdentityDTO;
    try {
      identity = await authIdentityProviderService.retrieve({ entity_id: phone });
    } catch (error) {
      if (isNotFound(error)) {
        // No challenge was ever issued for this number. Same message as an
        // expired code: nothing here confirms whether a number is known.
        return this.fail_({ errorCode: "code_unusable", error: CODE_UNUSABLE });
      }
      return this.fail_({ error: messageOf(error) });
    }

    const existingMetadata = this.providerMetadataOf_(identity);
    const judged = await judgeChallenge(
      readChallengeState(existingMetadata),
      code,
      new Date(),
      await this.policy_(),
    );

    // Persist the consequences (attempt counted, or code consumed) before
    // answering — a replay must find the consumed_at already written.
    if (judged.state) {
      try {
        identity = await authIdentityProviderService.update(phone, {
          provider_metadata: { ...existingMetadata, otp: judged.state },
        });
      } catch (error) {
        return this.fail_({ error: messageOf(error) });
      }
    }

    if (judged.status === "verified") {
      return { success: true, authIdentity: this.sanitizeIdentity_(identity) };
    }

    if (judged.status === "mismatch") {
      return this.fail_({
        errorCode: "wrong_code",
        error: "That code is not right.",
        attemptsRemaining: judged.attemptsRemaining,
      });
    }

    // expired | consumed | locked | not_found — one indistinguishable answer.
    return this.fail_({ errorCode: "code_unusable", error: CODE_UNUSABLE });
  }

  /**
   * The sign-in limits in force: siumora_settings over core's defaults,
   * cached for the settings TTL (30s) so a send costs no extra query.
   *
   * A failed read answers with the defaults rather than refusing sign-in:
   * the defaults are the shipped limits, and a settings outage must not take
   * every customer's sign-in down with it. With no connection at all (unit
   * tests, a container without Postgres) the defaults apply directly.
   */
  protected async policy_(): Promise<OtpPolicy> {
    if (!this.settings_) {
      // Resolved on first use, not in the constructor: the container entry
      // is a lazy resolver, and boot order is the framework's business.
      const pg = this.container_.__pg_connection__;
      if (!pg) return DEFAULT_OTP_POLICY;
      this.settings_ = createSettingsCache(() => readSettings(pg));
    }
    try {
      return otpPolicyOf(await this.settings_.get());
    } catch (error) {
      this.logger_?.warn?.(
        `phone-otp: could not read sign-in limits, using defaults: ${messageOf(error)}`,
      );
      return DEFAULT_OTP_POLICY;
    }
  }

  protected providerMetadataOf_(
    identity: AuthIdentityDTO | undefined,
  ): Record<string, unknown> {
    const providerIdentity = identity?.provider_identities?.find(
      (entry) => entry.provider === this.provider,
    );
    return { ...(providerIdentity?.provider_metadata ?? {}) };
  }

  /** The challenge blob (code hash, counters) never leaves the module. */
  protected sanitizeIdentity_(identity: AuthIdentityDTO): AuthIdentityDTO {
    const copy = JSON.parse(JSON.stringify(identity)) as AuthIdentityDTO;
    const providerIdentity = copy.provider_identities?.find(
      (entry) => entry.provider === this.provider,
    );
    if (providerIdentity?.provider_metadata) {
      delete providerIdentity.provider_metadata.otp;
    }
    return copy;
  }

  protected fail_(
    fields: Omit<PhoneOtpAuthenticationResponse, "success">,
  ): AuthenticationResponse {
    const response: PhoneOtpAuthenticationResponse = {
      success: false,
      ...fields,
    };
    return response;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { type?: string }).type === MedusaError.Types.NOT_FOUND
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
