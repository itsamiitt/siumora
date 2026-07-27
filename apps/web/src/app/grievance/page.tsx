import type { Metadata } from "next";

import { Disclosure, PolicyPage, Section } from "@/components/policy-page";
import {
  DPDP_GRIEVANCE_DAYS,
  GRIEVANCE_ACKNOWLEDGEMENT_HOURS,
  GRIEVANCE_RESOLUTION_DAYS,
  LEGAL,
} from "@/lib/legal";

export const metadata: Metadata = {
  title: "Grievance officer",
  description:
    "How to raise a complaint with Siumora, who handles it, and how long it takes.",
};

export default function GrievancePage() {
  return (
    <PolicyPage
      title="Grievance officer"
      intro="If something has gone wrong and normal support has not fixed it, this is the escalation path."
      statutory
    >
      <Section heading="Who to contact">
        <dl className="mt-1">
          <Disclosure label="Grievance officer" value={LEGAL.grievanceOfficer} />
          <Disclosure label="Email" value={LEGAL.grievanceEmail} />
          <Disclosure label="Registered entity" value={LEGAL.registeredName} />
          <Disclosure label="Registered address" value={LEGAL.address} />
        </dl>
      </Section>

      <Section heading="How long it takes">
        <p>
          We acknowledge every complaint within{" "}
          {GRIEVANCE_ACKNOWLEDGEMENT_HOURS} hours of receiving it, and resolve
          it within {GRIEVANCE_RESOLUTION_DAYS} days. These are the timelines
          set by the Consumer Protection (E-Commerce) Rules, 2020, and we treat
          them as the ceiling rather than the target.
        </p>
        <p>
          Complaints about your personal data — access, correction, or erasure —
          are resolved within {DPDP_GRIEVANCE_DAYS} days under the Digital
          Personal Data Protection Act, 2023. In practice we aim to answer these
          much sooner; see the privacy policy for what we hold and why.
        </p>
      </Section>

      <Section heading="What to include">
        <p>
          Your order number, what happened, and what you would like done. If you
          have already spoken to us, mention when — it saves you repeating
          yourself.
        </p>
      </Section>
    </PolicyPage>
  );
}
