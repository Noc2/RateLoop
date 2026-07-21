"use client";

import { useCallback, useEffect, useState } from "react";
import { type AgentConnectionHistoryEntry, mergeAgentAuditHistory } from "./agentAuditHistory";
import { AgentVersionForm } from "~~/components/tokenless/agents/AgentVersionForm";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { Badge } from "~~/components/tokenless/ui/Badge";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import type { AgentRegistry, AgentVersionInput, WorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { readJson } from "~~/lib/tokenless/http";

function shortAddress(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

export function AgentRegistryPanel({
  workspaceId,
  agentRevision = 0,
  onAgentsChanged,
  connectionHistory = [],
}: {
  workspaceId: string;
  agentRevision?: number;
  onAgentsChanged?: () => void;
  connectionHistory?: readonly AgentConnectionHistoryEntry[];
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
          setError(cause instanceof Error ? cause.message : "Unable to load the connected agents.");
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
      setStatus("A new immutable workflow version was created.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the workflow version.");
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
  const auditEntries = mergeAgentAuditHistory(visibleAgents, connectionHistory);

  return (
    <div className="space-y-5">
      <AsyncSection loading={loading} loadingLabel="Loading agents">
        {null}
      </AsyncSection>

      <div className="space-y-4">
        {visibleAgents.map(agent => (
          <Card as="article" key={agent.agentId} className="rounded-2xl p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{agent.currentVersion.displayName}</h2>
                  <Badge variant={agent.status === "active" ? "success" : "neutral"}>{agent.status}</Badge>
                </div>
              </div>
            </div>
            <div className="mt-3 space-y-4 border-t border-white/10 pt-3">
              {registry?.canManage && agent.status === "active" ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setEditingAgent(current => (current?.agentId === agent.agentId ? null : agent))}
                  >
                    Change workflow version
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-error"
                    disabled={busy}
                    onClick={() => void deactivate(agent)}
                  >
                    Deactivate
                  </Button>
                </div>
              ) : null}

              {editingAgent?.agentId === agent.agentId && registry?.canManage ? (
                <section
                  className="surface-card-nested rounded-xl p-4"
                  aria-labelledby={`new-version-${agent.agentId}`}
                >
                  <h3 id={`new-version-${agent.agentId}`} className="font-semibold">
                    Change workflow version
                  </h3>
                  <div className="mt-4">
                    <AgentVersionForm
                      key={editingAgent.currentVersion.versionId}
                      current={editingAgent.currentVersion}
                      busy={busy}
                      submitLabel="Save workflow version"
                      onSubmit={createVersion}
                    />
                  </div>
                </section>
              ) : null}

              <details>
                <summary className="cursor-pointer text-sm font-medium text-base-content/65">Technical details</summary>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-xs text-base-content/45">External ID</dt>
                    <dd className="mt-1 break-all font-mono text-xs">{agent.externalId}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-base-content/45">Environment</dt>
                    <dd className="mt-1 capitalize">{agent.currentVersion.environment}</dd>
                  </div>
                  {agent.ownerAccountAddress ? (
                    <div>
                      <dt className="text-xs text-base-content/45">Owner</dt>
                      <dd className="mt-1 font-mono text-xs" title={agent.ownerAccountAddress}>
                        {shortAddress(agent.ownerAccountAddress)}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </details>
            </div>
          </Card>
        ))}
      </div>

      {!loading && archivedAgentCount > 0 ? (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-pressed={showArchived}
            onClick={() => setShowArchived(current => !current)}
          >
            {showArchived ? "Hide archived" : `Show archived (${archivedAgentCount})`}
          </Button>
        </div>
      ) : null}

      {!loading && auditEntries.length > 0 ? (
        <Card as="section" className="rounded-2xl p-5">
          <details>
            <summary className="cursor-pointer text-sm font-medium text-base-content/65">
              Audit history ({auditEntries.length})
            </summary>
            <ol className="mt-4 space-y-3">
              {auditEntries.map(entry => (
                <li key={entry.eventId} className="surface-card-nested rounded-lg p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>
                      {entry.kind === "connection"
                        ? entry.clientName
                        : `${entry.displayName} · Workflow version ${entry.versionNumber}`}
                    </strong>
                    {entry.occurredAt ? (
                      <time dateTime={entry.occurredAt} className="text-xs text-base-content/45">
                        {new Date(entry.occurredAt).toLocaleString()}
                      </time>
                    ) : null}
                  </div>
                  {entry.kind === "connection" ? (
                    <div className="mt-2">
                      <Badge variant="neutral" className="text-xs">
                        {entry.legacy ? `legacy · ${entry.status}` : entry.status}
                      </Badge>
                    </div>
                  ) : (
                    <>
                      <p className="mt-2 capitalize text-base-content/60">{entry.environment}</p>
                      <code className="mt-2 block break-all text-[11px] text-base-content/40">
                        sha256:{entry.configurationCommitment}
                      </code>
                    </>
                  )}
                </li>
              ))}
            </ol>
          </details>
        </Card>
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
