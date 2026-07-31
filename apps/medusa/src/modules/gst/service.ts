import { MedusaService } from "@medusajs/framework/utils";

import { GstInvoice } from "./models/gst-invoice";

/**
 * Generated CRUD over the invoice table (listGstInvoices etc.).
 *
 * The issue write does NOT go through this service: drawing a gapless
 * statutory sequence needs MAX+1 + number formatting + ON CONFLICT in a
 * single INSERT under a same-table lock, which the generated create cannot
 * express. That lives in allocate.ts against the shared pg connection; this
 * service exists so the module owns its model, its migrations, and the
 * GSTR-1 / recon reads that come with the rest of M2.
 */
class GstModuleService extends MedusaService({ GstInvoice }) {}

export default GstModuleService;
