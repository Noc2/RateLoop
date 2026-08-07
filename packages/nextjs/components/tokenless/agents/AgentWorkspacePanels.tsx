"use client";

import { type ReactNode, useCallback, useReducer, useState } from "react";
import { useSearchParams } from "next/navigation";
import { WorkspaceSettingsClient } from "../WorkspaceSettingsClient";
import { WorkspaceStopBanner } from "../WorkspaceStopControl";
import { Button } from "../ui/Button";
import { AgentConnectionPanel } from "./AgentConnectionPanel";
import { AgentOverviewMonitor } from "./AgentOverviewMonitor";
import { AgentRegistryPanel } from "./AgentRegistryPanel";
import { AgentReviewsPanel } from "./AgentReviewsPanel";
import { type AgentTab, AgentTabs } from "./AgentTabs";
import { useAgentTranslations } from "./AgentsLocaleProvider";
import { EvaluationDashboardPanel } from "./EvaluationDashboardPanel";
import { EvidenceWorkspacePanel } from "./EvidenceWorkspacePanel";
import { FeedbackBonusAwardInbox } from "./FeedbackBonusAwardInbox";
import { HumanReviewApprovalInbox } from "./HumanReviewApprovalInbox";
import { OversightAlertsPanel } from "./OversightAlertsPanel";
import { ScheduledWorkerHealthPanel } from "./ScheduledWorkerHealthPanel";
import type { AgentConnectionHistoryEntry } from "./agentAuditHistory";
import {
  agentTabHref,
  agentWorkspaceSwitchSearch,
  connectedAgentTabs,
  resolveAvailableAgentTab,
} from "./agentWorkspaceState";
import { AgentSetupFlow } from "./setup/AgentSetupFlow";
import { WorkspaceSetupStart } from "./setup/WorkspaceSetupStart";
import { Card } from "~~/components/tokenless/ui/Card";
import { Link, useRouter } from "~~/i18n/navigation";
import type { WorkspaceAgentSetupView } from "~~/lib/tokenless/workspaceAgentSetup";

type Workspace = { workspaceId: string; name: string; role: string };

export function AfterGuidedAgentSetup({
  children,
  setupIncomplete,
}: {
  children: ReactNode;
  setupIncomplete: boolean;
}) {
  return setupIncomplete ? null : children;
}

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
  const t = useAgentTranslations("workspace");
  const tabLabels = useAgentTranslations("tabs");
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const selectedAgentId = (searchParams.get("agent") ?? "").trim().slice(0, 256) || null;
  const selectedVersionId = (searchParams.get("version") ?? "").trim().slice(0, 256) || null;
  const showAgentManagement = agentManagementWorkspaceId === workspaceId || selectedAgentId !== null;

  const handleConnectionState = useCallback(() => refreshAgents(), []);
  const handleConnectionHistoryChange = useCallback(
    (entries: AgentConnectionHistoryEntry[]) => setConnectionHistoryState({ workspaceId, entries }),
    [workspaceId],
  );

  if (workspaces.length === 0) {
    return <WorkspaceSetupStart />;
  }

  const workspace = workspaces.find(entry => entry.workspaceId === workspaceId);
  if (!workspace) {
    return (
      <Card as="section" className="rounded-2xl p-6 sm:p-8" aria-labelledby="choose-workspace-heading">
        <h1 id="choose-workspace-heading" className="text-3xl font-semibold">
          {t("chooseTitle")}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-base-content/65">{t("chooseDescription")}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          {workspaces.map(option => (
            <Button
              as={Link}
              variant="secondary"
              size="none"
              className="min-h-11"
              key={option.workspaceId}
              href={agentTabHref(activeTab, option.workspaceId)}
            >
              {option.name}
            </Button>
          ))}
        </div>
      </Card>
    );
  }
  const canManage = workspace.role === "owner" || workspace.role === "admin";
  const setupIncomplete = Boolean(initialSetup && !initialSetup.complete);
  const visibleTabs = hasConnectedAgent
    ? connectedAgentTabs({ canManage })
    : canManage
      ? (["connect", "billing"] as AgentTab[])
      : (["billing"] as AgentTab[]);
  const resolvedTab = resolveAvailableAgentTab(activeTab, visibleTabs);

  return (
    <div className="space-y-5">
      <AgentTabs
        active={resolvedTab}
        visibleTabs={visibleTabs}
        workspaceId={workspaceId}
        workspaces={workspaces}
        onWorkspaceChange={nextWorkspaceId =>
          router.push(agentTabHref(resolvedTab, nextWorkspaceId, agentWorkspaceSwitchSearch(searchParams)))
        }
      />
      {!setupIncomplete ? <h1 className="sr-only">{tabLabels(resolvedTab)}</h1> : null}
      {/* Persistent across every agents tab while the workspace stop is engaged. */}
      <WorkspaceStopBanner workspaceId={workspaceId} />
      {setupIncomplete && initialSetup ? <AgentSetupFlow initialSetup={initialSetup} /> : null}

      <div key={workspaceId} id="agent-workspace-panel" className="space-y-5">
        {resolvedTab === "overview" ? (
          <>
            <AgentOverviewMonitor workspaceId={workspaceId} />
            {canManage ? <ScheduledWorkerHealthPanel workspaceId={workspaceId} /> : null}
          </>
        ) : null}
        {resolvedTab === "billing" ? <WorkspaceSettingsClient initialWorkspaceId={workspaceId} /> : null}
        {resolvedTab === "connect" && canManage ? (
          <AfterGuidedAgentSetup setupIncomplete={setupIncomplete}>
            <AgentConnectionPanel
              workspaceId={workspaceId}
              publishingRevision={publishingRevision}
              onAgentApproved={refreshAgents}
              onConnectionStateChange={handleConnectionState}
              onConnectionHistoryChange={handleConnectionHistoryChange}
            />
          </AfterGuidedAgentSetup>
        ) : null}
        {hasConnectedAgent && resolvedTab === "connect" ? (
          <Card as="section" className="rounded-2xl p-5" aria-labelledby="agent-version-management-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="agent-version-management-heading" className="font-semibold">
                {t("versionsTitle")}
              </h2>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                aria-controls="agent-version-management"
                aria-expanded={showAgentManagement}
                onClick={() => setAgentManagementWorkspaceId(current => (current === workspaceId ? null : workspaceId))}
              >
                {showAgentManagement ? t("done") : t("updateVersion")}
              </Button>
            </div>
            {showAgentManagement ? (
              <div id="agent-version-management" className="mt-5 border-t border-base-content/10 pt-5">
                <AgentRegistryPanel
                  workspaceId={workspaceId}
                  agentRevision={agentRevision}
                  connectionHistory={connectionHistory}
                  selectedAgentId={selectedAgentId}
                  selectedVersionId={selectedVersionId}
                  onAgentsChanged={refreshAgents}
                />
              </div>
            ) : null}
          </Card>
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
          <>
            <EvaluationDashboardPanel initialWorkspaceId={workspaceId} />
            <EvidenceWorkspacePanel
              key={[
                workspaceId,
                searchParams.get("q"),
                searchParams.get("outcome"),
                searchParams.get("date"),
                searchParams.get("run"),
                searchParams.get("packet"),
              ].join(":")}
              workspaceId={workspaceId}
              canManage={canManage}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
