import { ImageResponse } from "next/og";

import { getCollection, listProductsInCollection } from "@/lib/catalog";
import { OG_COLOURS, OG_SIZE, OgFrame, OgMark, ogFonts } from "@/lib/og";

export const alt = "Siumora collection";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  // A Promise in Next 16, exactly like a page's params. Reading `.handle`
  // straight off it yields undefined and the card silently renders its
  // fallback — which still looks correct, so it has to be checked, not assumed.
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const [collection, products, fonts] = await Promise.all([
    getCollection(handle),
    listProductsInCollection(handle),
    ogFonts(),
  ]);

  return new ImageResponse(
    (
      <OgFrame>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <OgMark size={56} />
          <span
            style={{
              fontFamily: "Cormorant Garamond",
              fontSize: 34,
              letterSpacing: 12,
              color: OG_COLOURS.INK,
            }}
          >
            SIUMORA
          </span>
        </div>

        <div
          style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}
        >
          <span
            style={{
              fontFamily: "Jost",
              fontSize: 18,
              letterSpacing: 6,
              textTransform: "uppercase",
              color: OG_COLOURS.MULBERRY,
            }}
          >
            Collection
          </span>

          <span
            style={{
              fontFamily: "Cormorant Garamond",
              fontSize: 88,
              lineHeight: 1.05,
              color: OG_COLOURS.INK,
              marginTop: 14,
            }}
          >
            {collection?.title ?? "Siumora"}
          </span>

          <span
            style={{
              fontFamily: "Jost",
              fontSize: 26,
              color: "rgba(28,25,23,0.62)",
              marginTop: 16,
            }}
          >
            {collection?.description ?? "Something given, something kept."}
            {products.length > 0 && ` · ${products.length} pieces`}
          </span>
        </div>
      </OgFrame>
    ),
    { ...size, fonts },
  );
}
