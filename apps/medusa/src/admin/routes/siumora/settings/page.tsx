import { StorefrontSettings } from "../../../lib/storefront-settings";
import { ProviderSettings } from "../../../lib/provider-settings";
import { ToggleSetting, useSiumoraSettings } from "../../../lib/settings-controls";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { CogSixTooth } from "@medusajs/icons";
import { Button, Container, Heading, Input, Prompt, Switch, Text, toast } from "@medusajs/ui";
import { useEffect, useState } from "react";

import { OpsError, inr, opsFetch } from "../../../lib/ops";

/**
 * Siumora · Settings (plan/07 governance): the payments kill-switch and the
 * COD caps — owner-grade levers over GET/PATCH /admin/siumora/settings.
 * Sign-in levers live under Settings → Customer sign-in (auth plan phase 3).
 * Every write is audited by the route; the kill-switch flip asks for
 * confirmation because it stops revenue within the 30-second config TTL.
 */

interface Settings {
  paymentsEnabled: boolean;
  codMaxOrder: number;
  codFee: number;
  codMinOrder: number;
}

const PAISE_KEYS = [
  { key: "cod_max_order", prop: "codMaxOrder", label: "COD cap (max order)" },
  { key: "cod_fee", prop: "codFee", label: "COD fee" },
  { key: "cod_min_order", prop: "codMinOrder", label: "COD floor (min order)" },
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
      <Container className="p-6"><Heading level="h1">Siumora control center</Heading><Text className="mt-2">Manage your storefront, checkout, providers, and account notifications.</Text><div className="mt-4 flex flex-wrap gap-4">{[["/products", "Products"], ["/categories", "Categories"], ["/collections", "Collections"], ["/orders", "Orders"], ["/inventory", "Inventory"], ["/promotions", "Promotions"], ["/settings/regions", "Regions & tax"], ["/settings/shipping-profiles", "Shipping"], ["/settings/customer-sign-in", "Customer sign-in"], ["/settings/staff-security", "Staff security"]].map(([to, label]) => <a key={to} href={`${window.location.pathname.split("/siumora/settings")[0]}${to}`} className="text-ui-fg-interactive">{label}</a>)}</div></Container>
      <StorefrontSettings />
      <ProviderSettings />
      <NotificationSettings />
      <Container className="p-6">
        <Heading level="h1">Store control center</Heading>
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
        <Text size="small" className="text-ui-fg-subtle">
          Sign-in limits, abuse caps and the COD phone check are under Settings → Customer
          sign-in.
        </Text>
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
  label: "Store control center",
  icon: CogSixTooth,
});

export default SettingsPage;

function NotificationSettings() {
  const { settings, refusal, busy, write } = useSiumoraSettings();
  return <Container className="p-6"><Heading level="h2">Account notifications</Heading>{refusal ? <Text>{refusal}</Text> : settings ? <ToggleSetting label="New-device alerts" hint="Send WhatsApp alerts when a customer signs in on a new device. Requires an enabled, configured WhatsApp channel." checked={settings.newDeviceAlerts === true} disabled={busy} onChange={next => void write("new_device_alerts", next)} /> : <Text>Loading?</Text>}<Text size="small" className="mt-3 text-ui-fg-subtle">Phone-change alerts follow the WhatsApp channel setting. Verification emails follow the Resend channel setting.</Text></Container>;
}
