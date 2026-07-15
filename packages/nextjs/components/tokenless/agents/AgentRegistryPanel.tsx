"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentVersionForm } from "~~/components/tokenless/agents/AgentVersionForm";
import type { AgentRegistry, AgentVersionInput, WorkspaceAgent } from "~~/lib/tokenless/agentRegistry";

async function readJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
    );
  }
  return body;
}

function shortAddress(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

export function AgentRegistryPanel({
  workspaceId,
  agentRevision = 0,
  activeManagementPanel = null,
  onAgentsChanged,
  onManagementPanelChange,
}: {
  workspaceId: string;
  agentRevision?: number;
  activeManagementPanel?: "review" | "publishing" | null;
  onAgentsChanged?: () => void;
  onManagementPanelChange?: (panel: "review" | "publishing" | null) => void;
}) {
  const [registry, setRegistry] = useState<AgentRegistry | null>(null);
  const [editingAgent, setEditingAgent] = useState<WorkspaceAgent | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const loadRegistry = useCallback(async (selectedWorkspaceId: string, signal?: AbortSignal) => {
    if (!selectedWorkspaceId) {
      setRegistry(null);
      return;
    }
    const body = await readJson(
      await fetch(`/api/account/workspaces/${encodeURIComponent(selectedWorkspaceId)}/agents`, {
        cache: "no-store",
        credentials: "same-origin",
        signal,
      }),
    );
    setRegistry(body as unknown as AgentRegistry);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadRegistry(workspaceId, controller.signal);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Unable to load the agent registry.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [agentRevision, loadRegistry, workspaceId]);

  async function createVersion(input: AgentVersionInput) {
    if (!editingAgent) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(editingAgent.agentId)}/versions`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        ),
      );
      await loadRegistry(workspaceId);
      onAgentsChanged?.();
      setEditingAgent(null);
      setStatus("A new immutable agent version was created.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the agent version.");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(agent: WorkspaceAgent) {
    if (!window.confirm(`Deactivate ${agent.currentVersion.displayName}? Existing records will stay available.`))
      return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agent.agentId)}`,
          { method: "DELETE", credentials: "same-origin" },
        ),
      );
      await loadRegistry(workspaceId);
      onAgentsChanged?.();
      setEditingAgent(null);
      setStatus("Agent deactivated. Existing records remain available.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to deactivate the agent.");
    } finally {
      setBusy(false);
    }
  }

  const agents = registry?.agents ?? [];
  const archivedAgentCount = agents.filter(agent => agent.status === "inactive").length;
  const visibleAgents = showArchived ? agents : agents.filter(agent => agent.status === "active");

  return (
    <div className="space-y-5">
      {loading ? (
        <p className="text-sm text-base-content/55" role="status">
          <span className="loading loading-spinner loading-sm mr-2" /> Loading agent…
        </p>
      ) : null}

      <div className="space-y-4">
        {visibleAgents.map(agent => (
          <article key={agent.agentId} className="surface-card rounded-2xl p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{agent.currentVersion.displayName}</h2>
                  <span
                    className={`badge border-0 ${
                      agent.status === "active"
                        ? "bg-emerald-300/10 text-emerald-100"
                        : "bg-white/[0.06] text-base-content/50"
                    }`}
                  >
                    {agent.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-base-content/55">
                  {agent.currentVersion.declaredModel}
                  {agent.currentVersion.declaredModelVersion ? ` · ${agent.currentVersion.declaredModelVersion}` : ""}
                  {` · v${agent.currentVersion.versionNumber}`}
                </p>
              </div>
            </div>
            <details className="mt-3 border-t border-white/10 pt-3">
              <summary className="cursor-pointer text-sm font-semibold text-base-content/70">Manage</summary>
              <div className="mt-4 space-y-4">
                {registry?.canManage && agent.status === "active" ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-sm border-white/10"
                      disabled={busy}
                      onClick={() => setEditingAgent(current => (current?.agentId === agent.agentId ? null : agent))}
                    >
                      Change version
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm border-white/10"
                      aria-expanded={activeManagementPanel === "review"}
                      aria-controls="agent-review-behavior"
                      disabled={busy}
                      onClick={() => onManagementPanelChange?.(activeManagementPanel === "review" ? null : "review")}
                    >
                      Review behavior
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm border-white/10"
                      aria-expanded={activeManagementPanel === "publishing"}
                      aria-controls="agent-autonomous-requests"
                      disabled={busy}
                      onClick={() =>
                        onManagementPanelChange?.(activeManagementPanel === "publishing" ? null : "publishing")
                      }
                    >
                      Autonomous requests
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost text-error"
                      disabled={busy}
                      onClick={() => void deactivate(agent)}
                    >
                      Deactivate
                    </button>
                  </div>
                ) : null}

                {editingAgent?.agentId === agent.agentId && registry?.canManage ? (
                  <section
                    className="surface-card-nested rounded-xl p-4"
                    aria-labelledby={`new-version-${agent.agentId}`}
                  >
                    <h3 id={`new-version-${agent.agentId}`} className="font-semibold">
                      Change declared version
                    </h3>
                    <div className="mt-4">
                      <AgentVersionForm
                        key={editingAgent.currentVersion.versionId}
                        current={editingAgent.currentVersion}
                        busy={busy}
                        submitLabel="Save new version"
                        onSubmit={createVersion}
                      />
                    </div>
                  </section>
                ) : null}

                {!registry?.canManage ? (
                  <p className="text-sm text-base-content/55">Only workspace owners and admins can make changes.</p>
                ) : null}

                <details>
                  <summary className="cursor-pointer text-sm font-medium text-base-content/65">
                    Technical details
                  </summary>
                  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-xs text-base-content/45">External ID</dt>
                      <dd className="mt-1 break-all font-mono text-xs">{agent.externalId}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-base-content/45">Declared provider</dt>
                      <dd className="mt-1">{agent.currentVersion.declaredProvider}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-base-content/45">Environment</dt>
                      <dd className="mt-1 capitalize">{agent.currentVersion.environment}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-base-content/45">Owner</dt>
                      <dd className="mt-1 font-mono text-xs" title={agent.ownerAccountAddress}>
                        {shortAddress(agent.ownerAccountAddress)}
                      </dd>
                    </div>
                  </dl>
                </details>

                <details>
                  <summary className="cursor-pointer text-sm font-medium text-base-content/65">
                    Audit history ({agent.versions.length})
                  </summary>
                  <ol className="mt-3 space-y-3">
                    {agent.versions.map(version => (
                      <li key={version.versionId} className="surface-card-nested rounded-lg p-4 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <strong>Version {version.versionNumber}</strong>
                          <time dateTime={version.createdAt} className="text-xs text-base-content/45">
                            {new Date(version.createdAt).toLocaleString()}
                          </time>
                        </div>
                        <p className="mt-2 text-base-content/60">
                          {version.displayName} · declared {version.declaredProvider} / {version.declaredModel}
                        </p>
                        <code className="mt-2 block break-all text-[11px] text-base-content/40">
                          sha256:{version.configurationCommitment}
                        </code>
                      </li>
                    ))}
                  </ol>
                </details>
              </div>
            </details>
          </article>
        ))}
      </div>

      {!loading && archivedAgentCount > 0 ? (
        <div className="flex justify-end">
          <button
            type="button"
            className="btn btn-sm btn-ghost text-base-content/60"
            aria-pressed={showArchived}
            onClick={() => setShowArchived(current => !current)}
          >
            {showArchived ? "Hide archived" : `Show archived (${archivedAgentCount})`}
          </button>
        </div>
      ) : null}

      {status ? (
        <p role="status" className="rounded-lg bg-emerald-300/10 p-3 text-sm text-emerald-100">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg bg-red-400/10 p-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}
    </div>
  );
}
