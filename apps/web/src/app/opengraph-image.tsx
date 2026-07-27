import { ImageResponse } from "next/og";

import { SITE } from "@siumora/seo";

import { OG_COLOURS, OG_SIZE, OgFrame, OgMark, ogFonts } from "@/lib/og";

export const alt = "Siumora — something given, something kept";
export const size = OG_SIZE;
export const contentType = "image/png";

/** Site-wide card. Used for the home page and anything without its own image. */
export default async function Image() {
  const fonts = await ogFonts();

  return new ImageResponse(
    (
      <OgFrame>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            width: "100%",
          }}
        >
          <OgMark size={104} />
          <span
            style={{
              fontFamily: "Cormorant Garamond",
              fontSize: 68,
              letterSpacing: 24,
              color: OG_COLOURS.INK,
              marginTop: 34,
              paddingLeft: 24,
            }}
          >
            SIUMORA
          </span>
          <span
            style={{
              fontFamily: "Cormorant Garamond",
              fontSize: 34,
              color: "rgba(28,25,23,0.62)",
              marginTop: 18,
            }}
          >
            {SITE.tagline}
          </span>
        </div>
      </OgFrame>
    ),
    { ...size, fonts },
  );
}
