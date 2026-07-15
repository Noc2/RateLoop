import { cookies } from "next/headers";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { type AgentTab } from "~~/components/tokenless/agents/AgentTabs";
import { AgentWorkspacePanels } from "~~/components/tokenless/agents/AgentWorkspacePanels";
import { AgentsSignInPrompt } from "~~/components/tokenless/agents/AgentsSignInPrompt";
import { isUsableAgentConnection, selectRequestedWorkspace } from "~~/components/tokenless/agents/agentWorkspaceState";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";
import { listAgentConnections } from "~~/lib/tokenless/agentIntegrations";
import { getWorkspaceEvaluationDashboard } from "~~/lib/tokenless/evaluationDashboard";
import { listPrivateGroups } from "~~/lib/tokenless/privateGroups";
import { listProductWorkspaces } from "~~/lib/tokenless/productCore";

const AGENT_TABS = new Set<AgentTab>(["overview", "agents", "groups", "evaluations"]);

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; workspace?: string | string[] }>;
}) {
  const cookieStore = await cookies();
  const session = await findAuthSession(cookieStore.get(AUTH_SESSION_COOKIE)?.value);

  if (!session) return <AgentsSignInPrompt />;

  const params = await searchParams;
  const rawTab = firstQueryValue(params.tab);
  const tab = AGENT_TABS.has(rawTab as AgentTab) ? (rawTab as AgentTab) : "overview";
  const workspaces = await listProductWorkspaces(session.principalId);
  const requestedWorkspaceId = firstQueryValue(params.workspace);
  const workspace = selectRequestedWorkspace(workspaces, requestedWorkspaceId);
  let hasConnectedAgent = false;
  let hasGroups = false;
  let hasEvaluations = false;

  if (workspace && (workspace.role === "owner" || workspace.role === "admin")) {
    const { integrations } = await listAgentConnections({
      accountAddress: session.principalId,
      workspaceId: workspace.workspaceId,
    });
    hasConnectedAgent = integrations.some(integration => isUsableAgentConnection(integration));
    if (hasConnectedAgent) {
      const [groups, dashboard] = await Promise.all([
        listPrivateGroups({ accountAddress: session.principalId, workspaceId: workspace.workspaceId }),
        getWorkspaceEvaluationDashboard({ accountAddress: session.principalId, workspaceId: workspace.workspaceId }),
      ]);
      hasGroups = groups.length > 0;
      hasEvaluations = dashboard.runs.length > 0;
    }
  }

  return (
    <AppPageShell outerClassName="pb-8" contentClassName="space-y-5">
      <AgentWorkspacePanels
        key={workspace?.workspaceId ?? "no-workspace"}
        activeTab={tab}
        initialHasConnectedAgent={hasConnectedAgent}
        initialHasEvaluations={hasEvaluations}
        initialHasGroups={hasGroups}
        initialWorkspaceId={workspace?.workspaceId ?? ""}
        workspaces={workspaces}
      />
    </AppPageShell>
  );
}
