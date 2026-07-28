"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { HumanInboxBadge } from "~~/components/tokenless/human/HumanInboxBadge";
import { type HumanNavigation, humanSectionHref } from "~~/components/tokenless/human/humanNavigation";

export type { HumanTab } from "~~/components/tokenless/human/humanNavigation";

const tabs: Array<{ value: HumanNavigation; label: string }> = [
  { value: "discover", label: "To review" },
  { value: "history", label: "History" },
  { value: "inbox", label: "Inbox" },
  { value: "profile", label: "Profile" },
  { value: "settings", label: "Settings" },
];

export function HumanTabs({ active, endAction }: { active: HumanNavigation; endAction?: ReactNode }) {
  const searchParams = useSearchParams();
  const preservedSearch = new URLSearchParams(searchParams?.toString() ?? "");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Human sections" className="flex flex-wrap gap-2">
        {tabs.map(tab => (
          <Link
            key={tab.value}
            href={humanSectionHref(
              tab.value,
              active === tab.value
                ? preservedSearch
                : tab.value === "history"
                  ? new URLSearchParams({ scope: "private" })
                  : undefined,
            )}
            aria-current={active === tab.value ? "page" : undefined}
            className={`tab-control px-4 py-1.5 text-base font-medium transition-colors ${
              active === tab.value ? "pill-active" : "pill-inactive"
            }`}
          >
            <span className="inline-flex items-center gap-2">
              {tab.label}
              {tab.value === "inbox" ? <HumanInboxBadge /> : null}
            </span>
          </Link>
        ))}
      </nav>
      {endAction ? <div className="ml-auto">{endAction}</div> : null}
    </div>
  );
}
