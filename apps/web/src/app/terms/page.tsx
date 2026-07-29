import type { Metadata } from "next";

import { Disclosure, PolicyPage, Section } from "@/components/policy-page";
import {
  COUNTRY_OF_ORIGIN,
  LEGAL,
  RETURN_WINDOW_DAYS,
} from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of use",
  description:
    "Who you are buying from, what the prices include, and the terms that apply to an order from Siumora.",
};

export default function TermsPage() {
  return (
    <PolicyPage
      title="Terms of use"
      intro="The terms that apply when you buy from this site."
      updated="27 July 2026"
      statutory
    >
      <Section heading="Who you are buying from">
        <dl className="mt-1">
          <Disclosure label="Registered entity" value={LEGAL.registeredName} />
          <Disclosure label="Registered address" value={LEGAL.address} />
          <Disclosure label="GSTIN" value={LEGAL.gstin} />
          {LEGAL.registrationIdentifier && (
            <Disclosure
              label={LEGAL.registrationIdentifier.label}
              value={LEGAL.registrationIdentifier.value}
            />
          )}
          <Disclosure label="Support email" value={LEGAL.supportEmail} />
          <Disclosure label="Support phone" value={LEGAL.supportPhone} />
        </dl>
      </Section>

      <Section heading="Prices">
        <p>
          Every price shown includes GST. The figure on the product page is the
          figure you pay, before any shipping or cash-on-delivery fee, and both
          of those are shown before you confirm. A tax invoice is issued with
          every order.
        </p>
        <p>
          Where a piece shows a struck-through price, that is the maximum retail
          price and the discount is calculated against it.
        </p>
      </Section>

      <Section heading="Country of origin">
        <p>
          Every piece sold here is made in {COUNTRY_OF_ORIGIN}, and this is
          stated on each product page as the Legal Metrology rules require.
        </p>
      </Section>

      <Section heading="Orders">
        <p>
          An order is an offer to buy. It is accepted when we confirm it, and we
          may decline one — if a piece is out of stock, if a delivery address
          cannot be served, or if an order looks fraudulent. If we decline after
          taking payment, you are refunded in full.
        </p>
      </Section>

      <Section heading="Returns">
        <p>
          {RETURN_WINDOW_DAYS} days from delivery, on the terms set out in the
          returns policy. Nothing here limits the rights you have under the
          Consumer Protection Act, 2019.
        </p>
      </Section>

      <Section heading="Reviews">
        <p>
          Only customers whose order was delivered can leave a review, and the
          published rating counts those reviews alone. We do not remove reviews
          for being unflattering and we do not write our own.
        </p>
      </Section>

      <Section heading="Complaints">
        <p>
          If something goes wrong, the grievance officer page sets out who to
          contact and how long we take.
        </p>
      </Section>
    </PolicyPage>
  );
}
