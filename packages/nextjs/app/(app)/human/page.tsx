import { cookies } from "next/headers";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { HumanAssuranceRaterClient } from "~~/components/tokenless/HumanAssuranceRaterClient";
import { AccountDeletionPanel } from "~~/components/tokenless/account/AccountDeletionPanel";
import { NotificationSettingsPanel } from "~~/components/tokenless/account/NotificationSettingsPanel";
import { PasskeyManagementPanel } from "~~/components/tokenless/account/PasskeyManagementPanel";
import { AnswerPageClient } from "~~/components/tokenless/answer/AnswerPageClient";
import { HumanAccountSignInPrompt } from "~~/components/tokenless/human/HumanAccountSignInPrompt";
import { HumanProfileContent } from "~~/components/tokenless/human/HumanProfileContent";
import { type HumanTab, HumanTabs } from "~~/components/tokenless/human/HumanTabs";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";
import { isWorldIdAssuranceEnabled } from "~~/lib/tokenless/worldIdAssurance";

const HUMAN_TABS = new Set<HumanTab>(["discover", "profile", "settings"]);

export default async function HumanPage({
  searchParams,
}: {
  searchParams: Promise<{
    assignment?: string | string[];
    invite?: string | string[];
    terms?: string | string[];
    q?: string | string[];
    scope?: string | string[];
    tab?: string | string[];
    view?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const requestedTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab = HUMAN_TABS.has(requestedTab as HumanTab) ? (requestedTab as HumanTab) : "discover";
  const assignmentId = Array.isArray(params.assignment) ? params.assignment[0] : params.assignment;

  if (assignmentId) {
    const assignmentSession = await findAuthSession((await cookies()).get(AUTH_SESSION_COOKIE)?.value);
    return (
      <AppPageShell outerClassName="pb-8" contentClassName="space-y-5">
        <HumanTabs active="discover" />
        <HumanAssuranceRaterClient
          principalId={assignmentSession?.principalId ?? null}
          initialAssignmentId={params.assignment}
          initialTermsHash={params.terms}
        />
      </AppPageShell>
    );
  }

  if (tab === "discover") {
    const invitation = Array.isArray(params.invite) ? params.invite[0] : params.invite;
    const query = Array.isArray(params.q) ? params.q[0] : params.q;
    const requestedScope = Array.isArray(params.scope) ? params.scope[0] : params.scope;
    const requestedView = Array.isArray(params.view) ? params.view[0] : params.view;
    const scope = ["all", "public", "private"].includes(requestedScope ?? "")
      ? (requestedScope as "all" | "public" | "private")
      : "all";
    return (
      <AnswerPageClient
        initialInvitationOpen={invitation === "1"}
        initialQuery={query}
        initialScope={scope}
        initialView={requestedView === "history" ? "history" : "active"}
      />
    );
  }

  const session = await findAuthSession((await cookies()).get(AUTH_SESSION_COOKIE)?.value);
  if (!session) return <HumanAccountSignInPrompt tab={tab} />;

  return (
    <AppPageShell outerClassName="pb-8" contentClassName="space-y-5">
      <h1 className="sr-only">{tab === "profile" ? "Your profile" : "Your settings"}</h1>
      <HumanTabs active={tab} />
      {tab === "profile" ? (
        <HumanProfileContent worldIdEnabled={isWorldIdAssuranceEnabled()} />
      ) : (
        <>
          <PasskeyManagementPanel />
          <NotificationSettingsPanel />
          <AccountDeletionPanel />
        </>
      )}
    </AppPageShell>
  );
}
