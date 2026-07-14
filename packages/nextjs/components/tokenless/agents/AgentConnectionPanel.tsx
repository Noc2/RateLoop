"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";

type Workspace = { workspaceId: string; name: string; role: string };

type PairingStatus = "open" | "claimed" | "approved" | "rejected" | "expired" | "revoked";

type AgentPairing = {
  pairingId: string;
  status: PairingStatus;
  createdAt: string | null;
  expiresAt: string | null;
  externalId: string;
  displayName: string;
  description: string;
  declaredProvider: string;
  declaredModel: string;
  declaredModelVersion: string;
  declaredDeploymentName: string;
  environment: "sandbox" | "staging" | "production";
  clientName: string;
  clientVersion: string;
  requestedWorkflowKeys: string[];
};

type AgentIntegration = {
  integrationId: string;
  agentId: string;
  agentVersionId: string;
  agentDisplayName: string;
  agentVersionNumber: number | null;
  publishingPolicyId: string;
  publishingPolicyName: string;
  reviewPolicyId: string;
  reviewPolicyVersion: number | null;
  status: "active" | "revoked";
  enforcementMode: "advisory" | "host_enforced";
  clientName: string;
  clientVersion: string;
  lastSeenAt: string | null;
  credentialExpiresAt: string | null;
};

type PublishingPolicy = {
  policyId: string;
  name: string;
  version: number;
  enabled: boolean;
  revokedAt: string | null;
};

type ConnectionReveal = {
  title: string;
  secret: string;
  mcpUrl: string;
  expiresAt: string | null;
};

type ApprovalPayload = {
  externalId: string;
  displayName: string;
  description: string;
  provider: string;
  model: string;
  modelVersion: string | null;
  deploymentName: string | null;
  environment: "sandbox" | "staging" | "production";
  publishingPolicyId: string;
  allowedWorkflowKeys: string[];
};

const PAIRING_POLL_INTERVAL_MS = 3_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringField(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (typeof value[key] === "string") return value[key] as string;
  }
  return "";
}

function nullableStringField(value: Record<string, unknown>, ...keys: string[]) {
  return stringField(value, ...keys) || null;
}

function numberField(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (typeof value[key] === "number" && Number.isFinite(value[key])) return value[key] as number;
  }
  return null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function responseList(body: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (Array.isArray(body[key])) return body[key] as unknown[];
  }
  return [];
}

export function normalizeAgentPairing(value: unknown): AgentPairing {
  const row = record(value);
  const status = stringField(row, "status") as PairingStatus;
  const environment = stringField(row, "environment") as AgentPairing["environment"];
  return {
    pairingId: stringField(row, "pairingId", "id"),
    status: ["open", "claimed", "approved", "rejected", "expired", "revoked"].includes(status) ? status : "open",
    createdAt: nullableStringField(row, "createdAt"),
    expiresAt: nullableStringField(row, "expiresAt"),
    externalId: stringField(row, "externalId"),
    displayName: stringField(row, "displayName"),
    description: stringField(row, "description"),
    declaredProvider: stringField(row, "declaredProvider", "provider"),
    declaredModel: stringField(row, "declaredModel", "model"),
    declaredModelVersion: stringField(row, "declaredModelVersion", "modelVersion"),
    declaredDeploymentName: stringField(row, "declaredDeploymentName", "deploymentName"),
    environment: ["sandbox", "staging", "production"].includes(environment) ? environment : "production",
    clientName: stringField(row, "clientName"),
    clientVersion: stringField(row, "clientVersion"),
    requestedWorkflowKeys: stringArray(row.requestedWorkflowKeys),
  };
}

export function normalizeAgentIntegration(value: unknown): AgentIntegration {
  const row = record(value);
  const agent = record(row.agent);
  const version = record(row.agentVersion);
  const publishingPolicy = record(row.publishingPolicy);
  const reviewPolicy = record(row.reviewPolicy);
  return {
    integrationId: stringField(row, "integrationId", "id"),
    agentId: stringField(row, "agentId") || stringField(agent, "agentId", "id"),
    agentVersionId: stringField(row, "agentVersionId") || stringField(version, "versionId", "id"),
    agentDisplayName: stringField(row, "agentDisplayName", "displayName") || stringField(agent, "displayName"),
    agentVersionNumber: numberField(row, "agentVersionNumber") ?? numberField(version, "versionNumber", "version"),
    publishingPolicyId: stringField(row, "publishingPolicyId") || stringField(publishingPolicy, "policyId", "id"),
    publishingPolicyName: stringField(row, "publishingPolicyName") || stringField(publishingPolicy, "name"),
    reviewPolicyId: stringField(row, "reviewPolicyId") || stringField(reviewPolicy, "policyId", "id"),
    reviewPolicyVersion: numberField(row, "reviewPolicyVersion") ?? numberField(reviewPolicy, "version"),
    status: stringField(row, "status") === "revoked" ? "revoked" : "active",
    enforcementMode: stringField(row, "enforcementMode") === "host_enforced" ? "host_enforced" : "advisory",
    clientName: stringField(row, "clientName"),
    clientVersion: stringField(row, "clientVersion"),
    lastSeenAt: nullableStringField(row, "lastSeenAt"),
    credentialExpiresAt: nullableStringField(row, "credentialExpiresAt", "expiresAt"),
  };
}

function normalizePublishingPolicy(value: unknown): PublishingPolicy {
  const row = record(value);
  return {
    policyId: stringField(row, "policyId", "id"),
    name: stringField(row, "name") || "Unnamed policy",
    version: numberField(row, "version") ?? 1,
    enabled: row.enabled !== false,
    revokedAt: nullableStringField(row, "revokedAt"),
  };
}

async function readJson(response: Response) {
  const body = record(await response.json().catch(() => ({})));
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
    );
  }
  return body;
}

function workflowKeys(value: string) {
  const entries = [
    ...new Set(
      value
        .split(",")
        .map(entry => entry.trim())
        .filter(Boolean),
    ),
  ];
  if (
    entries.length === 0 ||
    entries.length > 32 ||
    entries.some(entry => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(entry))
  ) {
    throw new Error("Allowed workflows must be comma-separated identifiers.");
  }
  return entries;
}

function formatTimestamp(value: string | null, empty = "Never") {
  if (!value) return empty;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function fallbackMcpUrl() {
  return typeof window === "undefined" ? "/api/agent/v1/mcp" : `${window.location.origin}/api/agent/v1/mcp`;
}

function revealFromResponse(body: Record<string, unknown>, title: string): ConnectionReveal {
  const pairing = record(body.pairing ?? body.session);
  const integration = record(body.integration);
  return {
    title,
    secret: stringField(body, "secret", "token", "credential", "apiKey"),
    mcpUrl: stringField(body, "mcpUrl", "mcpEndpoint") || fallbackMcpUrl(),
    expiresAt:
      nullableStringField(body, "expiresAt") ??
      nullableStringField(pairing, "expiresAt") ??
      nullableStringField(integration, "expiresAt", "credentialExpiresAt"),
  };
}

function PairingApprovalCard({
  pairing,
  policies,
  busy,
  onApprove,
  onReject,
}: {
  pairing: AgentPairing;
  policies: PublishingPolicy[];
  busy: boolean;
  onApprove: (payload: ApprovalPayload) => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const [externalId, setExternalId] = useState(pairing.externalId);
  const [displayName, setDisplayName] = useState(pairing.displayName);
  const [description, setDescription] = useState(pairing.description);
  const [declaredProvider, setDeclaredProvider] = useState(pairing.declaredProvider);
  const [declaredModel, setDeclaredModel] = useState(pairing.declaredModel);
  const [declaredModelVersion, setDeclaredModelVersion] = useState(pairing.declaredModelVersion);
  const [declaredDeploymentName, setDeclaredDeploymentName] = useState(pairing.declaredDeploymentName);
  const [environment, setEnvironment] = useState(pairing.environment);
  const [publishingPolicyId, setPublishingPolicyId] = useState(policies[0]?.policyId ?? "");
  const [allowedWorkflows, setAllowedWorkflows] = useState(pairing.requestedWorkflowKeys.join(", "));
  const [localError, setLocalError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    try {
      await onApprove({
        externalId,
        displayName,
        description,
        provider: declaredProvider,
        model: declaredModel,
        modelVersion: declaredModelVersion || null,
        deploymentName: declaredDeploymentName || null,
        environment,
        publishingPolicyId,
        allowedWorkflowKeys: workflowKeys(allowedWorkflows),
      });
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "Unable to approve this agent.");
    }
  }

  return (
    <form
      className="rounded-xl border border-[var(--rateloop-blue)]/25 bg-[var(--rateloop-blue)]/[0.035] p-5"
      onSubmit={submit}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold">Agent is waiting for approval</h4>
            <span className="badge border-0 bg-amber-300/10 text-amber-100">declared metadata</span>
          </div>
          <p className="mt-2 text-sm text-base-content/60">
            {pairing.clientName || "Unknown MCP client"}
            {pairing.clientVersion ? ` ${pairing.clientVersion}` : ""} submitted this registration. Verify and edit
            every field before activation.
          </p>
          {pairing.requestedWorkflowKeys.length > 0 ? (
            <p className="mt-2 text-xs text-base-content/45">
              Requested workflows: {pairing.requestedWorkflowKeys.join(", ")}
            </p>
          ) : null}
        </div>
        <time className="font-mono text-xs text-base-content/45" dateTime={pairing.expiresAt ?? undefined}>
          Expires {formatTimestamp(pairing.expiresAt, "soon")}
        </time>
      </div>

      <fieldset className="mt-5">
        <legend className="text-sm font-semibold">1. Confirm the agent identity</legend>
        <p className="mt-1 text-xs leading-5 text-base-content/50">
          Provider and model values are agent-declared, not provider-attested. Approval records your edited declaration
          as immutable version 1.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm text-base-content/65">
            Display name
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={displayName}
              onChange={event => setDisplayName(event.target.value)}
              maxLength={120}
              required
            />
          </label>
          <label className="text-sm text-base-content/65">
            Stable external ID
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)] font-mono text-xs"
              value={externalId}
              onChange={event => setExternalId(event.target.value)}
              maxLength={160}
              required
            />
          </label>
          <label className="text-sm text-base-content/65">
            Declared provider
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={declaredProvider}
              onChange={event => setDeclaredProvider(event.target.value)}
              maxLength={120}
              required
            />
          </label>
          <label className="text-sm text-base-content/65">
            Declared model
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={declaredModel}
              onChange={event => setDeclaredModel(event.target.value)}
              maxLength={160}
              required
            />
          </label>
          <label className="text-sm text-base-content/65">
            Declared model version (optional)
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={declaredModelVersion}
              onChange={event => setDeclaredModelVersion(event.target.value)}
              maxLength={160}
            />
          </label>
          <label className="text-sm text-base-content/65">
            Deployment name (optional)
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={declaredDeploymentName}
              onChange={event => setDeclaredDeploymentName(event.target.value)}
              maxLength={160}
            />
          </label>
          <label className="text-sm text-base-content/65">
            Environment
            <select
              className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={environment}
              onChange={event => setEnvironment(event.target.value as AgentPairing["environment"])}
            >
              <option value="sandbox">Sandbox</option>
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
          </label>
          <label className="text-sm text-base-content/65 md:col-span-2">
            Description
            <textarea
              className="textarea mt-2 min-h-24 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={description}
              onChange={event => setDescription(event.target.value)}
              maxLength={1_000}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="mt-6 border-t border-white/10 pt-5">
        <legend className="text-sm font-semibold">2. Choose publishing and workflow controls</legend>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm text-base-content/65">
            Publishing policy
            <select
              className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={publishingPolicyId}
              onChange={event => setPublishingPolicyId(event.target.value)}
              required
            >
              <option value="" disabled>
                Select an active policy
              </option>
              {policies.map(policy => (
                <option key={policy.policyId} value={policy.policyId}>
                  {policy.name} · v{policy.version}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-base-content/65">
            Allowed workflows
            <input
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={allowedWorkflows}
              onChange={event => setAllowedWorkflows(event.target.value)}
              placeholder="review.copy, review.code"
              required
            />
            <span className="mt-2 block text-xs leading-5 text-base-content/45">
              You may remove requested workflows before approval. The credential cannot add workflows later.
            </span>
          </label>
        </div>
        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.025] p-4 text-xs leading-5 text-base-content/55">
          <strong className="text-base-content/75">Safe adaptive preset:</strong> private invited reviewers, 90%
          agreement, 70% minimum declared confidence, review for high and critical risk, and at most 20 outputs without
          a sample. Coverage starts at 100%, then may move to 50%, 25%, and a 10% monitoring floor after stable
          agreement. Generic MCP is advisory: RateLoop decides and records when review is required, but cannot prove
          this host blocks an answer before review finishes. Customize the immutable review policy in the Review policy
          panel after approval.
        </div>
      </fieldset>

      {policies.length === 0 ? (
        <p className="mt-4 rounded-lg bg-amber-300/10 p-3 text-sm text-amber-100">
          Create an active publishing policy below before approving this agent.
        </p>
      ) : null}
      {localError ? (
        <p className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100" role="alert">
          {localError}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="submit" className="rateloop-gradient-action px-5" disabled={busy || !publishingPolicyId}>
          {busy ? "Approving…" : "Approve and activate"}
        </button>
        <button
          type="button"
          className="btn border border-red-300/20 bg-red-300/[0.06] text-red-100"
          disabled={busy}
          onClick={() => void onReject()}
        >
          Reject request
        </button>
      </div>
    </form>
  );
}

export function AgentConnectionPanel() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [pairings, setPairings] = useState<AgentPairing[]>([]);
  const [integrations, setIntegrations] = useState<AgentIntegration[]>([]);
  const [publishingPolicies, setPublishingPolicies] = useState<PublishingPolicy[]>([]);
  const [reveal, setReveal] = useState<ConnectionReveal | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const loadConnectionState = useCallback(async (selectedWorkspaceId: string, signal?: AbortSignal) => {
    if (!selectedWorkspaceId) {
      setPairings([]);
      setIntegrations([]);
      setPublishingPolicies([]);
      return;
    }
    const base = `/api/account/workspaces/${encodeURIComponent(selectedWorkspaceId)}`;
    const [pairingBody, integrationBody, policyBody] = await Promise.all([
      readJson(await fetch(`${base}/agent-pairings`, { cache: "no-store", credentials: "same-origin", signal })),
      readJson(await fetch(`${base}/agent-integrations`, { cache: "no-store", credentials: "same-origin", signal })),
      readJson(
        await fetch(`${base}/agent-publishing-policies`, { cache: "no-store", credentials: "same-origin", signal }),
      ),
    ]);
    setPairings(responseList(pairingBody, "pairings", "sessions").map(normalizeAgentPairing));
    setIntegrations(responseList(integrationBody, "integrations").map(normalizeAgentIntegration));
    setPublishingPolicies(
      responseList(policyBody, "policies")
        .map(normalizePublishingPolicy)
        .filter(policy => policy.enabled && !policy.revokedAt),
    );
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const body = await readJson(
          await fetch("/api/account/workspaces", {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          }),
        );
        const manageable = (responseList(body, "workspaces") as Workspace[]).filter(
          workspace => workspace.role === "owner" || workspace.role === "admin",
        );
        if (controller.signal.aborted) return;
        const selected = manageable[0]?.workspaceId ?? "";
        setWorkspaces(manageable);
        setWorkspaceId(selected);
        await loadConnectionState(selected, controller.signal);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Unable to load agent connections.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [loadConnectionState]);

  const shouldPoll = pairings.some(pairing => pairing.status === "open" || pairing.status === "claimed");

  useEffect(() => {
    if (!workspaceId || !shouldPoll) return;
    const timer = window.setInterval(() => {
      void loadConnectionState(workspaceId).catch(() => undefined);
    }, PAIRING_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadConnectionState, shouldPoll, workspaceId]);

  async function selectWorkspace(nextWorkspaceId: string) {
    setWorkspaceId(nextWorkspaceId);
    setPairings([]);
    setIntegrations([]);
    setPublishingPolicies([]);
    setReveal(null);
    setError(null);
    setStatus(null);
    setLoading(true);
    try {
      await loadConnectionState(nextWorkspaceId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load agent connections.");
    } finally {
      setLoading(false);
    }
  }

  async function generatePairing() {
    if (!workspaceId) return;
    setBusyAction("create-pairing");
    setReveal(null);
    setError(null);
    setStatus(null);
    try {
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-pairings`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expiresInSeconds: 600 }),
        }),
      );
      const nextReveal = revealFromResponse(body, "One-time agent connection");
      if (!nextReveal.secret) throw new Error("The server did not return the one-time pairing secret.");
      setReveal(nextReveal);
      await loadConnectionState(workspaceId);
      setStatus("Pairing created. It expires in 10 minutes and can submit only one registration request.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create an agent pairing.");
    } finally {
      setBusyAction(null);
    }
  }

  async function approvePairing(pairingId: string, payload: ApprovalPayload) {
    setBusyAction(`approve:${pairingId}`);
    setError(null);
    setStatus(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-pairings/${encodeURIComponent(pairingId)}/approve`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        ),
      );
      await loadConnectionState(workspaceId);
      setStatus("Agent approved. Its credential is now bound to this workspace, immutable version, and policies.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to approve the agent.");
      throw cause;
    } finally {
      setBusyAction(null);
    }
  }

  async function rejectPairing(pairingId: string) {
    if (!window.confirm("Reject this agent registration request? The pairing secret cannot be reused.")) return;
    setBusyAction(`reject:${pairingId}`);
    setError(null);
    setStatus(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-pairings/${encodeURIComponent(pairingId)}/reject`,
          { method: "POST", credentials: "same-origin" },
        ),
      );
      await loadConnectionState(workspaceId);
      setStatus("Agent registration rejected.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to reject the agent.");
    } finally {
      setBusyAction(null);
    }
  }

  async function rotateIntegration(integration: AgentIntegration) {
    if (!window.confirm(`Rotate the credential for ${integration.agentDisplayName || integration.agentId}?`)) return;
    setBusyAction(`rotate:${integration.integrationId}`);
    setReveal(null);
    setError(null);
    setStatus(null);
    try {
      const body = await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-integrations/${encodeURIComponent(integration.integrationId)}/rotate`,
          { method: "POST", credentials: "same-origin" },
        ),
      );
      const nextReveal = revealFromResponse(body, "Rotated agent credential");
      if (!nextReveal.secret) throw new Error("The server did not return the rotated credential.");
      setReveal(nextReveal);
      await loadConnectionState(workspaceId);
      setStatus("Credential rotated. The previous credential is no longer valid.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to rotate the credential.");
    } finally {
      setBusyAction(null);
    }
  }

  async function revokeIntegration(integration: AgentIntegration) {
    if (!window.confirm(`Revoke the RateLoop connection for ${integration.agentDisplayName || integration.agentId}?`))
      return;
    setBusyAction(`revoke:${integration.integrationId}`);
    setError(null);
    setStatus(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-integrations/${encodeURIComponent(integration.integrationId)}`,
          { method: "DELETE", credentials: "same-origin" },
        ),
      );
      await loadConnectionState(workspaceId);
      setStatus("Agent connection revoked. Its next authenticated request will be denied.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to revoke the agent connection.");
    } finally {
      setBusyAction(null);
    }
  }

  async function copyReveal() {
    if (!reveal) return;
    const bundle = `RateLoop MCP URL: ${reveal.mcpUrl}\nAuthorization: Bearer ${reveal.secret}`;
    try {
      await navigator.clipboard.writeText(bundle);
      setStatus("Connection bundle copied. Store it in the MCP host configuration, never in a prompt.");
    } catch {
      setError("Clipboard access was denied. Copy the MCP URL and secret manually.");
    }
  }

  const activePairings = pairings.filter(pairing => pairing.status === "open" || pairing.status === "claimed");

  return (
    <div className="space-y-5">
      <section className="surface-card rounded-2xl p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Agent connection</p>
            <h2 className="mt-2 text-2xl font-semibold">Connect an agent to RateLoop</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-base-content/60">
              Generate a short-lived connection, let the agent describe itself over MCP, then approve its identity,
              spending boundary, and human-feedback policy. Possessing the pairing secret does not grant workspace
              access.
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
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rateloop-gradient-action px-5"
            disabled={!workspaceId || busyAction === "create-pairing"}
            onClick={() => void generatePairing()}
          >
            {busyAction === "create-pairing" ? "Generating…" : "Generate 10-minute connection"}
          </button>
          <span className="text-xs leading-5 text-base-content/45">
            The secret is random, single-use, hash-only at rest, and shown once.
          </span>
        </div>
        {!loading && workspaces.length === 0 ? (
          <p className="mt-5 rounded-lg bg-white/[0.04] p-4 text-sm text-base-content/65">
            Create a workspace in Overview, or ask an owner to grant you owner/admin access, before connecting an agent.
          </p>
        ) : null}
      </section>

      {reveal ? (
        <section
          className="rounded-2xl border border-warning/35 bg-warning/10 p-5"
          aria-labelledby="agent-connection-secret-heading"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 id="agent-connection-secret-heading" className="font-semibold">
                {reveal.title}
              </h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/65">
                Copy this once into the agent&apos;s MCP host configuration. The bearer secret must never be pasted into
                a prompt, chat, repository, log, or tool argument.
              </p>
            </div>
            <button type="button" className="btn btn-sm border-white/10" onClick={() => void copyReveal()}>
              Copy connection bundle
            </button>
          </div>
          <dl className="mt-4 space-y-3 rounded-lg bg-black/30 p-4 font-mono text-xs">
            <div>
              <dt className="text-base-content/45">MCP URL</dt>
              <dd className="mt-1 break-all">{reveal.mcpUrl}</dd>
            </div>
            <div>
              <dt className="text-base-content/45">Bearer secret</dt>
              <dd className="mt-1 break-all">{reveal.secret}</dd>
            </div>
            {reveal.expiresAt ? (
              <div>
                <dt className="text-base-content/45">Expires</dt>
                <dd className="mt-1">{formatTimestamp(reveal.expiresAt)}</dd>
              </div>
            ) : null}
          </dl>
          <button
            type="button"
            className="mt-3 text-xs text-base-content/55 underline underline-offset-4"
            onClick={() => setReveal(null)}
          >
            I stored it securely — hide secret
          </button>
        </section>
      ) : null}

      {loading ? (
        <div className="surface-card rounded-2xl p-6 text-sm text-base-content/55" role="status">
          <span className="loading loading-spinner loading-sm mr-2" /> Loading agent connections…
        </div>
      ) : null}

      {!loading && workspaceId ? (
        <section className="surface-card rounded-2xl p-6" aria-labelledby="pending-agent-connections-heading">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 id="pending-agent-connections-heading" className="text-xl font-semibold">
                Pending connections
              </h3>
              <p className="mt-2 text-sm text-base-content/55">This list refreshes while an agent is connecting.</p>
            </div>
            {shouldPoll ? (
              <span className="badge border-0 bg-[var(--rateloop-blue)]/10 text-[var(--rateloop-blue)]">
                Listening for agent…
              </span>
            ) : null}
          </div>
          {activePairings.length === 0 ? (
            <p className="mt-5 text-sm text-base-content/55">No agent is waiting for approval.</p>
          ) : null}
          <div className="mt-5 space-y-4">
            {activePairings.map(pairing =>
              pairing.status === "claimed" ? (
                <PairingApprovalCard
                  key={pairing.pairingId}
                  pairing={pairing}
                  policies={publishingPolicies}
                  busy={busyAction === `approve:${pairing.pairingId}` || busyAction === `reject:${pairing.pairingId}`}
                  onApprove={payload => approvePairing(pairing.pairingId, payload)}
                  onReject={() => rejectPairing(pairing.pairingId)}
                />
              ) : (
                <article key={pairing.pairingId} className="surface-card-nested rounded-xl p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h4 className="font-semibold">Waiting for agent metadata</h4>
                      <p className="mt-1 font-mono text-xs text-base-content/45">{pairing.pairingId}</p>
                    </div>
                    <time className="text-xs text-base-content/45" dateTime={pairing.expiresAt ?? undefined}>
                      Expires {formatTimestamp(pairing.expiresAt, "soon")}
                    </time>
                  </div>
                </article>
              ),
            )}
          </div>
        </section>
      ) : null}

      {!loading && workspaceId ? (
        <section className="surface-card rounded-2xl p-6" aria-labelledby="connected-agents-heading">
          <h3 id="connected-agents-heading" className="text-xl font-semibold">
            Connected agents
          </h3>
          <p className="mt-2 text-sm leading-6 text-base-content/55">
            Each credential is bound to one workspace, agent, immutable version, review policy, and publishing policy.
          </p>
          {integrations.length === 0 ? (
            <p className="mt-5 text-sm text-base-content/55">No approved agent integration exists yet.</p>
          ) : null}
          <div className="mt-5 space-y-4">
            {integrations.map(integration => {
              const active = integration.status === "active";
              return (
                <article
                  key={integration.integrationId}
                  className="rounded-xl border border-white/10 bg-white/[0.025] p-5"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-semibold">{integration.agentDisplayName || integration.agentId}</h4>
                        {integration.agentVersionNumber ? (
                          <span className="badge badge-ghost">v{integration.agentVersionNumber}</span>
                        ) : null}
                        <span
                          className={`badge border-0 ${active ? "bg-emerald-300/10 text-emerald-100" : "bg-white/[0.06] text-base-content/50"}`}
                        >
                          {integration.status}
                        </span>
                        <span className="badge badge-ghost">
                          {integration.enforcementMode === "host_enforced" ? "host-enforced" : "advisory"}
                        </span>
                      </div>
                      <p className="mt-2 font-mono text-xs text-base-content/40">{integration.integrationId}</p>
                      <p className="mt-3 text-sm text-base-content/60">
                        {integration.clientName || "Unknown client"}
                        {integration.clientVersion ? ` ${integration.clientVersion}` : ""}
                      </p>
                    </div>
                    {active ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn btn-sm border-white/10"
                          disabled={Boolean(busyAction)}
                          onClick={() => void rotateIntegration(integration)}
                        >
                          Rotate credential
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost text-error"
                          disabled={Boolean(busyAction)}
                          onClick={() => void revokeIntegration(integration)}
                        >
                          Revoke
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <dl className="mt-4 grid gap-4 border-t border-white/10 pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-xs text-base-content/45">Last seen</dt>
                      <dd className="mt-1">{formatTimestamp(integration.lastSeenAt, "Never connected")}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-base-content/45">Credential expiry</dt>
                      <dd className="mt-1">{formatTimestamp(integration.credentialExpiresAt, "No expiry")}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-base-content/45">Review policy</dt>
                      <dd className="mt-1">
                        {integration.reviewPolicyId || "Unknown"}
                        {integration.reviewPolicyVersion ? ` · v${integration.reviewPolicyVersion}` : ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-base-content/45">Publishing policy</dt>
                      <dd className="mt-1">
                        {integration.publishingPolicyName || integration.publishingPolicyId || "Unknown"}
                      </dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>
        </section>
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
