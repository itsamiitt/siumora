import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Jost, Marcellus } from "next/font/google";
import { GoogleTagManager } from "@next/third-parties/google";

import { SITE, organizationJsonLd, websiteJsonLd } from "@siumora/seo";

import { MetaPixelLoader, WebVitalsReporter } from "@/components/analytics-loaders";
import { ConsentBanner } from "@/components/consent-banner";
import { JsonLdScript } from "@/components/json-ld";
import { SiteFooter } from "@/components/site-footer";
import { FestivalBanner } from "@/components/festival-banner";
import { ServiceWorker } from "@/components/service-worker";
import { SiteHeader } from "@/components/site-header";
import { PRE_PAINT_SCRIPT } from "@/lib/pre-paint";

import "./globals.css";

/**
 * The three brand families, self-hosted by next/font so there is no render-
 * blocking request to Google and no layout shift (CLS budget is 0.05).
 */
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400"],
  variable: "--font-cormorant",
  display: "swap",
});

const marcellus = Marcellus({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-marcellus",
  display: "swap",
});

const jost = Jost({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-jost",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Siumora · Something given, something kept",
    template: "%s · Siumora",
  },
  description: SITE.description,
  metadataBase: new URL(SITE.url),
  openGraph: {
    type: "website",
    locale: "en_IN",
    siteName: "Siumora",
  },
};

export const viewport: Viewport = {
  // Two values so the browser chrome matches the ground the page actually
  // paints — Kagaz Ivory light, Ink Plate dark.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F3EA" },
    { media: "(prefers-color-scheme: dark)", color: "#14110F" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en-IN"
      className={`${cormorant.variable} ${marcellus.variable} ${jost.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Before paint, so a dark-theme visitor never sees an ivory flash. */}
        <script dangerouslySetInnerHTML={{ __html: PRE_PAINT_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <JsonLdScript data={[organizationJsonLd(), websiteJsonLd()]} />
        <FestivalBanner />
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
        <ConsentBanner />
        <ServiceWorker />
        {/* Tags load via the framework's optimized loader, never raw script
            tags (eng review 8A); the Pixel additionally waits for ads consent
            and first idle. Consent Mode v2 defaults are denied until the
            banner grants — the GTM container sees the dataLayer state. */}
        {process.env.NEXT_PUBLIC_GTM_ID && (
          <GoogleTagManager gtmId={process.env.NEXT_PUBLIC_GTM_ID} />
        )}
        {process.env.NEXT_PUBLIC_META_PIXEL_ID && (
          <MetaPixelLoader pixelId={process.env.NEXT_PUBLIC_META_PIXEL_ID} />
        )}
        <WebVitalsReporter />
      </body>
    </html>
  );
}
