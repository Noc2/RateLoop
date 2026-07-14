import { AppPageShell } from "~~/components/shared/AppPageShell";
import { HumanAssuranceRaterClient } from "~~/components/tokenless/HumanAssuranceRaterClient";
import { PaidEligibilityClient } from "~~/components/tokenless/PaidEligibilityClient";
import { NotificationSettingsPanel } from "~~/components/tokenless/account/NotificationSettingsPanel";
import { ProfileClient } from "~~/components/tokenless/account/ProfileClient";
import { AnswerPageClient } from "~~/components/tokenless/answer/AnswerPageClient";
import { type HumanTab, HumanTabs } from "~~/components/tokenless/human/HumanTabs";
import { isTokenlessSandboxMode } from "~~/lib/tokenless/server";
import { isWorldIdAssuranceEnabled } from "~~/lib/tokenless/worldIdAssurance";

const HUMAN_TABS = new Set<HumanTab>(["discover", "profile", "settings"]);

export default async function HumanPage({
  searchParams,
}: {
  searchParams: Promise<{
    assignment?: string | string[];
    terms?: string | string[];
    q?: string | string[];
    scope?: string | string[];
    tab?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const requestedTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab = HUMAN_TABS.has(requestedTab as HumanTab) ? (requestedTab as HumanTab) : "discover";
  const assignmentId = Array.isArray(params.assignment) ? params.assignment[0] : params.assignment;
  const sandboxMode = isTokenlessSandboxMode();

  if (assignmentId) {
    return (
      <AppPageShell outerClassName="pb-8" contentClassName="space-y-5">
        <HumanTabs active="discover" />
        <HumanAssuranceRaterClient
          initialAssignmentId={params.assignment}
          initialTermsHash={params.terms}
          sandboxMode={sandboxMode}
        />
      </AppPageShell>
    );
  }

  if (tab === "discover") {
    const query = Array.isArray(params.q) ? params.q[0] : params.q;
    const requestedScope = Array.isArray(params.scope) ? params.scope[0] : params.scope;
    const scope = ["all", "public", "private", "submitted"].includes(requestedScope ?? "")
      ? (requestedScope as "all" | "public" | "private" | "submitted")
      : "all";
    return (
      <>
        <AppPageShell contentClassName="mb-4">
          <HumanTabs active={tab} />
        </AppPageShell>
        <AnswerPageClient initialQuery={query} initialScope={scope} sandboxMode={sandboxMode} />
      </>
    );
  }

  return (
    <AppPageShell outerClassName="pb-8" contentClassName="space-y-5">
      <HumanTabs active={tab} />
      {tab === "profile" ? (
        <>
          <ProfileClient />
          <section id="paid-work" className="scroll-mt-24">
            <PaidEligibilityClient networkPanelsEnabled={isWorldIdAssuranceEnabled()} />
          </section>
        </>
      ) : (
        <NotificationSettingsPanel />
      )}
    </AppPageShell>
  );
}
