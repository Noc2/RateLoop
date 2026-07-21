"use client";

import { useState } from "react";
import { PaidEligibilityClient } from "~~/components/tokenless/PaidEligibilityClient";
import { InvitationRouterPanel } from "~~/components/tokenless/account/InvitationRouterPanel";
import { ProfileClient } from "~~/components/tokenless/account/ProfileClient";
import { FeedbackBonusClaimsClient } from "~~/components/tokenless/human/FeedbackBonusClaimsClient";
import { ReviewerAccessPanel } from "~~/components/tokenless/human/ReviewerAccessPanel";
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
      <section id="feedback-bonus-claims" className="scroll-mt-24">
        <FeedbackBonusClaimsClient />
      </section>
    </>
  );
}
