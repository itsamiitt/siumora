import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text } from "@medusajs/ui";

import { inr } from "../../../lib/ops";
import { NumberSetting, ToggleSetting, useSiumoraSettings } from "../../../lib/settings-controls";

/**
 * Settings → Customer sign-in (auth plan phase 3): every lever on how
 * shoppers sign in, in one place, owner only (the PATCH route enforces it).
 *
 * - Codes: lifetime, resend wait, codes per number per window, wrong
 *   guesses before a code locks (core's OtpPolicy).
 * - Abuse caps: codes per connection per hour, per number per day, and the
 *   site's daily SMS budget (WhatsApp keeps working past it).
 * - Checkout: whether COD needs the delivery phone verified, and the order
 *   value above which a new address needs a fresh code.
 * - Alerts and methods: the new-device WhatsApp alert; Google sign-in and
 *   the share of shoppers who see it (the A/B arm).
 *
 * Every change is audited and reaches sign-in within the 30-second
 * settings cache.
 */

const CODE_LEVERS = [
  { key: "otp_ttl_seconds", prop: "otpTtlSeconds", label: "Code lifetime (seconds)", hint: "60–600. NIST's ceiling for out-of-band codes is 10 minutes." },
  { key: "otp_resend_cooldown_seconds", prop: "otpResendCooldownSeconds", label: "Resend wait (seconds)", hint: "15–600." },
  { key: "otp_max_sends_per_window", prop: "otpMaxSendsPerWindow", label: "Codes per number per window", hint: "1–20." },
  { key: "otp_send_window_seconds", prop: "otpSendWindowSeconds", label: "That window (seconds)", hint: "600–86400." },
  { key: "otp_max_attempts", prop: "otpMaxAttempts", label: "Wrong guesses before a code locks", hint: "1–10." },
] as const;

const ABUSE_LEVERS = [
  { key: "otp_max_sends_per_ip_hour", prop: "otpMaxSendsPerIpHour", label: "Codes per connection per hour", hint: "1–500, across all numbers. Mobile networks share addresses — keep this generous." },
  { key: "otp_max_sends_per_day", prop: "otpMaxSendsPerDay", label: "Codes per number per day", hint: "1–50." },
  { key: "otp_daily_sms_cap", prop: "otpDailySmsCap", label: "SMS budget per day (whole site)", hint: "0–100000. Past it, codes go on WhatsApp only. 0 turns SMS off." },
] as const;

const CustomerSignInPage = () => {
  const { settings, refusal, busy, write } = useSiumoraSettings();

  if (refusal) {
    return (
      <Container className="p-6">
        <Heading level="h1">Customer sign-in</Heading>
        <Text className="mt-2 text-ui-fg-subtle">{refusal}</Text>
      </Container>
    );
  }
  if (!settings) return null;
  const num = (prop: string) => Number(settings[prop]);
  const bool = (prop: string) => settings[prop] === true;

  return (
    <div className="flex flex-col gap-4">
      <Container className="p-6">
        <Heading level="h1">Customer sign-in</Heading>
        <Text size="small" className="mt-1 text-ui-fg-subtle">
          Shoppers sign in with a one-time code on WhatsApp or SMS. Changes are audited and
          apply within 30 seconds.
        </Text>
      </Container>

      <Container className="p-6">
        <Heading level="h2">Codes</Heading>
        {CODE_LEVERS.map((lever) => (
          <NumberSetting
            key={lever.key}
            label={lever.label}
            hint={lever.hint}
            current={num(lever.prop)}
            disabled={busy}
            onSave={(value) => write(lever.key, value)}
          />
        ))}
      </Container>

      <Container className="p-6">
        <Heading level="h2">Abuse caps</Heading>
        <Text size="small" className="mt-1 text-ui-fg-subtle">
          Tighten these during an attack. The Abuse page shows who is sending.
        </Text>
        {ABUSE_LEVERS.map((lever) => (
          <NumberSetting
            key={lever.key}
            label={lever.label}
            hint={lever.hint}
            current={num(lever.prop)}
            disabled={busy}
            onSave={(value) => write(lever.key, value)}
          />
        ))}
      </Container>

      <Container className="p-6">
        <Heading level="h2">Checkout</Heading>
        <ToggleSetting
          label="Cash on delivery needs a verified phone"
          hint="The delivery number must be signed in with an OTP before a COD order is placed."
          checked={bool("codRequiresOtp")}
          disabled={busy}
          onChange={(next) => write("cod_requires_otp", next)}
        />
        <NumberSetting
          label="Fresh code for COD to a new address above"
          hint="Rupees. A larger COD order to an address this account has never received at asks for a fresh code."
          current={num("codStepUpAbove")}
          disabled={busy}
          format={(paise) => inr(paise)}
          parse={(raw) => Math.round(Number(raw.replaceAll(",", "").replace("₹", "")) * 100)}
          onSave={(value) => write("cod_step_up_above", value)}
        />
      </Container>

      <Container className="p-6">
        <Heading level="h2">Alerts and methods</Heading>
        <ToggleSetting
          label="New-device alert on WhatsApp"
          hint="Tell the account holder when their account signs in on a device it has not used before."
          checked={bool("newDeviceAlerts")}
          disabled={busy}
          onChange={(next) => write("new_device_alerts", next)}
        />
        <ToggleSetting
          label="Google sign-in"
          hint="Offer Continue with Google. A Google account links to a customer only after an OTP proves their phone. Needs GOOGLE_CLIENT_ID on the server."
          checked={bool("googleSignInEnabled")}
          disabled={busy}
          onChange={(next) => write("google_signin_enabled", next)}
        />
        <NumberSetting
          label="Shoppers who see Google sign-in (%)"
          hint="0–100. The rest see phone only; compare checkout completion between the two before going to 100."
          current={num("googleSignInPercent")}
          disabled={busy}
          onSave={(value) => write("google_signin_percent", value)}
        />
      </Container>
    </div>
  );
};

export const config = defineRouteConfig({
  label: "Customer sign-in",
});

export default CustomerSignInPage;
