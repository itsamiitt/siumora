/**
 * Notification templates and the rules about sending them.
 *
 * Two regimes govern a message to an Indian phone, and they disagree about
 * almost everything except that breaking either is expensive:
 *
 * - **TRAI DLT.** Every commercial SMS template is registered with a telecom
 *   operator before it can be sent, and the registered id travels with the
 *   send. An unregistered template is not delivered — it is dropped silently by
 *   the operator, which is worse than an error.
 * - **Meta's WhatsApp categories.** A template is `utility` or `marketing`.
 *   Utility covers what happened to an order the customer placed; marketing is
 *   anything they did not ask for. Sending marketing copy through a utility
 *   template is a policy violation that costs the number, not the message.
 *
 * The registry below is the single place both facts live, so a new message has
 * to declare its category rather than inherit one by accident. `templateHygiene`
 * is the check plan/06 §4 asks CI to run.
 */

export type Channel = "whatsapp" | "sms" | "push" | "email";

export type TemplateCategory =
  /** Something happened to an order this person placed. */
  | "utility"
  /** Anything they did not ask for. Needs opt-in, and obeys quiet hours. */
  | "marketing";

export interface Template {
  readonly key: string;
  readonly category: TemplateCategory;
  /**
   * Channels in the order they are tried. India-first: WhatsApp is read, SMS
   * arrives, email is checked eventually.
   */
  readonly channels: readonly Channel[];
  /**
   * The DLT-registered template id, once the entity is registered.
   *
   * Undefined until then, and `sendableOn` refuses SMS without it — an
   * unregistered template is dropped by the operator with no error, which
   * would look like a delivery problem for weeks.
   */
  readonly dltTemplateId?: string;
  /** Variables the body needs, in order. */
  readonly variables: readonly string[];
  /** The approved body, with `{{name}}` placeholders. */
  readonly body: string;
}

/**
 * Words that make a message marketing, whatever it is labelled.
 *
 * Not a content filter — a coarse net for the one mistake plan/06 §4 names:
 * promotional copy shipped through a utility template. It runs in a test, so a
 * new template carrying an offer fails the build rather than the account.
 */
const PROMOTIONAL = [
  "offer",
  "discount",
  "sale",
  "deal",
  "% off",
  "coupon",
  "shop now",
  "limited time",
  "hurry",
  "free gift",
  "exclusive",
];

export const TEMPLATES: readonly Template[] = [
  {
    key: "order_confirmed",
    category: "utility",
    channels: ["whatsapp", "email"],
    variables: ["name", "orderNumber", "total"],
    body: "Hi {{name}}, we have your order {{orderNumber}} for {{total}}. Your tax invoice is attached. We will message you when it ships.",
  },
  {
    key: "cod_confirm",
    category: "utility",
    // No email fallback: this one is time-critical and an unanswered email
    // holds the parcel.
    channels: ["whatsapp", "sms"],
    variables: ["name", "orderNumber", "code"],
    body: "Hi {{name}}, reply with {{code}} to confirm your cash-on-delivery order {{orderNumber}}. We hold it for 24 hours.",
  },
  {
    key: "order_shipped",
    category: "utility",
    channels: ["whatsapp", "push", "email"],
    variables: ["name", "orderNumber", "courier", "trackingId"],
    body: "Hi {{name}}, order {{orderNumber}} is on its way with {{courier}}. Tracking: {{trackingId}}.",
  },
  {
    key: "out_for_delivery",
    category: "utility",
    channels: ["whatsapp", "push"],
    variables: ["name", "orderNumber"],
    body: "Hi {{name}}, order {{orderNumber}} is out for delivery today. Please keep your phone reachable.",
  },
  {
    key: "delivery_failed",
    category: "utility",
    // Every channel: an unanswered NDR becomes a return, and a return costs
    // both legs of the freight and the sale.
    channels: ["whatsapp", "sms", "push", "email"],
    variables: ["name", "orderNumber", "reason"],
    body: "Hi {{name}}, we could not deliver {{orderNumber}} — {{reason}}. Reply to pick a new time or update your address.",
  },
  {
    key: "order_delivered",
    category: "utility",
    channels: ["whatsapp", "email"],
    variables: ["name", "orderNumber"],
    body: "Hi {{name}}, {{orderNumber}} has been delivered. Anything wrong with it, tell us within 7 days and we will put it right.",
  },
  {
    key: "refund_processed",
    category: "utility",
    channels: ["whatsapp", "email"],
    variables: ["name", "orderNumber", "amount", "workingDays"],
    body: "Hi {{name}}, your refund of {{amount}} for {{orderNumber}} is on its way back. Banks take up to {{workingDays}} working days.",
  },
  {
    key: "back_in_stock",
    category: "marketing",
    channels: ["whatsapp", "push", "email"],
    variables: ["name", "product"],
    body: "Hi {{name}}, {{product}} is back. We kept one aside for a day.",
  },
];

export function templateFor(key: string): Template | undefined {
  return TEMPLATES.find((template) => template.key === key);
}

/**
 * Quiet hours for anything that is not about an order in flight.
 *
 * TRAI restricts commercial communication to daytime, and past that it is
 * simply rude. Utility messages are exempt and must be: an NDR at nine in the
 * evening is the whole point of an NDR message.
 */
export const QUIET_FROM_HOUR = 21;
export const QUIET_UNTIL_HOUR = 9;

/** The hour in IST, whatever zone the process runs in. */
export function istHour(at: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).format(at),
  );
}

export function inQuietHours(at: Date): boolean {
  const hour = istHour(at);
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}

export interface SendContext {
  /** Whether this person opted in to marketing. Absent means they did not. */
  readonly marketingConsent?: boolean;
  /** Set when they asked to stop. Overrides consent, including for utility. */
  readonly optedOut?: boolean;
  readonly now: Date;
}

export type SendDecision =
  | { readonly send: true; readonly channels: readonly Channel[] }
  | { readonly send: false; readonly reason: SendRefusal };

export type SendRefusal =
  | "unknown_template"
  | "opted_out"
  | "no_marketing_consent"
  | "quiet_hours"
  | "no_channel";

/**
 * Whether this message may go, and on which channels.
 *
 * Utility messages go regardless of marketing consent — a parcel arriving is
 * not advertising, and withholding a delivery notice because somebody
 * unticked an offers box would be its own kind of failure. An explicit opt-out
 * still stops everything, because that is a person asking to be left alone.
 */
export function evaluateSend(
  templateKey: string,
  context: SendContext,
  available: readonly Channel[] = ["whatsapp", "sms", "push", "email"],
): SendDecision {
  const template = templateFor(templateKey);
  if (!template) return { send: false, reason: "unknown_template" };

  if (context.optedOut) return { send: false, reason: "opted_out" };

  if (template.category === "marketing") {
    if (!context.marketingConsent) {
      return { send: false, reason: "no_marketing_consent" };
    }
    if (inQuietHours(context.now)) {
      // Held, not dropped: the caller reschedules rather than losing it.
      return { send: false, reason: "quiet_hours" };
    }
  }

  const channels = template.channels.filter((channel) =>
    available.includes(channel),
  );
  if (channels.length === 0) return { send: false, reason: "no_channel" };

  return { send: true, channels };
}

/**
 * When a message held for quiet hours may next go.
 *
 * Nine in the morning IST is 03:30 UTC — the half hour matters, and a first
 * draft that worked in whole hours landed every held message at 08:30. India
 * has no daylight saving, so that offset is fixed, which is the one thing
 * making this arithmetic safe to do by hand.
 */
export function nextSendableAt(at: Date): Date {
  if (!inQuietHours(at)) return at;

  const next = new Date(at);
  next.setUTCHours(3, 30, 0, 0);
  // Already past this morning's opening, so it is tomorrow's.
  if (next <= at) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export type RenderResult =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly missing: readonly string[] };

/**
 * Fill a template.
 *
 * Refuses on a missing variable rather than leaving a placeholder or an empty
 * string. WhatsApp rejects a template send with an empty parameter, and an SMS
 * that reads "your order  has shipped" is worse than none — it is the message
 * that makes a customer ring support.
 */
export function renderTemplate(
  templateKey: string,
  values: Readonly<Record<string, string | number>>,
): RenderResult {
  const template = templateFor(templateKey);
  if (!template) return { ok: false, missing: ["template"] };

  const missing = template.variables.filter((variable) => {
    const value = values[variable];
    return value === undefined || String(value).trim() === "";
  });
  if (missing.length > 0) return { ok: false, missing };

  const body = template.body.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(values[name] ?? ""),
  );

  return { ok: true, body };
}

/** Whether a template may go out on a channel in this environment. */
export function sendableOn(template: Template, channel: Channel): boolean {
  // An SMS template with no DLT id is dropped by the operator with no error,
  // which looks like a delivery problem for however long it takes somebody to
  // check the registration.
  if (channel === "sms") return Boolean(template.dltTemplateId);
  return template.channels.includes(channel);
}

export interface HygieneProblem {
  readonly template: string;
  readonly problem: string;
}

/**
 * The lint plan/06 §4 asks CI to run.
 *
 * Three things: every template declares a category and at least one channel;
 * no utility template carries promotional language; every variable in the body
 * is declared and every declared variable is used. The last one catches the
 * quiet failure — a variable added to the body and not to the list renders as
 * an empty string in production and reads fine in review.
 */
export function templateHygiene(
  templates: readonly Template[] = TEMPLATES,
): HygieneProblem[] {
  const problems: HygieneProblem[] = [];

  for (const template of templates) {
    if (template.channels.length === 0) {
      problems.push({ template: template.key, problem: "no channel" });
    }

    if (template.category === "utility") {
      const found = PROMOTIONAL.filter((word) =>
        template.body.toLowerCase().includes(word),
      );
      if (found.length > 0) {
        problems.push({
          template: template.key,
          problem: `promotional language in a utility template: ${found.join(", ")}`,
        });
      }
    }

    const used = [...template.body.matchAll(/\{\{(\w+)\}\}/g)].map(
      (match) => match[1] as string,
    );
    for (const variable of used) {
      if (!template.variables.includes(variable)) {
        problems.push({
          template: template.key,
          problem: `body uses {{${variable}}}, which is not declared`,
        });
      }
    }
    for (const variable of template.variables) {
      if (!used.includes(variable)) {
        problems.push({
          template: template.key,
          problem: `declares ${variable}, which the body never uses`,
        });
      }
    }
  }

  return problems;
}

/** The template an order transition should send, if any. */
export function templateForStatus(status: string): string | undefined {
  const map: Record<string, string> = {
    confirmed: "order_confirmed",
    shipped: "order_shipped",
    out_for_delivery: "out_for_delivery",
    delivered: "order_delivered",
    ndr: "delivery_failed",
    awaiting_cod_confirmation: "cod_confirm",
  };
  return map[status];
}
