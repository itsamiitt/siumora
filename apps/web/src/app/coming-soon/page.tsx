import type { Metadata } from "next";
import Link from "next/link";

import { SiumoraLockupHorizontal, SiumoraMark } from "@siumora/ui";

import { PreviewUnlock } from "@/components/preview-unlock";
import { WaitlistForm } from "@/components/waitlist-form";

export const metadata: Metadata = {
  title: "Coming soon",
  description: "Siumora is coming soon. Join the waiting list.",
};

export default function ComingSoonPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-ivory text-ink">
      <header className="border-b border-ink/10">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 sm:px-10">
          <SiumoraLockupHorizontal size={30} tone="ink" />
          {process.env.SITE_PHASE === "coming-soon" && <PreviewUnlock />}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-6 py-16 text-center sm:py-24">
        <SiumoraMark size={96} tone="mulberry" label={null} className="h-20 w-20 sm:h-24 sm:w-24" />
        <h1 className="mt-10 font-display text-[clamp(3.75rem,10vw,7.5rem)] font-light leading-none tracking-tight">
          Coming soon.
        </h1>
        <div className="mt-9 h-px w-14 bg-mulberry/55" />
        <WaitlistForm />
      </div>

      <footer className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 border-t border-ink/10 px-6 py-5 text-[11px] text-ink/55 sm:px-10">
        <span>© Siumora</span>
        <Link href="/privacy" className="underline-offset-4 hover:text-mulberry hover:underline">Privacy</Link>
      </footer>
    </div>
  );
}
