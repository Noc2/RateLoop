import { PaidEligibilityClient } from "~~/components/tokenless/PaidEligibilityClient";
import { isWorldIdAssuranceEnabled } from "~~/lib/tokenless/worldIdAssurance";

export default function PaidEligibilityPage() {
  return (
    <section className="space-y-5">
      <PaidEligibilityClient networkPanelsEnabled={isWorldIdAssuranceEnabled()} />
    </section>
  );
}
