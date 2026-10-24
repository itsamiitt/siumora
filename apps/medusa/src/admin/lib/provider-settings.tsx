import { Button, Container, Heading, Input, Switch, Text, toast } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { PROVIDERS, type ProviderName } from "../../modules/settings/provider-fields";
import { opsFetch } from "./ops";

type Status = { enabled: boolean; configured: boolean; saved: boolean; fields: Record<string, boolean>; error?: string };
type Payload = { editable: boolean; providers: Record<ProviderName, Status> };
const hints: Record<ProviderName, string> = {
  razorpay: "Credentials can be stored here. Prepaid checkout and webhook processing are not yet connected in Medusa; Razorpay is not offered to shoppers.",
  whatsapp: "Used for sign-in codes and account security alerts. Enter your compatible BSP endpoint and approved text and OTP template names.",
  sms: "MSG91 delivers sign-in codes, including fallback when WhatsApp fails. Use your approved DLT OTP template ID.",
  email: "Resend sends account email-verification links. Use a sender on your verified Resend domain.",
};

export function ProviderSettings() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { opsFetch<Payload>("/admin/siumora/providers").then(setData).catch(e => setError(e.message)); }, []);
  return <Container className="p-6"><Heading level="h2">Payment and messaging providers</Heading>
    <Text className="mt-2 text-ui-fg-subtle">Credentials are encrypted on the server and never displayed again. Configured means required values are present; it does not verify provider approval or delivery.</Text>
    {error ? <Text>{error}</Text> : !data ? <Text>Loading providers…</Text> : <>
      {!data.editable && <Text className="mt-3">Server setup required: set SETTINGS_ENCRYPTION_KEY to a random secret of at least 32 characters. Keep this key backed up to retain access to saved credentials.</Text>}
      {(Object.keys(PROVIDERS) as ProviderName[]).map(name => <ProviderForm key={name} name={name} status={data.providers[name]} editable={data.editable} onSaved={setData} />)}
    </>}
  </Container>;
}

function ProviderForm({ name, status, editable, onSaved }: { name: ProviderName; status: Status; editable: boolean; onSaved: (payload: Payload) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  return <section className="mt-5 rounded-lg border p-4">
    <div className="flex items-center justify-between"><Heading level="h3">{PROVIDERS[name].label}</Heading><Text size="small">{name === "razorpay" ? "Checkout integration pending" : status.configured ? "Configured" : status.enabled ? "Missing configuration" : "Disabled"}</Text></div>
    <Text size="small" className="mt-2 text-ui-fg-subtle">{hints[name]}</Text>
    {status.error && <Text>{status.error}</Text>}
    {name !== "razorpay" && <label className="mt-3 flex items-center gap-3"><Switch checked={enabled ?? status.enabled} disabled={!editable || busy} onCheckedChange={setEnabled} /><Text>Enable channel</Text></label>}
    <div className="mt-3 grid gap-3 md:grid-cols-2">{PROVIDERS[name].fields.map(field => <label key={field}><Text size="small">{field.replaceAll("_", " ")}{status.fields[field] ? " · saved" : " · missing"}</Text><Input type={/KEY|SECRET/.test(field) ? "password" : "text"} autoComplete="off" disabled={!editable || busy} value={draft[field] ?? ""} placeholder={status.fields[field] ? "Leave unchanged" : "Enter value"} onChange={event => setDraft({ ...draft, [field]: event.target.value })} /></label>)}</div>
    <Text size="xsmall" className="mt-2 text-ui-fg-subtle">Blank fields keep existing values. Disable the channel to stop sending. Order confirmation, shipping, and marketing notifications are not connected yet.</Text>
    <Button className="mt-3" disabled={!editable || busy || (enabled === null && !Object.values(draft).some(Boolean))} onClick={async () => {
      setBusy(true);
      try {
        const fields = Object.fromEntries(Object.entries(draft).filter(([, value]) => value.trim()));
        onSaved(await opsFetch<Payload>("/admin/siumora/providers", { method: "PATCH", body: JSON.stringify({ provider: name, enabled: enabled ?? status.enabled, fields }) }));
        setDraft({}); setEnabled(null); toast.success("Provider settings saved.");
      } catch (e) { toast.error(e instanceof Error ? e.message : "Save failed."); }
      finally { setBusy(false); }
    }}>Save {PROVIDERS[name].label}</Button>
  </section>;
}
