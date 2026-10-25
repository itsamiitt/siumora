import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { ArrowUpTray, MagnifyingGlass, PauseSolid, PencilSquare, PlaySolid } from "@medusajs/icons";
import {
  Button,
  Container,
  CurrencyInput,
  FocusModal,
  Input,
  Prompt,
  StatusBadge,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import { CardError, CardSkeleton, EditDrawer, FormField, KeyValueRow, SectionHeader, SwitchField, inr, rupeesToPaise, when } from "../components/kit";
import { OpsError, opsFetch } from "../lib/ops";
import { useImportPincodes, useProviders, useSaveSettings, useServiceability, useSiumoraSettings } from "../lib/queries";

/**
 * Store › Checkout & COD (plan 16 Phase E) — every checkout lever on the
 * native Store page, where an owner already looks, instead of a separate
 * "Store control center" in the sidebar.
 *
 * Read-only rows; the "⋯" menu edits the rules in a drawer (saved together,
 * one audit entry), pauses or resumes checkout behind a confirmation,
 * imports the courier's pincode list, and looks a pincode up exactly as the
 * storefront sees it. Payment and courier connections are shown here and
 * edited under Settings › Integrations — one place for credentials.
 */

const rupees = (paise: unknown) => (typeof paise === "number" ? String(paise / 100) : "");

const StoreCheckoutWidget = () => {
  const settings = useSiumoraSettings();
  const providers = useProviders();
  const pincodes = useServiceability();
  const save = useSaveSettings("Checkout rules saved.");

  const [editing, setEditing] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});

  if (settings.isLoading) return <CardSkeleton rows={6} />;
  if (settings.error || !settings.data) {
    // An operator without settings:write — the card is not theirs to see.
    return settings.error instanceof OpsError && settings.error.status === 403 ? null : (
      <CardError title="Checkout & COD" message={settings.error?.message ?? "Could not load the checkout settings."} />
    );
  }
  const s = settings.data;
  const paymentsOn = s.paymentsEnabled === true;
  const razorpay = providers.data?.providers.razorpay;
  const shiprocket = providers.data?.providers.shiprocket;

  const openEditor = () => {
    setDraft({
      codFee: rupees(s.codFee),
      codMinOrder: rupees(s.codMinOrder),
      codMaxOrder: rupees(s.codMaxOrder),
      codStepUpAbove: rupees(s.codStepUpAbove),
      codRequiresOtp: s.codRequiresOtp === true,
      giftMessageEnabled: s.giftMessageEnabled === true,
      cartRecoveryEnabled: s.cartRecoveryEnabled === true,
      cartRecoveryDelayMinutes: String(s.cartRecoveryDelayMinutes ?? 60),
    });
    setEditing(true);
  };

  const submitRules = () => {
    const money: Array<[string, string]> = [
      ["cod_fee", "codFee"],
      ["cod_min_order", "codMinOrder"],
      ["cod_max_order", "codMaxOrder"],
      ["cod_step_up_above", "codStepUpAbove"],
    ];
    const entries: Array<{ key: string; value: unknown }> = [];
    for (const [key, prop] of money) {
      const paise = rupeesToPaise(String(draft[prop] ?? ""));
      if (paise === undefined) {
        toast.error("Enter every amount in rupees.");
        return;
      }
      entries.push({ key, value: paise });
    }
    entries.push({ key: "cod_requires_otp", value: draft.codRequiresOtp === true });
    // Plan 16 Phase I: the optional checkout pieces.
    const delay = Number(draft.cartRecoveryDelayMinutes);
    if (!Number.isInteger(delay) || delay < 30 || delay > 1440) {
      toast.error("Send the reminder between 30 and 1440 minutes after the shopper leaves.");
      return;
    }
    entries.push({ key: "gift_message_enabled", value: draft.giftMessageEnabled === true });
    entries.push({ key: "cart_recovery_enabled", value: draft.cartRecoveryEnabled === true });
    entries.push({ key: "cart_recovery_delay_minutes", value: delay });
    save.mutate(entries, { onSuccess: () => setEditing(false) });
  };

  return (
    <Container className="divide-y p-0">
      <SectionHeader
        title="Checkout & COD"
        subtitle="What shoppers can pay with, and when cash on delivery is offered."
        badge={
          <StatusBadge color={paymentsOn ? "green" : "red"}>{paymentsOn ? "Checkout open" : "Checkout paused"}</StatusBadge>
        }
        actions={[
          [{ label: "Edit checkout rules", icon: <PencilSquare />, onClick: openEditor }],
          [
            { label: "Import pincodes", icon: <ArrowUpTray />, onClick: () => setImporting(true) },
            { label: "Look up a pincode", icon: <MagnifyingGlass />, onClick: () => setLookingUp(true) },
          ],
          [
            paymentsOn
              ? { label: "Pause checkout", icon: <PauseSolid />, onClick: () => setPausing(true), destructive: true }
              : {
                  label: "Resume checkout",
                  icon: <PlaySolid />,
                  onClick: () => save.mutate([{ key: "payments_enabled", value: true }]),
                },
          ],
        ]}
      />

      <KeyValueRow label="Online payments">
        {razorpay?.configured ? "Razorpay connected" : "Not connected — cash on delivery only"}
        {" · "}
        <Link to="/settings/integrations" className="text-ui-fg-interactive hover:underline">
          Integrations
        </Link>
      </KeyValueRow>
      <KeyValueRow label="Courier">
        {shiprocket?.configured ? "Shiprocket connected" : "Not connected — book couriers by hand"}
      </KeyValueRow>
      <KeyValueRow label="COD fee">{typeof s.codFee === "number" ? inr(s.codFee) : "—"}</KeyValueRow>
      <KeyValueRow label="COD order value">
        {typeof s.codMinOrder === "number" && typeof s.codMaxOrder === "number"
          ? `${inr(s.codMinOrder)} – ${inr(s.codMaxOrder)}`
          : "—"}
      </KeyValueRow>
      <KeyValueRow label="COD needs a verified phone">{s.codRequiresOtp === true ? "Yes" : "No"}</KeyValueRow>
      <KeyValueRow label="Fresh code for COD to a new address">
        {typeof s.codStepUpAbove === "number" ? `Above ${inr(s.codStepUpAbove)}` : "—"}
      </KeyValueRow>
      <KeyValueRow label="Serviceable pincodes">
        {pincodes.data
          ? `${pincodes.data.serviceable.toLocaleString("en-IN")} · COD on ${pincodes.data.codAvailable.toLocaleString("en-IN")}` +
            (pincodes.data.updatedAt ? ` · updated ${when(pincodes.data.updatedAt)}` : "")
          : "—"}
      </KeyValueRow>
      <KeyValueRow label="Gift message">{s.giftMessageEnabled === true ? "Offered at checkout" : "Off"}</KeyValueRow>
      <KeyValueRow label="Cart reminders">
        {s.cartRecoveryEnabled === true
          ? `One WhatsApp ${String(s.cartRecoveryDelayMinutes ?? 60)} minutes after a shopper who opted in leaves`
          : "Off"}
      </KeyValueRow>
      <KeyValueRow label="Coupons and offers">
        <Link to="/promotions" className="text-ui-fg-interactive hover:underline">
          Managed in Promotions
        </Link>
      </KeyValueRow>

      <EditDrawer
        open={editing}
        onOpenChange={setEditing}
        title="Edit checkout rules"
        description="Applies to new checkouts within 30 seconds. Saved together and recorded in the audit log."
        saving={save.isPending}
        onSave={submitRules}
      >
        <FormField label="COD fee" hint="Added to cash-on-delivery orders. Prepaid pays nothing extra.">
          <CurrencyInput symbol="₹" code="INR" value={String(draft.codFee ?? "")} onValueChange={(value) => setDraft({ ...draft, codFee: value ?? "" })} />
        </FormField>
        <FormField label="Smallest order for COD">
          <CurrencyInput symbol="₹" code="INR" value={String(draft.codMinOrder ?? "")} onValueChange={(value) => setDraft({ ...draft, codMinOrder: value ?? "" })} />
        </FormField>
        <FormField label="Largest order for COD" hint="Above this, only online payment is offered.">
          <CurrencyInput symbol="₹" code="INR" value={String(draft.codMaxOrder ?? "")} onValueChange={(value) => setDraft({ ...draft, codMaxOrder: value ?? "" })} />
        </FormField>
        <SwitchField
          label="COD needs a verified phone"
          hint="The delivery number is confirmed with a one-time code before a COD order is placed."
          checked={draft.codRequiresOtp === true}
          onCheckedChange={(checked) => setDraft({ ...draft, codRequiresOtp: checked })}
        />
        <FormField label="Fresh code for COD to a new address above" hint="A larger COD order to an address this account has never received at asks for a new code.">
          <CurrencyInput symbol="₹" code="INR" value={String(draft.codStepUpAbove ?? "")} onValueChange={(value) => setDraft({ ...draft, codStepUpAbove: value ?? "" })} />
        </FormField>
        <SwitchField
          label="Offer a gift message"
          hint="Shoppers can add up to 150 characters. It shows on the order page for whoever packs the parcel."
          checked={draft.giftMessageEnabled === true}
          onCheckedChange={(checked) => setDraft({ ...draft, giftMessageEnabled: checked })}
        />
        <SwitchField
          label="Cart reminders on WhatsApp"
          hint="Checkout asks first. A shopper who says yes and leaves gets one reminder with a link back to their bag — never at night."
          checked={draft.cartRecoveryEnabled === true}
          onCheckedChange={(checked) => setDraft({ ...draft, cartRecoveryEnabled: checked })}
        />
        {draft.cartRecoveryEnabled === true && (
          <FormField label="Send the reminder after (minutes)" hint="Counted from the last change to their bag. 30 to 1440.">
            <Input
              type="number"
              min={30}
              max={1440}
              value={String(draft.cartRecoveryDelayMinutes ?? "")}
              onChange={(event) => setDraft({ ...draft, cartRecoveryDelayMinutes: event.target.value })}
            />
          </FormField>
        )}
      </EditDrawer>

      <Prompt open={pausing} onOpenChange={setPausing}>
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>Pause checkout?</Prompt.Title>
            <Prompt.Description>
              Shoppers can still browse and keep their bags, but nobody can pay until you resume. The pause is recorded with your name.
            </Prompt.Description>
          </Prompt.Header>
          <Prompt.Footer>
            <Prompt.Cancel>Keep selling</Prompt.Cancel>
            <Prompt.Action onClick={() => save.mutate([{ key: "payments_enabled", value: false }], { onSettled: () => setPausing(false) })}>
              Pause checkout
            </Prompt.Action>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>

      <ImportPincodes open={importing} onOpenChange={setImporting} />
      <LookupPincode open={lookingUp} onOpenChange={setLookingUp} />
    </Container>
  );
};

/** The courier's pincode file: check it, see what changes, then apply. */
function ImportPincodes({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [csv, setCsv] = useState("");
  const [report, setReport] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const run = useImportPincodes();

  const reset = () => {
    setCsv("");
    setReport(null);
    setErrors([]);
    setChecked(false);
  };

  const submit = (dryRun: boolean) =>
    run.mutate(
      { csv, dryRun },
      {
        onSuccess: (result) => {
          setErrors([]);
          const line = `${result.rows.toLocaleString("en-IN")} pincodes: ${result.added} new, ${result.updated} changed, ${result.unchanged} unchanged.`;
          if (result.dryRun) {
            setReport(`Checked. ${line} Nothing is saved yet.`);
            setChecked(true);
          } else {
            toast.success(`Imported. ${line}`);
            reset();
            onOpenChange(false);
          }
        },
        onError: (error) => {
          setChecked(false);
          const listed = error instanceof OpsError ? error.errors : undefined;
          setErrors(listed ?? [error instanceof Error ? error.message : "The file was refused."]);
        },
      },
    );

  return (
    <FocusModal
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <FocusModal.Content>
        <FocusModal.Header>
          <div className="flex items-center justify-end gap-x-2">
            <Button size="small" variant="secondary" disabled={!csv.trim() || run.isPending} onClick={() => submit(true)}>
              Check file
            </Button>
            <Button size="small" disabled={!checked || run.isPending} isLoading={run.isPending && checked} onClick={() => submit(false)}>
              Import
            </Button>
          </div>
        </FocusModal.Header>
        <FocusModal.Body className="flex justify-center overflow-y-auto px-6 py-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-6">
            <div>
              <Text size="large" weight="plus">
                Import pincodes
              </Text>
              <Text size="small" className="text-ui-fg-subtle">
                The courier&apos;s list as CSV. Columns: pincode, state_code (two-digit GST code), and optionally city,
                serviceable, cod_available, estimated_days, rto_rate_bps. Pincodes not in the file are left as they are.
              </Text>
            </div>
            <div className="flex items-center gap-x-3">
              <Button size="small" variant="secondary" onClick={() => file.current?.click()}>
                Choose a file
              </Button>
              <input
                ref={file}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={async (event) => {
                  const chosen = event.target.files?.[0];
                  if (chosen) {
                    setCsv(await chosen.text());
                    setChecked(false);
                    setReport(null);
                  }
                  event.target.value = "";
                }}
              />
              <Text size="small" className="text-ui-fg-subtle">
                or paste it below
              </Text>
            </div>
            <Textarea
              rows={12}
              className="font-mono"
              value={csv}
              placeholder={"pincode,city,state_code,serviceable,cod_available,estimated_days\n400001,Mumbai,27,yes,yes,2-3"}
              onChange={(event) => {
                setCsv(event.target.value);
                setChecked(false);
                setReport(null);
              }}
            />
            {report && <Text size="small">{report}</Text>}
            {errors.length > 0 && (
              <ul className="flex flex-col gap-y-1">
                {errors.map((line) => (
                  <li key={line}>
                    <Text size="small" className="text-ui-fg-error">
                      {line}
                    </Text>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  );
}

interface PincodeCard {
  pincode: string;
  city?: string;
  stateCode?: string;
  serviceable: boolean;
  codAvailable: boolean;
  estimatedDays: string;
  rtoRateBps: number;
}

/** One pincode, exactly as the storefront's delivery check sees it. */
function LookupPincode({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [pincode, setPincode] = useState("");
  const [card, setCard] = useState<PincodeCard | null>(null);
  const [busy, setBusy] = useState(false);

  const look = async () => {
    setBusy(true);
    try {
      const payload = await opsFetch<{ card: PincodeCard }>(`/admin/siumora/serviceability?pincode=${encodeURIComponent(pincode)}`);
      setCard(payload.card);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not look that up.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditDrawer open={open} onOpenChange={onOpenChange} title="Look up a pincode" saving={busy} onSave={look} saveLabel="Look up">
      <FormField label="Pincode">
        <Input
          value={pincode}
          inputMode="numeric"
          maxLength={6}
          onChange={(event) => {
            setPincode(event.target.value.replace(/\D/g, ""));
            setCard(null);
          }}
        />
      </FormField>
      {card && (
        <div className="flex flex-col gap-y-2">
          <Text size="small">
            {card.serviceable ? `Delivered in ${card.estimatedDays} days` : "Not served by the courier"}
            {card.city ? ` · ${card.city}` : ""}
          </Text>
          <Text size="small">Cash on delivery: {card.codAvailable ? "available" : "not available"}</Text>
          {card.rtoRateBps > 0 && (
            <Text size="small" className="text-ui-fg-subtle">
              Returned-to-origin rate {(card.rtoRateBps / 100).toFixed(1)}%
            </Text>
          )}
        </div>
      )}
    </EditDrawer>
  );
}

export const config = defineWidgetConfig({
  zone: "store.details.after",
});

export default StoreCheckoutWidget;
