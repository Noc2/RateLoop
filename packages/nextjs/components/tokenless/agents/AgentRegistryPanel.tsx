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
  onAgentsChanged,
}: {
  workspaceId: string;
  agentRevision?: number;
  onAgentsChanged?: () => void;
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
    if (!window.confirm(`Deactivate ${agent.currentVersion.displayName}? Existing run snapshots remain unchanged.`))
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
      setStatus("Agent deactivated. Existing immutable versions remain available for audit.");
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
      <section className="surface-card rounded-2xl p-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Agent registry</p>
          <h2 className="mt-2 text-2xl font-semibold">Durable identities and declared model versions</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-base-content/60">
            Every version is append-only. Human results bind to the version captured when the review was requested,
            never to a later mutable label.
          </p>
        </div>
        {registry && !registry.canManage ? (
          <p className="mt-5 rounded-lg bg-white/[0.04] p-3 text-sm text-base-content/60">
            Your {registry.callerRole} role has read-only access to this registry.
          </p>
        ) : null}
      </section>

      {editingAgent && registry?.canManage ? (
        <section className="surface-card rounded-2xl p-6" aria-labelledby="new-agent-version-heading">
          <h2 id="new-agent-version-heading" className="text-xl font-semibold">
            Create version {editingAgent.currentVersion.versionNumber + 1} for {editingAgent.currentVersion.displayName}
          </h2>
          <p className="mt-2 text-sm text-base-content/55">
            Version {editingAgent.currentVersion.versionNumber} remains immutable and available in history.
          </p>
          <div className="mt-5">
            <AgentVersionForm
              key={editingAgent.currentVersion.versionId}
              current={editingAgent.currentVersion}
              busy={busy}
              submitLabel="Save new immutable version"
              onSubmit={createVersion}
            />
          </div>
        </section>
      ) : null}

      {loading ? (
        <div className="surface-card rounded-2xl p-6 text-sm text-base-content/55" role="status">
          <span className="loading loading-spinner loading-sm mr-2" /> Loading authorized agent metadata…
        </div>
      ) : null}
      {!loading && registry?.agents.length === 0 ? (
        <div className="surface-card rounded-2xl p-6 text-sm leading-6 text-base-content/55">
          No approved agents are registered yet. Use Connect an agent above so the agent can describe itself before you
          approve its immutable identity and policies.
        </div>
      ) : null}
      {!loading && registry && registry.agents.length > 0 && visibleAgents.length === 0 ? (
        <div className="surface-card rounded-2xl p-6 text-sm leading-6 text-base-content/55">
          No active agents are registered. Archived identities remain available for audit.
        </div>
      ) : null}
      {!loading && archivedAgentCount > 0 ? (
        <div className="flex justify-end">
          <button
            type="button"
            className="btn border border-white/10 bg-white/[0.04] text-base-content/70"
            aria-pressed={showArchived}
            onClick={() => setShowArchived(current => !current)}
          >
            {showArchived ? "Hide archived agents" : `Show archived agents (${archivedAgentCount})`}
          </button>
        </div>
      ) : null}

      <div className="space-y-4">
        {visibleAgents.map(agent => (
          <article key={agent.agentId} className="surface-card rounded-2xl p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold">{agent.currentVersion.displayName}</h2>
                  <span className="rounded-md bg-white/[0.06] px-2 py-1 text-xs text-base-content/60">
                    v{agent.currentVersion.versionNumber}
                  </span>
                  <span
                    className={`rounded-md px-2 py-1 text-xs ${
                      agent.status === "active"
                        ? "bg-emerald-300/10 text-emerald-100"
                        : "bg-white/[0.06] text-base-content/50"
                    }`}
                  >
                    {agent.status}
                  </span>
                </div>
                <p className="mt-2 font-mono text-xs text-base-content/45">{agent.externalId}</p>
                {agent.currentVersion.description ? (
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-base-content/60">
                    {agent.currentVersion.description}
                  </p>
                ) : null}
              </div>
              {registry?.canManage && agent.status === "active" ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn border-0 bg-white/[0.08]"
                    disabled={busy}
                    onClick={() => {
                      setEditingAgent(agent);
                    }}
                  >
                    New version
                  </button>
                  <button
                    type="button"
                    className="btn border border-red-300/20 bg-red-300/[0.06] text-red-100"
                    disabled={busy}
                    onClick={() => void deactivate(agent)}
                  >
                    Deactivate
                  </button>
                </div>
              ) : null}
            </div>
            <dl className="mt-5 grid gap-4 border-y border-white/10 py-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-base-content/45">Declared provider</dt>
                <dd className="mt-1">{agent.currentVersion.declaredProvider}</dd>
              </div>
              <div>
                <dt className="text-xs text-base-content/45">Declared model</dt>
                <dd className="mt-1">
                  {agent.currentVersion.declaredModel}
                  {agent.currentVersion.declaredModelVersion ? ` · ${agent.currentVersion.declaredModelVersion}` : ""}
                </dd>
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
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold text-base-content/70">
                Version history ({agent.versions.length})
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
          </article>
        ))}
      </div>

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
