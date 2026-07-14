import { AppPageShell } from "~~/components/shared/AppPageShell";
import { WorkspaceSettingsClient } from "~~/components/tokenless/WorkspaceSettingsClient";
import { AgentIntegrationPanel } from "~~/components/tokenless/agents/AgentIntegrationPanel";
import { type AgentTab, AgentTabs } from "~~/components/tokenless/agents/AgentTabs";

const AGENT_TABS = new Set<AgentTab>(["overview", "integrate", "agents", "groups", "evaluations"]);

function PendingSurface({ tab }: { tab: Exclude<AgentTab, "overview" | "integrate"> }) {
  const copy = {
    agents: ["Agent registry", "Register agent identities and immutable model versions."],
    groups: ["Private groups", "Manage durable memberships and scoped invitation tokens."],
    evaluations: ["Evaluations", "Compare human agreement, disagreement, latency, coverage, and cost."],
  } as const;
  return (
    <section className="surface-card rounded-2xl p-6">
      <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">{copy[tab][0]}</p>
      <h2 className="mt-2 text-2xl font-semibold">{copy[tab][1]}</h2>
      <p className="mt-4 text-sm leading-6 text-base-content/60">
        Select or create a workspace in Overview first. Configuration on this tab is workspace-scoped and server
        authorized.
      </p>
    </section>
  );
}

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const requestedTab = (await searchParams).tab;
  const rawTab = Array.isArray(requestedTab) ? requestedTab[0] : requestedTab;
  const tab = AGENT_TABS.has(rawTab as AgentTab) ? (rawTab as AgentTab) : "overview";
  return (
    <AppPageShell outerClassName="pb-8" contentClassName="space-y-5">
      <AgentTabs active={tab} />
      {tab === "overview" ? <WorkspaceSettingsClient /> : null}
      {tab === "integrate" ? <AgentIntegrationPanel /> : null}
      {tab === "agents" || tab === "groups" || tab === "evaluations" ? <PendingSurface tab={tab} /> : null}
    </AppPageShell>
  );
}
