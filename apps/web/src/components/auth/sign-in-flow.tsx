"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { mintEventId, track } from "@siumora/analytics/client";
import { maskPhone, normalisePhone } from "@siumora/core/auth";
import type { OtpChannel } from "@siumora/sdk";
import { Button, MicroLabel } from "@siumora/ui";

import {
  confirmStepUp,
  requestCode,
  requestStepUpCode,
  verifyCode,
  type RequestCodeResult,
  type VerifyCodeResult,
} from "@/app/actions/auth";

import { ChannelSwitch } from "./channel-switch";
import { OtpInput } from "./otp-input";
import { PhoneField, tenDigits } from "./phone-field";
import { ResendTimer } from "./resend-timer";
import { TURNSTILE_SITE_KEY, Turnstile } from "./turnstile";

/** The server's default resend cooldown (core OTP_RESEND_COOLDOWN_SECONDS). */
const RESEND_SECONDS = 45;

export interface SignInFlowProps {
  /**
   * `signin` signs a shopper in. `stepup` re-proves the signed-in account's
   * own phone for a sensitive action (StepUpGate) — the number is the
   * account's, read on the server, and only its masked form is shown.
   */
  mode?: "signin" | "stepup";
  /** Where to go after signing in. Ignored when `onDone` is given. */
  next?: string;
  /** Called instead of navigating — the sheet, checkout and step-up use it. */
  onDone?: (result: VerifyCodeResult) => void;
  /** Where sign-in was opened from, for the funnel events. */
  surface?: string;
  /** A number to start with (checkout's delivery phone). */
  initialPhone?: string;
  /** Verify exactly this number — the COD gate verifies the delivery phone. */
  lockPhone?: boolean;
  /** The masked number shown in step-up mode. */
  maskedPhone?: string;
  /** The sign-in A/B arm, carried on every funnel event. */
  variant?: string;
  /** The primary action's words. */
  submitLabel?: string;
}

/**
 * Phone sign-in, in two steps, rebuilt for the auth plan's phase 1:
 * WhatsApp first with "Send by SMS instead", a one-field code that fills
 * itself (iOS/Android keyboards, WebOTP) and submits itself, a visible
 * resend countdown, and Turnstile when it is switched on.
 *
 * The number step never says whether an account exists — a different message
 * for a known number would turn this form into a way to find out who shops
 * here. Both paths look identical up to the code.
 */
export function SignInFlow({
  mode = "signin",
  next = "/account",
  onDone,
  surface = "page",
  initialPhone = "",
  lockPhone = false,
  maskedPhone,
  variant,
  submitLabel,
}: SignInFlowProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState(tenDigits(initialPhone));
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [developmentCode, setDevelopmentCode] = useState<string | null>(null);
  const [channel, setChannel] = useState<OtpChannel | undefined>(undefined);
  const [channels, setChannels] = useState<OtpChannel[]>([]);
  const [sentAt, setSentAt] = useState(0);
  const [blockedFor, setBlockedFor] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);
  const verifying = useRef(false);

  const codeRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  // A refusal with a wait ("too many codes") counts down like the resend.
  useEffect(() => {
    if (blockedFor <= 0) return;
    const timer = setTimeout(() => setBlockedFor((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [blockedFor]);

  const funnel = useCallback(
    (extra: { channel?: OtpChannel | "google" | "unknown" } = {}) => ({
      event_id: mintEventId(),
      channel: extra.channel ?? channel ?? "unknown",
      surface,
      ...(variant ? { variant } : {}),
    }),
    [channel, surface, variant],
  );

  const stepUp = mode === "stepup";
  const phoneValid = stepUp || normalisePhone(phone) !== undefined;
  const challengeReady = !TURNSTILE_SITE_KEY || turnstileToken !== null;

  function send(options: { channel?: OtpChannel; resend?: boolean } = {}) {
    setMessage(null);
    startTransition(async () => {
      const challenge = turnstileToken ?? undefined;
      const request = {
        ...(options.channel ? { channel: options.channel } : {}),
        ...(challenge ? { turnstileToken: challenge } : {}),
      };
      const result: RequestCodeResult = stepUp
        ? await requestStepUpCode(request)
        : await requestCode(phone, request);
      // Turnstile tokens are single-use: every send needs a fresh one.
      setTurnstileKey((key) => key + 1);

      track("otp_requested", {
        ...funnel({ channel: result.channel ?? options.channel ?? "unknown" }),
        ...(options.resend ? { resend: true } : {}),
      });

      if (!result.ok) {
        setMessage(result.message ?? "Could not send a code.");
        if (result.retryAfterSeconds) setBlockedFor(result.retryAfterSeconds);
        track("otp_failed", {
          ...funnel(),
          reason:
            result.error === "rate_limited"
              ? "rate_limited"
              : result.error === "challenge_failed"
                ? "challenge_failed"
                : "error",
        });
        return;
      }

      if (result.delivery === "send_failed") {
        track("otp_failed", { ...funnel({ channel: result.channel ?? "unknown" }), reason: "send_failed" });
      } else if (result.delivery === "sent") {
        track("otp_delivered", { ...funnel({ channel: result.channel ?? "unknown" }) });
      }

      setDevelopmentCode(result.developmentCode ?? null);
      setChannel(result.channel);
      setChannels(result.channels ?? []);
      setSentAt(Date.now());
      setCode("");
      setStep("code");
      if (result.delivery === "send_failed") {
        setMessage(
          "We could not deliver the code just now. Wait a moment and resend, or try SMS.",
        );
      }
    });
  }

  const verify = useCallback(
    (value: string) => {
      if (verifying.current) return;
      verifying.current = true;
      setMessage(null);
      startTransition(async () => {
        try {
          const result = stepUp ? await confirmStepUp(value) : await verifyCode(phone, value);
          if (!result.ok) {
            const reason =
              result.error === "wrong_code"
                ? "wrong_code"
                : result.error === "code_unusable"
                  ? "code_unusable"
                  : result.error === "account_blocked"
                    ? "blocked"
                    : "error";
            track("otp_failed", { ...funnel(), reason });
            setMessage(result.message ?? "That code is not right.");
            setCode("");
            codeRef.current?.focus();
            return;
          }

          track("otp_verified", funnel());
          if (!stepUp) {
            track("signin_completed", {
              ...funnel(),
              method: "phone",
              ...(result.claimedOrders ? { claimed_orders: result.claimedOrders } : {}),
            });
          }

          if (onDone) {
            onDone(result);
            router.refresh();
            return;
          }
          router.push(next);
          // The header and account page are server-rendered, so the route change
          // alone would leave them showing the signed-out view.
          router.refresh();
        } finally {
          verifying.current = false;
        }
      });
    },
    [funnel, next, onDone, phone, router, stepUp],
  );

  const shownNumber = stepUp ? (maskedPhone ?? "your number") : maskPhone(normalisePhone(phone) ?? "");
  const channelWords =
    channel === "whatsapp" ? " on WhatsApp" : channel === "sms" ? " by SMS" : "";

  return (
    <div className="mx-auto max-w-sm">
      {step === "phone" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (phoneValid && challengeReady && blockedFor <= 0) send();
          }}
        >
          {stepUp ? (
            <p className="text-sm text-content-muted">
              For your security, confirm it&apos;s you. We&apos;ll send a code to{" "}
              <span className="text-content">{shownNumber}</span>.
            </p>
          ) : (
            <PhoneField
              ref={phoneRef}
              value={phone}
              onChange={setPhone}
              disabled={lockPhone || pending}
              label={lockPhone ? "Verify this number" : "Mobile number"}
            />
          )}

          <Turnstile onToken={setTurnstileToken} resetKey={turnstileKey} />

          <Button
            type="submit"
            className="mt-5 w-full"
            disabled={!phoneValid || !challengeReady || pending || blockedFor > 0}
          >
            {pending
              ? "Sending…"
              : blockedFor > 0
                ? `Try again in ${blockedFor}s`
                : (submitLabel ?? "Send code")}
          </Button>
          <p className="mt-3 text-xs text-content-faint">
            We send the code on WhatsApp, or by SMS if WhatsApp isn&apos;t available. Standard
            rates may apply.
          </p>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (code.length > 0) verify(code);
          }}
        >
          <p className="mb-4 text-sm text-content-muted">
            Sent{channelWords} to {shownNumber}.{" "}
            {!stepUp && !lockPhone && (
              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setCode("");
                  setMessage(null);
                  setTimeout(() => phoneRef.current?.focus(), 0);
                }}
                className="border-b border-content pb-0.5 hover:border-accent-ink hover:text-accent-ink"
              >
                Change number
              </button>
            )}
          </p>

          <OtpInput
            ref={codeRef}
            value={code}
            onChange={setCode}
            onComplete={verify}
            disabled={pending}
          />

          <Button type="submit" className="mt-5 w-full" disabled={code.length === 0 || pending}>
            {pending ? "Checking…" : stepUp ? "Confirm" : "Sign in"}
          </Button>

          <Turnstile onToken={setTurnstileToken} resetKey={turnstileKey} />

          <div className="mt-3 flex flex-col items-center gap-1">
            <ResendTimer
              seconds={RESEND_SECONDS}
              startedAt={sentAt}
              onResend={() => send({ resend: true, ...(channel ? { channel } : {}) })}
              disabled={pending || !challengeReady}
            />
            <ChannelSwitch
              channel={channel}
              channels={channels}
              sentAt={sentAt}
              onSwitch={(next) => send({ channel: next, resend: true })}
              disabled={pending || !challengeReady}
            />
          </div>
        </form>
      )}

      {message && (
        <p role="alert" className="mt-4 text-sm text-accent-ink">
          {message}
        </p>
      )}

      {developmentCode && (
        // Shown, and labelled, because no WhatsApp or SMS sender is connected.
        // A code silently present in a response would be far worse than one
        // the page admits it is displaying.
        <div className="mt-6 border border-dashed border-content/25 p-4 text-sm">
          <MicroLabel>No message sender connected</MicroLabel>
          <p className="mt-2 text-content-muted">
            Nothing was sent to your phone. This environment shows the code
            instead:{" "}
            <span className="font-medium tracking-[0.3em] text-content">
              {developmentCode}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
