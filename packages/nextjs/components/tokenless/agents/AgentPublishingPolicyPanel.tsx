"use client";

import { type FormEvent, useCallback, useEffect, useId, useState } from "react";

type PublishingPolicy = {
  allowedAdmissionPolicyHashes: string[];
  allowedDataClassifications: string[];
  allowedPaymentModes: Array<"prepaid" | "x402">;
  allowedReviewerSources: string[];
  createdAt: string;
  enabled: boolean;
  expiresAt: string | null;
  maxAttemptReserveAtomic: string;
  maxBountyAtomic: string;
  maxDailyAtomic: string;
  maxFeeBps: number;
  maxMonthlyAtomic: string;
  maxPanelAtomic: string;
  maxPanelSize: number;
  name: string;
  onPolicyMiss: "handoff" | "deny";
  payerAddress: string | null;
  policyId: string;
  revokedAt: string | null;
  version: number;
};

type ConnectedIntegration = {
  activationMode: string | null;
  allowedWorkflowKeys: string[];
  connectionStatus: string | null;
  displayName: string | null;
  integrationId: string;
  publishingPolicyId: string | null;
  status: string;
};

type Audience = "private_invited" | "public_network" | "hybrid";
export type ContentBoundary = "public_or_test" | "private_workspace";

export type PolicyDraft = {
  admissionPolicyHash: string;
  audience: Audience;
  contentBoundary: ContentBoundary;
  maxDailyUsdc: string;
  maxFeePercent: string;
  maxMonthlyUsdc: string;
  maxPanelSize: string;
  maxPanelUsdc: string;
  name: string;
  onPolicyMiss: "handoff" | "deny";
  payerAddress: string;
  paymentMode: "prepaid" | "x402";
};

export type PublishingPolicyPayload = {
  allowedAdmissionPolicyHashes: string[];
  allowedDataClassifications: string[];
  allowedPaymentModes: Array<"prepaid" | "x402">;
  allowedReviewerSources: string[];
  maxAttemptReserveAtomic: string;
  maxBountyAtomic: string;
  maxDailyAtomic: string;
  maxFeeBps: number;
  maxMonthlyAtomic: string;
  maxPanelAtomic: string;
  maxPanelSize: number;
  name: string;
  onPolicyMiss: "handoff" | "deny";
  payerAddress: string | null;
};

export const INITIAL_DRAFT: PolicyDraft = {
  admissionPolicyHash: "",
  audience: "private_invited",
  contentBoundary: "private_workspace",
  maxDailyUsdc: "100",
  maxFeePercent: "7.5",
  maxMonthlyUsdc: "1000",
  maxPanelSize: "15",
  maxPanelUsdc: "30",
  name: "",
  onPolicyMiss: "handoff",
  payerAddress: "",
  paymentMode: "prepaid",
};

const CONTENT_BOUNDARY_CLASSIFICATIONS: Record<ContentBoundary, readonly string[]> = {
  public_or_test: ["public", "synthetic", "redacted"],
  private_workspace: ["internal", "confidential"],
};

const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

async function readJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
    );
  }
  return body;
}

export function parseUsdcToAtomic(value: string) {
  const normalized = value.trim();
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(normalized)) {
    throw new Error("USDC amounts must be non-negative with at most six decimal places.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  return (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0") || "0")).toString();
}

export function formatUsdcAtomic(value: string) {
  const amount = BigInt(value);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""} USDC`;
}

export function classificationsForContentBoundary(boundary: ContentBoundary) {
  const classifications = CONTENT_BOUNDARY_CLASSIFICATIONS[boundary];
  if (!classifications) throw new Error("Choose a supported content boundary.");
  return [...classifications];
}

export function workflowKeysFromInput(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map(entry => entry.trim())
        .filter(Boolean),
    ),
  ];
}

function audienceSources(audience: Audience) {
  if (audience === "private_invited") return ["customer_invited"];
  if (audience === "public_network") return ["rateloop_network"];
  return ["hybrid"];
}

function audienceLabel(sources: string[]) {
  if (sources.includes("hybrid")) return "Invited and RateLoop reviewers";
  if (sources.includes("rateloop_network")) return "RateLoop reviewer network";
  return "Invited reviewers";
}

function contentBoundaryLabel(boundary: ContentBoundary) {
  return boundary === "public_or_test" ? "Public or test material only" : "Private workspace material";
}

function policyContentBoundaryLabel(classifications: string[]) {
  const values = new Set(classifications);
  if (
    classifications.length > 0 &&
    classifications.every(value => ["public", "synthetic", "redacted"].includes(value))
  ) {
    return "Public or test material only";
  }
  if (classifications.length > 0 && classifications.every(value => ["internal", "confidential"].includes(value))) {
    return "Private workspace material";
  }
  if (values.has("restricted") || values.has("regulated")) return "Restricted material";
  return "Custom content boundary";
}

function minimumAtomic(value: string, ceiling: string) {
  const amount = BigInt(value);
  const maximum = BigInt(ceiling);
  return (amount < maximum ? amount : maximum).toString();
}

/**
 * Fail-closed adapter for the current publishing-policy API. The UI presents two
 * understandable content boundaries, but the server still requires the legacy
 * classification array. Restricted and regulated material are intentionally not
 * mapped because this component cannot prove the separate entitlement they need.
 */
export function buildPublishingPolicyPayload(draft: PolicyDraft): PublishingPolicyPayload {
  const maxPanelAtomic = parseUsdcToAtomic(draft.maxPanelUsdc);
  const maxDailyAtomic = parseUsdcToAtomic(draft.maxDailyUsdc);
  const maxMonthlyAtomic = parseUsdcToAtomic(draft.maxMonthlyUsdc);
  if ([maxPanelAtomic, maxDailyAtomic, maxMonthlyAtomic].some(value => BigInt(value) <= 0n)) {
    throw new Error("Spending limits must be greater than zero.");
  }
  if (BigInt(maxDailyAtomic) < BigInt(maxPanelAtomic)) {
    throw new Error("The daily limit must be at least the per-request limit.");
  }
  if (BigInt(maxMonthlyAtomic) < BigInt(maxDailyAtomic)) {
    throw new Error("The monthly limit must be at least the daily limit.");
  }

  const admissionPolicyHash = draft.admissionPolicyHash.trim().toLowerCase();
  if (!BYTES32_PATTERN.test(admissionPolicyHash)) {
    throw new Error("Add the audience policy binding under Advanced.");
  }
  const panelSize = Number(draft.maxPanelSize);
  if (!Number.isSafeInteger(panelSize) || panelSize < 3 || panelSize > 500) {
    throw new Error("Maximum responses must be a whole number between 3 and 500.");
  }
  const feePercent = Number(draft.maxFeePercent);
  if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 20) {
    throw new Error("The fee cap must be between 0% and 20%.");
  }

  const payerAddress = draft.payerAddress.trim().toLowerCase();
  if (draft.paymentMode === "x402" && !ADDRESS_PATTERN.test(payerAddress)) {
    throw new Error("Add the bound payer wallet under Advanced.");
  }

  return {
    name: draft.name.trim() || "Autonomous review requests",
    allowedPaymentModes: [draft.paymentMode],
    payerAddress: draft.paymentMode === "x402" ? payerAddress : null,
    maxPanelAtomic,
    maxDailyAtomic,
    maxMonthlyAtomic,
    maxPanelSize: panelSize,
    maxBountyAtomic: minimumAtomic(maxPanelAtomic, parseUsdcToAtomic("20")),
    maxFeeBps: Math.round(feePercent * 100),
    maxAttemptReserveAtomic: minimumAtomic(maxPanelAtomic, parseUsdcToAtomic("5")),
    allowedReviewerSources: audienceSources(draft.audience),
    allowedAdmissionPolicyHashes: [admissionPolicyHash],
    allowedDataClassifications: classificationsForContentBoundary(draft.contentBoundary),
    onPolicyMiss: draft.onPolicyMiss,
  };
}

export function AgentPublishingPolicyPanel({
  workspaceId,
  publishingRevision = 0,
  onPoliciesChanged,
}: {
  workspaceId: string;
  publishingRevision?: number;
  onPoliciesChanged?: () => void;
}) {
  const advancedId = useId();
  const [policies, setPolicies] = useState<PublishingPolicy[]>([]);
  const [integrations, setIntegrations] = useState<ConnectedIntegration[]>([]);
  const [draft, setDraft] = useState<PolicyDraft>(() => ({ ...INITIAL_DRAFT }));
  const [pendingPolicy, setPendingPolicy] = useState<PublishingPolicyPayload | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selectedIntegrationId, setSelectedIntegrationId] = useState("");
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [allowedWorkflows, setAllowedWorkflows] = useState("");

  const loadPolicies = useCallback(async (selectedWorkspaceId: string, signal?: AbortSignal) => {
    if (!selectedWorkspaceId) {
      setPolicies([]);
      return;
    }
    const [policyBody, integrationBody] = await Promise.all([
      readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(selectedWorkspaceId)}/agent-publishing-policies`, {
          cache: "no-store",
          credentials: "same-origin",
          signal,
        }),
      ),
      readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(selectedWorkspaceId)}/agent-integrations`, {
          cache: "no-store",
          credentials: "same-origin",
          signal,
        }),
      ),
    ]);
    const nextPolicies = (policyBody.policies ?? []) as PublishingPolicy[];
    const nextIntegrations = ((integrationBody.integrations ?? []) as ConnectedIntegration[]).filter(
      integration =>
        integration.status === "active" &&
        integration.connectionStatus === "connected" &&
        (integration.activationMode === "preauthorized_safe" || integration.activationMode === "owner_approved"),
    );
    setPolicies(nextPolicies);
    setIntegrations(nextIntegrations);
    setSelectedPolicyId(current =>
      nextPolicies.some(policy => policy.policyId === current && policy.enabled && !policy.revokedAt)
        ? current
        : (nextPolicies.find(policy => policy.enabled && !policy.revokedAt)?.policyId ?? ""),
    );
    setSelectedIntegrationId(current =>
      nextIntegrations.some(integration => integration.integrationId === current)
        ? current
        : (nextIntegrations[0]?.integrationId ?? ""),
    );
    setAllowedWorkflows(current => current || (nextIntegrations[0]?.allowedWorkflowKeys ?? []).join(", "));
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
          setError(cause instanceof Error ? cause.message : "Unable to load autonomous access.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [loadPolicies, publishingRevision, workspaceId]);

  function updateDraft<Key extends keyof PolicyDraft>(key: Key, value: PolicyDraft[Key]) {
    setDraft(current => ({ ...current, [key]: value }));
    setPendingPolicy(null);
  }

  function startEditor() {
    setEditorOpen(true);
    setPendingPolicy(null);
    setError(null);
    setStatus(null);
  }

  function closeEditor() {
    if (busy) return;
    setEditorOpen(false);
    setAdvancedOpen(false);
    setPendingPolicy(null);
    setDraft({ ...INITIAL_DRAFT });
    setError(null);
  }

  function reviewPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      setPendingPolicy(buildPublishingPolicyPayload(draft));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to review autonomous access.";
      if (message.includes("Advanced")) setAdvancedOpen(true);
      setError(message);
    }
  }

  async function createPolicy() {
    if (!workspaceId || !pendingPolicy) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-publishing-policies`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pendingPolicy),
        }),
      );
      await loadPolicies(workspaceId);
      const created = body.policy as PublishingPolicy | undefined;
      if (created?.policyId) setSelectedPolicyId(created.policyId);
      onPoliciesChanged?.();
      setDraft({ ...INITIAL_DRAFT });
      setPendingPolicy(null);
      setAdvancedOpen(false);
      setEditorOpen(false);
      setStatus("Policy saved. Choose a connected agent below to activate it.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to approve autonomous access.");
    } finally {
      setBusy(false);
    }
  }

  async function activatePolicy() {
    const allowedWorkflowKeys = workflowKeysFromInput(allowedWorkflows);
    if (!selectedIntegrationId || !selectedPolicyId || allowedWorkflowKeys.length === 0) {
      setError("Choose a connected agent, a policy, and at least one workflow.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-integrations/${encodeURIComponent(selectedIntegrationId)}/publishing`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ publishingPolicyId: selectedPolicyId, allowedWorkflowKeys }),
          },
        ),
      );
      await loadPolicies(workspaceId);
      setStatus("Autonomous publishing and spending are active for this agent.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to activate autonomous access.");
    } finally {
      setBusy(false);
    }
  }

  async function revokePolicy(policy: PublishingPolicy) {
    if (!window.confirm(`Revoke ${policy.name}? Bound credentials will be denied on their next request.`)) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-publishing-policies/${encodeURIComponent(policy.policyId)}`,
          { method: "DELETE", credentials: "same-origin" },
        ),
      );
      await loadPolicies(workspaceId);
      onPoliciesChanged?.();
      setStatus("Autonomous review access revoked.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to revoke autonomous access.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {workspaceId && !editorOpen && policies.length === 0 ? (
        <section className="surface-card rounded-2xl p-6">
          <h2 className="text-xl font-semibold">Autonomous review requests</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-base-content/60">
            Your agent cannot spend or request reviewers until you allow it.
          </p>
          <button type="button" className="rateloop-gradient-action mt-5 px-5" onClick={startEditor} disabled={loading}>
            {loading ? "Checking access…" : "Allow autonomous review requests"}
          </button>
        </section>
      ) : null}

      {workspaceId && editorOpen && !pendingPolicy ? (
        <form className="surface-card rounded-2xl p-6" onSubmit={reviewPolicy}>
          <h2 className="text-xl font-semibold">Allow autonomous review requests</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-base-content/60">
            Set where the agent may send work and how much it may spend without asking you again.
          </p>

          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <label className="text-sm text-base-content/70">
              Reviewer source
              <select
                className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={draft.audience}
                onChange={event => updateDraft("audience", event.target.value as Audience)}
              >
                <option value="private_invited">Invited reviewers</option>
                <option value="public_network">RateLoop reviewer network</option>
                <option value="hybrid">Invited and RateLoop reviewers</option>
              </select>
            </label>
            <label className="text-sm text-base-content/70">
              Content boundary
              <select
                className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={draft.contentBoundary}
                onChange={event => updateDraft("contentBoundary", event.target.value as ContentBoundary)}
              >
                <option value="public_or_test">Public or test material only</option>
                <option value="private_workspace">Private workspace material</option>
              </select>
            </label>
          </div>

          <div className="mt-6 grid gap-5 md:grid-cols-3">
            {[
              ["maxPanelUsdc", "Maximum per request", draft.maxPanelUsdc],
              ["maxDailyUsdc", "Daily limit", draft.maxDailyUsdc],
              ["maxMonthlyUsdc", "Monthly limit", draft.maxMonthlyUsdc],
            ].map(([key, label, value]) => (
              <label key={key} className="text-sm text-base-content/70">
                {label} (USDC)
                <input
                  className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)] font-mono"
                  value={value}
                  onChange={event => updateDraft(key as keyof PolicyDraft, event.target.value)}
                  inputMode="decimal"
                  required
                />
              </label>
            ))}
          </div>

          <button
            type="button"
            className="btn btn-sm rateloop-secondary-action mt-6"
            aria-controls={advancedId}
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen(open => !open)}
          >
            Advanced
          </button>

          {advancedOpen ? (
            <div id={advancedId} className="mt-4 grid gap-5 rounded-xl border border-white/10 p-4 md:grid-cols-2">
              <label className="text-sm text-base-content/70 md:col-span-2">
                Audience policy binding
                <input
                  className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)] font-mono text-xs"
                  value={draft.admissionPolicyHash}
                  onChange={event => updateDraft("admissionPolicyHash", event.target.value)}
                  placeholder="0x…"
                  pattern="0x[0-9a-fA-F]{64}"
                  required
                />
              </label>
              <label className="text-sm text-base-content/70">
                Payment method
                <select
                  className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  value={draft.paymentMode}
                  onChange={event => updateDraft("paymentMode", event.target.value as "prepaid" | "x402")}
                >
                  <option value="prepaid">Workspace prepaid USDC</option>
                  <option value="x402">Bound payer wallet</option>
                </select>
              </label>
              {draft.paymentMode === "x402" ? (
                <label className="text-sm text-base-content/70">
                  Payer wallet
                  <input
                    className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)] font-mono text-xs"
                    value={draft.payerAddress}
                    onChange={event => updateDraft("payerAddress", event.target.value)}
                    placeholder="0x…"
                    pattern="0x[0-9a-fA-F]{40}"
                    required
                  />
                </label>
              ) : null}
              <label className="text-sm text-base-content/70">
                Policy name
                <input
                  className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  value={draft.name}
                  onChange={event => updateDraft("name", event.target.value)}
                  maxLength={120}
                  placeholder="Autonomous review requests"
                />
              </label>
              <label className="text-sm text-base-content/70">
                Maximum responses
                <input
                  className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)] font-mono"
                  type="number"
                  min={3}
                  max={500}
                  step={1}
                  value={draft.maxPanelSize}
                  onChange={event => updateDraft("maxPanelSize", event.target.value)}
                  required
                />
              </label>
              <label className="text-sm text-base-content/70">
                Maximum platform fee (%)
                <input
                  className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)] font-mono"
                  type="number"
                  min={0}
                  max={20}
                  step={0.01}
                  value={draft.maxFeePercent}
                  onChange={event => updateDraft("maxFeePercent", event.target.value)}
                  required
                />
              </label>
              <label className="text-sm text-base-content/70">
                If a request exceeds these limits
                <select
                  className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                  value={draft.onPolicyMiss}
                  onChange={event => updateDraft("onPolicyMiss", event.target.value as "handoff" | "deny")}
                >
                  <option value="handoff">Ask me for approval</option>
                  <option value="deny">Deny the request</option>
                </select>
              </label>
              <p className="text-xs leading-5 text-base-content/50 md:col-span-2">
                Restricted and regulated material remain blocked. The current server contract requires the audience
                policy binding shown above.
              </p>
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button type="submit" className="rateloop-gradient-action px-5">
              Review access
            </button>
            <button type="button" className="btn rateloop-secondary-action px-5" onClick={closeEditor}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {workspaceId && editorOpen && pendingPolicy ? (
        <section className="surface-card rounded-2xl p-6">
          <h2 className="text-xl font-semibold">Confirm autonomous access</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-base-content/60">
            The agent may request and pay for reviews within every limit below without asking again.
          </p>
          <dl className="mt-6 grid gap-4 text-sm md:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-base-content/45">Reviewers</dt>
              <dd className="mt-1">{audienceLabel(pendingPolicy.allowedReviewerSources)}</dd>
            </div>
            <div>
              <dt className="text-base-content/45">Content</dt>
              <dd className="mt-1">{contentBoundaryLabel(draft.contentBoundary)}</dd>
            </div>
            <div>
              <dt className="text-base-content/45">Payment</dt>
              <dd className="mt-1">
                {pendingPolicy.allowedPaymentModes[0] === "prepaid" ? "Workspace prepaid USDC" : "Bound payer wallet"}
              </dd>
            </div>
            <div>
              <dt className="text-base-content/45">Per request</dt>
              <dd className="mt-1">{formatUsdcAtomic(pendingPolicy.maxPanelAtomic)}</dd>
            </div>
            <div>
              <dt className="text-base-content/45">Daily</dt>
              <dd className="mt-1">{formatUsdcAtomic(pendingPolicy.maxDailyAtomic)}</dd>
            </div>
            <div>
              <dt className="text-base-content/45">Monthly</dt>
              <dd className="mt-1">{formatUsdcAtomic(pendingPolicy.maxMonthlyAtomic)}</dd>
            </div>
            <div>
              <dt className="text-base-content/45">Bounty ceiling</dt>
              <dd className="mt-1">{formatUsdcAtomic(pendingPolicy.maxBountyAtomic)}</dd>
            </div>
            <div>
              <dt className="text-base-content/45">Accepted-work reserve</dt>
              <dd className="mt-1">{formatUsdcAtomic(pendingPolicy.maxAttemptReserveAtomic)}</dd>
            </div>
            <div>
              <dt className="text-base-content/45">Maximum responses</dt>
              <dd className="mt-1">{pendingPolicy.maxPanelSize}</dd>
            </div>
            <div>
              <dt className="text-base-content/45">Maximum platform fee</dt>
              <dd className="mt-1">{pendingPolicy.maxFeeBps / 100}%</dd>
            </div>
            <div>
              <dt className="text-base-content/45">If a request exceeds the limits</dt>
              <dd className="mt-1">{pendingPolicy.onPolicyMiss === "handoff" ? "Ask for approval" : "Deny"}</dd>
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <dt className="text-base-content/45">Audience policy binding</dt>
              <dd className="mt-1 break-all font-mono text-xs">{pendingPolicy.allowedAdmissionPolicyHashes[0]}</dd>
            </div>
          </dl>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="rateloop-gradient-action px-5"
              onClick={() => void createPolicy()}
              disabled={busy}
            >
              {busy ? "Approving…" : "Approve autonomous access"}
            </button>
            <button
              type="button"
              className="btn rateloop-secondary-action rateloop-back-action gap-2 px-5"
              onClick={() => setPendingPolicy(null)}
              disabled={busy}
            >
              Back
            </button>
          </div>
        </section>
      ) : null}

      {error ? (
        <p className="alert alert-error text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="alert alert-success text-sm" role="status">
          {status}
        </p>
      ) : null}

      {workspaceId && policies.length > 0 ? (
        <section className="surface-card rounded-2xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Autonomous review access</h2>
            {!editorOpen ? (
              <button type="button" className="btn btn-sm rateloop-secondary-action" onClick={startEditor}>
                Add policy
              </button>
            ) : null}
          </div>
          <div className="mt-5 space-y-4">
            {policies.map(policy => {
              const active = policy.enabled && !policy.revokedAt;
              return (
                <article key={policy.policyId} className="rounded-xl border border-white/10 bg-white/[0.025] p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{policy.name}</h3>
                        <span className={`badge ${active ? "badge-success" : "badge-ghost"}`}>
                          {active ? "active" : "revoked"}
                        </span>
                        <span className="badge badge-ghost">v{policy.version}</span>
                      </div>
                      <p className="mt-3 text-sm text-base-content/65">
                        {audienceLabel(policy.allowedReviewerSources)} ·{" "}
                        {policyContentBoundaryLabel(policy.allowedDataClassifications)}
                      </p>
                    </div>
                    {active ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost text-error"
                        onClick={() => void revokePolicy(policy)}
                        disabled={busy}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </div>
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-base-content/45">Per request</dt>
                      <dd>{formatUsdcAtomic(policy.maxPanelAtomic)}</dd>
                    </div>
                    <div>
                      <dt className="text-base-content/45">Daily</dt>
                      <dd>{formatUsdcAtomic(policy.maxDailyAtomic)}</dd>
                    </div>
                    <div>
                      <dt className="text-base-content/45">Monthly</dt>
                      <dd>{formatUsdcAtomic(policy.maxMonthlyAtomic)}</dd>
                    </div>
                  </dl>
                  <details className="mt-4 text-xs text-base-content/50">
                    <summary className="cursor-pointer">Technical details</summary>
                    <dl className="mt-3 space-y-2 break-all font-mono">
                      <div>
                        <dt className="sr-only">Policy ID</dt>
                        <dd>{policy.policyId}</dd>
                      </div>
                      <div>
                        <dt className="sr-only">Audience policy binding</dt>
                        <dd>{policy.allowedAdmissionPolicyHashes[0]}</dd>
                      </div>
                      <div>
                        <dt className="sr-only">Server classifications</dt>
                        <dd>{policy.allowedDataClassifications.join(", ") || "legacy unrestricted"}</dd>
                      </div>
                    </dl>
                  </details>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {workspaceId && policies.some(policy => policy.enabled && !policy.revokedAt) ? (
        <section className="surface-card rounded-2xl p-6" aria-labelledby="activate-agent-publishing-heading">
          <h2 id="activate-agent-publishing-heading" className="text-xl font-semibold">
            Activate for a connected agent
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-base-content/60">
            This separate owner approval lets the selected agent publish review requests and spend within the chosen
            policy without asking again. Until you activate it here, the connection remains safe and cannot publish or
            spend.
          </p>
          {integrations.length > 0 ? (
            <div className="mt-6 space-y-5">
              <div className="grid gap-5 md:grid-cols-2">
                <label className="text-sm text-base-content/70">
                  Connected agent
                  <select
                    className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                    value={selectedIntegrationId}
                    onChange={event => {
                      const integrationId = event.target.value;
                      const integration = integrations.find(entry => entry.integrationId === integrationId);
                      setSelectedIntegrationId(integrationId);
                      setAllowedWorkflows((integration?.allowedWorkflowKeys ?? []).join(", "));
                    }}
                  >
                    {integrations.map(integration => (
                      <option key={integration.integrationId} value={integration.integrationId}>
                        {integration.displayName || "Connected agent"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-base-content/70">
                  Autonomous access policy
                  <select
                    className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                    value={selectedPolicyId}
                    onChange={event => setSelectedPolicyId(event.target.value)}
                  >
                    {policies
                      .filter(policy => policy.enabled && !policy.revokedAt)
                      .map(policy => (
                        <option key={policy.policyId} value={policy.policyId}>
                          {policy.name} · v{policy.version}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <label className="block text-sm text-base-content/70">
                Allowed workflows
                <input
                  className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)] font-mono text-sm"
                  value={allowedWorkflows}
                  onChange={event => setAllowedWorkflows(event.target.value)}
                  placeholder="general-assistance"
                />
              </label>
              <button
                type="button"
                className="rateloop-gradient-action px-5"
                onClick={() => void activatePolicy()}
                disabled={busy || !selectedIntegrationId || !selectedPolicyId}
              >
                {busy ? "Activating…" : "Allow agent to publish and spend"}
              </button>
            </div>
          ) : (
            <p className="mt-5 text-sm text-base-content/60">
              No verified OAuth-connected agent is available. Connect and verify an agent first.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
