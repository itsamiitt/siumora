"use client";

import { useEffect, useState } from "react";

/**
 * "Resend in 42s", counting down on screen. Telling someone to "try again
 * later" without saying how much later is how a form gets hammered.
 * `startedAt` restarts the count whenever a new code goes out.
 */
export function ResendTimer({
  seconds,
  startedAt,
  onResend,
  disabled,
}: {
  seconds: number;
  startedAt: number;
  onResend: () => void;
  disabled?: boolean;
}) {
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    const tick = () =>
      setLeft(Math.max(0, seconds - Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [seconds, startedAt]);

  return (
    <button
      type="button"
      onClick={onResend}
      disabled={left > 0 || disabled}
      className="min-h-11 text-sm text-content-muted underline-offset-4 enabled:hover:text-accent-ink enabled:hover:underline disabled:opacity-60"
    >
      {left > 0 ? `Resend in ${left}s` : "Resend code"}
    </button>
  );
}
