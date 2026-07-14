import { AppPageShell } from "~~/components/shared/AppPageShell";
import { WorkspaceSettingsClient } from "~~/components/tokenless/WorkspaceSettingsClient";
import { AgentConnectionPanel } from "~~/components/tokenless/agents/AgentConnectionPanel";
import { AgentPublishingPolicyPanel } from "~~/components/tokenless/agents/AgentPublishingPolicyPanel";
import { AgentRegistryPanel } from "~~/components/tokenless/agents/AgentRegistryPanel";
import { AgentReviewPolicyPanel } from "~~/components/tokenless/agents/AgentReviewPolicyPanel";
import { type AgentTab, AgentTabs } from "~~/components/tokenless/agents/AgentTabs";
import { EvaluationDashboardPanel } from "~~/components/tokenless/agents/EvaluationDashboardPanel";
import { PrivateGroupsPanel } from "~~/components/tokenless/agents/PrivateGroupsPanel";

const AGENT_TABS = new Set<AgentTab>(["overview", "agents", "groups", "evaluations"]);

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const requestedTab = (await searchParams).tab;
  const rawTab = Array.isArray(requestedTab) ? requestedTab[0] : requestedTab;
  const tab = AGENT_TABS.has(rawTab as AgentTab) ? (rawTab as AgentTab) : "overview";
  return (
    <AppPageShell outerClassName="pb-8" contentClassName="space-y-5">
      <AgentTabs active={tab} />
      {tab === "overview" ? <WorkspaceSettingsClient /> : null}
      {tab === "agents" ? (
        <>
          <AgentConnectionPanel />
          <AgentRegistryPanel />
          <AgentReviewPolicyPanel />
          <AgentPublishingPolicyPanel />
        </>
      ) : null}
      {tab === "groups" ? <PrivateGroupsPanel /> : null}
      {tab === "evaluations" ? <EvaluationDashboardPanel /> : null}
    </AppPageShell>
  );
}
