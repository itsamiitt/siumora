import type { Metadata } from "next";

import { faqJsonLd } from "@siumora/seo";

import { JsonLdScript } from "@/components/json-ld";
import { PolicyPage, Section } from "@/components/policy-page";

export const metadata: Metadata = {
  title: "Shipping & delivery",
  description:
    "Where Siumora ships, how long it takes, what it costs, and how cash on delivery works.",
};

/**
 * Answer-ready pairs, also emitted as FAQ structured data.
 *
 * These are the questions support actually gets. Answering them plainly is what
 * earns a citation when someone asks an AI engine the same thing.
 */
const FAQ = [
  {
    question: "Where does Siumora ship?",
    answer:
      "Across India, to any pincode our courier partners serve. You can check a pincode from the header or on any product page before you order.",
  },
  {
    question: "How long does delivery take?",
    answer:
      "Two to three days to the metros, four to six days elsewhere. The estimate shown for your pincode at checkout is the one we work to.",
  },
  {
    question: "How much does shipping cost?",
    answer:
      "Free on orders of ₹999 and above. Below that it is ₹79, shown before you pay.",
  },
  {
    question: "Is cash on delivery available?",
    answer:
      "On most pincodes and on orders between ₹499 and ₹10,000. A ₹49 handling fee applies, and it is waived once you have had three orders delivered.",
  },
];

export default function ShippingPage() {
  return (
    <>
      <JsonLdScript data={faqJsonLd(FAQ)} />
      <PolicyPage
        title="Shipping & delivery"
        intro="Where we ship, how long it takes, and what it costs."
      >
        <Section heading="Where and when">
          <p>{FAQ[0]!.answer}</p>
          <p>{FAQ[1]!.answer}</p>
        </Section>

        <Section heading="What it costs">
          <p>{FAQ[2]!.answer}</p>
        </Section>

        <Section heading="Cash on delivery">
          <p>{FAQ[3]!.answer}</p>
          <p>
            On some orders we ask you to confirm by WhatsApp before we pack, and
            occasionally for a small advance. That is not a judgement about you
            — it is how we keep the fee low for everyone.
          </p>
        </Section>

        <Section heading="If delivery fails">
          <p>
            Couriers try more than once. If they cannot reach you, we message
            you to rearrange rather than sending the parcel straight back. Every
            piece is packed as a gift, so we would rather it arrived.
          </p>
        </Section>
      </PolicyPage>
    </>
  );
}
