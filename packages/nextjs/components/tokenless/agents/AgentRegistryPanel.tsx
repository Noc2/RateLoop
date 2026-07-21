"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentVersionForm } from "~~/components/tokenless/agents/AgentVersionForm";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { Badge } from "~~/components/tokenless/ui/Badge";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import type {
  AgentAssuranceScopeSummary,
  AgentExecutionModelProfile,
  AgentRegistry,
  AgentVersionInput,
  WorkspaceAgent,
} from "~~/lib/tokenless/agentRegistry";
import { readJson } from "~~/lib/tokenless/http";
import { formatUsdcAtomic } from "~~/lib/tokenless/usdc";

function shortAddress(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function formatPercent(bps: number | null) {
  if (bps === null) return "—";
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function modelLabel(profile: AgentExecutionModelProfile) {
  const model = profile.resolvedModel ?? profile.requestedModel;
  return `${profile.provider} · ${model}${profile.modelVersion ? ` · ${profile.modelVersion}` : ""}`;
}

function assuranceStageLabel(stage: AgentAssuranceScopeSummary["stage"]) {
  if (stage === "high_coverage") return "High coverage";
  if (stage === "medium_coverage") return "Medium coverage";
  return stage === "monitoring" ? "Monitoring" : "Calibrating";
}

type HumanReviewConfiguration = NonNullable<WorkspaceAgent["humanReview"]["configuration"]>;

function reviewFrequencyLabel(selection: HumanReviewConfiguration["selection"]) {
  if (selection.mode === "always") return "Every eligible output";
  if (selection.mode === "manual") return "Manual handoff only";
  if (selection.mode === "fixed") return `${formatPercent(selection.fixedRateBps)} of eligible outputs`;
  if (selection.mode === "rules") return "When risk or confidence rules match";
  const range = selection.effectiveRateRangeBps;
  if (!range) return "Adaptive review";
  return range.minimum === range.maximum
    ? `Adaptive · ${formatPercent(range.minimum)} now`
    : `Adaptive · ${formatPercent(range.minimum)}–${formatPercent(range.maximum)} now`;
}

function reviewAudienceLabel(request: HumanReviewConfiguration["request"]) {
  if (request.audience === "private_invited") return "Invited reviewers · private workspace material";
  if (request.audience === "public_network") return "RateLoop network · public-safe material";
  return "Invited + RateLoop network · public-safe material";
}

function reviewQuestionAuthorLabel(request: HumanReviewConfiguration["request"]) {
  return request.questionAuthority === "agent_per_request"
    ? "Agent writes each review question · feedback only"
    : "One owner-set question";
}

function responseWindowLabel(seconds: number | null, panelSize: number | null) {
  if (seconds === null || panelSize === null) return "Not set";
  const duration =
    seconds % 3_600 === 0
      ? `${seconds / 3_600} ${seconds === 3_600 ? "hour" : "hours"}`
      : seconds % 60 === 0
        ? `${seconds / 60} minutes`
        : `${seconds} seconds`;
  return `${duration} · ${panelSize} ${panelSize === 1 ? "reviewer" : "reviewers"}`;
}

function basePaymentLabel(request: HumanReviewConfiguration["request"]) {
  if (request.compensationMode === "unpaid") return "Unpaid";
  if (request.bountyPerSeatAtomic === null) return "Not set";
  return formatUsdcAtomic(request.bountyPerSeatAtomic).replace(" USDC", " USDC / reviewer");
}

function feedbackBonusLabel(request: HumanReviewConfiguration["request"]) {
  if (!request.feedbackBonusEnabled || request.feedbackBonusPoolAtomic === null) return "Off";
  return `${formatUsdcAtomic(request.feedbackBonusPoolAtomic)} · ${
    request.feedbackBonusAwarderKind === "designated" ? "designated human" : "requester"
  } awards`;
}

function reviewAuthorityLabel(authority: HumanReviewConfiguration["authority"]) {
  if (authority === "check_only") return "Check policy only";
  if (authority === "prepare_for_approval") return "Prepare for owner approval";
  return "Ask automatically";
}

function reviewCapability(agent: WorkspaceAgent) {
  const review = agent.humanReview;
  if (review.status === "disabled") return { blocked: true, label: "Off · agent inactive" };
  if (review.status === "configuration_required" || !review.configuration) {
    return { blocked: true, label: "Blocked · finish review setup" };
  }
  if (!review.configuration.connected) return { blocked: true, label: "Blocked · reconnect the agent" };
  if (review.configuration.selection.mode === "manual") {
    return { blocked: false, label: "Manual handoffs only" };
  }
  if (review.configuration.killSwitchActive) {
    return { blocked: true, label: "Blocked · automatic requests are off" };
  }
  if (review.workload.blockedCount > 0) {
    return {
      blocked: true,
      label: `${review.workload.blockedCount} blocked ${review.workload.blockedCount === 1 ? "review" : "reviews"}`,
    };
  }
  if (review.configuration.authority === "check_only") return { blocked: false, label: "Policy checks ready" };
  if (review.configuration.authority === "prepare_for_approval") {
    return { blocked: false, label: "Owner-approved requests ready" };
  }
  return { blocked: false, label: "Automatic requests ready" };
}

function AgentEvidenceCard({ agent }: { agent: WorkspaceAgent }) {
  const workflows = [...new Set(agent.assuranceScopes.map(scope => scope.workflowKey))];
  const riskTiers = [...new Set(agent.assuranceScopes.map(scope => scope.riskTier))];
  const latestScope = agent.assuranceScopes[0] ?? null;
  const version = agent.currentVersion;

  return (
    <Card
      as="section"
      variant="nested"
      className="mt-4 rounded-xl p-4"
      aria-labelledby={`agent-evidence-${agent.agentId}`}
    >
      <h3 id={`agent-evidence-${agent.agentId}`} className="text-sm font-semibold">
        Model and evidence
      </h3>

      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-base-content/45">Declared model</dt>
          <dd className="mt-1">
            {version.declaredProvider} · {version.declaredModel}
            {version.declaredModelVersion ? ` · ${version.declaredModelVersion}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/45">Coverage stage</dt>
          <dd className="mt-1">{latestScope ? assuranceStageLabel(latestScope.stage) : "No evidence scope yet"}</dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/45">Observed workflows</dt>
          <dd className="mt-1">{workflows.length > 0 ? workflows.join(", ") : "None observed"}</dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/45">Observed risk tiers</dt>
          <dd className="mt-1 capitalize">{riskTiers.length > 0 ? riskTiers.join(", ") : "None observed"}</dd>
        </div>
        {latestScope?.executionProfile.available ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-base-content/45">Evaluation profile</dt>
            <dd className="mt-1">
              {modelLabel(latestScope.executionProfile.primary)}
              {latestScope.executionProfile.orchestrationMode === "multi_model"
                ? ` (+${latestScope.executionProfile.contributors.length} contributing models)`
                : ""}
              {" · "}
              {latestScope.humanAgreementBps === null
                ? "agreement pending"
                : `${formatPercent(latestScope.humanAgreementBps)} human agreement`}
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="mt-3 text-xs text-base-content/45">
        Declared and execution metadata is reported by the connected host, not independently verified.
      </p>
    </Card>
  );
}

function AgentHumanReviewConfigurationSummary({ agent }: { agent: WorkspaceAgent }) {
  const configuration = agent.humanReview.configuration;
  const capability = reviewCapability(agent);
  return (
    <Card
      as="section"
      variant="nested"
      className="mt-4 rounded-xl p-4"
      aria-labelledby={`review-config-${agent.agentId}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`review-config-${agent.agentId}`} className="text-sm font-semibold">
          Review configuration
        </h3>
        <Badge variant={capability.blocked ? "warning" : "success"} className="text-xs">
          {capability.label}
        </Badge>
      </div>
      {configuration ? (
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-base-content/45">Frequency</dt>
            <dd className="mt-1 text-sm font-medium">{reviewFrequencyLabel(configuration.selection)}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/45">Reviewers</dt>
            <dd className="mt-1 text-sm font-medium">{reviewAudienceLabel(configuration.request)}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/45">Question author</dt>
            <dd className="mt-1 text-sm font-medium">{reviewQuestionAuthorLabel(configuration.request)}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/45">Response window</dt>
            <dd className="mt-1 text-sm font-medium">
              {responseWindowLabel(configuration.request.responseWindowSeconds, configuration.request.panelSize)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/45">Base payment</dt>
            <dd className="mt-1 text-sm font-medium">{basePaymentLabel(configuration.request)}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/45">Feedback Bonus</dt>
            <dd className="mt-1 text-sm font-medium">{feedbackBonusLabel(configuration.request)}</dd>
          </div>
          {configuration.selection.mode !== "manual" ? (
            <div>
              <dt className="text-xs text-base-content/45">Agent authority</dt>
              <dd className="mt-1 text-sm font-medium">{reviewAuthorityLabel(configuration.authority)}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="mt-3 text-sm text-base-content/55">
          Choose when review runs, who answers, the response window, payment, and agent authority.
        </p>
      )}
    </Card>
  );
}

export function AgentRegistryPanel({
  view,
  workspaceId,
  agentRevision = 0,
  activeReviewAgentId = null,
  onAgentsChanged,
  onReviewAgentChange,
}: {
  view: "connection" | "reviews";
  workspaceId: string;
  agentRevision?: number;
  activeReviewAgentId?: string | null;
  onAgentsChanged?: () => void;
  onReviewAgentChange?: (agentId: string | null) => void;
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
  const visibleAgents =
    view === "connection" && showArchived ? agents : agents.filter(agent => agent.status === "active");

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
              {view === "reviews" && registry?.canManage && agent.status === "active" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-expanded={activeReviewAgentId === agent.agentId}
                  aria-controls="agent-human-review-editor"
                  disabled={busy}
                  onClick={() => onReviewAgentChange?.(activeReviewAgentId === agent.agentId ? null : agent.agentId)}
                >
                  {agent.humanReview.status === "configuration_required" ? "Finish setup" : "Edit reviews"}
                </Button>
              ) : null}
            </div>
            {view === "connection" ? (
              <>
                <AgentEvidenceCard agent={agent} />
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
                    <summary className="cursor-pointer text-sm font-medium text-base-content/65">
                      Technical details
                    </summary>
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

                  <details>
                    <summary className="cursor-pointer text-sm font-medium text-base-content/65">
                      Audit history ({agent.versions.length})
                    </summary>
                    <ol className="mt-3 space-y-3">
                      {agent.versions.map(version => (
                        <li key={version.versionId} className="surface-card-nested rounded-lg p-4 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <strong>Workflow version {version.versionNumber}</strong>
                            <time dateTime={version.createdAt} className="text-xs text-base-content/45">
                              {new Date(version.createdAt).toLocaleString()}
                            </time>
                          </div>
                          <p className="mt-2 text-base-content/60">
                            {version.displayName} · <span className="capitalize">{version.environment}</span>
                          </p>
                          <code className="mt-2 block break-all text-[11px] text-base-content/40">
                            sha256:{version.configurationCommitment}
                          </code>
                        </li>
                      ))}
                    </ol>
                  </details>
                </div>
              </>
            ) : (
              <AgentHumanReviewConfigurationSummary agent={agent} />
            )}
          </Card>
        ))}
      </div>

      {!loading && view === "connection" && archivedAgentCount > 0 ? (
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
