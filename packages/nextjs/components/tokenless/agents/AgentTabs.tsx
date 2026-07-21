"use client";

import { type KeyboardEvent, useRef } from "react";
import Link from "next/link";
import { agentTabHref, nextAgentTabIndex } from "./agentWorkspaceState";

export type AgentTab = "overview" | "connect" | "inbox" | "registry" | "evaluations" | "evidence";

const tabs: Array<{ value: AgentTab; label: string }> = [
  { value: "overview", label: "Workspace" },
  { value: "connect", label: "Connection" },
  { value: "inbox", label: "Inbox" },
  { value: "registry", label: "Reviews" },
  { value: "evaluations", label: "Evaluations" },
  { value: "evidence", label: "Evidence" },
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
  const tabRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const visible = tabs.filter(tab => visibleTabs.includes(tab.value));

  function handleKeyDown(event: KeyboardEvent<HTMLAnchorElement>, index: number) {
    if (event.key === " ") {
      event.preventDefault();
      event.currentTarget.click();
      return;
    }
    const nextIndex = nextAgentTabIndex(index, event.key, visible.length);
    if (nextIndex === index) return;
    event.preventDefault();
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <nav className="min-w-0 flex-[1_1_40rem]" aria-label="Agent workspace sections">
        <div role="tablist" aria-orientation="horizontal" className="flex flex-wrap gap-2">
          {visible.map((tab, index) => (
            <Link
              key={tab.value}
              ref={element => {
                tabRefs.current[index] = element;
              }}
              id={`agent-tab-${tab.value}`}
              role="tab"
              href={agentTabHref(tab.value, workspaceId)}
              aria-current={active === tab.value ? "page" : undefined}
              aria-selected={active === tab.value}
              aria-controls="agent-workspace-panel"
              tabIndex={active === tab.value ? 0 : -1}
              onKeyDown={event => handleKeyDown(event, index)}
              className={`tab-control px-4 py-1.5 text-base font-medium transition-colors ${
                active === tab.value ? "pill-active" : "pill-inactive"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>
      <label className="ml-auto w-56 max-w-full shrink-0">
        <span className="sr-only">Active workspace</span>
        <select
          className="select h-11 min-h-11 w-full rounded-xl border-white/10 bg-[var(--rateloop-field)] text-sm font-medium"
          value={workspaceId}
          onChange={event => onWorkspaceChange(event.target.value)}
        >
          {workspaces.map(workspace => (
            <option key={workspace.workspaceId} value={workspace.workspaceId}>
              {workspace.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
