import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { PencilSquare } from "@medusajs/icons";
import { Container, CurrencyInput, Input, Select, StatusBadge, Text, toast } from "@medusajs/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { CardSkeleton, EditDrawer, FormField, KeyValueRow, SectionHeader, inr } from "../components/kit";
import { GST_SLABS, missingFields, paiseToRupees, parseMrp, parseProductFields } from "../lib/india-fields";
import { opsFetch } from "../lib/ops";
import { missingPublishFields, type PublishCandidate } from "../../lib/product-publish-guard";

/**
 * India tax, in the product page's side column (made native in plan 16
 * Phase E): HSN, GST slab and each variant's MRP, read-only, edited in a
 * drawer. Selling prices stay in native Medusa pricing, so this card can
 * never create a second selling price.
 *
 * The save is validated before anything is written (../lib/india-fields.ts,
 * pure and tested), and refreshes the page's own product data so the native
 * sections never show a stale value beside it. A product missing a
 * statutory field says so in the header — the invoice refuses it until fixed.
 */

interface VariantRow {
  id: string;
  title: string | null;
  metadata?: Record<string, unknown> | null;
}
interface Product {
  id: string;
  metadata?: Record<string, unknown> | null;
  variants?: VariantRow[] | null;
}

/**
 * Whether shoppers can see this product, by the same rules the publish
 * guard enforces — so "published in admin, missing on the site" is visible
 * here instead of only in the storefront's logs.
 */
const StorefrontVisibility = ({ productId }: { productId: string }) => {
  const visibility = useQuery({
    queryKey: ["siumora", "storefront-visibility", productId],
    queryFn: async () => {
      const [{ product }, { api_keys }] = await Promise.all([
        opsFetch<{ product: PublishCandidate }>(
          `/admin/products/${productId}?fields=id,status,metadata,*variants,*variants.prices,*sales_channels`,
        ),
        opsFetch<{ api_keys: Array<{ revoked_at?: string | null; sales_channels?: Array<{ id: string }> | null }> }>(
          "/admin/api-keys?type=publishable&fields=id,revoked_at,*sales_channels&limit=50",
        ),
      ]);
      const live = api_keys.filter((key) => !key.revoked_at);
      const channels = live.length
        ? new Set(live.flatMap((key) => (key.sales_channels ?? []).map((channel) => channel.id)))
        : undefined;
      // Judge it as if published: a draft shows what still stands in the way.
      return { status: product.status, blockers: missingPublishFields({ ...product, status: "published" }, channels) };
    },
  });
  if (!visibility.data) return null;
  const { status, blockers } = visibility.data;
  const visible = status === "published" && blockers.length === 0;
  return (
    <div className="flex flex-col gap-1 px-6 py-4">
      <div className="flex items-center justify-between">
        <Text size="small" weight="plus">Storefront</Text>
        <StatusBadge color={visible ? "green" : status === "published" ? "red" : "grey"}>
          {visible ? "Visible to shoppers" : "Not visible on storefront"}
        </StatusBadge>
      </div>
      {!visible && (
        <Text size="small" className="text-ui-fg-subtle">
          {status !== "published" ? `Status is ${status ?? "unknown"}. ` : ""}
          {blockers.length ? `Needs ${blockers.join(", ")}.` : status !== "published" ? "Publish it to show it." : ""}
        </Text>
      )}
    </div>
  );
};

const IndiaFieldsWidget = ({ data }: { data: { id: string } }) => {
  const client = useQueryClient();
  const product = useQuery({
    queryKey: ["siumora", "india-fields", data.id],
    queryFn: () =>
      opsFetch<{ product: Product }>(`/admin/products/${data.id}?fields=id,metadata,*variants`).then((p) => p.product),
  });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hsn, setHsn] = useState("");
  const [gstSlab, setGstSlab] = useState("");
  const [mrp, setMrp] = useState<Record<string, string>>({});

  if (product.isLoading) return <CardSkeleton rows={3} />;
  if (!product.data) return null; // the product page reports its own load failure
  const p = product.data;
  const missing = missingFields(p);
  const slab = typeof p.metadata?.gst_slab === "number" ? p.metadata.gst_slab : undefined;

  const open = () => {
    setHsn(typeof p.metadata?.hsn === "string" ? p.metadata.hsn : "");
    setGstSlab(slab !== undefined ? String(slab) : "");
    setMrp(
      Object.fromEntries(
        (p.variants ?? []).map((variant) => [
          variant.id,
          typeof variant.metadata?.mrp_paise === "number" ? paiseToRupees(variant.metadata.mrp_paise) : "",
        ]),
      ),
    );
    setEditing(true);
  };

  const save = async () => {
    const fields = parseProductFields({ hsn, gstSlab });
    if (!fields.ok) {
      toast.error(fields.message);
      return;
    }
    const updates: Array<{ id: string; mrpPaise: number }> = [];
    for (const variant of p.variants ?? []) {
      const parsed = parseMrp(mrp[variant.id] ?? "");
      if (!parsed.ok) {
        toast.error(`${variant.title ?? variant.id}: ${parsed.message}`);
        return;
      }
      updates.push({ id: variant.id, mrpPaise: parsed.value });
    }

    setSaving(true);
    try {
      await opsFetch(`/admin/products/${p.id}`, {
        method: "POST",
        body: JSON.stringify({ metadata: { hsn: fields.value.hsn, gst_slab: fields.value.gstSlab } }),
      });
      for (const update of updates) {
        await opsFetch(`/admin/products/${p.id}/variants/${update.id}`, {
          method: "POST",
          body: JSON.stringify({ metadata: { mrp_paise: update.mrpPaise } }),
        });
      }
      // This card and every native query about this product re-read.
      await client.invalidateQueries({ predicate: (query) => JSON.stringify(query.queryKey).includes(p.id) });
      toast.success("India tax fields saved.");
      setEditing(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Not saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Container className="divide-y p-0">
      <SectionHeader
        title="India tax"
        badge={
          missing.length > 0 ? (
            <StatusBadge color="red">Incomplete</StatusBadge>
          ) : (
            <StatusBadge color="green">Complete</StatusBadge>
          )
        }
        actions={[[{ label: "Edit", icon: <PencilSquare />, onClick: open }]]}
      />
      <StorefrontVisibility productId={p.id} />
      {missing.length > 0 && (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-error">
            Missing {missing.join(", ")} — orders with this product cannot be invoiced until it is set.
          </Text>
        </div>
      )}
      <KeyValueRow label="HSN code">{typeof p.metadata?.hsn === "string" ? p.metadata.hsn : "—"}</KeyValueRow>
      <KeyValueRow label="GST slab">{slab !== undefined ? `${slab}%` : "—"}</KeyValueRow>
      {(p.variants ?? []).map((variant) => (
        <KeyValueRow key={variant.id} label={`MRP · ${variant.title ?? "Variant"}`}>
          {typeof variant.metadata?.mrp_paise === "number" ? inr(variant.metadata.mrp_paise) : "—"}
        </KeyValueRow>
      ))}

      <EditDrawer
        open={editing}
        onOpenChange={setEditing}
        title="Edit India tax"
        description="Printed on every GST invoice. Selling prices are edited in the variant's Pricing section."
        saving={saving}
        onSave={() => void save()}
      >
        <FormField label="HSN code" hint="Jewellery is usually 7113 (precious) or 7117 (imitation).">
          <Input value={hsn} onChange={(event) => setHsn(event.target.value)} placeholder="7113" />
        </FormField>
        <FormField label="GST slab">
          <Select value={gstSlab} onValueChange={setGstSlab}>
            <Select.Trigger>
              <Select.Value placeholder="Select a slab" />
            </Select.Trigger>
            <Select.Content>
              {GST_SLABS.map((value) => (
                <Select.Item key={value} value={String(value)}>
                  {value}%
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </FormField>
        {(p.variants ?? []).map((variant) => (
          <FormField key={variant.id} label={`MRP · ${variant.title ?? "Variant"}`} hint="Must be at least the selling price.">
            <CurrencyInput
              symbol="₹"
              code="INR"
              value={mrp[variant.id] ?? ""}
              onValueChange={(value) => setMrp({ ...mrp, [variant.id]: value ?? "" })}
            />
          </FormField>
        ))}
      </EditDrawer>
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "product.details.side.after",
});

export default IndiaFieldsWidget;
