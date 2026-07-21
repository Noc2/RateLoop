"use client";

import { useCallback, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceSettingsClient } from "../WorkspaceSettingsClient";
import { WorkspaceStopBanner } from "../WorkspaceStopControl";
import { AgentConnectionPanel } from "./AgentConnectionPanel";
import { AgentRegistryPanel } from "./AgentRegistryPanel";
import { AgentReviewsPanel } from "./AgentReviewsPanel";
import { type AgentTab, AgentTabs } from "./AgentTabs";
import { EvaluationDashboardPanel } from "./EvaluationDashboardPanel";
import { EvidenceWorkspacePanel } from "./EvidenceWorkspacePanel";
import { FeedbackBonusAwardInbox } from "./FeedbackBonusAwardInbox";
import { HumanReviewApprovalInbox } from "./HumanReviewApprovalInbox";
import { OversightAlertsPanel } from "./OversightAlertsPanel";
import type { AgentConnectionHistoryEntry } from "./agentAuditHistory";
import { connectedAgentTabs, resolveAvailableAgentTab } from "./agentWorkspaceState";
import { AgentSetupFlow } from "./setup/AgentSetupFlow";
import { WorkspaceSetupStart } from "./setup/WorkspaceSetupStart";
import type { WorkspaceAgentSetupView } from "~~/lib/tokenless/workspaceAgentSetup";

type Workspace = { workspaceId: string; name: string; role: string };

export function AgentWorkspacePanels({
  activeTab,
  initialHasConnectedAgent,
  initialSetup,
  initialWorkspaceId,
  workspaces,
}: {
  activeTab: AgentTab;
  initialHasConnectedAgent: boolean;
  initialSetup: WorkspaceAgentSetupView | null;
  initialWorkspaceId: string;
  workspaces: Workspace[];
}) {
  const router = useRouter();
  const workspaceId = initialWorkspaceId;
  const hasConnectedAgent = initialSetup?.complete ?? initialHasConnectedAgent;
  const [agentRevision, refreshAgents] = useReducer(value => value + 1, 0);
  const publishingRevision = 0;
  const [connectionHistoryState, setConnectionHistoryState] = useState<{
    workspaceId: string;
    entries: AgentConnectionHistoryEntry[];
  }>({ workspaceId, entries: [] });
  const connectionHistory = connectionHistoryState.workspaceId === workspaceId ? connectionHistoryState.entries : [];

  const handleConnectionState = useCallback(() => refreshAgents(), []);
  const handleConnectionHistoryChange = useCallback(
    (entries: AgentConnectionHistoryEntry[]) => setConnectionHistoryState({ workspaceId, entries }),
    [workspaceId],
  );

  if (workspaces.length === 0) {
    return <WorkspaceSetupStart />;
  }

  const workspace = workspaces.find(entry => entry.workspaceId === workspaceId) ?? workspaces[0];
  const canManage = workspace.role === "owner" || workspace.role === "admin";
  const visibleTabs = connectedAgentTabs({ canManage });
  const resolvedTab = resolveAvailableAgentTab(activeTab, visibleTabs);

  if (initialSetup && !initialSetup.complete) {
    return (
      <div className="space-y-5">
        {workspaces.length > 1 ? (
          <div className="flex justify-end">
            <label className="min-w-56 text-sm text-base-content/60">
              Workspace
              <select
                className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={workspaceId}
                onChange={event => router.push(`/agents?workspace=${encodeURIComponent(event.target.value)}`)}
              >
                {workspaces.map(entry => (
                  <option key={entry.workspaceId} value={entry.workspaceId}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        <AgentSetupFlow initialSetup={initialSetup} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Persistent across every agents tab while the workspace stop is engaged. */}
      <WorkspaceStopBanner workspaceId={workspaceId} />
      {hasConnectedAgent ? (
        <AgentTabs
          active={resolvedTab}
          visibleTabs={visibleTabs}
          workspaceId={workspaceId}
          workspaces={workspaces}
          onWorkspaceChange={nextWorkspaceId =>
            router.push(
              `/agents?tab=${encodeURIComponent(resolvedTab)}&workspace=${encodeURIComponent(nextWorkspaceId)}`,
            )
          }
        />
      ) : null}

      <div
        key={workspaceId}
        id="agent-workspace-panel"
        role="tabpanel"
        aria-labelledby={`agent-tab-${resolvedTab}`}
        tabIndex={0}
        className="space-y-5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--rateloop-blue)]"
      >
        {hasConnectedAgent && resolvedTab === "overview" ? (
          <WorkspaceSettingsClient initialWorkspaceId={workspaceId} />
        ) : null}
        {hasConnectedAgent && resolvedTab === "connect" && canManage ? (
          <AgentConnectionPanel
            workspaceId={workspaceId}
            publishingRevision={publishingRevision}
            onAgentApproved={refreshAgents}
            onConnectionStateChange={handleConnectionState}
            onConnectionHistoryChange={handleConnectionHistoryChange}
          />
        ) : null}
        {hasConnectedAgent && resolvedTab === "connect" ? (
          <AgentRegistryPanel
            workspaceId={workspaceId}
            agentRevision={agentRevision}
            connectionHistory={connectionHistory}
            onAgentsChanged={refreshAgents}
          />
        ) : null}
        {hasConnectedAgent && resolvedTab === "inbox" && canManage ? (
          <HumanReviewApprovalInbox workspaceId={workspaceId} />
        ) : null}
        {hasConnectedAgent && resolvedTab === "inbox" && canManage ? (
          <FeedbackBonusAwardInbox workspaceId={workspaceId} />
        ) : null}
        {hasConnectedAgent && resolvedTab === "registry" && canManage ? (
          <AgentReviewsPanel workspaceId={workspaceId} canManage={canManage} />
        ) : null}
        {hasConnectedAgent && resolvedTab === "evaluations" && canManage ? (
          <OversightAlertsPanel workspaceId={workspaceId} />
        ) : null}
        {hasConnectedAgent && resolvedTab === "evaluations" ? (
          <EvaluationDashboardPanel initialWorkspaceId={workspaceId} showWorkspaceSelector={false} />
        ) : null}
        {hasConnectedAgent && resolvedTab === "evidence" ? (
          <EvidenceWorkspacePanel workspaceId={workspaceId} canManage={canManage} />
        ) : null}
      </div>
    </div>
  );
}
