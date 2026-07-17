import { cookies } from "next/headers";
import { AppPageShell } from "~~/components/shared/AppPageShell";
import { AgentWorkspacePanels } from "~~/components/tokenless/agents/AgentWorkspacePanels";
import { AgentsSignInPrompt } from "~~/components/tokenless/agents/AgentsSignInPrompt";
import { resolveAgentTabParam, selectRequestedWorkspace } from "~~/components/tokenless/agents/agentWorkspaceState";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";
import { listProductWorkspaces } from "~~/lib/tokenless/productCore";
import { getWorkspaceAgentSetup } from "~~/lib/tokenless/workspaceAgentSetup";

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
  const tab = resolveAgentTabParam(rawTab);
  const workspaces = await listProductWorkspaces(session.principalId);
  const requestedWorkspaceId = firstQueryValue(params.workspace);
  const requestedStep = firstQueryValue(params.step);
  const workspace = selectRequestedWorkspace(workspaces, requestedWorkspaceId);
  let hasConnectedAgent = false;
  let setup = null;

  if (workspace) {
    setup = await getWorkspaceAgentSetup({
      accountAddress: session.principalId,
      workspaceId: workspace.workspaceId,
      requestedStep,
    });
    hasConnectedAgent = setup.complete;
  }

  return (
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
  );
}
