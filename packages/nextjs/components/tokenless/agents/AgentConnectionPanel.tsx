"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InfoPopover } from "../InfoPopover";
import {
  AgentConnectionHostPicker,
  loadAgentConnectionHostChoice,
  saveAgentConnectionHostChoice,
} from "./AgentConnectionHostPicker";
import { AgentConnectionTroubleshooting } from "./AgentConnectionTroubleshooting";
import type { AgentConnectionHistoryEntry } from "./agentAuditHistory";
import { buildAgentConnectionMessage, buildAgentConnectionMessageForHost } from "./agentConnectionMessage";
import { isUsableAgentConnection } from "./agentWorkspaceState";
import { useRateLoopNotifications } from "~~/components/tokenless/RateLoopNotificationProvider";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { Badge } from "~~/components/tokenless/ui/Badge";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { type TokenlessHostId } from "~~/lib/tokenless/hostCapabilities";
import { readJson } from "~~/lib/tokenless/http";

type PairingStatus = "open" | "claimed" | "approved" | "rejected" | "expired" | "revoked";

type AgentPairing = {
  pairingId: string;
  status: PairingStatus;
  createdAt: string | null;
  expiresAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  externalId: string;
  displayName: string;
  description: string;
  declaredProvider: string;
  declaredModel: string;
  declaredModelVersion: string;
  environment: "staging" | "production";
  clientName: string;
  clientVersion: string;
  requestedWorkflowKeys: string[];
};

type AgentIntegration = {
  integrationId: string;
  apiKeyId: string;
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
  connectionStatus: string | null;
  oauthRecoveryAvailable: boolean;
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

type ConnectionIntentStatus =
  | "issued"
  | "install_required"
  | "authorizing"
  | "approval_required"
  | "testing"
  | "connected"
  | "action_required"
  | "cancelled"
  | "expired"
  | "rejected"
  | "revoked"
  | "superseded";

type AgentConnectionIntent = {
  intentId: string;
  status: ConnectionIntentStatus;
  profile: { key: string; version: number; summary: string };
  createdAt: string | null;
  claimExpiresAt: string | null;
  hardExpiresAt: string | null;
  clientName: string;
  clientVersion: string;
  lastTransitionAt: string | null;
  recoveryAction: string;
  reconnectIntegrationId: string;
  workspaceMove: {
    transferId: string;
    status: "source_confirmation_required" | "owner_approval_required" | "completed" | "expired";
    sourceConfirmedAt: string | null;
    targetApprovedAt: string | null;
    expiresAt: string | null;
  } | null;
};

type ApprovalPayload = {
  externalId: string;
  displayName: string;
  description: string;
  provider: string;
  model: string;
  modelVersion: string | null;
  environment: "staging" | "production";
  publishingPolicyId: string;
  allowedWorkflowKeys: string[];
};

const PAIRING_POLL_INTERVAL_MS = 5_000;
const PAIRING_HIDDEN_POLL_INTERVAL_MS = 10_000;
const CONNECTION_INTENT_ACTIVE_STATUSES: ConnectionIntentStatus[] = [
  "issued",
  "install_required",
  "authorizing",
  "approval_required",
  "testing",
  "action_required",
];

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
    approvedAt: nullableStringField(row, "approvedAt"),
    rejectedAt: nullableStringField(row, "rejectedAt"),
    externalId: stringField(row, "externalId"),
    displayName: stringField(row, "displayName"),
    description: stringField(row, "description"),
    declaredProvider: stringField(row, "declaredProvider", "provider"),
    declaredModel: stringField(row, "declaredModel", "model"),
    declaredModelVersion: stringField(row, "declaredModelVersion", "modelVersion"),
    environment: environment === "staging" ? "staging" : "production",
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
    apiKeyId: stringField(row, "apiKeyId"),
    agentId: stringField(row, "agentId") || stringField(agent, "agentId", "id"),
    agentVersionId: stringField(row, "agentVersionId") || stringField(version, "versionId", "id"),
    agentDisplayName: stringField(row, "agentDisplayName", "displayName") || stringField(agent, "displayName"),
    agentVersionNumber: numberField(row, "agentVersionNumber") ?? numberField(version, "versionNumber", "version"),
    publishingPolicyId: stringField(row, "publishingPolicyId") || stringField(publishingPolicy, "policyId", "id"),
    publishingPolicyName: stringField(row, "publishingPolicyName") || stringField(publishingPolicy, "name"),
    reviewPolicyId: stringField(row, "reviewPolicyId") || stringField(reviewPolicy, "policyId", "id"),
    reviewPolicyVersion: numberField(row, "reviewPolicyVersion") ?? numberField(reviewPolicy, "version"),
    status: stringField(row, "status") === "active" ? "active" : "revoked",
    enforcementMode: stringField(row, "enforcementMode") === "host_enforced" ? "host_enforced" : "advisory",
    clientName: stringField(row, "clientName"),
    clientVersion: stringField(row, "clientVersion"),
    lastSeenAt: nullableStringField(row, "lastSeenAt"),
    credentialExpiresAt: nullableStringField(row, "credentialExpiresAt", "expiresAt"),
    connectionStatus: nullableStringField(row, "connectionStatus"),
    oauthRecoveryAvailable: row.oauthRecoveryAvailable === true,
  };
}

export function normalizeAgentConnectionIntent(value: unknown): AgentConnectionIntent {
  const row = record(value);
  const profile = record(row.profile);
  const workspaceMove = record(row.workspaceMove);
  const status = stringField(row, "status") as ConnectionIntentStatus;
  const workspaceMoveStatus = stringField(workspaceMove, "status") as NonNullable<
    AgentConnectionIntent["workspaceMove"]
  >["status"];
  return {
    intentId: stringField(row, "intentId"),
    status: [
      "issued",
      "install_required",
      "authorizing",
      "approval_required",
      "testing",
      "connected",
      "action_required",
      "cancelled",
      "expired",
      "rejected",
      "revoked",
      "superseded",
    ].includes(status)
      ? status
      : "action_required",
    profile: {
      key: stringField(profile, "key"),
      version: numberField(profile, "version") ?? 1,
      summary:
        stringField(profile, "summary") ||
        "Can check when human review is needed. Cannot spend, publish, read private files, or administer the workspace.",
    },
    createdAt: nullableStringField(row, "createdAt"),
    claimExpiresAt: nullableStringField(row, "claimExpiresAt"),
    hardExpiresAt: nullableStringField(row, "hardExpiresAt"),
    clientName: stringField(row, "clientName"),
    clientVersion: stringField(row, "clientVersion"),
    lastTransitionAt: nullableStringField(row, "lastTransitionAt"),
    recoveryAction: stringField(row, "recoveryAction"),
    reconnectIntegrationId: stringField(row, "reconnectIntegrationId"),
    workspaceMove: stringField(workspaceMove, "transferId")
      ? {
          transferId: stringField(workspaceMove, "transferId"),
          status: ["source_confirmation_required", "owner_approval_required", "completed", "expired"].includes(
            workspaceMoveStatus,
          )
            ? workspaceMoveStatus
            : "expired",
          sourceConfirmedAt: nullableStringField(workspaceMove, "sourceConfirmedAt"),
          targetApprovedAt: nullableStringField(workspaceMove, "targetApprovedAt"),
          expiresAt: nullableStringField(workspaceMove, "expiresAt"),
        }
      : null,
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

function connectionIntentCopy(status: ConnectionIntentStatus) {
  switch (status) {
    case "issued":
      return { heading: "Waiting for the agent to open your connection", detail: "Paste the copied message once." };
    case "install_required":
      return {
        heading: "Host install or trust required",
        detail: "Complete the native host prompt once. The original connection resumes automatically.",
      };
    case "authorizing":
      return {
        heading: "Waiting for authorization",
        detail: "Complete the RateLoop authorization prompt if your host opened one.",
      };
    case "approval_required":
      return {
        heading: "Additional access needs approval",
        detail: "The agent requested more than the safe default. Review the exact access before continuing.",
      };
    case "testing":
      return { heading: "Verifying safe access", detail: "The agent and RateLoop are finishing automatically." };
    case "action_required":
      return {
        heading: "Connection needs attention",
        detail: "Return to the agent for one exact recovery action. Do not paste the message again.",
      };
    case "connected":
      return {
        heading: "Connected with safe access",
        detail: "Review decisions are available; spending, publishing, private files, and administration stay blocked.",
      };
    default:
      return { heading: "Connection ended", detail: "Create a new connection message to try again." };
  }
}

export function isPendingAgentPairing(pairing: Pick<AgentPairing, "status" | "expiresAt">, now = Date.now()) {
  if (pairing.status !== "open" && pairing.status !== "claimed") return false;
  if (!pairing.expiresAt) return true;
  const expiresAt = new Date(pairing.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function isActiveAgentConnectionIntent(
  intent: Pick<AgentConnectionIntent, "status" | "hardExpiresAt">,
  now = Date.now(),
) {
  if (!CONNECTION_INTENT_ACTIVE_STATUSES.includes(intent.status)) return false;
  if (!intent.hardExpiresAt) return true;
  const expiresAt = new Date(intent.hardExpiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function fallbackMcpUrl() {
  return typeof window === "undefined" ? "/api/agent/v1/mcp" : `${window.location.origin}/api/agent/v1/mcp`;
}

/** The universal message stays the default; a chosen host only tunes the same message. */
function connectionMessageForHost(connectionUrl: string, hostId: TokenlessHostId | null) {
  return hostId
    ? buildAgentConnectionMessageForHost({ connectionUrl, hostId })
    : buildAgentConnectionMessage({ connectionUrl });
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
  const [environment, setEnvironment] = useState(pairing.environment);
  const [selectedPublishingPolicyId, setSelectedPublishingPolicyId] = useState("");
  const [allowedWorkflows, setAllowedWorkflows] = useState(pairing.requestedWorkflowKeys.join(", "));
  const [localError, setLocalError] = useState<string | null>(null);
  const publishingPolicyId = policies.some(policy => policy.policyId === selectedPublishingPolicyId)
    ? selectedPublishingPolicyId
    : (policies[0]?.policyId ?? "");

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
            <Badge variant="warning">declared metadata</Badge>
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
            Environment
            <select
              className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={environment}
              onChange={event => setEnvironment(event.target.value as AgentPairing["environment"])}
            >
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
              onChange={event => setSelectedPublishingPolicyId(event.target.value)}
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
          <strong className="text-base-content/75">Safe adaptive preset:</strong> private invited reviewers, two stable
          15-case windows with at least 14 agent-human agreements each, 70% minimum declared confidence, review for high
          and critical risk, and at most 20 outputs without a sample. Coverage starts at 100%, then may move to 50%,
          25%, and a 10% monitoring floor after stable evidence. Generic MCP is advisory: RateLoop decides and records
          when review is required, but cannot prove this host blocks an answer before review finishes. Customize the
          immutable review policy in the Review policy panel after approval.
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

export function AgentConnectionPanel({
  workspaceId,
  publishingRevision = 0,
  onAgentApproved,
  onConnectionStateChange,
  onConnectionHistoryChange,
}: {
  workspaceId: string;
  publishingRevision?: number;
  onAgentApproved?: () => void;
  onConnectionStateChange?: (connected: boolean) => void;
  onConnectionHistoryChange?: (history: AgentConnectionHistoryEntry[]) => void;
}) {
  const notifications = useRateLoopNotifications();
  const [connectionIntents, setConnectionIntents] = useState<AgentConnectionIntent[]>([]);
  const [pairings, setPairings] = useState<AgentPairing[]>([]);
  const [integrations, setIntegrations] = useState<AgentIntegration[]>([]);
  const [publishingPolicies, setPublishingPolicies] = useState<PublishingPolicy[]>([]);
  const [reveal, setReveal] = useState<ConnectionReveal | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [connectionClock, setConnectionClock] = useState(() => Date.now());
  const [manualConnectionMessage, setManualConnectionMessage] = useState<string | null>(null);
  const [manualConnectionUrl, setManualConnectionUrl] = useState<string | null>(null);
  const [selectedHostId, setSelectedHostId] = useState<TokenlessHostId | null>(null);
  const [expandedLegacyPairingId, setExpandedLegacyPairingId] = useState<string | null>(null);
  const [showConnectionManagement, setShowConnectionManagement] = useState(false);
  const manualMessageRef = useRef<HTMLTextAreaElement>(null);

  const loadConnectionState = useCallback(
    async (selectedWorkspaceId: string, signal?: AbortSignal) => {
      if (!selectedWorkspaceId) {
        setConnectionIntents([]);
        setPairings([]);
        setIntegrations([]);
        setPublishingPolicies([]);
        onConnectionStateChange?.(false);
        return;
      }
      const base = `/api/account/workspaces/${encodeURIComponent(selectedWorkspaceId)}`;
      const [intentBody, pairingBody, integrationBody, policyBody] = await Promise.all([
        readJson(await fetch(`${base}/agent-connections`, { cache: "no-store", credentials: "same-origin", signal })),
        readJson(await fetch(`${base}/agent-pairings`, { cache: "no-store", credentials: "same-origin", signal })),
        readJson(await fetch(`${base}/agent-integrations`, { cache: "no-store", credentials: "same-origin", signal })),
        readJson(
          await fetch(`${base}/agent-publishing-policies`, { cache: "no-store", credentials: "same-origin", signal }),
        ),
      ]);
      setConnectionIntents(responseList(intentBody, "intents").map(normalizeAgentConnectionIntent));
      setPairings(responseList(pairingBody, "pairings", "sessions").map(normalizeAgentPairing));
      const nextIntegrations = responseList(integrationBody, "integrations").map(normalizeAgentIntegration);
      setIntegrations(nextIntegrations);
      onConnectionStateChange?.(
        nextIntegrations.some(integration =>
          isUsableAgentConnection({
            status: integration.status,
            connectionStatus: integration.connectionStatus,
            expiresAt: integration.credentialExpiresAt,
          }),
        ),
      );
      setPublishingPolicies(
        responseList(policyBody, "policies")
          .map(normalizePublishingPolicy)
          .filter(policy => policy.enabled && !policy.revokedAt),
      );
    },
    [onConnectionStateChange],
  );

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadConnectionState(workspaceId, controller.signal);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Unable to load agent connections.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [loadConnectionState, publishingRevision, workspaceId]);

  useEffect(() => {
    setSelectedHostId(loadAgentConnectionHostChoice(workspaceId));
  }, [workspaceId]);

  function selectConnectionHost(hostId: TokenlessHostId | null) {
    setSelectedHostId(hostId);
    saveAgentConnectionHostChoice(workspaceId, hostId);
    if (manualConnectionUrl) {
      setManualConnectionMessage(connectionMessageForHost(manualConnectionUrl, hostId));
    }
  }

  const shouldPoll =
    connectionIntents.some(intent => isActiveAgentConnectionIntent(intent, connectionClock)) ||
    pairings.some(pairing => isPendingAgentPairing(pairing, connectionClock));

  useEffect(() => {
    if (!workspaceId || !shouldPoll) return;
    let timer: number | null = null;
    let stopped = false;
    let failures = 0;

    const schedule = (delay: number) => {
      timer = window.setTimeout(() => void refresh(), delay);
    };
    const refresh = async () => {
      if (stopped) return;
      if (document.visibilityState !== "visible") return;
      try {
        await loadConnectionState(workspaceId);
        failures = 0;
        setConnectionClock(Date.now());
      } catch {
        failures += 1;
        setError("Connection status could not refresh. RateLoop will retry while this page is visible.");
      }
      if (!stopped && document.visibilityState === "visible") {
        schedule(Math.min(PAIRING_POLL_INTERVAL_MS * Math.max(1, failures), PAIRING_HIDDEN_POLL_INTERVAL_MS));
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible" || stopped) return;
      if (timer !== null) window.clearTimeout(timer);
      schedule(0);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    if (document.visibilityState === "visible") schedule(PAIRING_POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [loadConnectionState, shouldPoll, workspaceId]);

  async function copyConnectionMessage(reconnectIntegrationId?: string) {
    if (!workspaceId) return;
    setBusyAction("create-intent");
    setManualConnectionMessage(null);
    setManualConnectionUrl(null);
    setError(null);
    setStatus(null);
    try {
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-connections`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reconnectIntegrationId ? { reconnectIntegrationId } : {}),
        }),
      );
      const connectionUrl = stringField(body, "connectionUrl");
      if (!connectionUrl) throw new Error("RateLoop did not return a connection URL.");
      const message = connectionMessageForHost(connectionUrl, selectedHostId);
      setManualConnectionUrl(connectionUrl);
      setManualConnectionMessage(message);
      let copied = false;
      try {
        await navigator.clipboard.writeText(message);
        copied = true;
        setStatus(
          reconnectIntegrationId
            ? "Reconnect message copied. Paste it once into the same agent task."
            : "Connection message copied. Paste it once into the agent chat you want to connect.",
        );
        notifications.success("Connection message copied to clipboard.");
        void fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-connections/onboarding-events`, {
          method: "POST",
          body: JSON.stringify({ event: "connection_message_copied" }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        setError("Clipboard access was denied. The complete message is selected below for one manual copy.");
        notifications.error("Clipboard access was blocked. The connection message is selected for manual copying.");
        window.requestAnimationFrame(() => {
          manualMessageRef.current?.focus();
          manualMessageRef.current?.select();
        });
      }
      try {
        await loadConnectionState(workspaceId);
      } catch {
        if (copied) {
          setError("The message was copied, but live status could not refresh yet. The connection can still continue.");
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the connection message.");
    } finally {
      setBusyAction(null);
    }
  }

  async function copyVisibleConnectionMessage() {
    if (!manualConnectionMessage) return;
    try {
      await navigator.clipboard.writeText(manualConnectionMessage);
      setStatus("Connection message copied. Paste it once into the agent chat you want to connect.");
      notifications.success("Connection message copied to clipboard.");
      void fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-connections/onboarding-events`, {
        method: "POST",
        body: JSON.stringify({ event: "connection_message_copied" }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      setError("Clipboard access was denied. The complete message is selected below for manual copying.");
      notifications.error("Clipboard access was blocked. The connection message is selected for manual copying.");
      manualMessageRef.current?.focus();
      manualMessageRef.current?.select();
    }
  }

  async function cancelConnectionIntent(intentId: string) {
    if (!window.confirm("Cancel this connection attempt? Its original message will stop working.")) return;
    setBusyAction(`cancel-intent:${intentId}`);
    setError(null);
    setStatus(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-connections/${encodeURIComponent(intentId)}`,
          { method: "DELETE", credentials: "same-origin" },
        ),
      );
      await loadConnectionState(workspaceId);
      setManualConnectionMessage(null);
      setManualConnectionUrl(null);
      setStatus("Connection attempt cancelled. You can create a new message when ready.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to cancel the connection attempt.");
    } finally {
      setBusyAction(null);
    }
  }

  async function approveWorkspaceMove(intent: AgentConnectionIntent) {
    const move = intent.workspaceMove;
    if (!move || move.status !== "owner_approval_required") return;
    if (
      !window.confirm(
        "Reconnect this agent here? Its current RateLoop workspace connection will stop, and this agent's previous credential will be replaced.",
      )
    )
      return;
    setBusyAction(`approve-move:${move.transferId}`);
    setError(null);
    setStatus(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-connection-moves/${encodeURIComponent(move.transferId)}/approve`,
          {
            method: "POST",
            body: JSON.stringify({ decision: "approve" }),
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
      await loadConnectionState(workspaceId);
      setStatus("Reconnect approved. Return to the same agent task; it can now finish automatically.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to approve the reconnect.");
    } finally {
      setBusyAction(null);
    }
  }

  async function retryConnectionStatus() {
    setBusyAction("refresh-intents");
    setError(null);
    try {
      await loadConnectionState(workspaceId);
      setConnectionClock(Date.now());
      setStatus("Connection status refreshed. The agent can keep using the original message.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to refresh connection status.");
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
      onAgentApproved?.();
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
    if (!window.confirm(`Disconnect ${integration.agentDisplayName || integration.agentId} from RateLoop?`)) return;
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
      setStatus("Agent disconnected.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to revoke the agent connection.");
    } finally {
      setBusyAction(null);
    }
  }

  async function recoverOAuthIntegration(integration: AgentIntegration) {
    setBusyAction(`recover-oauth:${integration.integrationId}`);
    setError(null);
    setStatus(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-integrations/${encodeURIComponent(integration.integrationId)}/recover-oauth`,
          { method: "POST", credentials: "same-origin" },
        ),
      );
      await loadConnectionState(workspaceId);
      setStatus("Codex connection restored. The agent can resume with its existing credential.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to restore the OAuth connection.");
    } finally {
      setBusyAction(null);
    }
  }

  async function copyReveal() {
    if (!reveal) return;
    try {
      await navigator.clipboard.writeText(reveal.secret);
      setStatus("Legacy credential copied. Store it only in the existing agent host's secure credential setting.");
      notifications.success("Legacy credential copied to clipboard.");
    } catch {
      setError("Clipboard access was denied. Copy the legacy credential manually from the one-time reveal.");
      notifications.error("Clipboard access was blocked. Copy the legacy credential manually.");
    }
  }

  const activeConnectionIntents = connectionIntents.filter(intent =>
    isActiveAgentConnectionIntent(intent, connectionClock),
  );
  const activePairings = pairings.filter(pairing => isPendingAgentPairing(pairing, connectionClock));
  const activeIntegrations = integrations.filter(integration =>
    isUsableAgentConnection(
      {
        status: integration.status,
        connectionStatus: integration.connectionStatus,
        expiresAt: integration.credentialExpiresAt,
      },
      connectionClock,
    ),
  );
  const isFreshWorkspace =
    !loading && activeConnectionIntents.length === 0 && activePairings.length === 0 && activeIntegrations.length === 0;
  const connectionHistory = useMemo<AgentConnectionHistoryEntry[]>(
    () => [
      ...connectionIntents
        .filter(intent => !isActiveAgentConnectionIntent(intent, connectionClock))
        .map(intent => ({
          eventId: `connection-intent:${intent.intentId}`,
          clientName: intent.clientName || "Agent connection",
          status:
            intent.status === "connected" ||
            !intent.hardExpiresAt ||
            new Date(intent.hardExpiresAt).getTime() > connectionClock
              ? intent.status
              : "expired",
          occurredAt: intent.lastTransitionAt ?? intent.createdAt,
          legacy: false,
        })),
      ...pairings
        .filter(pairing => !isPendingAgentPairing(pairing, connectionClock))
        .map(pairing => {
          const expired =
            (pairing.status === "open" || pairing.status === "claimed") &&
            pairing.expiresAt &&
            new Date(pairing.expiresAt).getTime() <= connectionClock;
          const status = expired ? "expired" : pairing.status;
          return {
            eventId: `legacy-pairing:${pairing.pairingId}`,
            clientName: pairing.displayName || pairing.clientName || "Agent connection",
            status,
            occurredAt:
              (status === "approved" ? pairing.approvedAt : null) ??
              (status === "rejected" ? pairing.rejectedAt : null) ??
              (status === "expired" ? pairing.expiresAt : null) ??
              pairing.createdAt,
            legacy: true,
          };
        }),
    ],
    [connectionClock, connectionIntents, pairings],
  );

  useEffect(() => {
    onConnectionHistoryChange?.(connectionHistory);
  }, [connectionHistory, onConnectionHistoryChange]);

  return (
    <div className="space-y-5">
      {isFreshWorkspace ? (
        <Card as="section" className="rounded-2xl p-6">
          <div>
            <h2 className="text-2xl font-semibold">Connect your agent</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-base-content/60">
              Copy one message into the agent chat you want to connect.
            </p>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={!workspaceId || loading || Boolean(busyAction) || activeConnectionIntents.length > 0}
              onClick={() => void copyConnectionMessage()}
            >
              {busyAction === "create-intent" ? "Creating and copying…" : "Copy connection message"}
            </Button>
            <InfoPopover label="About safe agent access">
              This creates safe access. The agent cannot spend, publish, read private workspace content, or change
              workspace settings.
            </InfoPopover>
          </div>
          {status ? (
            <p role="status" aria-live="polite" className="mt-4 text-sm text-emerald-100">
              {status}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100">
              {error}
            </p>
          ) : null}
          <AgentConnectionHostPicker selectedHostId={selectedHostId} onSelectHost={selectConnectionHost} />
        </Card>
      ) : null}

      {!isFreshWorkspace && status ? (
        <p role="status" aria-live="polite" className="rounded-lg bg-emerald-300/10 p-3 text-sm text-emerald-100">
          {status}
        </p>
      ) : null}
      {!isFreshWorkspace && error ? (
        <p role="alert" className="rounded-lg bg-red-400/10 p-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}

      {manualConnectionMessage ? (
        <Card as="section" className="rounded-2xl p-5" aria-labelledby="manual-agent-message-heading">
          <h3 id="manual-agent-message-heading" className="font-semibold">
            Connection message
          </h3>
          <p id="manual-agent-message-help" className="mt-2 text-sm leading-6 text-base-content/60">
            Review or copy the complete message below, then paste it once into the intended agent chat.
          </p>
          <textarea
            ref={manualMessageRef}
            className="textarea mt-4 min-h-32 w-full border-white/10 bg-[var(--rateloop-field)] font-mono text-xs leading-5"
            aria-describedby="manual-agent-message-help"
            readOnly
            value={manualConnectionMessage}
            onFocus={event => event.currentTarget.select()}
          />
          <div className="mt-3 flex flex-wrap gap-3">
            <Button type="button" size="sm" variant="secondary" onClick={() => void copyVisibleConnectionMessage()}>
              Copy message
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setManualConnectionMessage(null);
                setManualConnectionUrl(null);
              }}
            >
              Hide message
            </Button>
          </div>
          <AgentConnectionTroubleshooting />
        </Card>
      ) : null}

      {reveal ? (
        <section
          className="rounded-2xl border border-warning/35 bg-warning/10 p-5"
          aria-labelledby="legacy-agent-credential-heading"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 id="legacy-agent-credential-heading" className="font-semibold">
                {reveal.title}
              </h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/65">
                This is a one-time compatibility reveal for an existing legacy integration. Store it directly in that
                host&apos;s secure credential setting; do not paste it into a model chat.
              </p>
            </div>
            <button type="button" className="btn btn-sm rateloop-secondary-action" onClick={() => void copyReveal()}>
              Copy legacy credential
            </button>
          </div>
          <dl className="mt-4 space-y-3 rounded-lg bg-black/30 p-4 font-mono text-xs">
            <div>
              <dt className="text-base-content/45">MCP URL</dt>
              <dd className="mt-1 break-all">{reveal.mcpUrl}</dd>
            </div>
            <div>
              <dt className="text-base-content/45">Legacy bearer credential</dt>
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

      <AsyncSection loading={loading} loadingLabel="Loading agent connections">
        {null}
      </AsyncSection>

      {!loading && workspaceId && activeConnectionIntents.length > 0 ? (
        <section className="surface-card rounded-2xl p-6" aria-labelledby="pending-agent-connections-heading">
          <div className="space-y-4">
            {connectionIntents
              .filter(intent => isActiveAgentConnectionIntent(intent, connectionClock))
              .slice(0, 1)
              .map(intent => {
                const move = intent.workspaceMove;
                const copy =
                  move?.status === "source_confirmation_required"
                    ? {
                        heading: "Confirm the reconnect in your agent",
                        detail: "Return to the same agent task and confirm moving its RateLoop connection.",
                      }
                    : move?.status === "owner_approval_required"
                      ? {
                          heading: "Approve reconnecting this agent",
                          detail: "The agent confirmed the move. Approve it here to keep this agent's settings.",
                        }
                      : connectionIntentCopy(intent.status);
                const recoveryAction = intent.recoveryAction;
                return (
                  <article key={intent.intentId}>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 id="pending-agent-connections-heading" className="text-xl font-semibold">
                            {copy.heading}
                          </h2>
                          <span className="badge badge-ghost font-mono text-xs">{intent.status}</span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-base-content/55">{copy.detail}</p>
                        {move ? (
                          <p className="mt-4 max-w-3xl rounded-xl border border-amber-300/25 bg-amber-300/[0.07] p-4 text-sm leading-6 text-amber-50/85">
                            This disconnects that Codex credential from its current RateLoop workspace and replaces this
                            agent&apos;s previous connection. This agent&apos;s review and publishing settings stay
                            unchanged.
                          </p>
                        ) : null}
                        {recoveryAction ? (
                          <div
                            className="mt-4 rounded-xl border border-amber-300/25 bg-amber-300/[0.07] p-4"
                            role="alert"
                          >
                            <p className="text-sm font-semibold text-amber-100">Resolve this connection</p>
                            <p className="mt-1 text-sm leading-6 text-amber-50/80">{recoveryAction}</p>
                          </div>
                        ) : !move ? (
                          <p className="mt-2 text-sm text-base-content/55">You can close this page.</p>
                        ) : null}
                        {(intent.clientName || intent.clientVersion) && (
                          <p className="mt-2 text-xs text-base-content/45">
                            {intent.clientName || "Agent host"}
                            {intent.clientVersion ? ` ${intent.clientVersion}` : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                        <time className="text-xs text-base-content/45" dateTime={intent.hardExpiresAt ?? undefined}>
                          Finishes by {formatTimestamp(intent.hardExpiresAt, "soon")}
                        </time>
                        <div className="flex flex-wrap gap-2">
                          {move?.status === "owner_approval_required" ? (
                            <Button
                              type="button"
                              size="sm"
                              disabled={Boolean(busyAction)}
                              onClick={() => void approveWorkspaceMove(intent)}
                            >
                              {busyAction === `approve-move:${move.transferId}` ? "Approving…" : "Approve reconnect"}
                            </Button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-sm rateloop-secondary-action"
                            disabled={Boolean(busyAction)}
                            onClick={() => void retryConnectionStatus()}
                          >
                            {busyAction === "refresh-intents" ? "Checking…" : "Check status"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm rateloop-secondary-action"
                            disabled={Boolean(busyAction)}
                            onClick={() => void cancelConnectionIntent(intent.intentId)}
                          >
                            {busyAction === `cancel-intent:${intent.intentId}` ? "Cancelling…" : "Cancel attempt"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
          </div>
        </section>
      ) : null}

      {!loading && workspaceId && activePairings.length > 0 ? (
        <section
          className="surface-card rounded-2xl border border-warning/25 p-6"
          aria-labelledby="legacy-pairing-actions-heading"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="legacy-pairing-actions-heading" className="text-xl font-semibold">
              Legacy connection needs attention
            </h2>
            <Badge variant="warning">{activePairings.length} action needed</Badge>
          </div>
          <p className="mt-3 text-sm leading-6 text-base-content/55">
            These requests were created by the retired bearer-pairing flow. Finish or reject them here; new connections
            use the one-message OAuth flow above.
          </p>
          <div className="mt-5 space-y-4">
            {activePairings.map(pairing =>
              pairing.status === "claimed" ? (
                expandedLegacyPairingId === pairing.pairingId ? (
                  <div key={pairing.pairingId}>
                    <div className="mb-3 flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setExpandedLegacyPairingId(null)}
                      >
                        Cancel review
                      </Button>
                    </div>
                    <PairingApprovalCard
                      pairing={pairing}
                      policies={publishingPolicies}
                      busy={
                        busyAction === `approve:${pairing.pairingId}` || busyAction === `reject:${pairing.pairingId}`
                      }
                      onApprove={payload => approvePairing(pairing.pairingId, payload)}
                      onReject={() => rejectPairing(pairing.pairingId)}
                    />
                  </div>
                ) : (
                  <article key={pairing.pairingId} className="surface-card-nested rounded-xl p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="font-semibold">
                          {pairing.displayName || pairing.clientName || "Agent"} is waiting for approval
                        </h3>
                        <p className="mt-1 text-sm text-base-content/55">
                          Verify its identity, workflows, and publishing policy before activation.
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setExpandedLegacyPairingId(pairing.pairingId)}
                      >
                        Review legacy approval
                      </Button>
                    </div>
                  </article>
                )
              ) : (
                <article key={pairing.pairingId} className="surface-card-nested rounded-xl p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h4 className="font-semibold">Waiting for legacy agent metadata</h4>
                      <p className="mt-1 text-sm text-base-content/55">Cancel if this request is no longer needed.</p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm rateloop-secondary-action"
                      disabled={busyAction === `reject:${pairing.pairingId}`}
                      onClick={() => void rejectPairing(pairing.pairingId)}
                    >
                      Cancel legacy request
                    </button>
                  </div>
                </article>
              ),
            )}
          </div>
        </section>
      ) : null}

      {!loading && workspaceId && activeIntegrations.length > 0 ? (
        <section className="surface-card rounded-2xl p-6" aria-labelledby="connected-agents-heading">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="connected-agents-heading" className="text-xl font-semibold">
                {activeIntegrations.length === 1
                  ? `${activeIntegrations[0].agentDisplayName || "Agent"} connected`
                  : `${activeIntegrations.length} agents connected`}
              </h2>
              <p className="mt-2 text-sm leading-6 text-base-content/55">
                Safe access · No spending or private workspace content
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {activeIntegrations.length === 1 && !activeIntegrations[0].apiKeyId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={Boolean(busyAction) || activeConnectionIntents.length > 0}
                  onClick={() => void copyConnectionMessage(activeIntegrations[0].integrationId)}
                >
                  {busyAction === "create-intent" ? "Creating…" : "Reconnect"}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                aria-controls="connected-agent-management"
                aria-expanded={showConnectionManagement}
                onClick={() => setShowConnectionManagement(current => !current)}
              >
                {showConnectionManagement ? "Done" : "Manage connected agents"}
              </Button>
            </div>
          </div>
          {activeIntegrations
            .filter(integration => integration.oauthRecoveryAvailable)
            .map(integration => (
              <div
                key={`oauth-recovery:${integration.integrationId}`}
                className="mt-5 flex flex-col gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">{integration.agentDisplayName || "Codex"} needs its connection restored</p>
                  <p className="mt-1 text-sm text-base-content/60">
                    This revokes its current access tokens and restores the existing safe OAuth credential.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={Boolean(busyAction)}
                  onClick={() => void recoverOAuthIntegration(integration)}
                >
                  {busyAction === `recover-oauth:${integration.integrationId}` ? "Restoring…" : "Restore connection"}
                </Button>
              </div>
            ))}
          {showConnectionManagement ? (
            <div id="connected-agent-management" className="mt-5 space-y-4">
              {activeIntegrations.map(integration => {
                const active = integration.status === "active";
                const legacyCredential = Boolean(integration.apiKeyId);
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
                          <span className="badge badge-ghost">
                            {legacyCredential ? "legacy credential" : "safe OAuth"}
                          </span>
                        </div>
                      </div>
                      {active ? (
                        <div className="flex flex-wrap gap-2">
                          {legacyCredential ? (
                            <button
                              type="button"
                              className="btn btn-sm rateloop-secondary-action"
                              disabled={Boolean(busyAction)}
                              onClick={() => void rotateIntegration(integration)}
                            >
                              Rotate legacy credential
                            </button>
                          ) : null}
                          {!legacyCredential && activeIntegrations.length > 1 ? (
                            <button
                              type="button"
                              className="btn btn-sm rateloop-secondary-action"
                              disabled={Boolean(busyAction) || activeConnectionIntents.length > 0}
                              onClick={() => void copyConnectionMessage(integration.integrationId)}
                            >
                              Reconnect
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost text-error"
                            disabled={Boolean(busyAction)}
                            onClick={() => void revokeIntegration(integration)}
                          >
                            Disconnect
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <details className="mt-4 border-t border-white/10 pt-4">
                      <summary className="cursor-pointer text-sm font-medium text-base-content/65">
                        Connection details
                      </summary>
                      <div className="mt-3">
                        <p className="font-mono text-xs text-base-content/40">{integration.integrationId}</p>
                        <p className="mt-2 text-sm text-base-content/60">
                          {integration.clientName || "Unknown client"}
                          {integration.clientVersion ? ` ${integration.clientVersion}` : ""}
                        </p>
                        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                          <div>
                            <dt className="text-xs text-base-content/45">Last seen</dt>
                            <dd className="mt-1">{formatTimestamp(integration.lastSeenAt, "Never connected")}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-base-content/45">
                              {legacyCredential ? "Credential expiry" : "Access"}
                            </dt>
                            <dd className="mt-1">
                              {legacyCredential
                                ? formatTimestamp(integration.credentialExpiresAt, "No expiry")
                                : "OAuth-managed safe access"}
                            </dd>
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
                              {integration.publishingPolicyName ||
                                integration.publishingPolicyId ||
                                "No publishing access"}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    </details>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
