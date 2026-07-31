"use client";

import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { HumanInboxBadge } from "~~/components/tokenless/human/HumanInboxBadge";
import { type HumanNavigation, humanSectionHref } from "~~/components/tokenless/human/humanNavigation";
import { Link } from "~~/i18n/navigation";

export type { HumanTab } from "~~/components/tokenless/human/humanNavigation";

const tabs: HumanNavigation[] = ["discover", "history", "inbox", "profile", "settings"];

export function HumanTabs({ active, endAction }: { active: HumanNavigation; endAction?: ReactNode }) {
  const t = useTranslations("human.tabs");
  const searchParams = useSearchParams();
  const preservedSearch = new URLSearchParams(searchParams?.toString() ?? "");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label={t("ariaLabel")} className="flex flex-wrap gap-2">
        {tabs.map(tab => (
          <Link
            key={tab}
            href={humanSectionHref(
              tab,
              active === tab
                ? preservedSearch
                : tab === "history"
                  ? new URLSearchParams({ scope: "private" })
                  : undefined,
            )}
            aria-current={active === tab ? "page" : undefined}
            className={`tab-control px-4 py-1.5 text-base font-medium transition-colors ${
              active === tab ? "pill-active" : "pill-inactive"
            }`}
          >
            <span className="inline-flex items-center gap-2">
              {t(tab)}
              {tab === "inbox" ? <HumanInboxBadge /> : null}
            </span>
          </Link>
        ))}
      </nav>
      {endAction ? <div className="ml-auto">{endAction}</div> : null}
    </div>
  );
}
