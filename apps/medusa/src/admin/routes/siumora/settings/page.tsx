import { defineRouteConfig } from "@medusajs/admin-sdk";
import { CogSixTooth } from "@medusajs/icons";
import { Button, Container, Heading, Input, Prompt, Switch, Text, toast } from "@medusajs/ui";
import { useEffect, useState } from "react";

import { OpsError, inr, opsFetch } from "../../../lib/ops";

/**
 * Siumora · Settings (plan/07 governance): the payments kill-switch, the
 * COD caps and the phone sign-in limits — owner-grade levers over
 * GET/PATCH /admin/siumora/settings.
 * Every write is audited by the route; the kill-switch flip asks for
 * confirmation because it stops revenue within the 30-second config TTL.
 */

interface Settings {
  paymentsEnabled: boolean;
  codMaxOrder: number;
  codFee: number;
  codMinOrder: number;
  otpTtlSeconds: number;
  otpResendCooldownSeconds: number;
  otpMaxSendsPerWindow: number;
  otpSendWindowSeconds: number;
  otpMaxAttempts: number;
}

const PAISE_KEYS = [
  { key: "cod_max_order", prop: "codMaxOrder", label: "COD cap (max order)" },
  { key: "cod_fee", prop: "codFee", label: "COD fee" },
  { key: "cod_min_order", prop: "codMinOrder", label: "COD floor (min order)" },
] as const;

/**
 * Phone sign-in limits — the levers to tighten during an OTP flood. The
 * route validates the ranges (settings.ts); the hint shows them up front.
 */
const OTP_KEYS = [
  { key: "otp_ttl_seconds", prop: "otpTtlSeconds", label: "Code lifetime (seconds)", hint: "60–600" },
  { key: "otp_resend_cooldown_seconds", prop: "otpResendCooldownSeconds", label: "Resend cooldown (seconds)", hint: "15–600" },
  { key: "otp_max_sends_per_window", prop: "otpMaxSendsPerWindow", label: "Codes per number per window", hint: "1–20" },
  { key: "otp_send_window_seconds", prop: "otpSendWindowSeconds", label: "Send window (seconds)", hint: "600–86400" },
  { key: "otp_max_attempts", prop: "otpMaxAttempts", label: "Wrong guesses before a code locks", hint: "1–10" },
] as const;

const SettingsPage = () => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirmKill, setConfirmKill] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    opsFetch<{ settings: Settings }>("/admin/siumora/settings")
      .then((payload) => setSettings(payload.settings))
      .catch((error) =>
        setRefusal(error instanceof OpsError ? error.message : "Could not load settings."),
      );
  }, []);

  const patch = async (key: string, value: unknown) => {
    setBusy(true);
    try {
      const payload = await opsFetch<{ settings: Settings }>("/admin/siumora/settings", {
        method: "PATCH",
        body: JSON.stringify({ key, value }),
      });
      setSettings(payload.settings);
      toast.success("Setting saved and audited.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Write refused.");
    } finally {
      setBusy(false);
      setConfirmKill(false);
    }
  };

  if (refusal) {
    return (
      <Container className="p-6">
        <Heading level="h1">Settings</Heading>
        <Text className="mt-2 text-ui-fg-subtle">{refusal}</Text>
      </Container>
    );
  }
  if (!settings) return null;

  return (
    <div className="flex flex-col gap-4">
      <Container className="p-6">
        <Heading level="h1">Runtime settings</Heading>
        <div className="mt-4 flex items-center justify-between">
          <div>
            <Text weight="plus">Payments (kill-switch)</Text>
            <Text size="small" className="text-ui-fg-subtle">
              Off = checkout refuses and the storefront renders the paused
              state, within the 30s config TTL.
            </Text>
          </div>
          <Switch
            checked={settings.paymentsEnabled}
            disabled={busy}
            onCheckedChange={(next) =>
              next ? patch("payments_enabled", true) : setConfirmKill(true)
            }
          />
        </div>
      </Container>

      <Container className="p-6">
        <Heading level="h2">COD caps (rupees)</Heading>
        {PAISE_KEYS.map(({ key, prop, label }) => (
          <div key={key} className="mt-3 flex items-end gap-2">
            <div className="flex-1">
              <Text size="small" weight="plus">
                {label} — currently {inr(settings[prop])}
              </Text>
              <Input
                value={drafts[key] ?? ""}
                placeholder={(settings[prop] / 100).toString()}
                onChange={(event) =>
                  setDrafts((prev) => ({ ...prev, [key]: event.target.value }))
                }
              />
            </div>
            <Button
              size="small"
              variant="secondary"
              disabled={busy || !(drafts[key] ?? "").trim()}
              onClick={() => {
                const rupees = Number((drafts[key] ?? "").replaceAll(",", ""));
                if (!Number.isFinite(rupees) || rupees < 0) {
                  toast.error("Expected a rupee amount.");
                  return;
                }
                patch(key, Math.round(rupees * 100));
              }}
            >
              Save
            </Button>
          </div>
        ))}
      </Container>

      <Container className="p-6">
        <Heading level="h2">Phone sign-in limits</Heading>
        <Text size="small" className="mt-1 text-ui-fg-subtle">
          Tighten these during an OTP flood. Changes reach sign-in within the
          30s settings TTL and are audited.
        </Text>
        {OTP_KEYS.map(({ key, prop, label, hint }) => (
          <div key={key} className="mt-3 flex items-end gap-2">
            <div className="flex-1">
              <Text size="small" weight="plus">
                {label} — currently {settings[prop]} ({hint})
              </Text>
              <Input
                value={drafts[key] ?? ""}
                placeholder={String(settings[prop])}
                inputMode="numeric"
                onChange={(event) =>
                  setDrafts((prev) => ({ ...prev, [key]: event.target.value }))
                }
              />
            </div>
            <Button
              size="small"
              variant="secondary"
              disabled={busy || !(drafts[key] ?? "").trim()}
              onClick={() => {
                const value = Number((drafts[key] ?? "").trim());
                if (!Number.isInteger(value)) {
                  toast.error("Expected a whole number.");
                  return;
                }
                patch(key, value);
              }}
            >
              Save
            </Button>
          </div>
        ))}
      </Container>

      <Prompt open={confirmKill} onOpenChange={setConfirmKill}>
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>Pause payments?</Prompt.Title>
            <Prompt.Description>
              Checkout will refuse new orders until switched back on. The flip
              is audited with your identity.
            </Prompt.Description>
          </Prompt.Header>
          <Prompt.Footer>
            <Prompt.Cancel>Keep selling</Prompt.Cancel>
            <Prompt.Action onClick={() => patch("payments_enabled", false)}>
              Pause payments
            </Prompt.Action>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>
    </div>
  );
};

export const config = defineRouteConfig({
  label: "Ops settings",
  icon: CogSixTooth,
});

export default SettingsPage;
