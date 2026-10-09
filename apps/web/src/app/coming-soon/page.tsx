import type { Metadata } from "next";
import Link from "next/link";

import { SiumoraMark } from "@siumora/ui";

import { WaitlistForm } from "@/components/waitlist-form";

export const metadata: Metadata = {
  title: "Coming soon",
  description: "Siumora is coming. Join the waiting list for our everyday jewellery opening.",
};

export default function ComingSoonPage() {
  return (
    <div className="bg-ivory text-ink">
      <div className="border-b border-ink/12 px-5 py-4 sm:px-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-[11px] uppercase tracking-[0.2em]">
          <span className="text-mulberry">Siumora is coming</span>
          <span className="text-ink/60">925 silver · 18k gold PVD · Made in India</span>
        </div>
      </div>

      <section className="mx-auto grid max-w-7xl lg:min-h-[min(760px,85vh)] lg:grid-cols-2">
        <div className="flex min-h-72 items-center justify-center bg-blush p-12 sm:min-h-96 lg:min-h-0">
          <div className="relative flex aspect-square w-48 items-center justify-center rounded-full border border-ink/15 sm:w-72">
            <div className="absolute inset-5 rounded-full border border-ink/15 sm:inset-7" />
            <SiumoraMark size={180} tone="ink" label={null} className="relative w-32 sm:w-44" />
          </div>
        </div>
        <div className="flex flex-col justify-center px-6 py-16 sm:px-12 lg:px-16 lg:py-20">
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-mulberry">Gift &amp; reward</p>
          <h1 className="mt-5 max-w-[12ch] font-display text-[clamp(3.2rem,6vw,6.5rem)] font-light leading-[0.98]">
            Something given, something kept.
          </h1>
          <p className="mt-7 max-w-lg text-base leading-8 text-ink/75">
            Siumora means reward. Everyday jewellery in real metal, for the woman who gives it, including to herself.
          </p>
          <div className="my-8 h-px w-full max-w-xl bg-ink/15" />
          <WaitlistForm />
        </div>
      </section>

      <div className="grid border-y border-ink/12 sm:grid-cols-3">
        {[
          ["Made to wear", "Every day"],
          ["Made with", "925 silver"],
          ["Made for", "Giving and keeping"],
        ].map(([label, value]) => (
          <div key={label} className="border-b border-ink/12 px-7 py-7 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-ink/55">{label}</p>
            <p className="mt-2 font-heading text-lg">{value}</p>
          </div>
        ))}
      </div>
      <div className="mx-auto max-w-7xl px-6 py-5 text-right">
        <Link href="/coming-soon/admin" className="text-xs text-ink/55 underline-offset-4 hover:text-mulberry hover:underline">Admin sign in</Link>
      </div>
    </div>
  );
}
