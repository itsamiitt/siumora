import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Jost, Marcellus } from "next/font/google";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

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
  description:
    "Demi-fine jewellery in 925 sterling silver and 18k gold PVD. Made to be worn every day. Every piece leaves here wrapped as a gift.",
  metadataBase: new URL("https://siumora.com"),
  openGraph: {
    type: "website",
    locale: "en_IN",
    siteName: "Siumora",
  },
};

export const viewport: Viewport = {
  themeColor: "#F7F3EA",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en-IN"
      className={`${cormorant.variable} ${marcellus.variable} ${jost.variable}`}
    >
      <body className="flex min-h-dvh flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
