"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AgentHumanReviewEditor } from "./AgentHumanReviewEditor";
import { WorkspaceReviewersPanel } from "./WorkspaceReviewersPanel";
import { agentTabHref } from "./agentWorkspaceState";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { Card } from "~~/components/tokenless/ui/Card";
import type { AgentRegistry, WorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { readJson } from "~~/lib/tokenless/http";

type RegistryState = {
  workspaceId: string;
  loading: boolean;
  agents: WorkspaceAgent[];
  error: string | null;
};

type AgentSelection = {
  workspaceId: string;
  agentId: string | null;
};

export function AgentReviewsPanel({ canManage, workspaceId }: { canManage: boolean; workspaceId: string }) {
  const [registry, setRegistry] = useState<RegistryState>(() => ({
    workspaceId,
    loading: canManage,
    agents: [],
    error: null,
  }));
  const [selection, setSelection] = useState<AgentSelection>({ workspaceId, agentId: null });

  useEffect(() => {
    const controller = new AbortController();
    setRegistry({ workspaceId, loading: canManage, agents: [], error: null });
    setSelection({ workspaceId, agentId: null });

    if (!canManage || !workspaceId) return () => controller.abort();

    void (async () => {
      try {
        const body = await readJson<AgentRegistry>(
          await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/agents`, {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          }),
        );
        if (controller.signal.aborted) return;
        setRegistry({
          workspaceId,
          loading: false,
          agents: body.agents.filter(agent => agent.status === "active"),
          error: null,
        });
      } catch (cause) {
        if (controller.signal.aborted) return;
        setRegistry({
          workspaceId,
          loading: false,
          agents: [],
          error: cause instanceof Error ? cause.message : "Unable to load the connected agents.",
        });
      }
    })();

    return () => controller.abort();
  }, [canManage, workspaceId]);

  if (!canManage) return null;

  const currentRegistry =
    registry.workspaceId === workspaceId ? registry : { workspaceId, loading: true, agents: [], error: null };
  const selectedAgentId =
    selection.workspaceId === workspaceId && currentRegistry.agents.some(agent => agent.agentId === selection.agentId)
      ? selection.agentId
      : (currentRegistry.agents[0]?.agentId ?? null);

  return (
    <AsyncSection
      loading={currentRegistry.loading}
      loadingLabel="Loading review settings"
      error={currentRegistry.error}
    >
      {!currentRegistry.loading && !currentRegistry.error && selectedAgentId ? (
        <div className="space-y-5">
          {currentRegistry.agents.length > 1 ? (
            <div className="flex justify-end">
              <label className="w-56 max-w-full text-sm text-base-content/60">
                Agent
                <select
                  className="select mt-2 w-full rounded-xl border-white/10 bg-[var(--rateloop-field)]"
                  value={selectedAgentId}
                  onChange={event => setSelection({ workspaceId, agentId: event.target.value })}
                >
                  {currentRegistry.agents.map(agent => (
                    <option key={agent.agentId} value={agent.agentId}>
                      {agent.currentVersion.displayName}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          <AgentHumanReviewEditor
            key={`${workspaceId}:${selectedAgentId}`}
            workspaceId={workspaceId}
            agentId={selectedAgentId}
          />
          <WorkspaceReviewersPanel canManage workspaceId={workspaceId} />
        </div>
      ) : !currentRegistry.loading && !currentRegistry.error ? (
        <Card as="section" className="rounded-2xl p-6" aria-labelledby="reviews-connection-required">
          <h2 id="reviews-connection-required" className="text-xl font-semibold">
            Connect an agent first
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-base-content/60">
            Human-review settings become available after this workspace has an active agent.
          </p>
          <Link
            className="rateloop-gradient-action mt-5 inline-flex min-h-11 items-center px-5"
            href={agentTabHref("connect", workspaceId)}
          >
            Go to Connection
          </Link>
        </Card>
      ) : null}
    </AsyncSection>
  );
}
