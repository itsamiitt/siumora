import type { Metadata } from "next";

import { faqJsonLd } from "@siumora/seo";

import { JsonLdScript } from "@/components/json-ld";
import { PolicyPage, Section } from "@/components/policy-page";

export const metadata: Metadata = {
  title: "Care guide",
  description:
    "How to look after 925 sterling silver with 18k gold PVD so it stays bright with daily wear.",
};

const FAQ = [
  {
    question: "Can I wear Siumora jewellery in the shower?",
    answer:
      "Yes. 18k gold PVD is bonded to the silver rather than plated on top, so water, sweat and soap do not lift it. It is made for daily wear.",
  },
  {
    question: "Will it turn my skin green?",
    answer:
      "No. The base is 925 sterling silver, not brass, and it is nickel-free. If you react to costume jewellery you should be fine with this.",
  },
  {
    question: "How do I clean it?",
    answer:
      "Warm water, a drop of mild soap, and a soft cloth. Dry it properly. Skip silver dip and anything abrasive — those strip the finish.",
  },
  {
    question: "How should I store it?",
    answer:
      "In the pouch it arrived in, away from damp. Pieces stored loose together scratch each other.",
  },
];

export default function CarePage() {
  return (
    <>
      <JsonLdScript data={faqJsonLd(FAQ)} />
      <PolicyPage
        title="Care guide"
        intro="Wear it every day. That is the point. A little care keeps it looking new."
      >
        <Section heading="Everyday wear">
          <p>{FAQ[0]!.answer}</p>
          <p>{FAQ[1]!.answer}</p>
        </Section>

        <Section heading="Cleaning">
          <p>{FAQ[2]!.answer}</p>
        </Section>

        <Section heading="Storing">
          <p>{FAQ[3]!.answer}</p>
        </Section>

        <Section heading="What to keep it away from">
          <p>
            Perfume and hairspray, applied directly. Put those on first, let them
            dry, then put the jewellery on.
          </p>
        </Section>
      </PolicyPage>
    </>
  );
}
