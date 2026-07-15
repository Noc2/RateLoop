"use client";

import { useCallback, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceSettingsClient } from "../WorkspaceSettingsClient";
import { AgentConnectionPanel } from "./AgentConnectionPanel";
import { AgentPublishingPolicyPanel } from "./AgentPublishingPolicyPanel";
import { AgentRegistryPanel } from "./AgentRegistryPanel";
import { AgentReviewPolicyPanel } from "./AgentReviewPolicyPanel";
import { type AgentTab, AgentTabs } from "./AgentTabs";
import { EvaluationDashboardPanel } from "./EvaluationDashboardPanel";
import { PrivateGroupsPanel } from "./PrivateGroupsPanel";
import { connectedAgentTabs, resolveAvailableAgentTab } from "./agentWorkspaceState";

type Workspace = { workspaceId: string; name: string; role: string };

export function AgentWorkspacePanels({
  activeTab,
  initialHasConnectedAgent,
  initialHasEvaluations,
  initialHasGroups,
  initialWorkspaceId,
  workspaces,
}: {
  activeTab: AgentTab;
  initialHasConnectedAgent: boolean;
  initialHasEvaluations: boolean;
  initialHasGroups: boolean;
  initialWorkspaceId: string;
  workspaces: Workspace[];
}) {
  const router = useRouter();
  const workspaceId = initialWorkspaceId;
  const [hasConnectedAgent, setHasConnectedAgent] = useState(initialHasConnectedAgent);
  const [agentRevision, refreshAgents] = useReducer(value => value + 1, 0);
  const [publishingRevision, refreshPublishingPolicies] = useReducer(value => value + 1, 0);
  const [managementPanel, setManagementPanel] = useState<"review" | "publishing" | null>(null);

  const handleConnectionState = useCallback((connected: boolean) => {
    setHasConnectedAgent(connected);
  }, []);

  if (workspaces.length === 0) {
    return <WorkspaceSettingsClient />;
  }

  const workspace = workspaces.find(entry => entry.workspaceId === workspaceId) ?? workspaces[0];
  const canManage = workspace.role === "owner" || workspace.role === "admin";
  const onboarding = !hasConnectedAgent;
  const visibleTabs = connectedAgentTabs({ hasEvaluations: initialHasEvaluations, hasGroups: initialHasGroups });
  const resolvedTab = resolveAvailableAgentTab(activeTab, visibleTabs);

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
        {onboarding && canManage ? (
          <AgentConnectionPanel
            workspaceId={workspaceId}
            publishingRevision={publishingRevision}
            onAgentApproved={refreshAgents}
            onConnectionStateChange={handleConnectionState}
          />
        ) : null}

        {onboarding && !canManage ? (
          <section className="surface-card rounded-2xl p-6">
            <h2 className="text-xl font-semibold">No agent connected</h2>
            <p className="mt-2 text-sm text-base-content/60">Ask a workspace owner to connect one.</p>
          </section>
        ) : null}

        {hasConnectedAgent && resolvedTab === "overview" ? <WorkspaceSettingsClient /> : null}
        {hasConnectedAgent && resolvedTab === "agents" && canManage ? (
          <AgentConnectionPanel
            workspaceId={workspaceId}
            publishingRevision={publishingRevision}
            onAgentApproved={refreshAgents}
            onConnectionStateChange={handleConnectionState}
          />
        ) : null}
        {hasConnectedAgent && resolvedTab === "agents" ? (
          <AgentRegistryPanel
            workspaceId={workspaceId}
            agentRevision={agentRevision}
            activeManagementPanel={managementPanel}
            onAgentsChanged={refreshAgents}
            onManagementPanelChange={setManagementPanel}
          />
        ) : null}
        {hasConnectedAgent && resolvedTab === "agents" && canManage && managementPanel === "review" ? (
          <div id="agent-review-behavior">
            <AgentReviewPolicyPanel workspaceId={workspaceId} agentRevision={agentRevision} />
          </div>
        ) : null}
        {hasConnectedAgent && resolvedTab === "agents" && canManage && managementPanel === "publishing" ? (
          <div id="agent-autonomous-requests">
            <AgentPublishingPolicyPanel
              workspaceId={workspaceId}
              publishingRevision={publishingRevision}
              onPoliciesChanged={refreshPublishingPolicies}
            />
          </div>
        ) : null}
        {hasConnectedAgent && resolvedTab === "groups" && canManage ? (
          <PrivateGroupsPanel initialWorkspaceId={workspaceId} showWorkspaceSelector={false} />
        ) : null}
        {hasConnectedAgent && resolvedTab === "evaluations" ? (
          <EvaluationDashboardPanel initialWorkspaceId={workspaceId} showWorkspaceSelector={false} />
        ) : null}
      </div>
    </div>
  );
}
