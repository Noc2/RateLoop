import type { AgentTab } from "./AgentTabs";

type WorkspaceOption = { workspaceId: string };
type ConnectionOption = {
  status: string | null;
  connectionStatus?: string | null;
  expiresAt?: string | null;
};

type OAuthConnectionOption = ConnectionOption & {
  agentId: string;
  oauthClientId?: string | null;
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

export function selectReconnectableOAuthConnections<T extends OAuthConnectionOption>(
  connections: T[],
  now = Date.now(),
) {
  const agentsWithUsableConnections = new Set(
    connections.filter(connection => isUsableAgentConnection(connection, now)).map(connection => connection.agentId),
  );
  const selectedAgentIds = new Set<string>();
  return connections.filter(connection => {
    if (!connection.agentId || !connection.oauthClientId) return false;
    if (agentsWithUsableConnections.has(connection.agentId)) return false;
    if (isUsableAgentConnection(connection, now) || selectedAgentIds.has(connection.agentId)) return false;
    selectedAgentIds.add(connection.agentId);
    return true;
  });
}

export function connectedAgentTabs({
  canManage = true,
}: {
  canManage?: boolean;
} = {}): AgentTab[] {
  return canManage
    ? ["overview", "connect", "inbox", "registry", "evaluations", "evidence"]
    : ["overview", "connect", "evaluations", "evidence"];
}

export function resolveAvailableAgentTab(requested: AgentTab, available: AgentTab[]): AgentTab {
  if (available.includes(requested)) return requested;
  return available.includes("overview") ? "overview" : (available[0] ?? "overview");
}

const currentAgentTabs = new Set<AgentTab>(["overview", "connect", "inbox", "registry", "evaluations", "evidence"]);

export function resolveAgentTabParam(requested?: string): AgentTab {
  if (requested === "agents") return "connect";
  if (requested === "groups") return "registry";
  return currentAgentTabs.has(requested as AgentTab) ? (requested as AgentTab) : "overview";
}

export function agentTabHref(tab: AgentTab, workspaceId?: string) {
  const params = new URLSearchParams({ tab });
  if (workspaceId) params.set("workspace", workspaceId);
  return `/agents?${params.toString()}`;
}

export function nextAgentTabIndex(currentIndex: number, key: string, tabCount: number) {
  if (tabCount <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return tabCount - 1;
  if (key === "ArrowRight") return (currentIndex + 1) % tabCount;
  if (key === "ArrowLeft") return (currentIndex - 1 + tabCount) % tabCount;
  return currentIndex;
}
