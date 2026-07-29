"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { agentTabHref } from "./agentWorkspaceState";
import { SelectField } from "~~/components/tokenless/forms/Field";

export type AgentTab = "overview" | "connect" | "inbox" | "registry" | "evaluations" | "billing";

const tabs: Array<{ value: AgentTab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "connect", label: "Connections" },
  { value: "inbox", label: "Approvals" },
  { value: "registry", label: "Review setup" },
  { value: "evaluations", label: "Results" },
  { value: "billing", label: "Billing & settings" },
];

export function AgentTabs({
  active,
  onWorkspaceChange,
  visibleTabs = tabs.map(tab => tab.value),
  workspaces,
  workspaceId,
}: {
  active: AgentTab;
  onWorkspaceChange: (workspaceId: string) => void;
  visibleTabs?: AgentTab[];
  workspaces: Array<{ workspaceId: string; name: string }>;
  workspaceId: string;
}) {
  const searchParams = useSearchParams();
  const visible = tabs.filter(tab => visibleTabs.includes(tab.value));

  return (
    <div className="space-y-3">
      <nav
        className="-mx-1 min-w-0 overflow-x-auto px-1 lg:mx-0 lg:overflow-visible lg:px-0"
        aria-label="Agent workspace sections"
      >
        <div className="flex min-w-max gap-2 lg:min-w-0 lg:flex-wrap">
          {visible.map(tab => (
            <Link
              key={tab.value}
              href={agentTabHref(
                tab.value,
                workspaceId,
                active === tab.value ? new URLSearchParams(searchParams.toString()) : undefined,
              )}
              aria-current={active === tab.value ? "page" : undefined}
              className={`tab-control whitespace-nowrap px-4 py-1.5 text-center text-base font-medium transition-colors ${
                active === tab.value ? "pill-active" : "pill-inactive"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>
      <div className="flex justify-end">
        <SelectField
          containerClassName="w-full shrink-0 sm:w-56"
          className="h-11 min-h-11 rounded-xl border-white/10 bg-[var(--rateloop-field)] text-sm font-medium"
          label="Active workspace"
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
