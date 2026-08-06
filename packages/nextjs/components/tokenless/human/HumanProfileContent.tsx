import { PaidEligibilityClient } from "~~/components/tokenless/PaidEligibilityClient";
import { ProfileClient } from "~~/components/tokenless/account/ProfileClient";
import { FeedbackBonusClaimsClient } from "~~/components/tokenless/human/FeedbackBonusClaimsClient";
import { ForecastIntegrityClient } from "~~/components/tokenless/human/ForecastIntegrityClient";
import { PaidWorkUnavailableNotice } from "~~/components/tokenless/human/PaidWorkUnavailableNotice";
import { RaterSettlementRecoveryClient } from "~~/components/tokenless/human/RaterSettlementRecoveryClient";
import { ReviewerAccessPanel } from "~~/components/tokenless/human/ReviewerAccessPanel";
import { ReviewerEarningsClient } from "~~/components/tokenless/human/ReviewerEarningsClient";
import { WorldIdProfilePanel } from "~~/components/tokenless/human/WorldIdProfilePanel";
import { configuredHumanReviewLanes } from "~~/lib/tokenless/reviewCapabilities";

export function HumanProfileContent({ worldIdEnabled }: { worldIdEnabled: boolean }) {
  const lanes = configuredHumanReviewLanes();
  const paidReviewAvailable =
    lanes.privateInvitedPaid.available || lanes.publicPaidNetwork.available || lanes.hybridPublicSafe.available;
  return (
    <>
      <ProfileClient />
      <ReviewerAccessPanel />
      {worldIdEnabled ? <WorldIdProfilePanel /> : null}
      {paidReviewAvailable ? (
        <>
          <section id="paid-work" className="scroll-mt-24">
            <PaidEligibilityClient />
          </section>
          <section id="earnings" className="scroll-mt-24">
            <ReviewerEarningsClient />
          </section>
          <section id="forecast-integrity" className="scroll-mt-24">
            <ForecastIntegrityClient />
          </section>
          <section id="paid-settlement" className="scroll-mt-24">
            <RaterSettlementRecoveryClient />
          </section>
          <section id="feedback-bonus-claims" className="scroll-mt-24">
            <FeedbackBonusClaimsClient />
          </section>
        </>
      ) : (
        <PaidWorkUnavailableNotice />
      )}
    </>
  );
}
