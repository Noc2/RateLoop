import { PaidEligibilityClient } from "~~/components/tokenless/PaidEligibilityClient";
import { isWorldIdAssuranceEnabled } from "~~/lib/tokenless/worldIdAssurance";

export default function PaidEligibilityPage() {
  return (
    <section>
      <p className="mt-8 text-sm leading-6 text-base-content/60">
        Complete tax, sanctions, identity, and payout checks before your first paid voucher. Private invited reviews do
        not require this capability unless their frozen policy says they are paid.
      </p>
      <PaidEligibilityClient networkPanelsEnabled={isWorldIdAssuranceEnabled()} />
    </section>
  );
}
