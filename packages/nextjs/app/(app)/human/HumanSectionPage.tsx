import { cookies } from "next/headers";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { HumanAssuranceRaterClient } from "~~/components/tokenless/HumanAssuranceRaterClient";
import { AccountDeletionPanel } from "~~/components/tokenless/account/AccountDeletionPanel";
import { NotificationSettingsPanel } from "~~/components/tokenless/account/NotificationSettingsPanel";
import { PasskeyManagementPanel } from "~~/components/tokenless/account/PasskeyManagementPanel";
import { SubjectDataExportPanel } from "~~/components/tokenless/account/SubjectDataExportPanel";
import { AnswerPageClient } from "~~/components/tokenless/answer/AnswerPageClient";
import { HumanAccountSignInPrompt } from "~~/components/tokenless/human/HumanAccountSignInPrompt";
import { HumanProfileContent } from "~~/components/tokenless/human/HumanProfileContent";
import { HumanTabs } from "~~/components/tokenless/human/HumanTabs";
import { ProfileSectionFocus } from "~~/components/tokenless/human/ProfileSectionFocus";
import { ReviewerNotificationInbox } from "~~/components/tokenless/human/ReviewerNotificationInbox";
import type { HumanNavigation, HumanTab } from "~~/components/tokenless/human/humanNavigation";
import { humanAccountReturnTo, resolveHumanProfileSection } from "~~/components/tokenless/human/humanProfileNavigation";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";
import { isWorldIdAssuranceEnabled } from "~~/lib/tokenless/worldIdAssurance";

export type HumanSearchParamRecord = Record<string, string | string[] | undefined>;

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export async function HumanSectionPage({
  navigation,
  searchParams,
}: {
  navigation: HumanNavigation;
  searchParams: HumanSearchParamRecord;
}) {
  const assignmentId = firstQueryValue(searchParams.assignment);
  const section = resolveHumanProfileSection(firstQueryValue(searchParams.section));
  const eligibility = firstQueryValue(searchParams.eligibility);

  if (assignmentId) {
    const assignmentSession = await findAuthSession((await cookies()).get(AUTH_SESSION_COOKIE)?.value);
    return (
      <AppPageShell outerClassName="pb-8" contentClassName="space-y-5">
        <HumanTabs active="discover" />
        <HumanAssuranceRaterClient
          principalId={assignmentSession?.principalId ?? null}
          initialAssignmentId={searchParams.assignment}
          initialTermsHash={searchParams.terms}
        />
      </AppPageShell>
    );
  }

  if (navigation === "discover" || navigation === "history") {
    const invitation = firstQueryValue(searchParams.invite);
    const query = firstQueryValue(searchParams.q);
    const requestedScope = firstQueryValue(searchParams.scope);
    const scope = ["all", "public", "private"].includes(requestedScope ?? "")
      ? (requestedScope as "all" | "public" | "private")
      : "all";
    return (
      <AnswerPageClient
        initialInvitationOpen={invitation === "1"}
        initialQuery={query}
        initialScope={scope}
        initialView={navigation === "history" ? "history" : "active"}
      />
    );
  }

  const tab: HumanTab = navigation;
  const session = await findAuthSession((await cookies()).get(AUTH_SESSION_COOKIE)?.value);
  if (!session) {
    return (
      <HumanAccountSignInPrompt
        returnTo={humanAccountReturnTo({ eligibility, section: tab === "profile" ? section : undefined, tab })}
        tab={tab}
      />
    );
  }

  return (
    <AppPageShell outerClassName="pb-8" contentClassName="space-y-5">
      <HumanTabs active={tab} />
      {tab === "inbox" ? (
        <ReviewerNotificationInbox />
      ) : tab === "profile" ? (
        <>
          <ProfileSectionFocus section={section} />
          <HumanProfileContent worldIdEnabled={isWorldIdAssuranceEnabled()} />
        </>
      ) : (
        <>
          <PasskeyManagementPanel />
          <NotificationSettingsPanel />
          <SubjectDataExportPanel />
          <AccountDeletionPanel />
        </>
      )}
    </AppPageShell>
  );
}
