import { ProfileClient } from "~~/components/tokenless/account/ProfileClient";
import { ReviewerAccessPanel } from "~~/components/tokenless/human/ReviewerAccessPanel";
import { WorldIdProfilePanel } from "~~/components/tokenless/human/WorldIdProfilePanel";

export function HumanProfileContent({ worldIdEnabled }: { worldIdEnabled: boolean }) {
  return (
    <>
      <ProfileClient />
      <ReviewerAccessPanel />
      {worldIdEnabled ? <WorldIdProfilePanel /> : null}
    </>
  );
}
