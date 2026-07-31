"use client";

import { useSearchParams } from "next/navigation";
import { useAgentTranslations } from "./AgentsLocaleProvider";
import { agentTabHref } from "./agentWorkspaceState";
import { SelectField } from "~~/components/tokenless/forms/Field";
import { Link } from "~~/i18n/navigation";

export type AgentTab = "overview" | "connect" | "inbox" | "registry" | "evaluations" | "billing";

const tabs: AgentTab[] = ["overview", "connect", "inbox", "registry", "evaluations", "billing"];

export function AgentTabs({
  active,
  onWorkspaceChange,
  visibleTabs = tabs,
  workspaces,
  workspaceId,
}: {
  active: AgentTab;
  onWorkspaceChange: (workspaceId: string) => void;
  visibleTabs?: AgentTab[];
  workspaces: Array<{ workspaceId: string; name: string }>;
  workspaceId: string;
}) {
  const t = useAgentTranslations("tabs");
  const searchParams = useSearchParams();
  const visible = tabs.filter(tab => visibleTabs.includes(tab));

  return (
    <div className="space-y-3">
      <nav
        className="-mx-1 min-w-0 overflow-x-auto px-1 lg:mx-0 lg:overflow-visible lg:px-0"
        aria-label={t("navigation")}
      >
        <div className="flex min-w-max gap-2 lg:min-w-0 lg:flex-wrap">
          {visible.map(tab => (
            <Link
              key={tab}
              href={agentTabHref(
                tab,
                workspaceId,
                active === tab ? new URLSearchParams(searchParams.toString()) : undefined,
              )}
              aria-current={active === tab ? "page" : undefined}
              className={`tab-control whitespace-nowrap px-4 py-1.5 text-center text-base font-medium transition-colors ${
                active === tab ? "pill-active" : "pill-inactive"
              }`}
            >
              {t(tab)}
            </Link>
          ))}
        </div>
      </nav>
      <div className="flex justify-end">
        <SelectField
          containerClassName="w-full shrink-0 sm:w-56"
          className="h-11 min-h-11 rounded-xl border-base-content/10 bg-[var(--rateloop-field)] text-sm font-medium"
          label={t("workspace")}
          labelClassName="sr-only"
          value={workspaceId}
          onChange={event => onWorkspaceChange(event.target.value)}
        >
          {workspaces.map(workspace => (
            <option key={workspace.workspaceId} value={workspace.workspaceId}>
              {workspace.name}
            </option>
          ))}
        </SelectField>
      </div>
    </div>
  );
}
