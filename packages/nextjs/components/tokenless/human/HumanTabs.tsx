import type { ReactNode } from "react";
import Link from "next/link";

export type HumanTab = "discover" | "profile" | "settings";
type HumanNavigation = HumanTab | "history";

const tabs: Array<{ value: HumanNavigation; label: string; href: string }> = [
  { value: "discover", label: "To review", href: "/human?tab=discover" },
  { value: "history", label: "History", href: "/human?tab=discover&view=history&scope=private" },
  { value: "profile", label: "Profile", href: "/human?tab=profile" },
  { value: "settings", label: "Settings", href: "/human?tab=settings" },
];

export function HumanTabs({ active, endAction }: { active: HumanNavigation; endAction?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Human sections" className="flex flex-wrap gap-2">
        {tabs.map(tab => (
          <Link
            key={tab.value}
            href={tab.href}
            aria-current={active === tab.value ? "page" : undefined}
            className={`tab-control px-4 py-1.5 text-base font-medium transition-colors ${
              active === tab.value ? "pill-active" : "pill-inactive"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {endAction ? <div className="ml-auto">{endAction}</div> : null}
    </div>
  );
}
