"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InfoPopover } from "../InfoPopover";
import {
  AgentConnectionHostPicker,
  loadAgentConnectionHostChoice,
  saveAgentConnectionHostChoice,
} from "./AgentConnectionHostPicker";
import { AgentConnectionTroubleshooting } from "./AgentConnectionTroubleshooting";
import { AgentText } from "./AgentText";
import { useAgentFormatter, useAgentTranslations } from "./AgentsLocaleProvider";
import type { AgentConnectionHistoryEntry } from "./agentAuditHistory";
import { buildAgentConnectionMessage, buildAgentConnectionMessageForHost } from "./agentConnectionMessage";
import { connectionStatusLabel, enforcementModeLabel } from "./agentPresentation";
import { canStartAgentConnection, selectReconnectableOAuthConnections } from "./agentWorkspaceState";
import { useLocalizedReviewPolicyCopy } from "./reviewPolicyCopy";
import { Field, SelectField, TextareaField } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { Badge } from "~~/components/tokenless/ui/Badge";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { ConfirmDialog } from "~~/components/tokenless/ui/ConfirmDialog";
import {
  type AgentAccessPresentation,
  hasActiveAgentAccess,
  normalizeAgentAccessPresentation,
} from "~~/lib/tokenless/agentAccessPresentation";
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
  oauthClientId: string;
  access: AgentAccessPresentation;
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

type PendingConnectionConfirmation =
  | { kind: "cancel-intent"; intentId: string }
  | { kind: "approve-workspace-move"; intent: AgentConnectionIntent }
  | { kind: "reject-pairing"; pairingId: string }
  | { kind: "rotate-integration"; integration: AgentIntegration }
  | { kind: "revoke-integration"; integration: AgentIntegration };

type AgentTranslate = (key: string, values?: Record<string, number | string>) => string;

function confirmationCopy(confirmation: PendingConnectionConfirmation, t: AgentTranslate) {
  if (confirmation.kind === "cancel-intent") {
    return {
      title: t("cancelTitle"),
      description: t("cancelDescription"),
      confirmLabel: t("cancelAttempt"),
    };
  }
  if (confirmation.kind === "approve-workspace-move") {
    return {
      title: t("reconnectTitle"),
      description: t("reconnectDescription"),
      confirmLabel: t("approveReconnect"),
    };
  }
  if (confirmation.kind === "reject-pairing") {
    return {
      title: t("rejectTitle"),
      description: t("rejectDescription"),
      confirmLabel: t("rejectRequest"),
    };
  }
  if (confirmation.kind === "rotate-integration") {
    const name = confirmation.integration.agentDisplayName || confirmation.integration.agentId;
    return {
      title: t("rotateTitle", { name }),
      description: t("rotateDescription"),
      confirmLabel: t("rotateCredential"),
    };
  }
  const name = confirmation.integration.agentDisplayName || confirmation.integration.agentId;
  return {
    title: t("disconnectTitle", { name }),
    description: t("disconnectDescription"),
    confirmLabel: t("disconnect"),
  };
}

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
    oauthClientId: stringField(row, "oauthClientId"),
    access: normalizeAgentAccessPresentation(row.access),
  };
}

export function normalizeAgentConnectionIntent(
  value: unknown,
  fallbackSummary = "Can check when human review is needed. Cannot spend, publish, read private files, or administer the workspace.",
): AgentConnectionIntent {
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
      summary: stringField(profile, "summary") || fallbackSummary,
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

function normalizePublishingPolicy(value: unknown, unnamedPolicy = "Unnamed policy"): PublishingPolicy {
  const row = record(value);
  return {
    policyId: stringField(row, "policyId", "id"),
    name: stringField(row, "name") || unnamedPolicy,
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

function connectionIntentCopy(status: ConnectionIntentStatus, t: AgentTranslate) {
  switch (status) {
    case "issued":
      return { heading: t("intentIssuedTitle"), detail: t("intentIssuedDescription") };
    case "install_required":
      return {
        heading: t("intentInstallTitle"),
        detail: t("intentInstallDescription"),
      };
    case "authorizing":
      return {
        heading: t("intentAuthorizingTitle"),
        detail: t("intentAuthorizingDescription"),
      };
    case "approval_required":
      return {
        heading: t("intentApprovalTitle"),
        detail: t("intentApprovalDescription"),
      };
    case "testing":
      return { heading: t("intentTestingTitle"), detail: t("intentTestingDescription") };
    case "action_required":
      return {
        heading: t("intentActionTitle"),
        detail: t("intentActionDescription"),
      };
    case "connected":
      return {
        heading: t("intentConnectedTitle"),
        detail: t("intentConnectedDescription"),
      };
    default:
      return { heading: t("intentEndedTitle"), detail: t("intentEndedDescription") };
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
  const format = useAgentFormatter();
  const t = useAgentTranslations("connection");
  const errors = useAgentTranslations("errors");
  const policyCopy = useLocalizedReviewPolicyCopy();
  const [externalId, setExternalId] = useState(pairing.externalId);
  const [displayName, setDisplayName] = useState(pairing.displayName);
  const [description, setDescription] = useState(pairing.description);
  const [declaredProvider, setDeclaredProvider] = useState(pairing.declaredProvider);
  const [declaredModel, setDeclaredModel] = useState(pairing.declaredModel);
  const [declaredModelVersion, setDeclaredModelVersion] = useState(pairing.declaredModelVersion);
  const [environment, setEnvironment] = useState(pairing.environment);
  const [selectedPublishingPolicyId, setSelectedPublishingPolicyId] = useState("");
  const [allowedWorkflows, setAllowedWorkflows] = useState(pairing.requestedWorkflowKeys.join(", "));
  const { capture, clear, fieldErrors, formError } = useFormErrors();
  const publishingPolicyId = policies.some(policy => policy.policyId === selectedPublishingPolicyId)
    ? selectedPublishingPolicyId
    : (policies[0]?.policyId ?? "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clear();
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
    } catch {
      capture(errors("approveAgent"), errors("approveAgent"));
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
            <h4 className="font-semibold">{t("waitingApproval")}</h4>
            <Badge variant="warning">{t("declaredMetadata")}</Badge>
          </div>
          <p className="mt-2 text-sm text-base-content/60">
            {pairing.clientName || t("unknownMcpClient")}
            {pairing.clientVersion ? ` ${pairing.clientVersion}` : ""} <AgentText id="translated001" />
          </p>
          {pairing.requestedWorkflowKeys.length > 0 ? (
            <p className="mt-2 text-xs text-base-content/55">
              <AgentText id="translated002" /> {pairing.requestedWorkflowKeys.join(", ")}
            </p>
          ) : null}
        </div>
        <time className="font-mono text-xs text-base-content/55" dateTime={pairing.expiresAt ?? undefined}>
          {t("expires", {
            date: pairing.expiresAt
              ? format.dateTime(new Date(pairing.expiresAt), { dateStyle: "medium", timeStyle: "short" })
              : t("soon"),
          })}
        </time>
      </div>

      <fieldset className="mt-5">
        <legend className="text-sm font-semibold">{t("confirmIdentity")}</legend>
        <p className="mt-1 text-xs leading-5 text-base-content/55">
          <AgentText id="translated003" />
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field
            label={t("displayName")}
            className="border-base-content/10 bg-[var(--rateloop-field)]"
            value={displayName}
            error={fieldErrors.displayName}
            onChange={event => {
              clear("displayName");
              setDisplayName(event.target.value);
            }}
            maxLength={120}
            required
          />
          <Field
            label={t("externalId")}
            className="border-base-content/10 bg-[var(--rateloop-field)] font-mono text-xs"
            value={externalId}
            error={fieldErrors.externalId}
            onChange={event => {
              clear("externalId");
              setExternalId(event.target.value);
            }}
            maxLength={160}
            required
          />
          <Field
            label={t("provider")}
            className="border-base-content/10 bg-[var(--rateloop-field)]"
            value={declaredProvider}
            error={fieldErrors.provider}
            onChange={event => {
              clear("provider");
              setDeclaredProvider(event.target.value);
            }}
            maxLength={120}
            required
          />
          <Field
            label={t("model")}
            className="border-base-content/10 bg-[var(--rateloop-field)]"
            value={declaredModel}
            error={fieldErrors.model}
            onChange={event => {
              clear("model");
              setDeclaredModel(event.target.value);
            }}
            maxLength={160}
            required
          />
          <Field
            label={t("modelVersion")}
            className="border-base-content/10 bg-[var(--rateloop-field)]"
            value={declaredModelVersion}
            error={fieldErrors.modelVersion}
            onChange={event => {
              clear("modelVersion");
              setDeclaredModelVersion(event.target.value);
            }}
            maxLength={160}
          />
          <SelectField
            label={t("environment")}
            className="border-base-content/10 bg-[var(--rateloop-field)]"
            value={environment}
            error={fieldErrors.environment}
            onChange={event => {
              clear("environment");
              setEnvironment(event.target.value as AgentPairing["environment"]);
            }}
          >
            <option value="staging">{t("staging")}</option>
            <option value="production">{t("production")}</option>
          </SelectField>
          <div className="md:col-span-2">
            <TextareaField
              label={t("descriptionField")}
              className="min-h-24 border-base-content/10 bg-[var(--rateloop-field)]"
              value={description}
              error={fieldErrors.description}
              onChange={event => {
                clear("description");
                setDescription(event.target.value);
              }}
              maxLength={1_000}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="mt-6 border-t border-base-content/10 pt-5">
        <legend className="text-sm font-semibold">{t("controls")}</legend>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <SelectField
            label={t("policy")}
            className="border-base-content/10 bg-[var(--rateloop-field)]"
            value={publishingPolicyId}
            error={fieldErrors.publishingPolicyId}
            onChange={event => {
              clear("publishingPolicyId");
              setSelectedPublishingPolicyId(event.target.value);
            }}
            required
          >
            <option value="" disabled>
              <AgentText id="translated004" />
            </option>
            {policies.map(policy => (
              <option key={policy.policyId} value={policy.policyId}>
                {policy.name} · v{policy.version}
              </option>
            ))}
          </SelectField>
          <Field
            label={t("workflows")}
            className="border-base-content/10 bg-[var(--rateloop-field)]"
            value={allowedWorkflows}
            error={fieldErrors.allowedWorkflowKeys}
            hint={t("workflowsHint")}
            onChange={event => {
              clear("allowedWorkflowKeys");
              setAllowedWorkflows(event.target.value);
            }}
            placeholder="review.copy, review.code"
            required
          />
        </div>
        <div className="mt-4 flex items-center gap-2 text-xs text-base-content/60">
          <span>{policyCopy.limits.adaptiveSummary}</span>
          <InfoPopover label={t("adaptivePreset")}>{policyCopy.limits.adaptiveConnectionHelp}</InfoPopover>
        </div>
      </fieldset>

      {policies.length === 0 ? (
        <p className="mt-4 rounded-lg bg-warning/10 p-3 text-sm text-warning">
          <AgentText id="translated005" />
        </p>
      ) : null}
      {formError ? (
        <p className="mt-4 rounded-lg bg-error/10 p-3 text-sm text-error" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="submit" className="rateloop-gradient-action px-5" disabled={busy || !publishingPolicyId}>
          {busy ? t("approving") : t("approveActivate")}
        </button>
        <button
          type="button"
          className="btn border border-error/20 bg-error/[0.06] text-error"
          disabled={busy}
          onClick={() => void onReject()}
        >
          {t("rejectRequest")}
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
  const format = useAgentFormatter();
  const t = useAgentTranslations("connection");
  const errors = useAgentTranslations("errors");
  const presentation = useAgentTranslations("presentation");
  const statusCopy = useAgentTranslations("status");
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
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConnectionConfirmation | null>(null);
  const manualMessageRef = useRef<HTMLTextAreaElement>(null);
  const actionFeedbackRef = useRef<HTMLParagraphElement>(null);
  const focusFeedbackAfterConfirmationRef = useRef(false);

  // Every poll used to re-announce the same connection state, and the parent treats each
  // announcement as a change: an expanded "Audit history" panel collapsed every five seconds while
  // a connection was pending. Announce only real transitions, per workspace.
  const reportedConnectionState = useRef<{ workspaceId: string; connected: boolean } | null>(null);
  const reportConnectionState = useCallback(
    (selectedWorkspaceId: string, connected: boolean) => {
      const reported = reportedConnectionState.current;
      if (reported && reported.workspaceId === selectedWorkspaceId && reported.connected === connected) return;
      reportedConnectionState.current = { workspaceId: selectedWorkspaceId, connected };
      onConnectionStateChange?.(connected);
    },
    [onConnectionStateChange],
  );

  const loadConnectionState = useCallback(
    async (selectedWorkspaceId: string, signal?: AbortSignal) => {
      if (!selectedWorkspaceId) {
        setConnectionIntents([]);
        setPairings([]);
        setIntegrations([]);
        setPublishingPolicies([]);
        reportConnectionState(selectedWorkspaceId, false);
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
      setConnectionIntents(
        responseList(intentBody, "intents").map(value => normalizeAgentConnectionIntent(value, t("safeSummary"))),
      );
      setPairings(responseList(pairingBody, "pairings", "sessions").map(normalizeAgentPairing));
      const nextIntegrations = responseList(integrationBody, "integrations").map(normalizeAgentIntegration);
      setIntegrations(nextIntegrations);
      reportConnectionState(
        selectedWorkspaceId,
        nextIntegrations.some(integration => hasActiveAgentAccess(integration.access)),
      );
      setPublishingPolicies(
        responseList(policyBody, "policies")
          .map(value => normalizePublishingPolicy(value, t("unnamedPolicy")))
          .filter(policy => policy.enabled && !policy.revokedAt),
      );
    },
    [reportConnectionState, t],
  );

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadConnectionState(workspaceId, controller.signal);
      } catch {
        if (!controller.signal.aborted) {
          setError(errors("loadConnections"));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [errors, loadConnectionState, publishingRevision, workspaceId]);

  useEffect(() => {
    setSelectedHostId(loadAgentConnectionHostChoice(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    if (pendingConfirmation !== null || !focusFeedbackAfterConfirmationRef.current) return;
    focusFeedbackAfterConfirmationRef.current = false;
    actionFeedbackRef.current?.focus({ preventScroll: true });
  }, [pendingConfirmation]);

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
        // A recovered blip must clear its own banner, or a red "could not refresh" sits beside the
        // green "Connected" state until the page is reloaded.
        setError(null);
        setConnectionClock(Date.now());
      } catch {
        failures += 1;
        setError(errors("refreshConnection"));
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
  }, [errors, loadConnectionState, shouldPoll, workspaceId]);

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
        setStatus(reconnectIntegrationId ? t("reconnectCopied") : t("connectionCopied"));
        void fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-connections/onboarding-events`, {
          method: "POST",
          body: JSON.stringify({ event: "connection_message_copied" }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        setError(errors("clipboardSelected"));
        window.requestAnimationFrame(() => {
          manualMessageRef.current?.focus();
          manualMessageRef.current?.select();
        });
      }
      try {
        await loadConnectionState(workspaceId);
      } catch {
        if (copied) {
          setError(errors("copiedRefresh"));
        }
      }
    } catch {
      setError(errors("createConnection"));
    } finally {
      setBusyAction(null);
    }
  }

  async function copyVisibleConnectionMessage() {
    if (!manualConnectionMessage) return;
    try {
      await navigator.clipboard.writeText(manualConnectionMessage);
      setError(null);
      setStatus(statusCopy("connectionCopied"));
      void fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/agent-connections/onboarding-events`, {
        method: "POST",
        body: JSON.stringify({ event: "connection_message_copied" }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      setError(errors("clipboardSelected"));
      manualMessageRef.current?.focus();
      manualMessageRef.current?.select();
    }
  }

  async function cancelConnectionIntent(intentId: string) {
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
      setStatus(statusCopy("connectionCancelled"));
    } catch {
      setError(errors("cancelConnection"));
    } finally {
      setBusyAction(null);
    }
  }

  async function approveWorkspaceMove(intent: AgentConnectionIntent) {
    const move = intent.workspaceMove;
    if (!move || move.status !== "owner_approval_required") return;
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
      setStatus(statusCopy("reconnectApproved"));
    } catch {
      setError(errors("approveReconnect"));
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
      setStatus(statusCopy("connectionRefreshed"));
    } catch {
      setError(errors("refreshStatus"));
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
      setStatus(statusCopy("agentApproved"));
    } catch (cause) {
      setError(errors("approveRegistration"));
      throw cause;
    } finally {
      setBusyAction(null);
    }
  }

  async function rejectPairing(pairingId: string) {
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
      setStatus(statusCopy("agentRejected"));
    } catch {
      setError(errors("rejectRegistration"));
    } finally {
      setBusyAction(null);
    }
  }

  async function rotateIntegration(integration: AgentIntegration) {
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
      const nextReveal = revealFromResponse(body, t("rotatedCredential"));
      if (!nextReveal.secret) throw new Error("The server did not return the rotated credential.");
      setReveal(nextReveal);
      await loadConnectionState(workspaceId);
      setStatus(statusCopy("credentialRotated"));
    } catch {
      setError(errors("rotateCredential"));
    } finally {
      setBusyAction(null);
    }
  }

  async function revokeIntegration(integration: AgentIntegration) {
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
      setStatus(statusCopy("agentDisconnected"));
    } catch {
      setError(errors("revokeConnection"));
    } finally {
      setBusyAction(null);
    }
  }

  async function confirmPendingAction() {
    const confirmation = pendingConfirmation;
    if (!confirmation) return;
    try {
      if (confirmation.kind === "cancel-intent") {
        await cancelConnectionIntent(confirmation.intentId);
      } else if (confirmation.kind === "approve-workspace-move") {
        await approveWorkspaceMove(confirmation.intent);
      } else if (confirmation.kind === "reject-pairing") {
        await rejectPairing(confirmation.pairingId);
      } else if (confirmation.kind === "rotate-integration") {
        await rotateIntegration(confirmation.integration);
      } else {
        await revokeIntegration(confirmation.integration);
      }
    } finally {
      focusFeedbackAfterConfirmationRef.current = true;
      setPendingConfirmation(null);
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
      setStatus(statusCopy("oauthRestored"));
    } catch {
      setError(errors("restoreOauth"));
    } finally {
      setBusyAction(null);
    }
  }

  async function copyReveal() {
    if (!reveal) return;
    try {
      await navigator.clipboard.writeText(reveal.secret);
      setStatus(statusCopy("legacyCopied"));
    } catch {
      setError(errors("legacyClipboard"));
    }
  }

  const activeConnectionIntents = connectionIntents.filter(intent =>
    isActiveAgentConnectionIntent(intent, connectionClock),
  );
  const activePairings = pairings.filter(pairing => isPendingAgentPairing(pairing, connectionClock));
  const activeIntegrations = integrations.filter(integration => hasActiveAgentAccess(integration.access));
  const recoveryIntegrations = integrations.filter(
    integration => integration.access.rateLoopAccessState === "recovery_required",
  );
  const managedIntegrations = [...activeIntegrations, ...recoveryIntegrations];
  const anyActiveCanPublish = activeIntegrations.some(integration => integration.access.canPublish);
  const anyActiveCanSpend = activeIntegrations.some(integration => integration.access.canSpend);
  const capabilitySummaryKey = anyActiveCanPublish
    ? anyActiveCanSpend
      ? "accessCanPublishAndSpend"
      : "accessCanPublish"
    : anyActiveCanSpend
      ? "accessCanSpend"
      : "accessCannotPublishOrSpend";
  const reconnectableIntegrations = selectReconnectableOAuthConnections(integrations);
  const showConnectionStart = canStartAgentConnection({
    loading,
    activeConnectionIntentCount: activeConnectionIntents.length,
    activePairingCount: activePairings.length,
  });
  const connectionHistory = useMemo<AgentConnectionHistoryEntry[]>(
    () => [
      ...connectionIntents
        .filter(intent => !isActiveAgentConnectionIntent(intent, connectionClock))
        .map(intent => ({
          eventId: `connection-intent:${intent.intentId}`,
          clientName: intent.clientName || t("agentConnection"),
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
            clientName: pairing.displayName || pairing.clientName || t("agentConnection"),
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
    [connectionClock, connectionIntents, pairings, t],
  );

  useEffect(() => {
    onConnectionHistoryChange?.(connectionHistory);
  }, [connectionHistory, onConnectionHistoryChange]);

  return (
    <div className="space-y-5">
      {showConnectionStart ? (
        <Card as="section" className="rounded-2xl p-6">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-semibold">
              {reconnectableIntegrations.length > 0
                ? t("titleReconnect")
                : activeIntegrations.length > 0
                  ? t("titleAnother")
                  : t("title")}
            </h2>
            {reconnectableIntegrations.length > 0 ? (
              <InfoPopover label={t("aboutReconnect")}>{t("descriptionReconnect")}</InfoPopover>
            ) : null}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {reconnectableIntegrations.length > 0 ? (
              reconnectableIntegrations.map(integration => (
                <Button
                  key={integration.integrationId}
                  type="button"
                  disabled={!workspaceId || loading || Boolean(busyAction) || activeConnectionIntents.length > 0}
                  onClick={() => void copyConnectionMessage(integration.integrationId)}
                >
                  {busyAction === "create-intent"
                    ? t("creatingCopying")
                    : t("reconnectNamed", { name: integration.agentDisplayName || t("agentFallback") })}
                </Button>
              ))
            ) : (
              <Button
                type="button"
                disabled={!workspaceId || loading || Boolean(busyAction) || activeConnectionIntents.length > 0}
                onClick={() => void copyConnectionMessage()}
              >
                {busyAction === "create-intent" ? t("creatingCopying") : t("copyMessage")}
              </Button>
            )}
            <InfoPopover label={t("safeAccess")}>
              <AgentText id="translated006" />
            </InfoPopover>
          </div>
          {status ? (
            <p
              ref={actionFeedbackRef}
              role="status"
              aria-live="polite"
              tabIndex={-1}
              className="mt-4 text-sm text-success"
            >
              {status}
            </p>
          ) : null}
          {error ? (
            <p
              ref={actionFeedbackRef}
              role="alert"
              tabIndex={-1}
              className="mt-4 rounded-lg bg-error/10 p-3 text-sm text-error"
            >
              {error}
            </p>
          ) : null}
          <AgentConnectionHostPicker selectedHostId={selectedHostId} onSelectHost={selectConnectionHost} />
        </Card>
      ) : null}

      {!showConnectionStart && status ? (
        <p
          ref={actionFeedbackRef}
          role="status"
          aria-live="polite"
          tabIndex={-1}
          className="rounded-lg bg-success/10 p-3 text-sm text-success"
        >
          {status}
        </p>
      ) : null}
      {!showConnectionStart && error ? (
        <p ref={actionFeedbackRef} role="alert" tabIndex={-1} className="rounded-lg bg-error/10 p-3 text-sm text-error">
          {error}
        </p>
      ) : null}

      {manualConnectionMessage ? (
        <Card as="section" className="rounded-2xl p-5" aria-labelledby="manual-agent-message-heading">
          <h3 id="manual-agent-message-heading" className="font-semibold">
            <AgentText id="translated007" />
          </h3>
          <p id="manual-agent-message-help" className="mt-2 text-sm leading-6 text-base-content/60">
            <AgentText id="translated008" />
          </p>
          <TextareaField
            ref={manualMessageRef}
            containerClassName="mt-4"
            className="min-h-32 border-base-content/10 bg-[var(--rateloop-field)] font-mono text-xs leading-5"
            label={t("message")}
            labelClassName="sr-only"
            aria-describedby="manual-agent-message-help"
            readOnly
            value={manualConnectionMessage}
            onFocus={event => event.currentTarget.select()}
          />
          <div className="mt-3 flex flex-wrap gap-3">
            <Button type="button" size="sm" variant="secondary" onClick={() => void copyVisibleConnectionMessage()}>
              <AgentText id="translated009" />
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
              <AgentText id="translated010" />
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
                <AgentText id="translated011" />
              </p>
            </div>
            <button type="button" className="btn btn-sm rateloop-secondary-action" onClick={() => void copyReveal()}>
              <AgentText id="translated012" />
            </button>
          </div>
          <dl className="mt-4 space-y-3 rounded-lg bg-base-content/[0.055] p-4 font-mono text-xs">
            <div>
              <dt className="text-base-content/55">
                <AgentText id="mcpUrl" />
              </dt>
              <dd className="mt-1 break-all">{reveal.mcpUrl}</dd>
            </div>
            <div>
              <dt className="text-base-content/55">
                <AgentText id="legacyCredential" />
              </dt>
              <dd className="mt-1 break-all">{reveal.secret}</dd>
            </div>
            {reveal.expiresAt ? (
              <div>
                <dt className="text-base-content/55">
                  <AgentText id="expires" />
                </dt>
                <dd className="mt-1">
                  {format.dateTime(new Date(reveal.expiresAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </dd>
              </div>
            ) : null}
          </dl>
          <button
            type="button"
            className="mt-3 text-xs text-base-content/55 underline underline-offset-4"
            onClick={() => setReveal(null)}
          >
            <AgentText id="translated013" />
          </button>
        </section>
      ) : null}

      <AsyncSection loading={loading} loadingLabel={t("loading")}>
        {null}
      </AsyncSection>

      {!loading && workspaceId && activeConnectionIntents.length > 0 ? (
        <Card as="section" className="rounded-2xl p-6" aria-labelledby="pending-agent-connections-heading">
          <div className="space-y-4">
            {connectionIntents
              .filter(intent => isActiveAgentConnectionIntent(intent, connectionClock))
              .slice(0, 1)
              .map(intent => {
                const move = intent.workspaceMove;
                const copy =
                  move?.status === "source_confirmation_required"
                    ? {
                        heading: t("confirmReconnectHost"),
                        detail: t("confirmReconnectHostDetail"),
                      }
                    : move?.status === "owner_approval_required"
                      ? {
                          heading: t("approveReconnectAgent"),
                          detail: t("approveReconnectAgentDetail"),
                        }
                      : connectionIntentCopy(intent.status, t);
                const recoveryAction = intent.recoveryAction;
                return (
                  <article key={intent.intentId}>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 id="pending-agent-connections-heading" className="text-xl font-semibold">
                            {copy.heading}
                          </h2>
                          <span className="badge badge-ghost text-xs">
                            {connectionStatusLabel(intent.status, presentation)}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-base-content/55">{copy.detail}</p>
                        {move ? (
                          <p className="mt-4 max-w-3xl rounded-xl border border-warning/25 bg-warning/[0.07] p-4 text-sm leading-6 text-warning/85">
                            <AgentText id="translated014" />
                          </p>
                        ) : null}
                        {recoveryAction ? (
                          <div className="mt-4 rounded-xl border border-warning/25 bg-warning/[0.07] p-4" role="alert">
                            <p className="text-sm font-semibold text-warning">{t("resolve")}</p>
                            <p className="mt-1 text-sm leading-6 text-warning/80">{t("recoveryAction")}</p>
                          </div>
                        ) : !move ? (
                          <p className="mt-2 text-sm text-base-content/55">{t("closePage")}</p>
                        ) : null}
                        {(intent.clientName || intent.clientVersion) && (
                          <p className="mt-2 text-xs text-base-content/55">
                            {intent.clientName || t("agentHost")}
                            {intent.clientVersion ? ` ${intent.clientVersion}` : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                        <time className="text-xs text-base-content/55" dateTime={intent.hardExpiresAt ?? undefined}>
                          <AgentText id="translated015" />{" "}
                          {intent.hardExpiresAt
                            ? format.dateTime(new Date(intent.hardExpiresAt), {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })
                            : t("soon")}
                        </time>
                        <div className="flex flex-wrap gap-2">
                          {move?.status === "owner_approval_required" ? (
                            <Button
                              type="button"
                              size="sm"
                              disabled={Boolean(busyAction)}
                              onClick={() => setPendingConfirmation({ kind: "approve-workspace-move", intent })}
                            >
                              {busyAction === `approve-move:${move.transferId}`
                                ? t("approving")
                                : t("approveReconnect")}
                            </Button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-sm rateloop-secondary-action"
                            disabled={Boolean(busyAction)}
                            onClick={() => void retryConnectionStatus()}
                          >
                            {busyAction === "refresh-intents" ? t("checking") : t("checkStatus")}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm rateloop-secondary-action"
                            disabled={Boolean(busyAction)}
                            onClick={() => setPendingConfirmation({ kind: "cancel-intent", intentId: intent.intentId })}
                          >
                            {busyAction === `cancel-intent:${intent.intentId}` ? t("cancelling") : t("cancelAttempt")}
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
          </div>
        </Card>
      ) : null}

      {!loading && workspaceId && activePairings.length > 0 ? (
        <Card
          as="section"
          className="rounded-2xl border border-warning/25 p-6"
          aria-labelledby="legacy-pairing-actions-heading"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="legacy-pairing-actions-heading" className="text-xl font-semibold">
              <AgentText id="translated016" />
            </h2>
            <Badge variant="warning">
              {activePairings.length} <AgentText id="translated017" />
            </Badge>
          </div>
          <p className="mt-3 text-sm leading-6 text-base-content/55">
            <AgentText id="translated018" />
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
                        <AgentText id="translated019" />
                      </Button>
                    </div>
                    <PairingApprovalCard
                      pairing={pairing}
                      policies={publishingPolicies}
                      busy={
                        busyAction === `approve:${pairing.pairingId}` || busyAction === `reject:${pairing.pairingId}`
                      }
                      onApprove={payload => approvePairing(pairing.pairingId, payload)}
                      onReject={async () =>
                        setPendingConfirmation({ kind: "reject-pairing", pairingId: pairing.pairingId })
                      }
                    />
                  </div>
                ) : (
                  <Card as="article" variant="nested" key={pairing.pairingId} className="rounded-xl p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="font-semibold">
                          {pairing.displayName || pairing.clientName || t("agentFallback")}{" "}
                          <AgentText id="translated020" />
                        </h3>
                        <p className="mt-1 text-sm text-base-content/55">
                          <AgentText id="translated021" />
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setExpandedLegacyPairingId(pairing.pairingId)}
                      >
                        <AgentText id="translated022" />
                      </Button>
                    </div>
                  </Card>
                )
              ) : (
                <Card as="article" variant="nested" key={pairing.pairingId} className="rounded-xl p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h4 className="font-semibold">
                        <AgentText id="legacyWaiting" />
                      </h4>
                      <p className="mt-1 text-sm text-base-content/55">
                        <AgentText id="legacyCancel" />
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm rateloop-secondary-action"
                      disabled={busyAction === `reject:${pairing.pairingId}`}
                      onClick={() => setPendingConfirmation({ kind: "reject-pairing", pairingId: pairing.pairingId })}
                    >
                      <AgentText id="translated023" />
                    </button>
                  </div>
                </Card>
              ),
            )}
          </div>
        </Card>
      ) : null}

      {!loading && workspaceId && managedIntegrations.length > 0 ? (
        <Card as="section" className="rounded-2xl p-6" aria-labelledby="connected-agents-heading">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="connected-agents-heading" className="text-xl font-semibold">
                {activeIntegrations.length === 0
                  ? t("accessNeedsAttention")
                  : activeIntegrations.length === 1
                    ? t("accessActiveOne", {
                        name: activeIntegrations[0].agentDisplayName || t("agentFallback"),
                      })
                    : t("accessActiveMany", { count: activeIntegrations.length })}
              </h2>
              {activeIntegrations.length > 0 ? (
                <div className="mt-2 space-y-1 text-sm leading-6 text-base-content/55">
                  <p>{t(capabilitySummaryKey)}</p>
                  <p>{t("hostToolStateUnverified")}</p>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {activeIntegrations.length === 1 && activeIntegrations[0].access.credentialKind === "oauth" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={Boolean(busyAction) || activeConnectionIntents.length > 0}
                  onClick={() => void copyConnectionMessage(activeIntegrations[0].integrationId)}
                >
                  {busyAction === "create-intent" ? t("creating") : t("reconnect")}
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
                {showConnectionManagement ? t("done") : t("manage")}
              </Button>
            </div>
          </div>
          {recoveryIntegrations.map(integration => (
            <div
              key={`oauth-recovery:${integration.integrationId}`}
              className="mt-5 flex flex-col gap-3 rounded-xl border border-warning/20 bg-warning/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium">
                  {integration.agentDisplayName || "Codex"} <AgentText id="translated025" />
                </p>
                <p className="mt-1 text-sm text-base-content/60">
                  <AgentText id="translated026" />
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={Boolean(busyAction)}
                onClick={() => void recoverOAuthIntegration(integration)}
              >
                {busyAction === `recover-oauth:${integration.integrationId}` ? t("restoring") : t("restore")}
              </Button>
            </div>
          ))}
          {showConnectionManagement ? (
            <div id="connected-agent-management" className="mt-5 space-y-4">
              {managedIntegrations.map(integration => {
                const active = hasActiveAgentAccess(integration.access);
                const legacyCredential = integration.access.credentialKind === "legacy";
                return (
                  <article
                    key={integration.integrationId}
                    className="rounded-xl border border-base-content/10 bg-base-content/[0.025] p-5"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-semibold">{integration.agentDisplayName || integration.agentId}</h4>
                          {integration.agentVersionNumber ? (
                            <span className="badge badge-ghost">v{integration.agentVersionNumber}</span>
                          ) : null}
                          <span
                            className={`badge border-0 ${active ? "bg-success/10 text-success" : "bg-base-content/[0.06] text-base-content/55"}`}
                          >
                            {integration.access.rateLoopAccessState === "recovery_required"
                              ? t("recoveryRequired")
                              : connectionStatusLabel(integration.status, presentation)}
                          </span>
                          <span className="badge badge-ghost">
                            {enforcementModeLabel(integration.enforcementMode, presentation)}
                          </span>
                          <span className="badge badge-ghost">
                            {legacyCredential ? t("legacyCredentialShort") : t("oauthCredentialShort")}
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
                              onClick={() => setPendingConfirmation({ kind: "rotate-integration", integration })}
                            >
                              <AgentText id="translated027" />
                            </button>
                          ) : null}
                          {!legacyCredential && activeIntegrations.length > 1 ? (
                            <button
                              type="button"
                              className="btn btn-sm rateloop-secondary-action"
                              disabled={Boolean(busyAction) || activeConnectionIntents.length > 0}
                              onClick={() => void copyConnectionMessage(integration.integrationId)}
                            >
                              {t("reconnectNamed", {
                                name: integration.agentDisplayName || t("agentFallback"),
                              })}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost text-error"
                            disabled={Boolean(busyAction)}
                            onClick={() => setPendingConfirmation({ kind: "revoke-integration", integration })}
                          >
                            <AgentText id="translated029" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <details className="mt-4 border-t border-base-content/10 pt-4">
                      <summary className="cursor-pointer text-sm font-medium text-base-content/65">
                        <AgentText id="translated030" />
                      </summary>
                      <div className="mt-3">
                        <p className="font-mono text-xs text-base-content/55">{integration.integrationId}</p>
                        <p className="mt-2 text-sm text-base-content/60">
                          {integration.clientName || t("unknownClient")}
                          {integration.clientVersion ? ` ${integration.clientVersion}` : ""}
                        </p>
                        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                          <div>
                            <dt className="text-xs text-base-content/55">{t("lastSeen")}</dt>
                            <dd className="mt-1">
                              {integration.lastSeenAt
                                ? format.dateTime(new Date(integration.lastSeenAt), {
                                    dateStyle: "medium",
                                    timeStyle: "short",
                                  })
                                : t("neverConnected")}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-base-content/55">
                              {legacyCredential ? t("credentialExpiry") : t("access")}
                            </dt>
                            <dd className="mt-1">
                              {legacyCredential
                                ? integration.credentialExpiresAt
                                  ? format.dateTime(new Date(integration.credentialExpiresAt), {
                                      dateStyle: "medium",
                                      timeStyle: "short",
                                    })
                                  : t("noExpiry")
                                : t("oauthAccess")}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-base-content/55">{t("reviewPolicy")}</dt>
                            <dd className="mt-1">
                              {integration.reviewPolicyId || t("unknown")}
                              {integration.reviewPolicyVersion ? ` · v${integration.reviewPolicyVersion}` : ""}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-base-content/55">{t("publishingPolicy")}</dt>
                            <dd className="mt-1">
                              {integration.publishingPolicyName || integration.publishingPolicyId || t("noPublishing")}
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
        </Card>
      ) : null}
      <ConfirmDialog
        open={pendingConfirmation !== null}
        title={pendingConfirmation ? confirmationCopy(pendingConfirmation, t).title : t("confirmAction")}
        description={pendingConfirmation ? confirmationCopy(pendingConfirmation, t).description : ""}
        confirmLabel={pendingConfirmation ? confirmationCopy(pendingConfirmation, t).confirmLabel : t("confirm")}
        busy={Boolean(busyAction)}
        onCancel={() => setPendingConfirmation(null)}
        onConfirm={() => void confirmPendingAction()}
      />
    </div>
  );
}
