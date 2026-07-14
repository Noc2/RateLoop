import Link from "next/link";

export type HumanTab = "discover" | "profile" | "settings";

const tabs: Array<{ value: HumanTab; label: string }> = [
  { value: "discover", label: "Discover" },
  { value: "profile", label: "Profile" },
  { value: "settings", label: "Settings" },
];

export function HumanTabs({ active }: { active: HumanTab }) {
  return (
    <nav aria-label="Human sections" className="flex flex-wrap gap-2">
      {tabs.map(tab => (
        <Link
          key={tab.value}
          href={`/human?tab=${tab.value}`}
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
