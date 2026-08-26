/**
 * Pure validation for the India-fields widget (M4: HSN, GST slab, MRP —
 * NOT NULL, feeding invoicing and GSTR-1). No imports at all, so node
 * --test strip-types it and the widget stays thin.
 *
 * The slabs mirror core's GST_SLABS ([0, 5, 18, 40] — GST 2.0); mirrored
 * rather than imported because the admin bundle must not pull @siumora/core
 * into the browser build. The seed writes hsn/gst_slab on PRODUCT metadata
 * and mrp_paise/price_paise on VARIANT metadata (src/scripts/seed.ts), and
 * the invoice path reads exactly those keys — this widget edits the same
 * truth.
 */

export const GST_SLABS = [0, 5, 18, 40] as const;

export interface ProductIndiaFields {
  hsn: string;
  gstSlab: number;
}

export interface VariantIndiaFields {
  mrpPaise: number;
  pricePaise: number;
}

export function parseProductFields(input: {
  hsn: string;
  gstSlab: string;
}): { ok: true; value: ProductIndiaFields } | { ok: false; message: string } {
  const hsn = input.hsn.trim();
  if (!/^\d{4,8}$/.test(hsn)) {
    return { ok: false, message: "HSN must be 4 to 8 digits." };
  }
  // Number("") is 0 — a real slab — so an unpicked select must refuse
  // before the numeric check ever runs.
  const slab = input.gstSlab.trim() === "" ? NaN : Number(input.gstSlab);
  if (!(GST_SLABS as readonly number[]).includes(slab)) {
    return { ok: false, message: `GST slab must be one of ${GST_SLABS.join(", ")}%.` };
  }
  return { ok: true, value: { hsn, gstSlab: slab } };
}

/**
 * Rupee text inputs to integer paise. The operator types rupees (₹1,990 or
 * 1990.50); storage is integer paise, and a value that does not land on a
 * whole paisa is a typo, not a price.
 */
export function rupeesToPaise(raw: string): number | undefined {
  const cleaned = raw.replaceAll(",", "").replaceAll("₹", "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
  return Math.round(Number(cleaned) * 100);
}

export function paiseToRupees(paise: number): string {
  return (paise / 100).toFixed(2).replace(/\.00$/, "");
}

export function parseVariantFields(input: {
  mrp: string;
  price: string;
}): { ok: true; value: VariantIndiaFields } | { ok: false; message: string } {
  const mrpPaise = rupeesToPaise(input.mrp);
  if (mrpPaise === undefined || mrpPaise <= 0) {
    return { ok: false, message: "MRP must be a positive rupee amount." };
  }
  const pricePaise = rupeesToPaise(input.price);
  if (pricePaise === undefined || pricePaise <= 0) {
    return { ok: false, message: "Price must be a positive rupee amount." };
  }
  if (mrpPaise < pricePaise) {
    return { ok: false, message: "MRP cannot be below the selling price." };
  }
  return { ok: true, value: { mrpPaise, pricePaise } };
}

/** The banner check: which statutory fields are still missing. */
export function missingFields(product: {
  metadata?: Record<string, unknown> | null;
  variants?: Array<{ metadata?: Record<string, unknown> | null }> | null;
}): string[] {
  const missing: string[] = [];
  const meta = product.metadata ?? {};
  if (typeof meta.hsn !== "string" || meta.hsn.length === 0) missing.push("HSN");
  if (typeof meta.gst_slab !== "number") missing.push("GST slab");
  for (const variant of product.variants ?? []) {
    const vm = variant.metadata ?? {};
    if (typeof vm.mrp_paise !== "number" || typeof vm.price_paise !== "number") {
      missing.push("variant MRP/price paise");
      break;
    }
  }
  return missing;
}
