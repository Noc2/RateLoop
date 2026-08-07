import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
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
    // Gate on the server, as the account tabs already do. Rendering
    // AnswerPageClient first meant a signed-out visitor got the tab strip and a
    // loading skeleton for several seconds before a card appeared below them,
    // while every other human surface showed a centered card immediately and no
    // navigation at all. Same section, two different pages.
    const reviewSession = await findAuthSession((await cookies()).get(AUTH_SESSION_COOKIE)?.value);
    if (!reviewSession) {
      return (
        <HumanAccountSignInPrompt returnTo={humanAccountReturnTo({ eligibility, tab: navigation })} tab={navigation} />
      );
    }
    const invitation = firstQueryValue(searchParams.invite);
    return (
      <AnswerPageClient
        initialInvitationOpen={invitation === "1"}
        initialView={navigation === "history" ? "history" : "active"}
      />
    );
  }

  const tab: HumanTab = navigation;
  const humanTabLabel = (await getTranslations("human.tabs"))(tab);
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
      {/*
        The tab strip names the destination visually, but a tab list is not a
        heading: inbox, profile and settings each began at an h2, and at three
        different sizes, so assistive technology had no page title to land on and
        the document outline started a level down. The agents shell already does
        this; the label is the active tab so the two agree by construction.
      */}
      <h1 className="sr-only">{humanTabLabel}</h1>
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
