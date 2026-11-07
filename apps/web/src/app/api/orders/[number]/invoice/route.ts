import { apiAs, orderAccessKey } from "@/lib/session";

/**
 * The tax invoice, proxied.
 *
 * The browser cannot fetch it from the API directly: the session lives in an
 * HTTP-only cookie on this origin, and a guest's access key is deliberately not
 * exposed to client JavaScript either. So the request is made here, with
 * whichever credential the visitor actually holds, and the bytes are passed
 * through.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const { number } = await params;

  let result: { ok: boolean; status: number; body?: ArrayBuffer };
  try {
    const client = await apiAs();
    const key = await orderAccessKey(number);
    result = await client.invoicePdf(number, key);
  } catch {
    // Backend unreachable — say so plainly instead of an unhandled 500.
    return Response.json(
      { error: "unavailable", message: "The invoice cannot be fetched right now. Try again shortly." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  if (!result.ok || !result.body) {
    // The API's own status is passed through: 404 for an order this visitor
    // may not see, 409 before an invoice exists, 503 when the seller's
    // registered details are not configured. Flattening them to one code would
    // lose the difference between "not yours" and "not yet".
    return new Response(null, { status: result.status });
  }

  return new Response(result.body, {
    headers: {
      "content-type": "application/pdf",
      // The param is visitor input: only order-number characters reach the
      // header, so a crafted value cannot break out of the quoted filename.
      "content-disposition": `inline; filename="invoice-${safeFilePart(number)}.pdf"`,
      // Personal data. Never in a shared cache, never on disk after the tab
      // closes.
      "cache-control": "private, no-store",
    },
  });
}

/** Order numbers are SIU-00001 style; anything else is dropped. */
function safeFilePart(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 40) || "order";
}
