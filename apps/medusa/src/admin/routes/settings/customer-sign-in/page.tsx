import { defineRouteConfig } from "@medusajs/admin-sdk";
import { PencilSquare } from "@medusajs/icons";
import { Container, Input, toast } from "@medusajs/ui";
import { useState } from "react";

import { CardError, CardSkeleton, EditDrawer, FormField, KeyValueRow, SectionHeader, SwitchField } from "../../../components/kit";
import { useSaveSettings, useSiumoraSettings, type SettingsBag } from "../../../lib/queries";

/**
 * Settings › Customer sign-in (auth plan phase 3; made native in plan 16
 * Phase E): every lever on how shoppers sign in, as read-only sections each
 * edited in a drawer and saved together (one audit entry per save). Owner
 * only — the PATCH route enforces it. Changes reach sign-in within the
 * 30-second settings cache.
 *
 * The COD levers (verified phone, fresh code to a new address) moved to the
 * Store page's Checkout & COD card, beside the rest of checkout.
 */

interface Lever {
  key: string;
  prop: string;
  label: string;
  hint: string;
  kind: "number" | "switch";
  unit?: string;
}

const SECTIONS: Array<{ title: string; subtitle: string; levers: Lever[] }> = [
  {
    title: "Codes",
    subtitle: "How long a one-time code lasts and how often it can be sent.",
    levers: [
      { key: "otp_ttl_seconds", prop: "otpTtlSeconds", label: "Code lifetime", unit: "seconds", hint: "60–600. Ten minutes is the usual ceiling.", kind: "number" },
      { key: "otp_resend_cooldown_seconds", prop: "otpResendCooldownSeconds", label: "Wait before resending", unit: "seconds", hint: "15–600.", kind: "number" },
      { key: "otp_max_sends_per_window", prop: "otpMaxSendsPerWindow", label: "Codes per number per window", hint: "1–20.", kind: "number" },
      { key: "otp_send_window_seconds", prop: "otpSendWindowSeconds", label: "That window", unit: "seconds", hint: "600–86400.", kind: "number" },
      { key: "otp_max_attempts", prop: "otpMaxAttempts", label: "Wrong guesses before a code locks", hint: "1–10.", kind: "number" },
    ],
  },
  {
    title: "Abuse caps",
    subtitle: "Tighten these during an attack — Siumora › Sign-in shows who is sending.",
    levers: [
      { key: "otp_max_sends_per_ip_hour", prop: "otpMaxSendsPerIpHour", label: "Codes per connection per hour", hint: "1–500, across all numbers. Mobile networks share addresses — keep it generous.", kind: "number" },
      { key: "otp_max_sends_per_day", prop: "otpMaxSendsPerDay", label: "Codes per number per day", hint: "1–50.", kind: "number" },
      { key: "otp_daily_sms_cap", prop: "otpDailySmsCap", label: "SMS budget per day (whole site)", hint: "0–100000. Past it, codes go on WhatsApp only. 0 turns SMS off.", kind: "number" },
    ],
  },
  {
    title: "Alerts and methods",
    subtitle: "What shoppers are told, and how else they can sign in.",
    levers: [
      { key: "new_device_alerts", prop: "newDeviceAlerts", label: "New-device alert on WhatsApp", hint: "Tell the account holder when their account signs in on a new device.", kind: "switch" },
      { key: "google_signin_enabled", prop: "googleSignInEnabled", label: "Continue with Google", hint: "A Google account links only after a code proves the phone. Needs Google set up on the server.", kind: "switch" },
      { key: "google_signin_percent", prop: "googleSignInPercent", label: "Shoppers who see Google", unit: "%", hint: "0–100. Compare checkout completion between the two groups before going to 100.", kind: "number" },
    ],
  },
];

function display(value: unknown, lever: Lever): string {
  if (lever.kind === "switch") return value === true ? "On" : "Off";
  if (typeof value !== "number") return "—";
  return lever.unit === "%" ? `${value}%` : lever.unit ? `${value.toLocaleString("en-IN")} ${lever.unit}` : value.toLocaleString("en-IN");
}

function Section({ title, subtitle, levers, settings }: { title: string; subtitle: string; levers: Lever[]; settings: SettingsBag }) {
  const save = useSaveSettings(`${title} saved.`);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});

  const begin = () => {
    setDraft(
      Object.fromEntries(
        levers.map((lever) => [lever.prop, lever.kind === "switch" ? settings[lever.prop] === true : String(settings[lever.prop] ?? "")]),
      ),
    );
    setOpen(true);
  };

  const submit = () => {
    const entries: Array<{ key: string; value: unknown }> = [];
    for (const lever of levers) {
      if (lever.kind === "switch") {
        entries.push({ key: lever.key, value: draft[lever.prop] === true });
        continue;
      }
      const value = Number(String(draft[lever.prop] ?? "").replaceAll(",", "").trim());
      if (!Number.isInteger(value)) {
        toast.error(`${lever.label}: enter a whole number.`);
        return;
      }
      entries.push({ key: lever.key, value });
    }
    save.mutate(entries, { onSuccess: () => setOpen(false) });
  };

  return (
    <Container className="divide-y p-0">
      <SectionHeader title={title} subtitle={subtitle} actions={[[{ label: "Edit", icon: <PencilSquare />, onClick: begin }]]} />
      {levers.map((lever) => (
        <KeyValueRow key={lever.key} label={lever.label}>
          {display(settings[lever.prop], lever)}
        </KeyValueRow>
      ))}
      <EditDrawer open={open} onOpenChange={setOpen} title={`Edit ${title.toLowerCase()}`} saving={save.isPending} onSave={submit}>
        {levers.map((lever) =>
          lever.kind === "switch" ? (
            <SwitchField
              key={lever.key}
              label={lever.label}
              hint={lever.hint}
              checked={draft[lever.prop] === true}
              onCheckedChange={(checked) => setDraft({ ...draft, [lever.prop]: checked })}
            />
          ) : (
            <FormField key={lever.key} label={lever.unit && lever.unit !== "%" ? `${lever.label} (${lever.unit})` : lever.label} hint={lever.hint}>
              <Input
                inputMode="numeric"
                value={String(draft[lever.prop] ?? "")}
                onChange={(event) => setDraft({ ...draft, [lever.prop]: event.target.value })}
              />
            </FormField>
          ),
        )}
      </EditDrawer>
    </Container>
  );
}

const CustomerSignInPage = () => {
  const settings = useSiumoraSettings();
  if (settings.isLoading) return <CardSkeleton rows={5} />;
  if (!settings.data) return <CardError title="Customer sign-in" message={settings.error?.message ?? "Could not load."} />;
  return (
    <div className="flex flex-col gap-y-3">
      <Container className="p-0">
        <SectionHeader
          level="h1"
          title="Customer sign-in"
          subtitle="Shoppers sign in with a one-time code on WhatsApp or SMS. Changes are audited and apply within 30 seconds."
        />
      </Container>
      {SECTIONS.map((section) => (
        <Section key={section.title} {...section} settings={settings.data} />
      ))}
    </div>
  );
};

export const config = defineRouteConfig({
  label: "Customer sign-in",
});

export default CustomerSignInPage;
