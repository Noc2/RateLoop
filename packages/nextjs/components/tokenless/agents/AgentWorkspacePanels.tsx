"use client";

import { useCallback, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceSettingsClient } from "../WorkspaceSettingsClient";
import { WorkspaceStopBanner } from "../WorkspaceStopControl";
import { Button } from "../ui/Button";
import { AgentConnectionPanel } from "./AgentConnectionPanel";
import { AgentRegistryPanel } from "./AgentRegistryPanel";
import { AgentReviewsPanel } from "./AgentReviewsPanel";
import { type AgentTab, AgentTabs } from "./AgentTabs";
import { EvaluationDashboardPanel } from "./EvaluationDashboardPanel";
import { EvidenceWorkspacePanel } from "./EvidenceWorkspacePanel";
import { FeedbackBonusAwardInbox } from "./FeedbackBonusAwardInbox";
import { HumanReviewApprovalInbox } from "./HumanReviewApprovalInbox";
import { OversightAlertsPanel } from "./OversightAlertsPanel";
import { ScheduledWorkerHealthPanel } from "./ScheduledWorkerHealthPanel";
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
  const [agentManagementWorkspaceId, setAgentManagementWorkspaceId] = useState<string | null>(null);
  const connectionHistory = connectionHistoryState.workspaceId === workspaceId ? connectionHistoryState.entries : [];
  const showAgentManagement = agentManagementWorkspaceId === workspaceId;

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
  const setupIncomplete = Boolean(initialSetup && !initialSetup.complete);
  const visibleTabs = hasConnectedAgent
    ? connectedAgentTabs({ canManage })
    : canManage
      ? (["overview", "connect"] as AgentTab[])
      : (["overview"] as AgentTab[]);
  const resolvedTab = resolveAvailableAgentTab(activeTab, visibleTabs);

  return (
    <div className="space-y-5">
      {/* Persistent across every agents tab while the workspace stop is engaged. */}
      <WorkspaceStopBanner workspaceId={workspaceId} />
      {setupIncomplete && initialSetup ? <AgentSetupFlow initialSetup={initialSetup} /> : null}
      <AgentTabs
        active={resolvedTab}
        visibleTabs={visibleTabs}
        workspaceId={workspaceId}
        workspaces={workspaces}
        onWorkspaceChange={nextWorkspaceId =>
          router.push(`/agents?tab=${encodeURIComponent(resolvedTab)}&workspace=${encodeURIComponent(nextWorkspaceId)}`)
        }
      />

      <div
        key={workspaceId}
        id="agent-workspace-panel"
        role="tabpanel"
        aria-labelledby={`agent-tab-${resolvedTab}`}
        tabIndex={0}
        className="space-y-5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--rateloop-blue)]"
      >
        {resolvedTab === "overview" ? (
          <>
            {canManage ? <ScheduledWorkerHealthPanel workspaceId={workspaceId} /> : null}
            <WorkspaceSettingsClient initialWorkspaceId={workspaceId} />
          </>
        ) : null}
        {resolvedTab === "connect" && canManage ? (
          <AgentConnectionPanel
            workspaceId={workspaceId}
            publishingRevision={publishingRevision}
            onAgentApproved={refreshAgents}
            onConnectionStateChange={handleConnectionState}
            onConnectionHistoryChange={handleConnectionHistoryChange}
          />
        ) : null}
        {hasConnectedAgent && resolvedTab === "connect" ? (
          <section className="surface-card rounded-2xl p-5" aria-labelledby="agent-version-management-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="agent-version-management-heading" className="font-semibold">
                  Agent versions
                </h2>
                <p className="mt-1 text-sm text-base-content/60">
                  Update workflow versions or view archived agents when needed.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                aria-controls="agent-version-management"
                aria-expanded={showAgentManagement}
                onClick={() => setAgentManagementWorkspaceId(current => (current === workspaceId ? null : workspaceId))}
              >
                {showAgentManagement ? "Done" : "Update agent version"}
              </Button>
            </div>
            {showAgentManagement ? (
              <div id="agent-version-management" className="mt-5 border-t border-white/10 pt-5">
                <AgentRegistryPanel
                  workspaceId={workspaceId}
                  agentRevision={agentRevision}
                  connectionHistory={connectionHistory}
                  onAgentsChanged={refreshAgents}
                />
              </div>
            ) : null}
          </section>
        ) : null}
        {hasConnectedAgent && resolvedTab === "inbox" && canManage ? (
          <HumanReviewApprovalInbox workspaceId={workspaceId} />
        ) : null}
        {hasConnectedAgent && resolvedTab === "inbox" && canManage ? (
          <FeedbackBonusAwardInbox workspaceId={workspaceId} />
        ) : null}
        {hasConnectedAgent && resolvedTab === "inbox" && canManage ? (
          <OversightAlertsPanel workspaceId={workspaceId} />
        ) : null}
        {hasConnectedAgent && resolvedTab === "registry" && canManage ? (
          <AgentReviewsPanel workspaceId={workspaceId} canManage={canManage} />
        ) : null}
        {hasConnectedAgent && resolvedTab === "evaluations" ? (
          <EvaluationDashboardPanel initialWorkspaceId={workspaceId} />
        ) : null}
        {hasConnectedAgent && resolvedTab === "evidence" ? (
          <EvidenceWorkspacePanel workspaceId={workspaceId} canManage={canManage} />
        ) : null}
      </div>
    </div>
  );
}
