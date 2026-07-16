"use client";

import { useCallback, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceDeletionPanel } from "../WorkspaceDeletionPanel";
import { WorkspaceSettingsClient } from "../WorkspaceSettingsClient";
import { AgentConnectionPanel } from "./AgentConnectionPanel";
import { AgentHumanReviewEditor } from "./AgentHumanReviewEditor";
import { AgentRegistryPanel } from "./AgentRegistryPanel";
import { type AgentTab, AgentTabs } from "./AgentTabs";
import { EvaluationDashboardPanel } from "./EvaluationDashboardPanel";
import { EvidenceWorkspacePanel } from "./EvidenceWorkspacePanel";
import { FeedbackBonusAwardInbox } from "./FeedbackBonusAwardInbox";
import { HumanReviewApprovalInbox } from "./HumanReviewApprovalInbox";
import { PrivateGroupsPanel } from "./PrivateGroupsPanel";
import { WorkspaceEvidenceSummaryStrip } from "./WorkspaceEvidenceSummaryStrip";
import { connectedAgentTabs, resolveAvailableAgentTab } from "./agentWorkspaceState";
import { AgentSetupFlow } from "./setup/AgentSetupFlow";
import { WorkspaceSetupStart } from "./setup/WorkspaceSetupStart";
import type { WorkspaceAgentSetupView } from "~~/lib/tokenless/workspaceAgentSetup";

type Workspace = { workspaceId: string; name: string; role: string };

export function AgentWorkspacePanels({
  activeTab,
  initialHasConnectedAgent,
  initialHasEvaluations,
  initialHasGroups,
  initialSetup,
  initialWorkspaceId,
  workspaces,
}: {
  activeTab: AgentTab;
  initialHasConnectedAgent: boolean;
  initialHasEvaluations: boolean;
  initialHasGroups: boolean;
  initialSetup: WorkspaceAgentSetupView | null;
  initialWorkspaceId: string;
  workspaces: Workspace[];
}) {
  const router = useRouter();
  const workspaceId = initialWorkspaceId;
  const hasConnectedAgent = initialSetup?.complete ?? initialHasConnectedAgent;
  const [agentRevision, refreshAgents] = useReducer(value => value + 1, 0);
  const publishingRevision = 0;
  const [reviewAgentId, setReviewAgentId] = useState<string | null>(null);

  const handleConnectionState = useCallback(() => refreshAgents(), []);

  if (workspaces.length === 0) {
    return <WorkspaceSetupStart />;
  }

  const workspace = workspaces.find(entry => entry.workspaceId === workspaceId) ?? workspaces[0];
  const canManage = workspace.role === "owner" || workspace.role === "admin";
  const visibleTabs = connectedAgentTabs({ hasEvaluations: initialHasEvaluations, hasGroups: initialHasGroups });
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
      {hasConnectedAgent ? (
        <AgentTabs active={resolvedTab} visibleTabs={visibleTabs} workspaceId={workspaceId} />
      ) : null}

      {workspaces.length > 1 ? (
        <div className="flex justify-end">
          <label className="min-w-56 text-sm text-base-content/60">
            Workspace
            <select
              className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={workspaceId}
              onChange={event =>
                router.push(
                  `/agents?tab=${encodeURIComponent(resolvedTab)}&workspace=${encodeURIComponent(event.target.value)}`,
                )
              }
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

      <div key={workspaceId} className="space-y-5">
        {hasConnectedAgent && resolvedTab === "overview" ? <WorkspaceSettingsClient /> : null}
        {hasConnectedAgent && resolvedTab === "overview" && workspace.role === "owner" ? (
          <WorkspaceDeletionPanel workspaceId={workspace.workspaceId} workspaceName={workspace.name} />
        ) : null}
        {hasConnectedAgent && resolvedTab === "agents" && canManage ? (
          <AgentConnectionPanel
            workspaceId={workspaceId}
            publishingRevision={publishingRevision}
            onAgentApproved={refreshAgents}
            onConnectionStateChange={handleConnectionState}
          />
        ) : null}
        {hasConnectedAgent && resolvedTab === "agents" && canManage ? (
          <HumanReviewApprovalInbox workspaceId={workspaceId} />
        ) : null}
        {hasConnectedAgent && resolvedTab === "agents" && canManage ? (
          <FeedbackBonusAwardInbox workspaceId={workspaceId} />
        ) : null}
        {hasConnectedAgent && resolvedTab === "agents" ? (
          <WorkspaceEvidenceSummaryStrip workspaceId={workspaceId} canManage={canManage} />
        ) : null}
        {hasConnectedAgent && resolvedTab === "agents" ? (
          <AgentRegistryPanel
            workspaceId={workspaceId}
            agentRevision={agentRevision}
            activeReviewAgentId={reviewAgentId}
            onAgentsChanged={refreshAgents}
            onReviewAgentChange={setReviewAgentId}
          />
        ) : null}
        {hasConnectedAgent && resolvedTab === "agents" && canManage && reviewAgentId ? (
          <AgentHumanReviewEditor
            key={reviewAgentId}
            workspaceId={workspaceId}
            agentId={reviewAgentId}
            onSaved={refreshAgents}
            onClose={() => setReviewAgentId(null)}
          />
        ) : null}
        {hasConnectedAgent && resolvedTab === "groups" && canManage ? (
          <PrivateGroupsPanel initialWorkspaceId={workspaceId} showWorkspaceSelector={false} />
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
