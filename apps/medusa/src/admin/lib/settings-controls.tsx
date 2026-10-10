import { Button, Input, Switch, Text, toast } from "@medusajs/ui";
import { useCallback, useEffect, useState } from "react";

import { OpsError, opsFetch } from "./ops";

/**
 * Shared plumbing for the Siumora settings pages (auth plan phase 3): load
 * the runtime settings once, write one key at a time through the audited
 * PATCH /admin/siumora/settings, and render a lever as a switch or a
 * bounded number with its range in view.
 */

export type SettingsBag = Record<string, unknown>;

export function useSiumoraSettings() {
  const [settings, setSettings] = useState<SettingsBag | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    opsFetch<{ settings: SettingsBag }>("/admin/siumora/settings")
      .then((payload) => setSettings(payload.settings))
      .catch((error) =>
        setRefusal(error instanceof OpsError ? error.message : "Could not load settings."),
      );
  }, []);

  const write = useCallback(async (key: string, value: unknown) => {
    setBusy(true);
    try {
      const payload = await opsFetch<{ settings: SettingsBag }>("/admin/siumora/settings", {
        method: "PATCH",
        body: JSON.stringify({ key, value }),
      });
      setSettings(payload.settings);
      toast.success("Saved and audited.");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Write refused.");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { settings, refusal, busy, write };
}

export function ToggleSetting({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="mt-4 flex items-start justify-between gap-6">
      <div>
        <Text weight="plus">{label}</Text>
        <Text size="small" className="text-ui-fg-subtle">
          {hint}
        </Text>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

export function NumberSetting({
  label,
  hint,
  current,
  disabled,
  onSave,
  format = String,
  parse = (raw: string) => Number(raw.trim()),
}: {
  label: string;
  hint: string;
  current: number;
  disabled: boolean;
  onSave: (value: number) => Promise<boolean>;
  format?: (value: number) => string;
  parse?: (raw: string) => number;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="mt-4 flex items-end gap-2">
      <div className="flex-1">
        <Text size="small" weight="plus">
          {label} — currently {format(current)}
        </Text>
        <Text size="xsmall" className="text-ui-fg-subtle">
          {hint}
        </Text>
        <Input
          value={draft}
          placeholder={format(current)}
          inputMode="numeric"
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      <Button
        size="small"
        variant="secondary"
        disabled={disabled || !draft.trim()}
        onClick={async () => {
          const value = parse(draft);
          if (!Number.isFinite(value)) {
            toast.error("Expected a number.");
            return;
          }
          if (await onSave(value)) setDraft("");
        }}
      >
        Save
      </Button>
    </div>
  );
}
