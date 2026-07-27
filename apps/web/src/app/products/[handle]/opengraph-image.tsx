import { ImageResponse } from "next/og";

import { lowestPrice } from "@siumora/core";
import { discountPercent, formatPaise } from "@siumora/in-locale";

import { getProduct } from "@/lib/catalog";
import { OG_COLOURS, OG_SIZE, OgFrame, OgMark, ogFonts } from "@/lib/og";

export const alt = "Siumora";
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
  const product = await getProduct(handle);
  const fonts = await ogFonts();

  // A share of a URL that no longer resolves should still look like us rather
  // than rendering a broken card.
  const title = product?.title ?? "Siumora";
  const subtitle = product?.subtitle ?? "Something given, something kept.";
  const price = product ? lowestPrice(product) : null;
  const off = price ? discountPercent(price.mrp, price.selling) : 0;

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
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: "auto",
          }}
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
            {product?.collections[0]?.replace(/-/g, " ") ?? "Gift & reward"}
          </span>

          <span
            style={{
              fontFamily: "Cormorant Garamond",
              fontSize: 82,
              lineHeight: 1.05,
              color: OG_COLOURS.INK,
              marginTop: 14,
            }}
          >
            {title}
          </span>

          <span
            style={{
              fontFamily: "Jost",
              fontSize: 26,
              color: "rgba(28,25,23,0.62)",
              marginTop: 14,
            }}
          >
            {subtitle}
          </span>

          {price && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 18,
                marginTop: 28,
              }}
            >
              {/* Cormorant, not Jost, and deliberately so: Jost has no rupee
                  glyph at any weight. In a browser that is invisible — the
                  font stack falls back per glyph — but Satori only has the two
                  faces passed to it, so a Jost price silently rendered the
                  whole string in Cormorant anyway. Choosing it makes the card
                  predictable, and the oldstyle figures suit the mark. */}
              <span
                style={{
                  fontFamily: "Cormorant Garamond",
                  fontSize: 46,
                  color: OG_COLOURS.INK,
                }}
              >
                {formatPaise(price.selling)}
              </span>
              {off > 0 && (
                <span
                  style={{
                    fontFamily: "Jost",
                    fontSize: 20,
                    letterSpacing: 4,
                    textTransform: "uppercase",
                    color: OG_COLOURS.MULBERRY,
                  }}
                >
                  {off}% off
                </span>
              )}
            </div>
          )}
        </div>
      </OgFrame>
    ),
    { ...size, fonts },
  );
}
