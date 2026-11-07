/**
 * Money alerts — the `[money-alert]` log lines written when a payment is
 * captured without an order, a refund fails, or provider credentials change —
 * are exactly the lines someone must see the same hour. This forwards each one
 * to an alert sink (Sentry, from instrumentation.ts) without touching the call
 * sites: it wraps the `error`/`warn` methods of the objects that write them
 * (Medusa's shared logger and `console`), passing every call through unchanged.
 */

export const MONEY_ALERT_MARKER = "[money-alert]";

type LogMethod = (...args: unknown[]) => unknown;
type LogTarget = Record<string, unknown>;
export type AlertSink = (message: string, level: "error" | "warning") => void;

const WRAPPED = Symbol.for("siumora.money-alert-capture");

function firstString(args: unknown[]): string | null {
  const head = args[0];
  if (typeof head === "string") return head;
  if (head instanceof Error) return head.message;
  return null;
}

export function installMoneyAlertCapture(targets: LogTarget[], sink: AlertSink): void {
  for (const target of targets) {
    for (const method of ["error", "warn"] as const) {
      const original = target[method];
      if (typeof original !== "function" || (original as { [WRAPPED]?: true })[WRAPPED]) continue;
      const wrapped: LogMethod = function (this: unknown, ...args: unknown[]) {
        const message = firstString(args);
        if (message?.includes(MONEY_ALERT_MARKER)) {
          try {
            sink(message, method === "error" ? "error" : "warning");
          } catch {
            // Alerting must never break the log line, let alone the request.
          }
        }
        return (original as LogMethod).apply(this, args);
      };
      (wrapped as { [WRAPPED]?: true })[WRAPPED] = true;
      target[method] = wrapped;
    }
  }
}
