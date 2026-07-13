import Link from "next/link";
import { PaidEligibilityClient } from "~~/components/tokenless/PaidEligibilityClient";
import { isWorldIdAssuranceEnabled } from "~~/lib/tokenless/worldIdAssurance";

export default function PaidTaskUnlockPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
      <div className="max-w-3xl border-l-2 border-[var(--rateloop-yellow)] pl-6">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-base-content/55">Account</p>
        <h1 className="display-section mt-3 text-4xl sm:text-5xl">Unlock paid tasks</h1>
        <p className="mt-4 text-lg leading-8 text-base-content/60">
          Browse and calibrate without friction. Complete this once before your first paid voucher so there are no
          surprises after you earn.
        </p>
      </div>

      <PaidEligibilityClient networkPanelsEnabled={isWorldIdAssuranceEnabled()} />
      <Link href="/settings/workspace" className="rateloop-gradient-action mt-6 w-fit px-6">
        Manage workspace & API keys
      </Link>
    </div>
  );
}
