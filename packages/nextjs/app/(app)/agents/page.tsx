import { cookies } from "next/headers";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { type AgentTab } from "~~/components/tokenless/agents/AgentTabs";
import { AgentWorkspacePanels } from "~~/components/tokenless/agents/AgentWorkspacePanels";
import { AgentsSignInPrompt } from "~~/components/tokenless/agents/AgentsSignInPrompt";
import { selectRequestedWorkspace } from "~~/components/tokenless/agents/agentWorkspaceState";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";
import { getWorkspaceEvaluationDashboard } from "~~/lib/tokenless/evaluationDashboard";
import { listPrivateGroups } from "~~/lib/tokenless/privateGroups";
import { listProductWorkspaces } from "~~/lib/tokenless/productCore";
import { getWorkspaceAgentSetup } from "~~/lib/tokenless/workspaceAgentSetup";

const AGENT_TABS = new Set<AgentTab>(["overview", "agents", "groups", "evaluations"]);

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; workspace?: string | string[]; step?: string | string[] }>;
}) {
  const cookieStore = await cookies();
  const session = await findAuthSession(cookieStore.get(AUTH_SESSION_COOKIE)?.value);

  if (!session) return <AgentsSignInPrompt />;

  const params = await searchParams;
  const rawTab = firstQueryValue(params.tab);
  const tab = AGENT_TABS.has(rawTab as AgentTab) ? (rawTab as AgentTab) : "overview";
  const workspaces = await listProductWorkspaces(session.principalId);
  const requestedWorkspaceId = firstQueryValue(params.workspace);
  const requestedStep = firstQueryValue(params.step);
  const workspace = selectRequestedWorkspace(workspaces, requestedWorkspaceId);
  let hasConnectedAgent = false;
  let hasGroups = false;
  let hasEvaluations = false;
  let setup = null;

  if (workspace) {
    setup = await getWorkspaceAgentSetup({
      accountAddress: session.principalId,
      workspaceId: workspace.workspaceId,
      requestedStep,
    });
    hasConnectedAgent = setup.complete;
    if (setup.complete && (workspace.role === "owner" || workspace.role === "admin")) {
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
        initialSetup={setup}
        initialWorkspaceId={workspace?.workspaceId ?? ""}
        workspaces={workspaces}
      />
    </AppPageShell>
  );
}
