"use client";

import { useEffect, useState } from "react";

import type { OtpChannel } from "@siumora/sdk";

/** How long to wait on WhatsApp before offering SMS. */
export const CHANNEL_SWITCH_AFTER_SECONDS = 20;

/**
 * "Didn't get it on WhatsApp? Send by SMS" — offered 20 seconds after a
 * WhatsApp code went out, and only where the backend can send SMS at all.
 * Not every phone has WhatsApp, and a code the customer cannot receive is a
 * cart abandoned at the last step.
 */
export function ChannelSwitch({
  channel,
  channels,
  sentAt,
  onSwitch,
  disabled,
}: {
  channel: OtpChannel | undefined;
  channels: readonly OtpChannel[];
  sentAt: number;
  onSwitch: (channel: OtpChannel) => void;
  disabled?: boolean;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    const wait = Math.max(0, CHANNEL_SWITCH_AFTER_SECONDS * 1000 - (Date.now() - sentAt));
    const timer = setTimeout(() => setReady(true), wait);
    return () => clearTimeout(timer);
  }, [sentAt]);

  if (channel !== "whatsapp" || !channels.includes("sms") || !ready) return null;

  return (
    <button
      type="button"
      onClick={() => onSwitch("sms")}
      disabled={disabled}
      className="min-h-11 text-sm text-content-muted underline underline-offset-4 hover:text-accent-ink disabled:opacity-60"
    >
      Didn&apos;t get it on WhatsApp? Send by SMS
    </button>
  );
}
