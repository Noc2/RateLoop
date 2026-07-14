import Link from "next/link";

export type AgentTab = "overview" | "integrate" | "agents" | "groups" | "evaluations";

const tabs: Array<{ value: AgentTab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "integrate", label: "Integrate" },
  { value: "agents", label: "Agents" },
  { value: "groups", label: "Groups" },
  { value: "evaluations", label: "Evaluations" },
];

export function AgentTabs({ active }: { active: AgentTab }) {
  return (
    <nav aria-label="Agent workspace sections" className="flex flex-wrap gap-2">
      {tabs.map(tab => (
        <Link
          key={tab.value}
          href={`/agents?tab=${tab.value}`}
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
