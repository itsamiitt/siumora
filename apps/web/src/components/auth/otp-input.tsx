"use client";

import { forwardRef, useEffect } from "react";

import { OTP_LENGTH } from "@siumora/core/auth";
import { MicroLabel } from "@siumora/ui";

/**
 * The one-time code, one field.
 *
 * One input rather than six boxes: `autocomplete="one-time-code"` lets iOS
 * and Android keyboards offer the code from the message, paste works in one
 * go, and screen readers announce one field instead of six. When the code
 * is complete it submits itself — the customer's last action is reading the
 * code, not finding a button.
 *
 * On Android Chrome the WebOTP API reads the SMS directly when the message
 * ends with the origin-bound line (`@siumora.in #123456` — see the MSG91
 * template note in the auth plan). Browsers without it simply skip this.
 */
export const OtpInput = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (code: string) => void;
    onComplete: (code: string) => void;
    disabled?: boolean;
    /** Listen for an SMS through WebOTP while this is true. */
    listen?: boolean;
    label?: string;
  }
>(function OtpInput(
  { value, onChange, onComplete, disabled, listen = true, label = "Enter the code" },
  ref,
) {
  useEffect(() => {
    if (!listen || typeof window === "undefined" || !("OTPCredential" in window)) return;
    const controller = new AbortController();
    navigator.credentials
      .get({ otp: { transport: ["sms"] }, signal: controller.signal } as CredentialRequestOptions)
      .then((credential) => {
        const code = (credential as unknown as { code?: string } | null)?.code;
        if (code && new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code)) {
          onChange(code);
          onComplete(code);
        }
      })
      .catch(() => {
        // Aborted, denied or timed out: the customer types it instead.
      });
    return () => controller.abort();
  }, [listen, onChange, onComplete]);

  return (
    <div>
      <label htmlFor="otp-code" className="block">
        <MicroLabel>{label}</MicroLabel>
      </label>
      <input
        ref={ref}
        id="otp-code"
        value={value}
        onChange={(event) => {
          const code = event.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH);
          onChange(code);
          if (code.length === OTP_LENGTH) onComplete(code);
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern={`\\d{${OTP_LENGTH}}`}
        maxLength={OTP_LENGTH}
        placeholder={"0".repeat(OTP_LENGTH)}
        disabled={disabled}
        className="mt-3 h-12 w-full border border-content/20 bg-transparent px-3 text-center text-xl tracking-[0.4em] outline-none focus:border-accent-ink disabled:opacity-60"
      />
    </div>
  );
});
