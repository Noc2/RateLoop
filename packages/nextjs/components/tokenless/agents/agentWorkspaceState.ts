import type { AgentTab } from "./AgentTabs";

type WorkspaceOption = { workspaceId: string };
type ConnectionOption = {
  status: string | null;
  connectionStatus?: string | null;
  expiresAt?: string | null;
};

export function selectRequestedWorkspace<T extends WorkspaceOption>(workspaces: T[], requestedWorkspaceId?: string) {
  return workspaces.find(workspace => workspace.workspaceId === requestedWorkspaceId) ?? workspaces[0] ?? null;
}

export function isUsableAgentConnection(connection: ConnectionOption, now = Date.now()) {
  if (connection.status !== "active") return false;
  if (connection.connectionStatus && connection.connectionStatus !== "connected") return false;
  if (!connection.expiresAt) return true;
  const expiresAt = new Date(connection.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function connectedAgentTabs({
  hasGroups = false,
  hasEvaluations = false,
}: {
  hasGroups?: boolean;
  hasEvaluations?: boolean;
} = {}): AgentTab[] {
  return [
    "overview",
    "agents",
    ...(hasGroups ? (["groups"] as const) : []),
    ...(hasEvaluations ? (["evaluations"] as const) : []),
  ];
}

export function resolveAvailableAgentTab(requested: AgentTab, available: AgentTab[]): AgentTab {
  if (available.includes(requested)) return requested;
  return available.includes("agents") ? "agents" : (available[0] ?? "agents");
}
