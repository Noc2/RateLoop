"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentText } from "./AgentText";
import { useAgentFormatter, useAgentTranslations } from "./AgentsLocaleProvider";
import { type AgentConnectionHistoryEntry, mergeAgentAuditHistory } from "./agentAuditHistory";
import { agentEnvironmentLabel, agentStatusLabel, connectionStatusLabel } from "./agentPresentation";
import { AgentVersionForm } from "~~/components/tokenless/agents/AgentVersionForm";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { Badge } from "~~/components/tokenless/ui/Badge";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { ConfirmDialog } from "~~/components/tokenless/ui/ConfirmDialog";
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
  selectedAgentId = null,
  selectedVersionId = null,
}: {
  workspaceId: string;
  agentRevision?: number;
  onAgentsChanged?: () => void;
  connectionHistory?: readonly AgentConnectionHistoryEntry[];
  selectedAgentId?: string | null;
  selectedVersionId?: string | null;
}) {
  const format = useAgentFormatter();
  const ui = useAgentTranslations("ui");
  const errors = useAgentTranslations("errors");
  const presentation = useAgentTranslations("presentation");
  const statusCopy = useAgentTranslations("status");
  const [registry, setRegistry] = useState<AgentRegistry | null>(null);
  const [editingAgent, setEditingAgent] = useState<WorkspaceAgent | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [pendingDeactivation, setPendingDeactivation] = useState<WorkspaceAgent | null>(null);
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
      } catch {
        if (!controller.signal.aborted) {
          setError(errors("loadAgents"));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [agentRevision, errors, loadRegistry, workspaceId]);

  useEffect(() => {
    if (loading || !selectedAgentId || !registry?.agents.some(agent => agent.agentId === selectedAgentId)) return;
    const selected = document.getElementById(`registered-agent-${selectedAgentId}`);
    selected?.focus({ preventScroll: true });
    selected?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [loading, registry, selectedAgentId]);

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
      setStatus(statusCopy("versionCreated"));
    } catch {
      setError(errors("createVersion"));
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(agent: WorkspaceAgent) {
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
      setPendingDeactivation(null);
      setStatus(statusCopy("agentDeactivated"));
    } catch {
      setError(errors("deactivateAgent"));
    } finally {
      setBusy(false);
    }
  }

  const agents = registry?.agents ?? [];
  const archivedAgentCount = agents.filter(agent => agent.status === "inactive").length;
  const visibleAgents = showArchived
    ? agents
    : agents.filter(agent => agent.status === "active" || agent.agentId === selectedAgentId);
  const auditEntries = mergeAgentAuditHistory(visibleAgents, connectionHistory);

  return (
    <div className="space-y-5">
      <AsyncSection loading={loading} loadingLabel={ui("loadingAgents")}>
        {null}
      </AsyncSection>

      <div className="space-y-4">
        {visibleAgents.map(agent => {
          const selected = agent.agentId === selectedAgentId;
          const selectedVersion = selected
            ? (agent.versions.find(version => version.versionId === selectedVersionId) ?? agent.currentVersion)
            : null;
          return (
            <Card
              as="article"
              key={agent.agentId}
              id={`registered-agent-${agent.agentId}`}
              tabIndex={selected ? -1 : undefined}
              className={`rounded-2xl p-5 ${selected ? "ring-1 ring-[var(--rateloop-blue)]" : ""}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{agent.currentVersion.displayName}</h2>
                    <Badge variant={agent.status === "active" ? "success" : "neutral"}>
                      {agentStatusLabel(agent.status, presentation)}
                    </Badge>
                  </div>
                </div>
              </div>
              {selectedVersion ? (
                <div className="mt-3 rounded-xl bg-[var(--rateloop-blue)]/10 p-3 text-sm" role="status">
                  <strong>
                    <AgentText id="translated094" /> {selectedVersion.versionNumber}
                  </strong>
                  <p className="mt-1 text-base-content/65">
                    {selectedVersion.declaredProvider} {selectedVersion.declaredModel}
                    {selectedVersion.declaredModelVersion ? ` ${selectedVersion.declaredModelVersion}` : ""} ·{" "}
                    {agentEnvironmentLabel(selectedVersion.environment, presentation)}
                  </p>
                  <code className="mt-2 block break-all text-[11px] text-base-content/55">
                    {selectedVersion.versionId}
                  </code>
                </div>
              ) : null}
              <div className="mt-3 space-y-4 border-t border-base-content/10 pt-3">
                {registry?.canManage && agent.status === "active" ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setEditingAgent(current => (current?.agentId === agent.agentId ? null : agent))}
                    >
                      <AgentText id="translated095" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-error"
                      disabled={busy}
                      onClick={() => setPendingDeactivation(agent)}
                    >
                      <AgentText id="translated096" />
                    </Button>
                  </div>
                ) : null}

                {editingAgent?.agentId === agent.agentId && registry?.canManage ? (
                  <Card
                    as="section"
                    variant="nested"
                    className="rounded-xl p-4"
                    aria-labelledby={`new-version-${agent.agentId}`}
                  >
                    <h3 id={`new-version-${agent.agentId}`} className="font-semibold">
                      <AgentText id="translated095" />
                    </h3>
                    <div className="mt-4">
                      <AgentVersionForm
                        key={editingAgent.currentVersion.versionId}
                        current={editingAgent.currentVersion}
                        busy={busy}
                        submitLabel={ui("saveWorkflowVersion")}
                        onSubmit={createVersion}
                      />
                    </div>
                  </Card>
                ) : null}

                <details>
                  <summary className="cursor-pointer text-sm font-medium text-base-content/65">
                    <AgentText id="translated097" />
                  </summary>
                  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-xs text-base-content/55">
                        <AgentText id="externalId" />
                      </dt>
                      <dd className="mt-1 break-all font-mono text-xs">{agent.externalId}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-base-content/55">
                        <AgentText id="environment" />
                      </dt>
                      <dd className="mt-1">{agentEnvironmentLabel(agent.currentVersion.environment, presentation)}</dd>
                    </div>
                    {agent.ownerAccountAddress ? (
                      <div>
                        <dt className="text-xs text-base-content/55">
                          <AgentText id="owner" />
                        </dt>
                        <dd className="mt-1 font-mono text-xs" title={agent.ownerAccountAddress}>
                          {shortAddress(agent.ownerAccountAddress)}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </details>
              </div>
            </Card>
          );
        })}
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
            {showArchived ? ui("hideArchived") : ui("showArchived", { count: archivedAgentCount })}
          </Button>
        </div>
      ) : null}

      {!loading && auditEntries.length > 0 ? (
        <Card as="section" className="rounded-2xl p-5">
          <details>
            <summary className="cursor-pointer text-sm font-medium text-base-content/65">
              <AgentText id="translated098" />
              {auditEntries.length})
            </summary>
            <ol className="mt-4 space-y-3">
              {auditEntries.map(entry => (
                <Card as="li" variant="nested" key={entry.eventId} className="rounded-lg p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>
                      {entry.kind === "connection"
                        ? entry.clientName
                        : `${entry.displayName} · ${presentation("workflowVersion")} ${entry.versionNumber}`}
                    </strong>
                    {entry.occurredAt ? (
                      <time dateTime={entry.occurredAt} className="text-xs text-base-content/55">
                        {format.dateTime(new Date(entry.occurredAt), { dateStyle: "medium", timeStyle: "short" })}
                      </time>
                    ) : null}
                  </div>
                  {entry.kind === "connection" ? (
                    <div className="mt-2">
                      <Badge variant="neutral" className="text-xs">
                        {entry.legacy
                          ? `${presentation("legacy")} · ${connectionStatusLabel(entry.status, presentation)}`
                          : connectionStatusLabel(entry.status, presentation)}
                      </Badge>
                    </div>
                  ) : (
                    <>
                      <p className="mt-2 text-base-content/60">
                        {agentEnvironmentLabel(entry.environment, presentation)}
                      </p>
                      <code className="mt-2 block break-all text-[11px] text-base-content/55">
                        sha256:{entry.configurationCommitment}
                      </code>
                    </>
                  )}
                </Card>
              ))}
            </ol>
          </details>
        </Card>
      ) : null}

      {status ? (
        <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg bg-error/10 p-3 text-sm text-error">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={pendingDeactivation !== null}
        title={ui("deactivateAgentTitle", {
          name: pendingDeactivation?.currentVersion.displayName ?? ui("thisAgent"),
        })}
        description={<AgentText id="attribute006" />}
        confirmLabel={ui("deactivateAgent")}
        busy={busy}
        onCancel={() => setPendingDeactivation(null)}
        onConfirm={() => {
          if (pendingDeactivation) void deactivate(pendingDeactivation);
        }}
      />
    </div>
  );
}
