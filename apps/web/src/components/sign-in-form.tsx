"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { OTP_LENGTH, maskPhone, normalisePhone } from "@siumora/core";
import { Button, MicroLabel } from "@siumora/ui";

import { requestCode, verifyCode } from "@/app/actions/auth";

/**
 * Phone sign-in, in two steps.
 *
 * The number step never says whether an account exists — a different message
 * for a known number would turn this form into a way to find out who shops
 * here. Both paths look identical up to the code.
 */
export function SignInForm({ next = "/account" }: { next?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [developmentCode, setDevelopmentCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const codeRef = useRef<HTMLInputElement>(null);

  // Count the resend cooldown down on screen. Telling someone to "try again
  // later" without saying how much later is how a form gets hammered.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  const phoneValid = normalisePhone(phone) !== undefined;
  const codeValid = new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code);

  function send() {
    setMessage(null);
    startTransition(async () => {
      const result = await requestCode(phone);
      if (!result.ok) {
        setMessage(result.message ?? "Could not send a code.");
        if (result.retryAfterSeconds) setCooldown(result.retryAfterSeconds);
        return;
      }
      setDevelopmentCode(result.developmentCode ?? null);
      setStep("code");
      setCooldown(45);
    });
  }

  function verify() {
    setMessage(null);
    startTransition(async () => {
      const result = await verifyCode(phone, code);
      if (!result.ok) {
        setMessage(result.message ?? "That code is not right.");
        setCode("");
        return;
      }
      router.push(next);
      // The header and account page are server-rendered, so the route change
      // alone would leave them showing the signed-out view.
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-sm">
      {step === "phone" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <label htmlFor="phone" className="block">
            <MicroLabel>Mobile number</MicroLabel>
          </label>

          <div className="mt-3 flex items-center border border-content/20 focus-within:border-accent-ink">
            <span className="pl-3 text-sm text-content-muted">+91</span>
            <input
              id="phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={10}
              placeholder="98765 43210"
              className="h-12 min-w-0 flex-1 bg-transparent px-3 text-base outline-none"
            />
          </div>

          <Button
            type="submit"
            className="mt-5 w-full"
            disabled={!phoneValid || pending}
          >
            {pending ? "Sending…" : "Send code"}
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            verify();
          }}
        >
          <label htmlFor="code" className="block">
            <MicroLabel>Enter the code</MicroLabel>
          </label>
          <p className="mt-2 text-sm text-content-muted">
            Sent to {maskPhone(normalisePhone(phone) ?? "")}.{" "}
            <button
              type="button"
              onClick={() => {
                setStep("phone");
                setCode("");
                setMessage(null);
              }}
              className="border-b border-content pb-0.5 hover:border-accent-ink hover:text-accent-ink"
            >
              Change
            </button>
          </p>

          <input
            id="code"
            ref={codeRef}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={OTP_LENGTH}
            placeholder="000000"
            className="mt-3 h-12 w-full border border-content/20 bg-transparent px-3 text-center text-xl tracking-[0.4em] outline-none focus:border-accent-ink"
          />

          <Button
            type="submit"
            className="mt-5 w-full"
            disabled={!codeValid || pending}
          >
            {pending ? "Checking…" : "Sign in"}
          </Button>

          <button
            type="button"
            onClick={send}
            disabled={cooldown > 0 || pending}
            className="mt-4 w-full text-sm text-content-muted disabled:opacity-60"
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
          </button>
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
