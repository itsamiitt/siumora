"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { normalisePhone } from "@siumora/core/auth";
import { Button } from "@siumora/ui";

import { changePhone } from "@/app/actions/account";
import { requestCode } from "@/app/actions/auth";
import { OtpInput } from "@/components/auth/otp-input";
import { PhoneField } from "@/components/auth/phone-field";
import { useStepUp } from "@/components/auth/step-up";

/**
 * Change the account's mobile number (auth plan phase 2).
 *
 * The phone IS the account, so this takes two proofs: a code to the NEW
 * number (it is really yours), and — through the StepUpGate — a fresh code
 * on the CURRENT one (you are really the account holder). Every other
 * device is signed out afterwards, and the old number is told on WhatsApp.
 */
export function PhoneChange({ maskedPhone }: { maskedPhone: string }) {
  const router = useRouter();
  const { gate, sheet } = useStepUp(maskedPhone);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            setOpen(true);
          }}
          className="mt-3 min-h-11 text-sm text-content-muted underline underline-offset-4 hover:text-accent-ink"
        >
          Change mobile number
        </button>
        {message && (
          <p role="status" className="mt-2 text-sm text-content-muted">
            {message}
          </p>
        )}
      </div>
    );
  }

  function confirm(value: string) {
    startTransition(async () => {
      const result = await gate(() => changePhone(phone, value));
      if (!result.ok) {
        setMessage(result.message ?? "Could not change your number.");
        setCode("");
        return;
      }
      setMessage(
        `Your number is now ${result.maskedPhone}.` +
          (result.signedOutDevices ? ` ${result.signedOutDevices} other device(s) were signed out.` : ""),
      );
      setOpen(false);
      setStep("phone");
      setPhone("");
      setCode("");
      router.refresh();
    });
  }

  return (
    <div className="mt-4 max-w-sm">
      {step === "phone" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setMessage(null);
            startTransition(async () => {
              const result = await requestCode(phone);
              if (!result.ok) {
                setMessage(result.message ?? "Could not send a code.");
                return;
              }
              setStep("code");
              if (result.developmentCode) setMessage(`Development code: ${result.developmentCode}`);
            });
          }}
        >
          <PhoneField id="new-phone" value={phone} onChange={setPhone} label="New mobile number" />
          <Button type="submit" size="sm" className="mt-4" disabled={pending || !normalisePhone(phone)}>
            {pending ? "Sending…" : "Send code to the new number"}
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            confirm(code);
          }}
        >
          <OtpInput
            value={code}
            onChange={setCode}
            onComplete={confirm}
            disabled={pending}
            label="Code sent to the new number"
          />
          <Button type="submit" size="sm" className="mt-4" disabled={pending || code.length === 0}>
            {pending ? "Checking…" : "Change number"}
          </Button>
        </form>
      )}
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setStep("phone");
          setPhone("");
          setCode("");
          setMessage(null);
        }}
        className="mt-2 min-h-11 text-sm text-content-muted underline-offset-4 hover:underline"
      >
        Cancel
      </button>
      {message && (
        <p role="status" className="mt-2 text-sm text-content-muted">
          {message}
        </p>
      )}
      {sheet}
    </div>
  );
}
