import type { AgentTab } from "./AgentTabs";
import { type EvidenceUrlState, updateEvidenceUrlSearch } from "./evidenceUrlState";
import { type AgentAccessPresentation, hasActiveAgentAccess } from "~~/lib/tokenless/agentAccessPresentation";

type WorkspaceOption = { workspaceId: string };
type OAuthConnectionOption = {
  access: AgentAccessPresentation;
  agentId: string;
  oauthClientId?: string | null;
};

export function selectRequestedWorkspace<T extends WorkspaceOption>(workspaces: T[], requestedWorkspaceId?: string) {
  if (!requestedWorkspaceId) return workspaces[0] ?? null;
  return workspaces.find(workspace => workspace.workspaceId === requestedWorkspaceId) ?? null;
}

export function selectReconnectableOAuthConnections<T extends OAuthConnectionOption>(connections: T[]) {
  const agentsWithUsableConnections = new Set(
    connections.filter(connection => hasActiveAgentAccess(connection.access)).map(connection => connection.agentId),
  );
  const selectedAgentIds = new Set<string>();
  return connections.filter(connection => {
    if (!connection.agentId || !connection.oauthClientId || connection.access.credentialKind !== "oauth") return false;
    if (agentsWithUsableConnections.has(connection.agentId)) return false;
    if (connection.access.rateLoopAccessState !== "inactive" || selectedAgentIds.has(connection.agentId)) return false;
    selectedAgentIds.add(connection.agentId);
    return true;
  });
}

export function canStartAgentConnection(input: {
  loading: boolean;
  activeConnectionIntentCount: number;
  activePairingCount: number;
}) {
  return !input.loading && input.activeConnectionIntentCount === 0 && input.activePairingCount === 0;
}

export function connectedAgentTabs({
  canManage = true,
}: {
  canManage?: boolean;
} = {}): AgentTab[] {
  return canManage
    ? ["overview", "connect", "inbox", "registry", "evaluations", "billing"]
    : ["overview", "connect", "evaluations", "billing"];
}

export function resolveAvailableAgentTab(requested: AgentTab, available: AgentTab[]): AgentTab {
  if (available.includes(requested)) return requested;
  return available.includes("overview") ? "overview" : (available[0] ?? "overview");
}

const currentAgentTabs = new Set<AgentTab>(["overview", "connect", "inbox", "registry", "evaluations", "billing"]);

export function resolveAgentTabParam(requested?: string): AgentTab {
  if (requested === "agents") return "connect";
  if (requested === "groups") return "registry";
  if (requested === "evidence") return "evaluations";
  return currentAgentTabs.has(requested as AgentTab) ? (requested as AgentTab) : "overview";
}

export type AgentSection = "overview" | "connections" | "approvals" | "review-setup" | "results" | "billing";

const agentSectionByTab: Record<AgentTab, AgentSection> = {
  overview: "overview",
  connect: "connections",
  inbox: "approvals",
  registry: "review-setup",
  evaluations: "results",
  billing: "billing",
};

const agentTabBySection = new Map<string, AgentTab>([
  ...Object.entries(agentSectionByTab).map(([tab, section]) => [section, tab as AgentTab] as const),
  ["agents", "connect"],
  ["connect", "connect"],
  ["groups", "registry"],
  ["inbox", "inbox"],
  ["registry", "registry"],
  ["evaluations", "evaluations"],
  ["evidence", "evaluations"],
]);

type NavigationSearchParams = Record<string, string | string[] | undefined>;

function navigationSearchParams(input?: URLSearchParams | NavigationSearchParams) {
  if (!input) return new URLSearchParams();
  if (input instanceof URLSearchParams) return new URLSearchParams(input);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }
  return params;
}

function firstNavigationValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function agentSectionForTab(tab: AgentTab): AgentSection {
  return agentSectionByTab[tab];
}

export function agentTabForSection(section?: string): AgentTab | null {
  return section ? (agentTabBySection.get(section) ?? null) : null;
}

export function agentTabHref(
  tab: AgentTab,
  workspaceId?: string,
  currentSearch?: URLSearchParams | NavigationSearchParams,
) {
  const params = navigationSearchParams(currentSearch);
  params.delete("tab");
  if (workspaceId) params.set("workspace", workspaceId);
  const search = params.toString();
  return `/agents/${agentSectionForTab(tab)}${search ? `?${search}` : ""}`;
}

export function legacyAgentRouteHref(searchParams: NavigationSearchParams) {
  const tab = resolveAgentTabParam(firstNavigationValue(searchParams.tab));
  return agentTabHref(tab, undefined, searchParams);
}

export function agentSignInReturnTo(input: {
  returning?: string;
  tab?: string;
  workspaceId?: string;
  step?: string;
  evidence?: EvidenceUrlState;
  searchParams?: NavigationSearchParams;
}) {
  const params = navigationSearchParams(input.searchParams);
  params.delete("tab");
  if (input.returning === "oauth") params.set("returning", input.returning);
  if (input.workspaceId) params.set("workspace", input.workspaceId);
  if (input.step) params.set("step", input.step);
  const tab = resolveAgentTabParam(input.tab);
  const search =
    tab === "evaluations" && input.evidence ? updateEvidenceUrlSearch(params, input.evidence) : params.toString();
  return agentTabHref(tab, undefined, new URLSearchParams(search));
}

export function agentSignInReturnToWithHash(returnTo: string, hash: string) {
  return hash === "#evidence-packets-heading" ? `${returnTo}${hash}` : returnTo;
}

export function agentWorkspaceSwitchSearch(currentSearch: URLSearchParams | NavigationSearchParams) {
  const params = navigationSearchParams(currentSearch);
  for (const key of [
    "agent",
    "version",
    "run",
    "packet",
    "resultRun",
    "resultProject",
    "resultAgent",
    "resultWorkflow",
  ]) {
    params.delete(key);
  }
  return params;
}
