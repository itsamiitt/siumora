import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Jost, Marcellus } from "next/font/google";

import { SITE, organizationJsonLd, websiteJsonLd } from "@siumora/seo";

import { ConsentBanner } from "@/components/consent-banner";
import { JsonLdScript } from "@/components/json-ld";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { THEME_SCRIPT } from "@/components/theme-toggle";

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
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <JsonLdScript data={[organizationJsonLd(), websiteJsonLd()]} />
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
        <ConsentBanner />
      </body>
    </html>
  );
}
