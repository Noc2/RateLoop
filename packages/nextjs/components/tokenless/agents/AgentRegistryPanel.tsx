"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentVersionForm } from "~~/components/tokenless/agents/AgentVersionForm";
import type { AgentRegistry, AgentVersionInput, WorkspaceAgent } from "~~/lib/tokenless/agentRegistry";

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

function shortAddress(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

export function AgentRegistryPanel() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [registry, setRegistry] = useState<AgentRegistry | null>(null);
  const [editingAgent, setEditingAgent] = useState<WorkspaceAgent | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const loadRegistry = useCallback(async (selectedWorkspaceId: string) => {
    if (!selectedWorkspaceId) {
      setRegistry(null);
      return;
    }
    const body = await readJson(
      await fetch(`/api/account/workspaces/${encodeURIComponent(selectedWorkspaceId)}/agents`, {
        cache: "no-store",
        credentials: "same-origin",
      }),
    );
    setRegistry(body as unknown as AgentRegistry);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
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
        if (next[0]?.workspaceId) await loadRegistry(next[0].workspaceId);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Unable to load agent workspaces.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [loadRegistry]);

  async function selectWorkspace(nextWorkspaceId: string) {
    setWorkspaceId(nextWorkspaceId);
    setRegistry(null);
    setEditingAgent(null);
    setShowCreate(false);
    setError(null);
    setStatus(null);
    setLoading(true);
    try {
      await loadRegistry(nextWorkspaceId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load the agent registry.");
    } finally {
      setLoading(false);
    }
  }

  async function createAgent(input: AgentVersionInput & { externalId?: string }) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/agents`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
      );
      await loadRegistry(workspaceId);
      setShowCreate(false);
      setStatus("Agent registered with immutable version 1.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to register the agent.");
    } finally {
      setBusy(false);
    }
  }

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
      setEditingAgent(null);
      setStatus("Agent deactivated. Existing immutable versions remain available for audit.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to deactivate the agent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="surface-card rounded-2xl p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Agent registry</p>
            <h2 className="mt-2 text-2xl font-semibold">Durable identities and declared model versions</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-base-content/60">
              Every version is append-only. Human results bind to the version captured when the review was requested,
              never to a later mutable label.
            </p>
          </div>
          <label className="min-w-56 text-sm text-base-content/60">
            Workspace
            <select
              className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={workspaceId}
              onChange={event => void selectWorkspace(event.target.value)}
              disabled={loading}
            >
              {workspaces.map(workspace => (
                <option key={workspace.workspaceId} value={workspace.workspaceId}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {registry?.canManage ? (
          <button
            type="button"
            className="rateloop-gradient-action mt-5 px-5"
            onClick={() => {
              setShowCreate(current => !current);
              setEditingAgent(null);
            }}
          >
            {showCreate ? "Close registration" : "Register agent"}
          </button>
        ) : registry ? (
          <p className="mt-5 rounded-lg bg-white/[0.04] p-3 text-sm text-base-content/60">
            Your {registry.callerRole} role has read-only access to this registry.
          </p>
        ) : null}
      </section>

      {showCreate && registry?.canManage ? (
        <section className="surface-card rounded-2xl p-6" aria-labelledby="register-agent-heading">
          <h2 id="register-agent-heading" className="text-xl font-semibold">
            Register a durable agent
          </h2>
          <div className="mt-5">
            <AgentVersionForm
              externalIdRequired
              busy={busy}
              submitLabel="Create agent and version 1"
              onSubmit={createAgent}
            />
          </div>
        </section>
      ) : null}

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
      {!loading && workspaces.length === 0 ? (
        <div className="surface-card rounded-2xl p-6 text-sm leading-6 text-base-content/55">
          Create a workspace in Overview before registering an agent.
        </div>
      ) : null}
      {!loading && registry?.agents.length === 0 ? (
        <div className="surface-card rounded-2xl p-6 text-sm leading-6 text-base-content/55">
          No agents are registered in this workspace yet.
        </div>
      ) : null}

      <div className="space-y-4">
        {registry?.agents.map(agent => (
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
              {registry.canManage && agent.status === "active" ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn border-0 bg-white/[0.08]"
                    disabled={busy}
                    onClick={() => {
                      setEditingAgent(agent);
                      setShowCreate(false);
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
