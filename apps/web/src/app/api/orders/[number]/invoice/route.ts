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

  const client = await apiAs();
  const key = await orderAccessKey(number);
  const result = await client.invoicePdf(number, key);

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
      "content-disposition": `inline; filename="invoice-${number}.pdf"`,
      // Personal data. Never in a shared cache, never on disk after the tab
      // closes.
      "cache-control": "private, no-store",
    },
  });
}
