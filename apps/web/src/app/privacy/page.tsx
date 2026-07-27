import type { Metadata } from "next";

import { Disclosure, PolicyPage, Section } from "@/components/policy-page";
import { DPDP_GRIEVANCE_DAYS, LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What Siumora collects, why, how long it is kept, and how to have it corrected or erased.",
};

export default function PrivacyPage() {
  return (
    <PolicyPage
      title="Privacy policy"
      intro="Written to be read. What we collect, why we collect it, and what you can make us do about it."
      updated="27 July 2026"
      statutory
    >
      <Section heading="What we collect">
        <p>
          To send you an order: your name, phone number, delivery address and
          email. To take payment: nothing you would recognise as card details —
          those go straight to our payment gateway and never touch our servers.
        </p>
        <p>
          To understand what works on the site: pages viewed, items opened, and
          what was bought. This is analytics, and it only runs if you accept
          cookies. Declining changes nothing about your order.
        </p>
      </Section>

      <Section heading="Why we are allowed to">
        <p>
          Order data we process because you asked us to send you something —
          performing that contract is the lawful basis, and it does not depend
          on consent. Analytics and advertising run on consent alone, and you
          can withdraw it at any time by clearing the cookie choice in your
          browser.
        </p>
      </Section>

      <Section heading="Who else sees it">
        <p>
          Our courier, to deliver the parcel. Our payment gateway, to take the
          money. Our messaging providers, to send order updates. Analytics and
          advertising platforms, but only after you accept, and only ever as an
          irreversible hash of your phone or email — never the raw value.
        </p>
        <p>
          Data is stored in India. We do not sell it, and we do not share it for
          anyone else&rsquo;s marketing.
        </p>
      </Section>

      <Section heading="How long we keep it">
        <p>
          Order and tax records for as long as GST law requires us to.
          Everything else for as long as it is useful and no longer.
        </p>
      </Section>

      <Section heading="Your rights">
        <p>
          You can ask what we hold about you, correct it, or have it erased.
          Erasure does not extend to records we are legally required to retain,
          such as a tax invoice. Write to the grievance officer below; we
          resolve these within {DPDP_GRIEVANCE_DAYS} days as the Digital
          Personal Data Protection Act requires.
        </p>
        <dl className="mt-4">
          <Disclosure label="Grievance officer" value={LEGAL.grievanceOfficer} />
          <Disclosure label="Email" value={LEGAL.grievanceEmail} />
        </dl>
      </Section>

      <Section heading="If something goes wrong">
        <p>
          If your data is ever exposed, we notify the Data Protection Board and
          everyone affected within 72 hours, and we tell you what happened
          rather than what we would prefer you knew.
        </p>
      </Section>
    </PolicyPage>
  );
}
