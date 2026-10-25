import { defineRouteConfig } from "@medusajs/admin-sdk";
import { PencilSquare } from "@medusajs/icons";
import { Container, Input, StatusBadge, Text } from "@medusajs/ui";
import { useState } from "react";

import { CardError, CardSkeleton, EditDrawer, FormField, KeyValueRow, SectionHeader, SwitchField } from "../../../components/kit";
import { useMessagingStatus, useProviders, useSaveProvider, type ProviderStatus } from "../../../lib/queries";
import { FIELD_LABELS, OPTIONAL_FIELDS, PROVIDERS, type ProviderName } from "../../../../modules/settings/provider-fields";

/**
 * Settings › Integrations (plan 16 Phase E) — every outside service the
 * shop talks to, in one place: payments (Razorpay), courier (Shiprocket),
 * WhatsApp, SMS and email. Each shows whether it is ready; credentials are
 * edited in a drawer, stored encrypted, and never shown again. This page
 * replaces the old Messaging page and the credentials block that sat in the
 * Store control center.
 */

const ABOUT: Record<ProviderName, string> = {
  razorpay: "Takes UPI, card and netbanking payments at checkout. Without it, checkout offers cash on delivery only.",
  shiprocket: "Books the courier when you create a fulfillment, and moves orders as the parcel travels.",
  whatsapp: "Sends sign-in codes and account security alerts through your WhatsApp Business provider.",
  sms: "Sends sign-in codes by SMS, and catches the ones WhatsApp could not deliver.",
  email: "Sends email-verification links.",
};

const WEBHOOK_NOTE: Partial<Record<ProviderName, string>> = {
  razorpay: "Webhook URL for the Razorpay dashboard: <your Medusa address>/hooks/payment/razorpay_razorpay",
  shiprocket: "Webhook URL for the Shiprocket panel: <your Medusa address>/webhooks/courier — with the same webhook token.",
};

function readiness(status: ProviderStatus): { label: string; color: "green" | "orange" | "grey" | "red" } {
  if (status.error) return { label: "Cannot read", color: "red" };
  if (!status.enabled) return { label: "Switched off", color: "grey" };
  return status.configured ? { label: "Connected", color: "green" } : { label: "Not connected", color: "orange" };
}

function ProviderCard({ name, status, editable }: { name: ProviderName; status: ProviderStatus; editable: boolean }) {
  const save = useSaveProvider();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(status.enabled);
  const [values, setValues] = useState<Record<string, string>>({});
  const state = readiness(status);
  const fields = PROVIDERS[name].fields as readonly string[];

  return (
    <Container className="divide-y p-0">
      <SectionHeader
        title={PROVIDERS[name].label}
        subtitle={ABOUT[name]}
        badge={<StatusBadge color={state.color}>{state.label}</StatusBadge>}
        actions={
          editable
            ? [[{
                label: "Edit credentials",
                icon: <PencilSquare />,
                onClick: () => {
                  setEnabled(status.enabled);
                  setValues({});
                  setOpen(true);
                },
              }]]
            : []
        }
      />
      {fields.map((field) => (
        <KeyValueRow key={field} label={FIELD_LABELS[field] ?? field}>
          {status.fields[field] ? "Saved" : OPTIONAL_FIELDS.has(field) ? "Not set (optional)" : "Missing"}
        </KeyValueRow>
      ))}
      {status.error && (
        <Text size="small" className="px-6 py-4 text-ui-fg-error">
          {status.error}
        </Text>
      )}
      {WEBHOOK_NOTE[name] && (
        <Text size="xsmall" className="px-6 py-4 text-ui-fg-subtle">
          {WEBHOOK_NOTE[name]}
        </Text>
      )}

      <EditDrawer
        open={open}
        onOpenChange={setOpen}
        title={`${PROVIDERS[name].label} credentials`}
        description="Leave a field blank to keep what is saved. Values are encrypted and never shown again."
        saving={save.isPending}
        onSave={() =>
          save.mutate(
            {
              provider: name,
              enabled,
              fields: Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim() !== "")),
            },
            { onSuccess: () => setOpen(false) },
          )
        }
      >
        <SwitchField
          label="Switched on"
          hint="Off stops using this service without forgetting the credentials."
          checked={enabled}
          onCheckedChange={setEnabled}
        />
        {fields.map((field) => (
          <FormField key={field} label={FIELD_LABELS[field] ?? field} optional={OPTIONAL_FIELDS.has(field)}>
            <Input
              type={/KEY|SECRET|PASSWORD|TOKEN/.test(field) ? "password" : "text"}
              autoComplete="off"
              value={values[field] ?? ""}
              placeholder={status.fields[field] ? "Saved — leave blank to keep" : ""}
              onChange={(event) => setValues({ ...values, [field]: event.target.value })}
            />
          </FormField>
        ))}
      </EditDrawer>
    </Container>
  );
}

const IntegrationsPage = () => {
  const providers = useProviders();
  const messaging = useMessagingStatus();

  if (providers.isLoading) return <CardSkeleton rows={4} />;
  if (!providers.data) return <CardError title="Integrations" message={providers.error?.message ?? "Could not load."} />;
  const { editable } = providers.data;
  const m = messaging.data;

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <SectionHeader level="h1" title="Integrations" subtitle="The outside services the shop uses, and whether each is ready." />
        {!editable && (
          <Text size="small" className="px-6 py-4 text-ui-fg-error">
            Credentials cannot be saved yet: the server needs its settings encryption key (32+ characters). Ask whoever runs the
            server to set it, and to keep a copy safe.
          </Text>
        )}
        {m && (
          <>
            <KeyValueRow label="Sign-in codes on WhatsApp">{m.otp.whatsapp ? "Ready" : "Not ready"}</KeyValueRow>
            <KeyValueRow label="Sign-in codes by SMS">{m.otp.sms ? "Ready" : "Not ready"}</KeyValueRow>
            <KeyValueRow label="Security alerts on WhatsApp">{m.alerts.whatsapp ? "Ready" : "Not ready"}</KeyValueRow>
            <KeyValueRow label="Bot check on sign-in">{m.turnstile ? "On" : "Off"}</KeyValueRow>
            <KeyValueRow label="Continue with Google">{m.google ? "Available" : "Not set up on the server"}</KeyValueRow>
          </>
        )}
        {m?.otp.echo && (
          <Text size="small" className="px-6 py-4 text-ui-fg-error">
            Development mode: sign-in codes are shown on screen instead of sent. Production refuses to start like this.
          </Text>
        )}
      </Container>
      {(Object.keys(PROVIDERS) as ProviderName[]).map((name) => (
        <ProviderCard key={name} name={name} status={providers.data.providers[name]} editable={editable} />
      ))}
    </div>
  );
};

export const config = defineRouteConfig({
  label: "Integrations",
});

export default IntegrationsPage;
