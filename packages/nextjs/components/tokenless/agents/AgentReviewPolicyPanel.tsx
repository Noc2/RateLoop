"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  type ReviewPolicyAgentChoice,
  findBoundAgentVersion,
  listUnboundAgentVersions,
  reviewPolicySectionIsVisible,
  versionHasPolicy,
} from "./agentReviewPolicyPresentation";
import type {
  ManagedReviewPolicy,
  ReviewAudience,
  ReviewEnforcementMode,
  ReviewPolicyMode,
} from "~~/lib/tokenless/reviewPolicyManagement";

type PolicyRegistry = { canManage: boolean; agents: ReviewPolicyAgentChoice[]; policies: ManagedReviewPolicy[] };

type PolicyDraft = {
  agentId: string;
  agentVersionId: string;
  mode: ReviewPolicyMode;
  enforcementMode: ReviewEnforcementMode;
  agreementThresholdPercent: string;
  productionFloorPercent: string;
  maximumUnreviewedGap: string;
  requiredRiskTiers: string;
  criticalRiskTiers: string;
  minimumConfidencePercent: string;
  maximumLatencySeconds: string;
  audience: ReviewAudience;
};

const INITIAL_DRAFT: PolicyDraft = {
  agentId: "",
  agentVersionId: "",
  mode: "adaptive",
  enforcementMode: "advisory",
  agreementThresholdPercent: "90",
  productionFloorPercent: "10",
  maximumUnreviewedGap: "20",
  requiredRiskTiers: "high",
  criticalRiskTiers: "critical",
  minimumConfidencePercent: "70",
  maximumLatencySeconds: "120",
  audience: "private_invited",
};

const MODE_COPY: Record<ReviewPolicyMode, string> = {
  manual: "The agent chooses when to request a handoff. RateLoop records recommendations but does not force them.",
  always: "Every eligible output requires human review.",
  rules: "Critical, incomplete, low-confidence, and selected risk tiers require review.",
  adaptive: "Coverage falls only after stable human agreement: 100% → 50% → 25% → 10% minimum.",
};

async function readJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
    );
  }
  return body;
}

function percentToBps(value: string, field: string) {
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error(`${field} must be 0-100%.`);
  return Math.round(percent * 100);
}

function riskTiers(value: string) {
  const entries = [
    ...new Set(
      value
        .split(",")
        .map(entry => entry.trim())
        .filter(Boolean),
    ),
  ];
  if (entries.some(entry => !/^[a-z][a-z0-9_-]{0,63}$/.test(entry))) {
    throw new Error("Risk tiers must be lowercase identifiers separated by commas.");
  }
  return entries;
}

function rateLabel(value: number) {
  return `${(value / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function draftForPolicy(policy: ManagedReviewPolicy): PolicyDraft {
  return {
    agentId: policy.agentId,
    agentVersionId: policy.agentVersionId,
    mode: policy.mode,
    enforcementMode: policy.enforcementMode,
    agreementThresholdPercent: String(policy.agreementThresholdBps / 100),
    productionFloorPercent: String(policy.productionFloorBps / 100),
    maximumUnreviewedGap: String(policy.maximumUnreviewedGap),
    requiredRiskTiers: policy.requiredRiskTiers.join(", "),
    criticalRiskTiers: policy.criticalRiskTiers.join(", "),
    minimumConfidencePercent: policy.minimumConfidenceBps === null ? "" : String(policy.minimumConfidenceBps / 100),
    maximumLatencySeconds: policy.maximumLatencyMs === null ? "" : String(policy.maximumLatencyMs / 1_000),
    audience: policy.audience,
  };
}

export function AgentReviewPolicyPanel({
  workspaceId,
  agentRevision = 0,
}: {
  workspaceId: string;
  agentRevision?: number;
}) {
  const [registry, setRegistry] = useState<PolicyRegistry | null>(null);
  const [draft, setDraft] = useState<PolicyDraft>(INITIAL_DRAFT);
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);

  const loadPolicies = useCallback(async (selectedWorkspaceId: string, signal?: AbortSignal) => {
    if (!selectedWorkspaceId) {
      setRegistry(null);
      return;
    }
    const body = (await readJson(
      await fetch(`/api/account/workspaces/${encodeURIComponent(selectedWorkspaceId)}/agent-review-policies`, {
        cache: "no-store",
        credentials: "same-origin",
        signal,
      }),
    )) as unknown as PolicyRegistry;
    setRegistry(body);
    setDraft(current => {
      const currentAvailable =
        current.agentVersionId && !versionHasPolicy(body, current.agentVersionId)
          ? { agentId: current.agentId, versionId: current.agentVersionId }
          : null;
      const first = listUnboundAgentVersions(body)[0];
      const selected = currentAvailable ?? (first ? { agentId: first.agentId, versionId: first.versionId } : null);
      return { ...current, agentId: selected?.agentId ?? "", agentVersionId: selected?.versionId ?? "" };
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadPolicies(workspaceId, controller.signal);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Unable to load review policies.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [agentRevision, loadPolicies, retryVersion, workspaceId]);

  function updateDraft<Key extends keyof PolicyDraft>(key: Key, value: PolicyDraft[Key]) {
    setDraft(current => ({ ...current, [key]: value }));
  }

  function selectAgent(agentId: string) {
    const agent = registry?.agents.find(entry => entry.agentId === agentId);
    const version = agent?.versions.find(entry => !registry || !versionHasPolicy(registry, entry.versionId));
    setDraft(current => ({
      ...current,
      agentId,
      agentVersionId: version?.versionId ?? "",
    }));
  }

  function selectPolicyTarget(versionId: string) {
    if (!registry) return;
    const target = listUnboundAgentVersions(registry).find(entry => entry.versionId === versionId);
    if (!target) return;
    setDraft(current => ({ ...current, agentId: target.agentId, agentVersionId: target.versionId }));
  }

  async function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !draft.agentId || !draft.agentVersionId) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const maximumUnreviewedGap = Number(draft.maximumUnreviewedGap);
      if (!Number.isSafeInteger(maximumUnreviewedGap))
        throw new Error("Maximum unreviewed gap must be a whole number.");
      const maximumLatencySeconds = draft.maximumLatencySeconds.trim() ? Number(draft.maximumLatencySeconds) : null;
      if (
        maximumLatencySeconds !== null &&
        (!Number.isSafeInteger(maximumLatencySeconds) || maximumLatencySeconds < 1)
      ) {
        throw new Error("Maximum latency must be a positive number of seconds.");
      }
      const payload = {
        agentId: draft.agentId,
        agentVersionId: draft.agentVersionId,
        mode: draft.mode,
        enforcementMode: draft.enforcementMode,
        agreementThresholdBps: percentToBps(draft.agreementThresholdPercent, "Agreement threshold"),
        productionFloorBps: percentToBps(draft.productionFloorPercent, "Production floor"),
        maximumUnreviewedGap,
        requiredRiskTiers: riskTiers(draft.requiredRiskTiers),
        criticalRiskTiers: riskTiers(draft.criticalRiskTiers),
        minimumConfidenceBps: draft.minimumConfidencePercent.trim()
          ? percentToBps(draft.minimumConfidencePercent, "Minimum confidence")
          : null,
        maximumLatencyMs: maximumLatencySeconds === null ? null : maximumLatencySeconds * 1_000,
        audience: draft.audience,
      };
      const path = editingPolicyId
        ? `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-review-policies/${encodeURIComponent(editingPolicyId)}`
        : `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-review-policies`;
      await readJson(
        await fetch(path, {
          method: editingPolicyId ? "PUT" : "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
      await loadPolicies(workspaceId);
      setDraft(current => ({
        ...INITIAL_DRAFT,
        agentId: current.agentId,
        agentVersionId: current.agentVersionId,
      }));
      setEditingPolicyId(null);
      setShowForm(false);
      setStatus(
        editingPolicyId
          ? "A new immutable policy version was created. New scopes restart at 100% calibration."
          : "Review policy created and bound to the exact agent version.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save the review policy.");
    } finally {
      setBusy(false);
    }
  }

  async function disablePolicy(policy: ManagedReviewPolicy) {
    if (!window.confirm(`Disable review policy ${policy.policyId}? Existing evidence remains auditable.`)) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-review-policies/${encodeURIComponent(policy.policyId)}`,
          { method: "DELETE", credentials: "same-origin" },
        ),
      );
      await loadPolicies(workspaceId);
      setEditingPolicyId(null);
      setShowForm(false);
      setStatus("Review policy disabled. Existing evidence and immutable versions were preserved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to disable the review policy.");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !registry) return null;

  if (error && !registry) {
    return (
      <div className="rounded-lg bg-red-400/10 p-4 text-sm text-red-100" role="alert">
        <p>{error}</p>
        <button
          type="button"
          className="btn btn-sm mt-3 border border-red-100/20 bg-transparent"
          onClick={() => {
            setError(null);
            setRetryVersion(current => current + 1);
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!registry || !reviewPolicySectionIsVisible(registry)) return null;

  const unboundVersions = listUnboundAgentVersions(registry);
  const selectedTarget =
    unboundVersions.find(entry => entry.versionId === draft.agentVersionId) ?? unboundVersions[0] ?? null;

  function toggleCreateEditor() {
    if (!selectedTarget) return;
    setShowForm(current => !current);
    setEditingPolicyId(null);
    setDraft({
      ...INITIAL_DRAFT,
      agentId: selectedTarget.agentId,
      agentVersionId: selectedTarget.versionId,
    });
  }

  return (
    <div className="space-y-5">
      <section className="surface-card rounded-2xl p-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">
            Agent-level feedback
          </p>
          <h2 className="mt-2 text-2xl font-semibold">Human review policy by agent version</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-base-content/60">
            Each policy applies to one immutable version of one agent, not every agent in this workspace. Stable
            agreement can reduce review volume, but critical risk, missing metadata, the maximum gap, and the production
            floor keep sampling on.
          </p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-4" aria-label="Adaptive review progression">
          {["100% calibrating", "50% high coverage", "25% medium coverage", "10% monitoring floor"].map(
            (label, index) => (
              <div key={label} className="surface-card-nested rounded-lg p-3 text-sm">
                <span className="font-mono text-xs text-base-content/40">0{index + 1}</span>
                <p className="mt-1 font-medium">{label}</p>
              </div>
            ),
          )}
        </div>
        <p className="mt-3 text-xs leading-5 text-base-content/50">
          Critical-risk or incomplete opportunities require review in always, rules, and adaptive modes. Manual mode is
          advisory by definition. Editing creates a new version and restarts new scopes at calibration.
        </p>
        {unboundVersions.length > 0 && selectedTarget ? (
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
            {unboundVersions.length > 1 ? (
              <label className="min-w-72 text-sm text-base-content/60">
                Agent version without a policy
                <select
                  className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  value={selectedTarget.versionId}
                  onChange={event => selectPolicyTarget(event.target.value)}
                >
                  {unboundVersions.map(target => (
                    <option key={target.versionId} value={target.versionId}>
                      {target.agentDisplayName} · v{target.versionNumber} · {target.versionDisplayName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button type="button" className="rateloop-gradient-action px-5" onClick={toggleCreateEditor}>
              {showForm && !editingPolicyId
                ? "Close policy editor"
                : `Create policy for ${selectedTarget.agentDisplayName} · v${selectedTarget.versionNumber}`}
            </button>
          </div>
        ) : registry.agents.length > 0 ? (
          <p className="mt-5 rounded-lg bg-white/[0.04] p-3 text-sm text-base-content/60">
            Every active agent version already has a review policy. Use Edit as new version on the relevant policy
            below.
          </p>
        ) : null}
      </section>

      {showForm ? (
        <section className="surface-card rounded-2xl p-6" aria-labelledby="review-policy-editor-heading">
          <h2 id="review-policy-editor-heading" className="text-xl font-semibold">
            {editingPolicyId ? "Create the next immutable policy version" : "Configure human review"}
          </h2>
          <form className="mt-5 space-y-5" onSubmit={savePolicy}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm text-base-content/60">
                Agent
                <select
                  className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  value={draft.agentId}
                  onChange={event => selectAgent(event.target.value)}
                  disabled={Boolean(editingPolicyId)}
                  required
                >
                  {registry?.agents
                    .filter(
                      agent =>
                        editingPolicyId ||
                        agent.versions.some(version => !registry || !versionHasPolicy(registry, version.versionId)),
                    )
                    .map(agent => (
                      <option key={agent.agentId} value={agent.agentId}>
                        {agent.displayName}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-sm text-base-content/60">
                Immutable version
                <select
                  className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  value={draft.agentVersionId}
                  onChange={event => updateDraft("agentVersionId", event.target.value)}
                  disabled={Boolean(editingPolicyId)}
                  required
                >
                  {registry?.agents
                    .find(agent => agent.agentId === draft.agentId)
                    ?.versions.filter(
                      version =>
                        Boolean(editingPolicyId) || !registry || !versionHasPolicy(registry, version.versionId),
                    )
                    .map(version => (
                      <option key={version.versionId} value={version.versionId}>
                        Version {version.versionNumber} · {version.displayName}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-sm text-base-content/60">
                Review mode
                <select
                  className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  value={draft.mode}
                  onChange={event => {
                    const mode = event.target.value as ReviewPolicyMode;
                    setDraft(current => ({
                      ...current,
                      mode,
                      enforcementMode: mode === "manual" ? "advisory" : current.enforcementMode,
                      productionFloorPercent:
                        mode === "adaptive" && Number(current.productionFloorPercent) < 10
                          ? "10"
                          : mode === "adaptive"
                            ? current.productionFloorPercent
                            : "0",
                    }));
                  }}
                >
                  <option value="adaptive">Adaptive</option>
                  <option value="always">Always review</option>
                  <option value="rules">Rules</option>
                  <option value="manual">Manual handoff</option>
                </select>
                <span className="mt-2 block text-xs leading-5 text-base-content/45">{MODE_COPY[draft.mode]}</span>
              </label>
              <label className="text-sm text-base-content/60">
                Execution
                <select
                  className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  value={draft.enforcementMode}
                  onChange={event => updateDraft("enforcementMode", event.target.value as ReviewEnforcementMode)}
                  disabled={draft.mode === "manual"}
                >
                  <option value="advisory">Advisory</option>
                  <option value="host_enforced">Host-enforced</option>
                </select>
                <span className="mt-2 block text-xs leading-5 text-base-content/45">
                  Host-enforced is valid only when the connected agent host has compatible middleware and attests that
                  it blocks output until required review completes. MCP transport alone does not provide that guarantee.
                </span>
              </label>
              <label className="text-sm text-base-content/60">
                Reviewer audience
                <select
                  className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  value={draft.audience}
                  onChange={event => updateDraft("audience", event.target.value as ReviewAudience)}
                >
                  <option value="private_invited">Private invited reviewers</option>
                  <option value="public_network">Public RateLoop network</option>
                  <option value="hybrid">Hybrid invited + public</option>
                </select>
              </label>
              <label className="text-sm text-base-content/60">
                Agreement threshold (%)
                <input
                  className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={draft.agreementThresholdPercent}
                  onChange={event => updateDraft("agreementThresholdPercent", event.target.value)}
                  required
                />
              </label>
              <label className="text-sm text-base-content/60">
                Adaptive production floor (%)
                <input
                  className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  type="number"
                  min={draft.mode === "adaptive" ? "10" : "0"}
                  max="100"
                  step="0.01"
                  value={draft.productionFloorPercent}
                  onChange={event => updateDraft("productionFloorPercent", event.target.value)}
                  disabled={draft.mode !== "adaptive"}
                  required
                />
              </label>
              <label className="text-sm text-base-content/60">
                Maximum outputs without a sample
                <input
                  className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  type="number"
                  min="1"
                  max="10000"
                  value={draft.maximumUnreviewedGap}
                  onChange={event => updateDraft("maximumUnreviewedGap", event.target.value)}
                  required
                />
              </label>
              <label className="text-sm text-base-content/60">
                Minimum declared confidence (%)
                <input
                  className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={draft.minimumConfidencePercent}
                  onChange={event => updateDraft("minimumConfidencePercent", event.target.value)}
                />
              </label>
              <label className="text-sm text-base-content/60">
                Required risk tiers
                <input
                  className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  value={draft.requiredRiskTiers}
                  onChange={event => updateDraft("requiredRiskTiers", event.target.value)}
                  placeholder="high, regulated"
                />
              </label>
              <label className="text-sm text-base-content/60">
                Critical risk tiers
                <input
                  className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  value={draft.criticalRiskTiers}
                  onChange={event => updateDraft("criticalRiskTiers", event.target.value)}
                  placeholder="critical"
                />
              </label>
              <label className="text-sm text-base-content/60">
                Maximum review latency (seconds)
                <input
                  className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  type="number"
                  min="1"
                  value={draft.maximumLatencySeconds}
                  onChange={event => updateDraft("maximumLatencySeconds", event.target.value)}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="rateloop-gradient-action px-5" disabled={busy}>
                {busy ? "Saving…" : editingPolicyId ? "Create next policy version" : "Create review policy"}
              </button>
              <button
                type="button"
                className="btn border-0 bg-white/[0.08]"
                onClick={() => {
                  setShowForm(false);
                  setEditingPolicyId(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {registry.agents.length === 0 && registry.policies.length > 0 ? (
        <div className="rounded-lg border border-amber-200/20 bg-amber-200/[0.06] p-4 text-sm text-amber-50">
          No active agent is registered, but existing policies remain visible for audit and may still be bound to a live
          integration. Disable a policy only after confirming its connection is no longer operating.
        </div>
      ) : null}
      {registry.agents.length > 0 && registry.policies.length === 0 ? (
        <div className="surface-card rounded-2xl p-6 text-sm text-base-content/55">
          No review policy is active for these agent versions yet.
        </div>
      ) : null}

      <div className="space-y-4">
        {registry.policies.map(policy => {
          const { agent, version } = findBoundAgentVersion(registry, policy);
          return (
            <article key={`${policy.policyId}:${policy.version}`} className="surface-card rounded-2xl p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xl font-semibold">
                      {version?.displayName ?? agent?.displayName ?? policy.agentId}
                    </h3>
                    {version ? (
                      <span className="rounded-md bg-white/[0.06] px-2 py-1 text-xs">
                        agent v{version.versionNumber}
                      </span>
                    ) : null}
                    <span className="rounded-md bg-white/[0.06] px-2 py-1 text-xs">{policy.mode}</span>
                    <span className="rounded-md bg-white/[0.06] px-2 py-1 text-xs">
                      {policy.enforcementMode === "host_enforced" ? "host-enforced" : "advisory"}
                    </span>
                    <span className="rounded-md bg-white/[0.06] px-2 py-1 text-xs">
                      policy version {policy.version}
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-xs text-base-content/40">
                    {policy.policyId} · {policy.agentVersionId}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {agent ? (
                    <button
                      type="button"
                      className="btn border-0 bg-white/[0.08]"
                      disabled={busy}
                      onClick={() => {
                        setDraft(draftForPolicy(policy));
                        setEditingPolicyId(policy.policyId);
                        setShowForm(true);
                        setStatus(null);
                        setError(null);
                      }}
                    >
                      Edit as new version
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn border border-red-300/20 bg-red-300/[0.06] text-red-100"
                    disabled={busy}
                    onClick={() => void disablePolicy(policy)}
                  >
                    Disable
                  </button>
                </div>
              </div>
              <dl className="mt-5 grid gap-4 border-y border-white/10 py-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs text-base-content/45">Minimum review rate</dt>
                  <dd className="mt-1">{rateLabel(policy.safetyFloors.minimumReviewRateBps)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-base-content/45">Agreement threshold</dt>
                  <dd className="mt-1">{rateLabel(policy.agreementThresholdBps)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-base-content/45">Maximum gap</dt>
                  <dd className="mt-1">{policy.maximumUnreviewedGap} outputs</dd>
                </div>
                <div>
                  <dt className="text-xs text-base-content/45">Audience</dt>
                  <dd className="mt-1">{policy.audience.replaceAll("_", " ")}</dd>
                </div>
              </dl>
              {policy.scopes.length ? (
                <div className="mt-4">
                  <h4 className="text-sm font-semibold">Live adaptive scopes</h4>
                  <ul className="mt-3 grid gap-3 lg:grid-cols-2">
                    {policy.scopes.map(scope => (
                      <li key={scope.scopeId} className="surface-card-nested rounded-lg p-4 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <strong>{scope.workflowKey}</strong>
                          <span>{rateLabel(scope.reviewRateBps)} review</span>
                        </div>
                        <p className="mt-2 text-xs text-base-content/50">
                          {scope.riskTier} · {scope.stage.replaceAll("_", " ")} · {scope.completedComparableCases}
                          {" comparable cases"}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-4 text-sm text-base-content/50">
                  No eligible output has used this version yet. Its first adaptive scope starts at 100% review.
                </p>
              )}
              <p className="mt-4 break-all font-mono text-[11px] text-base-content/35">
                audience {policy.audiencePolicyHash}
              </p>
            </article>
          );
        })}
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
