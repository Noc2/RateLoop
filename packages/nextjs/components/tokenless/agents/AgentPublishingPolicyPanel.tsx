"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Workspace = { workspaceId: string; name: string; role: string };

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

type Audience = "private_invited" | "public_network" | "hybrid";

type PolicyDraft = {
  admissionPolicyHash: string;
  allowedDataClassifications: string[];
  audience: Audience;
  maxAttemptReserveUsdc: string;
  maxBountyUsdc: string;
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

const DATA_CLASSIFICATIONS = ["public", "synthetic", "redacted", "internal", "confidential", "restricted"] as const;

const INITIAL_DRAFT: PolicyDraft = {
  admissionPolicyHash: "",
  allowedDataClassifications: ["internal"],
  audience: "private_invited",
  maxAttemptReserveUsdc: "5",
  maxBountyUsdc: "20",
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

function audienceSources(audience: Audience) {
  if (audience === "private_invited") return ["customer_invited"];
  if (audience === "public_network") return ["rateloop_network"];
  return ["hybrid"];
}

function audienceLabel(sources: string[]) {
  if (sources.includes("hybrid")) return "Hybrid invited + public network";
  if (sources.includes("rateloop_network")) return "Public RateLoop network";
  return "Private invited reviewers";
}

export function AgentPublishingPolicyPanel() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [policies, setPolicies] = useState<PublishingPolicy[]>([]);
  const [draft, setDraft] = useState<PolicyDraft>(INITIAL_DRAFT);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const loadPolicies = useCallback(async (selectedWorkspaceId: string, signal?: AbortSignal) => {
    if (!selectedWorkspaceId) {
      setPolicies([]);
      return;
    }
    const body = await readJson(
      await fetch(`/api/account/workspaces/${encodeURIComponent(selectedWorkspaceId)}/agent-publishing-policies`, {
        cache: "no-store",
        credentials: "same-origin",
        signal,
      }),
    );
    setPolicies((body.policies ?? []) as PublishingPolicy[]);
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
        const manageable = ((body.workspaces ?? []) as Workspace[]).filter(
          workspace => workspace.role === "owner" || workspace.role === "admin",
        );
        if (controller.signal.aborted) return;
        const selectedId = manageable[0]?.workspaceId ?? "";
        setWorkspaces(manageable);
        setWorkspaceId(selectedId);
        await loadPolicies(selectedId, controller.signal);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Unable to load publishing policies.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [loadPolicies]);

  async function selectWorkspace(nextWorkspaceId: string) {
    setWorkspaceId(nextWorkspaceId);
    setPolicies([]);
    setError(null);
    setStatus(null);
    setLoading(true);
    try {
      await loadPolicies(nextWorkspaceId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load publishing policies.");
    } finally {
      setLoading(false);
    }
  }

  function updateDraft<Key extends keyof PolicyDraft>(key: Key, value: PolicyDraft[Key]) {
    setDraft(current => ({ ...current, [key]: value }));
  }

  function toggleClassification(value: string) {
    setDraft(current => ({
      ...current,
      allowedDataClassifications: current.allowedDataClassifications.includes(value)
        ? current.allowedDataClassifications.filter(item => item !== value)
        : [...current.allowedDataClassifications, value],
    }));
  }

  async function createPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      if (draft.allowedDataClassifications.length === 0) {
        throw new Error("Select at least one permitted data classification.");
      }
      const feePercent = Number(draft.maxFeePercent);
      if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 20) {
        throw new Error("The fee cap must be between 0% and 20%.");
      }
      const panelSize = Number(draft.maxPanelSize);
      if (!Number.isSafeInteger(panelSize)) throw new Error("Maximum responses must be a whole number.");
      await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-publishing-policies`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: draft.name,
            allowedPaymentModes: [draft.paymentMode],
            payerAddress: draft.paymentMode === "x402" ? draft.payerAddress : null,
            maxPanelAtomic: parseUsdcToAtomic(draft.maxPanelUsdc),
            maxDailyAtomic: parseUsdcToAtomic(draft.maxDailyUsdc),
            maxMonthlyAtomic: parseUsdcToAtomic(draft.maxMonthlyUsdc),
            maxPanelSize: panelSize,
            maxBountyAtomic: parseUsdcToAtomic(draft.maxBountyUsdc),
            maxFeeBps: Math.round(feePercent * 100),
            maxAttemptReserveAtomic: parseUsdcToAtomic(draft.maxAttemptReserveUsdc),
            allowedReviewerSources: audienceSources(draft.audience),
            allowedAdmissionPolicyHashes: [draft.admissionPolicyHash],
            allowedDataClassifications: draft.allowedDataClassifications,
            onPolicyMiss: draft.onPolicyMiss,
          }),
        }),
      );
      await loadPolicies(workspaceId);
      setDraft(INITIAL_DRAFT);
      setStatus("Publishing policy created. Select it when approving an agent connection.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the publishing policy.");
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
      setStatus("Publishing policy revoked. Existing audit records remain available.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to revoke the publishing policy.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="surface-card rounded-2xl p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">
              Delegated publishing
            </p>
            <h2 className="mt-2 text-2xl font-semibold">Put a hard boundary around autonomous agent spend</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-base-content/60">
              Policies are server-enforced and bound automatically when you approve an agent connection. Audience
              hashes, reviewer supply, classifications, payment rail, panel size, and USDC caps must all match before an
              ask is accepted.
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
        {!loading && workspaces.length === 0 ? (
          <p className="mt-5 rounded-lg bg-white/[0.04] p-4 text-sm text-base-content/65">
            Create a workspace in Overview, or ask an owner to grant you an owner/admin role, before managing policies.
          </p>
        ) : null}
      </section>

      {workspaceId ? (
        <form className="surface-card rounded-2xl p-6" onSubmit={createPolicy}>
          <h3 className="text-xl font-semibold">New publishing policy</h3>
          <p className="mt-2 text-sm leading-6 text-base-content/60">
            A policy is append-only after creation. Replace it with a new version and revoke the old policy when limits
            change.
          </p>

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <label className="text-sm text-base-content/70">
              Policy name
              <input
                className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={draft.name}
                onChange={event => updateDraft("name", event.target.value)}
                maxLength={120}
                required
              />
            </label>
            <label className="text-sm text-base-content/70">
              Reviewer supply
              <select
                className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={draft.audience}
                onChange={event => updateDraft("audience", event.target.value as Audience)}
              >
                <option value="private_invited">Private invited reviewers</option>
                <option value="public_network">Public RateLoop network</option>
                <option value="hybrid">Hybrid subpanels</option>
              </select>
            </label>
            <label className="text-sm text-base-content/70 lg:col-span-2">
              Frozen admission-policy hash
              <input
                className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)] font-mono text-xs"
                value={draft.admissionPolicyHash}
                onChange={event => updateDraft("admissionPolicyHash", event.target.value)}
                placeholder="0x… (32-byte policy hash)"
                pattern="0x[0-9a-fA-F]{64}"
                required
              />
              <span className="mt-2 block text-xs leading-5 text-base-content/50">
                Exact binding prevents an agent from silently changing group, World ID, qualification, or compensation
                rules. Public-network admission requires the registered World ID assurance policy.
              </span>
            </label>
          </div>

          <fieldset className="mt-6">
            <legend className="text-sm font-medium">Permitted data classifications</legend>
            <div className="mt-3 flex flex-wrap gap-3">
              {DATA_CLASSIFICATIONS.map(value => (
                <label key={value} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={draft.allowedDataClassifications.includes(value)}
                    onChange={() => toggleClassification(value)}
                  />
                  {value}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm text-base-content/70">
              Payment rail
              <select
                className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={draft.paymentMode}
                onChange={event => updateDraft("paymentMode", event.target.value as "prepaid" | "x402")}
              >
                <option value="prepaid">Workspace prepaid USDC</option>
                <option value="x402">Self-funded x402</option>
              </select>
            </label>
            {draft.paymentMode === "x402" ? (
              <label className="text-sm text-base-content/70 md:col-span-2">
                Bound payer wallet
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
            {[
              ["maxPanelUsdc", "Per review total", draft.maxPanelUsdc],
              ["maxDailyUsdc", "Daily total", draft.maxDailyUsdc],
              ["maxMonthlyUsdc", "Monthly total", draft.maxMonthlyUsdc],
              ["maxBountyUsdc", "Bounty per review", draft.maxBountyUsdc],
              ["maxAttemptReserveUsdc", "Accepted-work reserve", draft.maxAttemptReserveUsdc],
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
              When a request misses policy
              <select
                className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={draft.onPolicyMiss}
                onChange={event => updateDraft("onPolicyMiss", event.target.value as "handoff" | "deny")}
              >
                <option value="handoff">Return approval_required</option>
                <option value="deny">Deny</option>
              </select>
            </label>
          </div>

          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.025] p-4 text-sm leading-6 text-base-content/60">
            Public-network reviews require a non-zero bounty and paid eligibility. Private unpaid employee reviews use
            the private-group assurance workflow; this delegated quote → ask policy does not convert paid panels into
            unpaid work. Response windows, assignment leases, and minimum usable answers are frozen separately in each
            assurance run, while this policy limits the maximum panel size.
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button type="submit" className="rateloop-gradient-action px-5" disabled={busy}>
              {busy ? "Saving…" : "Create enforced policy"}
            </button>
            <Link href="/handoff" className="btn btn-ghost border border-white/10">
              Open manual handoff
            </Link>
          </div>
        </form>
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
      {workspaceId ? (
        <section className="surface-card rounded-2xl p-6">
          <h3 className="text-xl font-semibold">Active and historical policies</h3>
          {loading ? <p className="mt-4 text-sm text-base-content/55">Loading policies…</p> : null}
          {!loading && policies.length === 0 ? (
            <p className="mt-4 text-sm text-base-content/55">
              No publishing policy has been created for this workspace.
            </p>
          ) : null}
          <div className="mt-5 space-y-4">
            {policies.map(policy => {
              const active = policy.enabled && !policy.revokedAt;
              return (
                <article key={policy.policyId} className="rounded-xl border border-white/10 bg-white/[0.025] p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-semibold">{policy.name}</h4>
                        <span className={`badge ${active ? "badge-success" : "badge-ghost"}`}>
                          {active ? "active" : "revoked"}
                        </span>
                        <span className="badge badge-ghost">v{policy.version}</span>
                      </div>
                      <p className="mt-2 font-mono text-xs text-base-content/45">{policy.policyId}</p>
                      <p className="mt-3 text-sm text-base-content/65">
                        {audienceLabel(policy.allowedReviewerSources)} · {policy.allowedPaymentModes.join(" + ")} · max{" "}
                        {policy.maxPanelSize} responses
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
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
                  </div>
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-base-content/45">Per review</dt>
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
                    <div>
                      <dt className="text-base-content/45">On miss</dt>
                      <dd>{policy.onPolicyMiss}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs leading-5 text-base-content/50">
                    Classifications: {policy.allowedDataClassifications.join(", ") || "legacy unrestricted"}. Admission:{" "}
                    {policy.allowedAdmissionPolicyHashes[0]}
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
