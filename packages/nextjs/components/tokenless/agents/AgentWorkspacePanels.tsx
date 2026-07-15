"use client";

import { useEffect, useReducer, useState } from "react";
import { AgentConnectionPanel } from "./AgentConnectionPanel";
import { AgentPublishingPolicyPanel } from "./AgentPublishingPolicyPanel";
import { AgentRegistryPanel } from "./AgentRegistryPanel";
import { AgentReviewPolicyPanel } from "./AgentReviewPolicyPanel";

type Workspace = { workspaceId: string; name: string; role: string };

async function readJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
    );
  }
  return body;
}

export function AgentWorkspacePanels() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentRevision, refreshAgents] = useReducer(value => value + 1, 0);
  const [publishingRevision, refreshPublishingPolicies] = useReducer(value => value + 1, 0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const body = await readJson(
          await fetch("/api/account/workspaces", {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          }),
        );
        const next = (body.workspaces ?? []) as Workspace[];
        if (controller.signal.aborted) return;
        setWorkspaces(next);
        setWorkspaceId(next[0]?.workspaceId ?? "");
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Unable to load agent workspaces.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  if (loading) {
    return (
      <div className="surface-card rounded-2xl p-6 text-sm text-base-content/55" role="status">
        <span className="loading loading-spinner loading-sm mr-2" /> Loading agent workspaces…
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-lg bg-red-400/10 p-4 text-sm text-red-100" role="alert">
        {error}
      </p>
    );
  }

  if (workspaces.length === 0) {
    return (
      <div className="surface-card rounded-2xl p-6 text-sm leading-6 text-base-content/55">
        Create a workspace in Overview before connecting an agent.
      </div>
    );
  }

  const workspace = workspaces.find(entry => entry.workspaceId === workspaceId) ?? workspaces[0];
  const canManage = workspace.role === "owner" || workspace.role === "admin";

  return (
    <div className="space-y-5">
      <section className="surface-card rounded-2xl px-5 py-4" aria-labelledby="agent-workspace-heading">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Agent workspace</p>
            <h2 id="agent-workspace-heading" className="mt-2 text-xl font-semibold">
              Manage one workspace at a time
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/55">
              Connections, agent versions, review policies, and publishing limits below all use this workspace.
            </p>
          </div>
          <label className="min-w-56 text-sm text-base-content/60">
            Workspace
            <select
              className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={workspaceId}
              onChange={event => setWorkspaceId(event.target.value)}
            >
              {workspaces.map(entry => (
                <option key={entry.workspaceId} value={entry.workspaceId}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!canManage ? (
          <p className="mt-4 rounded-lg bg-white/[0.04] p-3 text-sm text-base-content/60">
            Your {workspace.role} role has read-only access to the agent registry in this workspace.
          </p>
        ) : null}
      </section>

      <div key={workspaceId} className="space-y-5">
        {canManage ? (
          <AgentConnectionPanel
            workspaceId={workspaceId}
            publishingRevision={publishingRevision}
            onAgentApproved={refreshAgents}
          />
        ) : null}
        <AgentRegistryPanel workspaceId={workspaceId} agentRevision={agentRevision} onAgentsChanged={refreshAgents} />
        {canManage ? <AgentReviewPolicyPanel workspaceId={workspaceId} agentRevision={agentRevision} /> : null}
        {canManage ? (
          <AgentPublishingPolicyPanel
            workspaceId={workspaceId}
            publishingRevision={publishingRevision}
            onPoliciesChanged={refreshPublishingPolicies}
          />
        ) : null}
      </div>
    </div>
  );
}
