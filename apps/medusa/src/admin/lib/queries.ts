import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@medusajs/ui";

import type { ProviderName } from "../../modules/settings/provider-fields";
import { opsFetch } from "./ops";

/**
 * React-query hooks over the /admin/siumora routes (plan 16 Phase E) — the
 * dashboard's own QueryClient, so a value fetched once is shared by every
 * card that shows it (the store page used to fetch /settings three times),
 * and a save refreshes everything reading it.
 */

export type SettingsBag = Record<string, unknown>;

export const keys = {
  settings: ["siumora", "settings"] as const,
  providers: ["siumora", "providers"] as const,
  messaging: ["siumora", "messaging"] as const,
  serviceability: ["siumora", "serviceability"] as const,
  orderCard: (orderId: string) => ["siumora", "order", orderId] as const,
};

export function useSiumoraSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: () => opsFetch<{ settings: SettingsBag }>("/admin/siumora/settings").then((p) => p.settings),
  });
}

/** Save several settings at once — all or nothing, one audit entry. */
export function useSaveSettings(done?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (entries: Array<{ key: string; value: unknown }>) =>
      opsFetch<{ settings: SettingsBag }>("/admin/siumora/settings", {
        method: "PATCH",
        body: JSON.stringify({ entries }),
      }).then((p) => p.settings),
    onSuccess: (settings) => {
      client.setQueryData(keys.settings, settings);
      toast.success(done ?? "Saved.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Not saved."),
  });
}

export interface ProviderStatus {
  enabled: boolean;
  configured: boolean;
  saved: boolean;
  fields: Record<string, boolean>;
  error?: string;
}
export interface ProvidersPayload {
  editable: boolean;
  providers: Record<ProviderName, ProviderStatus>;
}

export function useProviders() {
  return useQuery({
    queryKey: keys.providers,
    queryFn: () => opsFetch<ProvidersPayload>("/admin/siumora/providers"),
  });
}

export function useSaveProvider() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { provider: ProviderName; enabled: boolean; fields: Record<string, string> }) =>
      opsFetch<ProvidersPayload>("/admin/siumora/providers", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: (payload) => {
      client.setQueryData(keys.providers, payload);
      void client.invalidateQueries({ queryKey: keys.messaging });
      toast.success("Saved. Credentials are stored encrypted and never shown again.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Not saved."),
  });
}

export interface MessagingStatus {
  otp: { whatsapp: boolean; sms: boolean; echo: boolean };
  alerts: { whatsapp: boolean };
  email: boolean;
  turnstile: boolean;
  google: boolean;
}

export function useMessagingStatus() {
  return useQuery({
    queryKey: keys.messaging,
    queryFn: () => opsFetch<MessagingStatus>("/admin/siumora/messaging"),
  });
}

export interface ServiceabilitySummary {
  total: number;
  serviceable: number;
  codAvailable: number;
  updatedAt: string | null;
}

export function useServiceability() {
  return useQuery({
    queryKey: keys.serviceability,
    queryFn: () =>
      opsFetch<{ summary: ServiceabilitySummary }>("/admin/siumora/serviceability").then((p) => p.summary),
  });
}

export function useImportPincodes() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { csv: string; dryRun: boolean }) =>
      opsFetch<{
        dryRun: boolean;
        rows: number;
        added: number;
        updated: number;
        unchanged: number;
        summary: ServiceabilitySummary;
      }>("/admin/siumora/serviceability", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (result) => {
      if (!result.dryRun) client.setQueryData(keys.serviceability, result.summary);
    },
  });
}
