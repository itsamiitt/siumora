import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Badge, Container, Heading, Text } from "@medusajs/ui";
import { useEffect, useState } from "react";

import { OpsError, opsFetch } from "../../../lib/ops";

/**
 * Settings → Messaging (auth plan phase 3): which channels this server can
 * send sign-in codes and alerts on. Read-only by design — credentials live
 * in the server environment (/etc/siumora/medusa.env) and change with a
 * redeploy, never through a form an admin session could rewrite.
 */

interface MessagingStatus {
  otp: { whatsapp: boolean; sms: boolean; echo: boolean };
  alerts: { whatsapp: boolean };
  email: boolean;
  turnstile: boolean;
  google: boolean;
}

const Row = ({ label, on, detail }: { label: string; on: boolean; detail: string }) => (
  <div className="mt-4 flex items-start justify-between gap-6">
    <div>
      <Text weight="plus">{label}</Text>
      <Text size="small" className="text-ui-fg-subtle">
        {detail}
      </Text>
    </div>
    <Badge color={on ? "green" : "grey"}>{on ? "Connected" : "Not set"}</Badge>
  </div>
);

const MessagingPage = () => {
  const [status, setStatus] = useState<MessagingStatus | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    opsFetch<MessagingStatus>("/admin/siumora/messaging")
      .then(setStatus)
      .catch((error) => setRefusal(error instanceof OpsError ? error.message : "Could not load."));
  }, []);

  return (
    <Container className="p-6">
      <Heading level="h1">Messaging</Heading>
      <Text size="small" className="mt-1 text-ui-fg-subtle">
        Codes go on WhatsApp first and fall back to SMS. To change a provider or template, update
        the server environment and redeploy.
      </Text>
      {refusal && <Text className="mt-4 text-ui-fg-subtle">{refusal}</Text>}
      {status && (
        <>
          <Row label="WhatsApp sign-in codes" on={status.otp.whatsapp} detail="BSP credentials plus the approved authentication template (WHATSAPP_OTP_TEMPLATE)." />
          <Row label="SMS sign-in codes" on={status.otp.sms} detail="MSG91 with the DLT-registered OTP template (MSG91_OTP_TEMPLATE_ID). End it with “@siumora.in #{code}” so Android fills it in." />
          <Row label="WhatsApp security alerts" on={status.alerts.whatsapp} detail="New-device and phone-change notices, through the pass-through text template." />
          <Row label="Email" on={status.email} detail="Resend — used for email verification links." />
          <Row label="Turnstile bot check" on={status.turnstile} detail="Cloudflare Turnstile on “Send code”. Needs the site key on the storefront too." />
          <Row label="Google sign-in" on={status.google} detail="GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. Switch it on under Customer sign-in." />
          {status.otp.echo && (
            <Text className="mt-6 text-ui-fg-error">
              OTP_ECHO is on: sign-in codes are shown on screen instead of sent. Development only —
              production refuses to boot with it.
            </Text>
          )}
        </>
      )}
    </Container>
  );
};

export const config = defineRouteConfig({
  label: "Messaging",
});

export default MessagingPage;
