import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { Badge, Button, Container, Heading, Input, Select, Text, toast } from "@medusajs/ui";
import { useEffect, useState } from "react";

import {
  GST_SLABS,
  missingFields,
  paiseToRupees,
  parseProductFields,
  parseMrp,
} from "../lib/india-fields";
import { opsFetch } from "../lib/ops";

/**
 * India fields: HSN, GST slab and MRP. Selling prices are edited in native
 * Medusa pricing so this widget cannot create an independent selling price.
 *
 * The widget refuses an invalid save (validation in ../lib/india-fields.ts,
 * pure and tested) and banners a product still missing any statutory field —
 * the M4 "NOT NULL" bar enforced where the operator can fix it.
 */

interface VariantRow {
  id: string;
  title: string | null;
  metadata?: Record<string, unknown> | null;
}

interface ProductPayload {
  product: {
    id: string;
    metadata?: Record<string, unknown> | null;
    variants?: VariantRow[] | null;
  };
}

interface VariantDraft {
  mrp: string;
}

const IndiaFieldsWidget = ({ data }: { data: { id: string } }) => {
  const [product, setProduct] = useState<ProductPayload["product"] | null>(null);
  const [hsn, setHsn] = useState("");
  const [gstSlab, setGstSlab] = useState("");
  const [variantDrafts, setVariantDrafts] = useState<Record<string, VariantDraft>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    opsFetch<ProductPayload>(
      `/admin/products/${data.id}?fields=id,metadata,*variants`,
    ).then((payload) => {
      if (cancelled) return;
      const p = payload.product;
      setProduct(p);
      setHsn(typeof p.metadata?.hsn === "string" ? p.metadata.hsn : "");
      setGstSlab(
        typeof p.metadata?.gst_slab === "number" ? String(p.metadata.gst_slab) : "",
      );
      const drafts: Record<string, VariantDraft> = {};
      for (const variant of p.variants ?? []) {
        const meta = variant.metadata ?? {};
        drafts[variant.id] = {
          mrp:
            typeof meta.mrp_paise === "number"
              ? paiseToRupees(meta.mrp_paise)
              : "",
        };
      }
      setVariantDrafts(drafts);
    }).catch(() => {
      // The product page itself will surface a load failure; the widget
      // stays quiet rather than doubling the error.
    });
    return () => {
      cancelled = true;
    };
  }, [data.id]);

  if (!product) return null;

  const missing = missingFields(product);

  const save = async () => {
    const parsedProduct = parseProductFields({ hsn, gstSlab });
    if (!parsedProduct.ok) {
      toast.error(parsedProduct.message);
      return;
    }
    const variantUpdates: Array<{ id: string; mrpPaise: number }> = [];
    for (const variant of product.variants ?? []) {
      const draft = variantDrafts[variant.id];
      if (!draft) continue;
      const parsed = parseMrp(draft.mrp);
      if (!parsed.ok) {
        toast.error(`${variant.title ?? variant.id}: ${parsed.message}`);
        return;
      }
      variantUpdates.push({ id: variant.id, mrpPaise: parsed.value });
    }

    setSaving(true);
    try {
      await opsFetch(`/admin/products/${product.id}`, {
        method: "POST",
        body: JSON.stringify({
          metadata: { hsn: parsedProduct.value.hsn, gst_slab: parsedProduct.value.gstSlab },
        }),
      });
      for (const update of variantUpdates) {
        await opsFetch(`/admin/products/${product.id}/variants/${update.id}`, {
          method: "POST",
          body: JSON.stringify({
            metadata: { mrp_paise: update.mrpPaise },
          }),
        });
      }
      toast.success("India fields saved.");
      setProduct({
        ...product,
        metadata: {
          ...product.metadata,
          hsn: parsedProduct.value.hsn,
          gst_slab: parsedProduct.value.gstSlab,
        },
        variants: (product.variants ?? []).map((variant) => {
          const update = variantUpdates.find((entry) => entry.id === variant.id);
          return update
            ? {
                ...variant,
                metadata: {
                  ...variant.metadata,
                  mrp_paise: update.mrpPaise,
                },
              }
            : variant;
        }),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">India fields</Heading>
        {missing.length > 0 ? (
          <Badge color="red">Incomplete: {missing.join(", ")}</Badge>
        ) : (
          <Badge color="green">Statutory fields set</Badge>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4 px-6 py-4">
        <div>
          <Text size="small" weight="plus">HSN code</Text>
          <Input
            value={hsn}
            onChange={(event) => setHsn(event.target.value)}
            placeholder="7113"
          />
        </div>
        <div>
          <Text size="small" weight="plus">GST slab</Text>
          <Select value={gstSlab} onValueChange={setGstSlab}>
            <Select.Trigger>
              <Select.Value placeholder="Select slab" />
            </Select.Trigger>
            <Select.Content>
              {GST_SLABS.map((slab) => (
                <Select.Item key={slab} value={String(slab)}>
                  {slab}%
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
      </div>
      <div className="px-6 py-4">
        <Text size="small" weight="plus" className="mb-2">
          Variant MRP (rupees)
        </Text>
        <Text size="small" className="mb-2">
          Set selling prices in the variant Pricing section. MRP must cover the selling price.
        </Text>
        {(product.variants ?? []).map((variant) => (
          <div key={variant.id} className="mb-2 grid grid-cols-2 items-center gap-4">
            <Text size="small">{variant.title ?? variant.id}</Text>
            <Input
              value={variantDrafts[variant.id]?.mrp ?? ""}
              onChange={(event) =>
                setVariantDrafts((drafts) => ({
                  ...drafts,
                  [variant.id]: {
                    mrp: event.target.value,
                  },
                }))
              }
              placeholder="MRP ₹"
            />
          </div>
        ))}
      </div>
      <div className="flex justify-end px-6 py-4">
        <Button size="small" onClick={save} isLoading={saving}>
          Save India fields
        </Button>
      </div>
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "product.details.after",
});

export default IndiaFieldsWidget;
