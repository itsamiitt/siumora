import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { SiumoraLockupHorizontal, SiumoraMark } from "@siumora/ui";

import { PreviewUnlock } from "@/components/preview-unlock";
import { WaitlistForm } from "@/components/waitlist-form";

export const metadata: Metadata = {
  title: "Coming soon",
  description: "Something worth waiting for. Be first to know when Siumora opens.",
};

export default function ComingSoonPage() {
  return (
    <div className="flex min-h-svh flex-col bg-ivory text-ink [color-scheme:light]">
      <header className="mx-auto flex w-full max-w-[1440px] items-center justify-between gap-4 px-5 py-4 sm:px-10 lg:px-16 lg:py-6">
        <SiumoraLockupHorizontal size={28} tone="ink" />
        {process.env.SITE_PHASE === "coming-soon" && <PreviewUnlock />}
      </header>

      <div className="mx-auto grid w-full max-w-[1440px] flex-1 gap-7 px-5 pb-8 sm:px-10 md:grid-cols-2 md:items-center md:gap-12 md:pb-10 lg:gap-20 lg:px-16">
        <figure className="relative min-w-0 self-stretch overflow-hidden bg-blush">
          <div className="relative aspect-[2.15/1] sm:aspect-[2.5/1] md:absolute md:inset-0 md:aspect-auto">
            <Image
              src="/coming-soon/atelier.webp"
              alt="A mulberry jewellery pouch and a fine gold chain resting on warm ivory linen."
              fill
              preload
              sizes="(max-width: 767px) calc(100vw - 40px), (max-width: 1440px) 48vw, 616px"
              className="object-cover object-[center_48%] md:object-center"
            />
          </div>
          <figcaption className="absolute bottom-6 left-6 right-6 hidden border border-ivory/50 bg-ivory/95 px-7 py-5 md:block lg:bottom-8 lg:left-8 lg:right-8">
            <p className="font-display text-[30px] font-light leading-tight">Something given, something kept.</p>
          </figcaption>
        </figure>

        <section aria-labelledby="launch-title" className="mx-auto w-full max-w-[440px] md:py-12 lg:py-16">
          <div className="mb-4 flex items-center gap-3 md:mb-6">
            <span className="h-px w-8 bg-mulberry" aria-hidden="true" />
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-mulberry">Coming soon</p>
          </div>
          <h1 id="launch-title" className="font-display text-[clamp(2.625rem,6vw,3.875rem)] font-light leading-[1.02] tracking-[-0.025em]">
            Something<br />worth waiting for.
          </h1>
          <p className="mt-4 text-sm font-normal text-ink/70 md:mt-5 md:text-base">Be first to know when we open.</p>
          <WaitlistForm />
          <div className="mt-6 flex items-center gap-3 border-t border-ink/15 pt-5 md:mt-8 md:pt-6">
            <SiumoraMark size={24} tone="mulberry" label={null} />
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink/65">For the everyday. For you.</p>
          </div>
        </section>
      </div>

      <footer className="mx-auto flex w-full max-w-[1440px] items-center justify-between gap-4 px-5 pb-5 text-xs font-normal text-ink/65 sm:px-10 lg:px-16">
        <span>© Siumora</span>
        <Link href="/privacy" className="inline-flex min-h-11 items-center underline-offset-4 hover:text-mulberry hover:underline">Privacy</Link>
      </footer>
    </div>
  );
}
