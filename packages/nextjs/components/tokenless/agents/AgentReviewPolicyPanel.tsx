"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  type ReviewPolicyAgentChoice,
  findBoundAgentVersion,
  listUnboundAgentVersions,
  reviewPolicySectionIsVisible,
  versionHasPolicy,
} from "./agentReviewPolicyPresentation";
import { DEFAULT_ADAPTIVE_AGREEMENT_THRESHOLD_BPS } from "~~/lib/tokenless/adaptiveReviewDefaults";
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
  agreementThresholdPercent: String(DEFAULT_ADAPTIVE_AGREEMENT_THRESHOLD_BPS / 100),
  productionFloorPercent: "10",
  maximumUnreviewedGap: "20",
  requiredRiskTiers: "high",
  criticalRiskTiers: "critical",
  minimumConfidencePercent: "70",
  maximumLatencySeconds: "120",
  audience: "private_invited",
};

const MODE_COPY: Record<ReviewPolicyMode, string> = {
  manual: "The agent asks for review only when you choose.",
  always: "Every eligible output gets human review.",
  rules: "Higher-risk or incomplete work gets reviewed.",
  adaptive: "Review coverage falls only after stable human agreement.",
};

const REVIEW_PRESETS: Array<{ label: string; mode: ReviewPolicyMode }> = [
  { label: "Review everything", mode: "always" },
  { label: "Review higher-risk work", mode: "rules" },
  { label: "Adaptive review", mode: "adaptive" },
  { label: "Manual handoff only", mode: "manual" },
];

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

  function applyPreset(mode: ReviewPolicyMode) {
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
          <h2 className="text-2xl font-semibold">Human review</h2>
          <p className="mt-2 text-sm text-base-content/60">
            Choose when this agent should ask people to check its work.
          </p>
        </div>
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
              {showForm && !editingPolicyId ? "Close" : `Set review for ${selectedTarget.agentDisplayName}`}
            </button>
          </div>
        ) : registry.agents.length > 0 ? (
          <p className="mt-5 rounded-lg bg-white/[0.04] p-3 text-sm text-base-content/60">
            Review behavior is already set for every active agent version.
          </p>
        ) : null}
      </section>

      {showForm ? (
        <section className="surface-card rounded-2xl p-6" aria-labelledby="review-policy-editor-heading">
          <h2 id="review-policy-editor-heading" className="text-xl font-semibold">
            {editingPolicyId ? "Create the next immutable policy version" : "Configure human review"}
          </h2>
          <form className="mt-5 space-y-5" onSubmit={savePolicy}>
            <fieldset>
              <legend className="text-sm font-semibold">When should people review this agent?</legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {REVIEW_PRESETS.map(preset => (
                  <button
                    key={preset.mode}
                    type="button"
                    className={`rounded-xl border p-4 text-left transition ${
                      draft.mode === preset.mode
                        ? "border-[var(--rateloop-blue)] bg-[var(--rateloop-blue)]/10"
                        : "border-white/10 bg-white/[0.025] hover:bg-white/[0.05]"
                    }`}
                    aria-pressed={draft.mode === preset.mode}
                    onClick={() => applyPreset(preset.mode)}
                  >
                    <span className="block font-semibold">{preset.label}</span>
                    <span className="mt-1 block text-sm text-base-content/55">{MODE_COPY[preset.mode]}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            {draft.mode !== "manual" ? (
              <label className="block max-w-xl text-sm text-base-content/60">
                Who should review?
                <select
                  className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  value={draft.audience}
                  onChange={event => updateDraft("audience", event.target.value as ReviewAudience)}
                >
                  <option value="private_invited">Invited reviewers</option>
                  <option value="public_network">RateLoop network</option>
                  <option value="hybrid">Invited reviewers and RateLoop network</option>
                </select>
              </label>
            ) : null}

            <details className="rounded-xl border border-white/10 p-4">
              <summary className="cursor-pointer text-sm font-semibold">Customize rules</summary>
              <p className="mt-2 text-sm text-base-content/50">
                These defaults control sampling and risk escalation. Change them only when your evaluation process
                requires different thresholds.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm text-base-content/60">
                  Confidence-adjusted agreement threshold (%)
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
                  Adaptive review floor (%)
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
                  Maximum outputs between samples
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
                  Minimum confidence (%)
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
                  Review-required risk tiers
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
            </details>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="rateloop-gradient-action px-5" disabled={busy}>
                {busy ? "Saving…" : editingPolicyId ? "Create next policy version" : "Create review policy"}
              </button>
              <button
                type="button"
                className="btn rateloop-secondary-action"
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
                </div>
                <div className="flex flex-wrap gap-2">
                  {agent ? (
                    <button
                      type="button"
                      className="btn rateloop-secondary-action"
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
              <details className="mt-4 text-xs text-base-content/45">
                <summary className="cursor-pointer">Technical details</summary>
                <p className="mt-2 break-all font-mono">
                  {policy.policyId} · {policy.agentVersionId}
                </p>
                <p className="mt-1 break-all font-mono">audience {policy.audiencePolicyHash}</p>
              </details>
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
