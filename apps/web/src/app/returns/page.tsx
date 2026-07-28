import type { Metadata } from "next";
import Link from "next/link";

import { faqJsonLd } from "@siumora/seo";
import { MicroLabel } from "@siumora/ui";

import { JsonLdScript } from "@/components/json-ld";
import { PolicyPage, Section } from "@/components/policy-page";
import { RETURN_WINDOW_DAYS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Returns & exchange",
  description:
    "Siumora accepts returns within 7 days of delivery. How to start one, what comes back, and when the refund lands.",
};

const FAQ = [
  {
    question: "How long do I have to return something?",
    answer: `${RETURN_WINDOW_DAYS} days from the day it is delivered. Start it from your orders page and we book the pickup.`,
  },
  {
    question: "What condition does it need to be in?",
    answer:
      "Unworn, with the tag on, in the box it arrived in. Earrings are the one exception — for hygiene reasons we can only take those back if the seal is unbroken.",
  },
  {
    question: "When do I get my money back?",
    answer:
      "Within five working days of the piece reaching us and passing a quick check. Prepaid orders go back to the original payment method; cash-on-delivery orders are refunded by UPI.",
  },
  {
    question: "Can I exchange instead of returning?",
    answer:
      "Yes, for a different size or finish of the same piece. Ask when you start the return and we send the replacement once the original is on its way back.",
  },
];

export default function ReturnsPage() {
  return (
    <>
      <JsonLdScript data={faqJsonLd(FAQ)} />
      <PolicyPage
        title="Returns & exchange"
        intro="If it is not right, send it back. No argument, no restocking fee."
      >
        <Section heading="The window">
          <p>{FAQ[0]!.answer}</p>
        </Section>

        <Section heading="Condition">
          <p>{FAQ[1]!.answer}</p>
        </Section>

        <Section heading="Refunds">
          <p>{FAQ[2]!.answer}</p>
        </Section>

        <Section heading="Exchanges">
          <p>{FAQ[3]!.answer}</p>
        </Section>

        <Section heading="If it arrived damaged">
          <p>
            Message us within 48 hours with a photo and we replace it. You do not
            pay return shipping, and we do not ask you to prove anything beyond
            the photo.
          </p>
        </Section>

        <p className="pt-2">
          <Link
            href="/account"
            className="border-b border-content pb-0.5 transition-colors hover:border-accent-ink hover:text-accent-ink"
          >
            <MicroLabel>Start a return</MicroLabel>
          </Link>
        </p>
      </PolicyPage>
    </>
  );
}
