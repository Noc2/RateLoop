import Link from "next/link";

export type AgentTab = "overview" | "agents" | "groups" | "evaluations";

const tabs: Array<{ value: AgentTab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "agents", label: "Agents" },
  { value: "groups", label: "Groups" },
  { value: "evaluations", label: "Evaluations" },
];

export function AgentTabs({
  active,
  visibleTabs = tabs.map(tab => tab.value),
  workspaceId,
}: {
  active: AgentTab;
  visibleTabs?: AgentTab[];
  workspaceId?: string;
}) {
  return (
    <nav aria-label="Agent workspace sections" className="flex flex-wrap gap-2">
      {tabs
        .filter(tab => visibleTabs.includes(tab.value))
        .map(tab => (
          <Link
            key={tab.value}
            href={`/agents?tab=${tab.value}${workspaceId ? `&workspace=${encodeURIComponent(workspaceId)}` : ""}`}
            aria-current={active === tab.value ? "page" : undefined}
            className={`tab-control px-4 py-1.5 text-base font-medium transition-colors ${
              active === tab.value ? "pill-active" : "pill-inactive"
            }`}
          >
            {tab.label}
          </Link>
        ))}
    </nav>
  );
}
