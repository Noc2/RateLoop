"use client";

import { useState } from "react";
import { PaidEligibilityClient } from "~~/components/tokenless/PaidEligibilityClient";
import { InvitationRouterPanel } from "~~/components/tokenless/account/InvitationRouterPanel";
import { ProfileClient } from "~~/components/tokenless/account/ProfileClient";
import { FeedbackBonusClaimsClient } from "~~/components/tokenless/human/FeedbackBonusClaimsClient";
import { ForecastIntegrityClient } from "~~/components/tokenless/human/ForecastIntegrityClient";
import { RaterSettlementRecoveryClient } from "~~/components/tokenless/human/RaterSettlementRecoveryClient";
import { ReviewerAccessPanel } from "~~/components/tokenless/human/ReviewerAccessPanel";
import { ReviewerEarningsClient } from "~~/components/tokenless/human/ReviewerEarningsClient";
import { WorldIdProfilePanel } from "~~/components/tokenless/human/WorldIdProfilePanel";

export function HumanProfileContent({ worldIdEnabled }: { worldIdEnabled: boolean }) {
  const [reviewerAccessRevision, setReviewerAccessRevision] = useState(0);
  return (
    <>
      <ProfileClient />
      <InvitationRouterPanel
        onAccepted={kind => {
          if (kind === "reviewer") setReviewerAccessRevision(revision => revision + 1);
        }}
      />
      <ReviewerAccessPanel refreshKey={reviewerAccessRevision} />
      {worldIdEnabled ? <WorldIdProfilePanel /> : null}
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
  );
}
