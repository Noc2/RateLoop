import { cookies } from "next/headers";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import type { AgentTab } from "~~/components/tokenless/agents/AgentTabs";
import { AgentWorkspacePanels } from "~~/components/tokenless/agents/AgentWorkspacePanels";
import { AgentsLocaleProvider } from "~~/components/tokenless/agents/AgentsLocaleProvider";
import { AgentsSignInPrompt } from "~~/components/tokenless/agents/AgentsSignInPrompt";
import {
  agentSignInReturnTo,
  agentTabHref,
  connectedAgentTabs,
  resolveAvailableAgentTab,
  selectRequestedWorkspace,
} from "~~/components/tokenless/agents/agentWorkspaceState";
import { parseEvidenceUrlState } from "~~/components/tokenless/agents/evidenceUrlState";
import type { Locale } from "~~/i18n/config";
import { redirect } from "~~/i18n/navigation";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";
import { listProductWorkspaces } from "~~/lib/tokenless/productCore";
import { getWorkspaceAgentSetup } from "~~/lib/tokenless/workspaceAgentSetup";

export type AgentsSearchParamRecord = Record<string, string | string[] | undefined>;

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export async function AgentsSectionPage({
  searchParams,
  tab,
  locale,
}: {
  searchParams: AgentsSearchParamRecord;
  tab: AgentTab;
  locale: Locale;
}) {
  const returning = firstQueryValue(searchParams.returning);
  const requestedWorkspaceId = firstQueryValue(searchParams.workspace);
  const requestedStep = firstQueryValue(searchParams.step);
  const requestedEvidenceParams = new URLSearchParams();
  for (const [key, value] of [
    ["q", firstQueryValue(searchParams.q)],
    ["outcome", firstQueryValue(searchParams.outcome)],
    ["date", firstQueryValue(searchParams.date)],
    ["run", firstQueryValue(searchParams.run)],
    ["packet", firstQueryValue(searchParams.packet)],
  ] as const) {
    if (value) requestedEvidenceParams.set(key, value);
  }
  const requestedEvidence = parseEvidenceUrlState(requestedEvidenceParams);
  const cookieStore = await cookies();
  const session = await findAuthSession(cookieStore.get(AUTH_SESSION_COOKIE)?.value);

  if (!session) {
    return (
      <AgentsLocaleProvider locale={locale}>
        <AgentsSignInPrompt
          returnTo={agentSignInReturnTo({
            returning,
            tab,
            workspaceId: requestedWorkspaceId,
            step: requestedStep,
            evidence: requestedEvidence,
            searchParams,
          })}
        />
      </AgentsLocaleProvider>
    );
  }

  const workspaces = await listProductWorkspaces(session.principalId);
  const workspace =
    returning === "oauth" && !requestedWorkspaceId ? null : selectRequestedWorkspace(workspaces, requestedWorkspaceId);
  let hasConnectedAgent = false;
  let setup = null;

  if (workspace) {
    setup = await getWorkspaceAgentSetup({
      accountAddress: session.principalId,
      workspaceId: workspace.workspaceId,
      requestedStep,
    });
    hasConnectedAgent = setup.complete;

    const canManage = workspace.role === "owner" || workspace.role === "admin";
    const visibleTabs = hasConnectedAgent
      ? connectedAgentTabs({ canManage })
      : canManage
        ? (["connect", "billing"] as AgentTab[])
        : (["billing"] as AgentTab[]);
    const resolvedTab = resolveAvailableAgentTab(tab, visibleTabs);
    if (resolvedTab !== tab) {
      redirect({ href: agentTabHref(resolvedTab, workspace.workspaceId, searchParams), locale });
    }
  }

  return (
    <AgentsLocaleProvider locale={locale}>
      <AppPageShell outerClassName="pb-8" contentClassName="space-y-5">
        <AgentWorkspacePanels
          key={workspace?.workspaceId ?? "no-workspace"}
          activeTab={tab}
          initialHasConnectedAgent={hasConnectedAgent}
          initialSetup={setup}
          initialWorkspaceId={workspace?.workspaceId ?? ""}
          workspaces={workspaces}
        />
      </AppPageShell>
    </AgentsLocaleProvider>
  );
}
