import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { isRateLoopPrincipalId, normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { assertCanCreateWorkspaceAgent } from "~~/lib/billing/entitlements";
import { dbClient, dbPool } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { DEFAULT_ADAPTIVE_AGREEMENT_THRESHOLD_BPS } from "~~/lib/tokenless/adaptiveReviewDefaults";
import {
  type AgentOAuthAccessPrincipal,
  AgentOAuthError,
  authenticateAgentOAuthAccessToken,
} from "~~/lib/tokenless/agentOAuth";
import { AGENT_ENVIRONMENTS, type AgentEnvironment } from "~~/lib/tokenless/agentRegistry";
import {
  type HumanReviewPaymentProfile,
  OWNER_APPROVED_AGENT_SCOPES,
  automaticHumanReviewGrantScopes,
} from "~~/lib/tokenless/humanReviewGrantScopes";
import {
  type ProductPrincipal,
  TOKENLESS_AGENT_SCOPES,
  type TokenlessAgentScope,
  authenticateProductPrincipal,
} from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type ApiPrincipal = Extract<ProductPrincipal, { kind: "api_key" }>;

const TOKEN_PATTERN = /^rlk_([a-f0-9]{16})_([A-Za-z0-9_-]{32,128})$/;
const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const WORKFLOW_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const PAIRING_TTL_MS = 10 * 60_000;
const ACTIVE_TTL_MS = 90 * 24 * 60 * 60_000;

export { OWNER_APPROVED_AGENT_SCOPES } from "~~/lib/tokenless/humanReviewGrantScopes";

export type AgentRegistrationInput = {
  externalId: string;
  displayName: string;
  description?: string | null;
  provider: string;
  model: string;
  modelVersion?: string | null;
  environment: AgentEnvironment;
  clientName?: string | null;
  clientVersion?: string | null;
  clientCapabilities?: string[];
  requestedWorkflowKeys: string[];
};

export type AgentIntegrationBinding = {
  integrationId: string;
  workspaceId: string;
  agentId: string;
  agentVersionId: string;
  reviewPolicyId: string;
  reviewPolicyVersion: number;
  audiencePolicyHash?: string;
  publishingPolicyId: string | null;
  publishingPolicyVersion: number | null;
  status: "active";
  enforcementMode: "advisory" | "host_enforced";
  allowedWorkflowKeys: string[];
  lastSeenAt: string | null;
};

export type AgentMcpPrincipal =
  | { kind: "pairing"; pairingId: string; workspaceId: string; apiKeyId: string }
  | { kind: "integration"; principal: ApiPrincipal; integration: AgentIntegrationBinding }
  | {
      kind: "oauth";
      oauth: AgentOAuthAccessPrincipal;
      principal: ApiPrincipal | null;
      integration: AgentIntegrationBinding | null;
      connectionStatus: string | null;
    };

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Database returned invalid ${key}.`);
  return value;
}

function optionalInteger(row: Row | undefined, key: string) {
  return row?.[key] === null || row?.[key] === undefined ? null : integer(row, key);
}

function iso(value: unknown) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error("Database returned an invalid timestamp.");
  return date.toISOString();
}

function jsonArray(value: unknown, field: string) {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    if (!Array.isArray(parsed) || parsed.some(item => typeof item !== "string")) throw new Error();
    return parsed as string[];
  } catch {
    throw new Error(`Database returned invalid ${field}.`);
  }
}

function jsonObject(value: unknown, field: string) {
  try {
    const parsed = JSON.parse(String(value ?? "null")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Database returned invalid ${field}.`);
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function bounded(value: unknown, field: string, max: number, optional = false) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_agent_registration");
  }
  return value.trim();
}

function stringList(value: unknown, field: string, pattern: RegExp, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 32) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_agent_registration");
  }
  const items = [...new Set(value.map(item => (typeof item === "string" ? item.trim() : "")))];
  if (items.some(item => !pattern.test(item))) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_agent_registration");
  }
  return items;
}

function normalizeRegistration(value: unknown): AgentRegistrationInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError("Registration body is invalid.", 400, "invalid_agent_registration");
  }
  const input = value as Record<string, unknown>;
  const environment = input.environment as AgentEnvironment;
  if (!AGENT_ENVIRONMENTS.includes(environment)) {
    throw new TokenlessServiceError("Agent environment is invalid.", 400, "invalid_agent_registration");
  }
  const externalId = bounded(input.externalId, "External agent ID", 160);
  if (!EXTERNAL_ID_PATTERN.test(externalId!)) {
    throw new TokenlessServiceError("External agent ID is invalid.", 400, "invalid_agent_registration");
  }
  return {
    externalId: externalId!,
    displayName: bounded(input.displayName, "Display name", 120)!,
    description: bounded(input.description, "Description", 1_000, true),
    provider: bounded(input.provider, "Provider", 120)!,
    model: bounded(input.model, "Model", 160)!,
    modelVersion: bounded(input.modelVersion, "Model version", 160, true),
    environment,
    clientName: bounded(input.clientName, "Client name", 120, true),
    clientVersion: bounded(input.clientVersion, "Client version", 120, true),
    clientCapabilities: stringList(input.clientCapabilities ?? [], "Client capabilities", WORKFLOW_PATTERN, true),
    requestedWorkflowKeys: stringList(input.requestedWorkflowKeys, "Requested workflows", WORKFLOW_PATTERN),
  };
}

async function management(accountAddress: string, workspaceId: string) {
  let address: string;
  try {
    address = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
  const result = await dbClient.execute({
    sql: `SELECT m.role FROM tokenless_workspace_members m JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.workspace_id = ? AND m.account_address = ? AND m.role IN ('owner','admin') AND w.status = 'active' LIMIT 1`,
    args: [workspaceId, address],
  });
  if (!result.rowCount) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return address;
}

function pairingFromRow(row: Row) {
  return {
    pairingId: text(row, "pairing_id")!,
    workspaceId: text(row, "workspace_id")!,
    status: text(row, "status")!,
    credentialPrefix: text(row, "credential_prefix")!,
    externalId: text(row, "external_id"),
    displayName: text(row, "display_name"),
    description: text(row, "description"),
    provider: text(row, "declared_provider"),
    model: text(row, "declared_model"),
    modelVersion: text(row, "declared_model_version"),
    environment: text(row, "environment"),
    clientName: text(row, "client_name"),
    clientVersion: text(row, "client_version"),
    clientCapabilities: jsonArray(row.client_capabilities_json, "client capabilities"),
    requestedWorkflowKeys: jsonArray(row.requested_workflow_keys_json, "requested workflows"),
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    claimedAt: iso(row.claimed_at),
    approvedAt: iso(row.approved_at),
    rejectedAt: iso(row.rejected_at),
  };
}

function bindingFromRow(row: Row): AgentIntegrationBinding {
  if (text(row, "status") !== "active")
    throw new TokenlessServiceError("Agent integration is inactive.", 401, "agent_integration_inactive");
  return {
    integrationId: text(row, "integration_id")!,
    workspaceId: text(row, "workspace_id")!,
    agentId: text(row, "agent_id")!,
    agentVersionId: text(row, "agent_version_id")!,
    reviewPolicyId: text(row, "review_policy_id")!,
    reviewPolicyVersion: integer(row, "review_policy_version"),
    audiencePolicyHash: `sha256:${digest(stableJson(jsonObject(row.audience_policy_json, "audience policy")))}`,
    publishingPolicyId: text(row, "publishing_policy_id"),
    publishingPolicyVersion:
      row.publishing_policy_version === null || row.publishing_policy_version === undefined
        ? null
        : integer(row, "publishing_policy_version"),
    status: "active",
    enforcementMode: text(row, "enforcement_mode") as "advisory" | "host_enforced",
    allowedWorkflowKeys: jsonArray(row.allowed_workflow_keys_json, "allowed workflows"),
    lastSeenAt: iso(row.last_seen_at),
  };
}

export async function createAgentPairing(input: { accountAddress: string; workspaceId: string; origin: string }) {
  const address = await management(input.accountAddress, input.workspaceId);
  const keyId = randomBytes(8).toString("hex");
  const token = `rlk_${keyId}_${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
  const pairingId = `apr_${randomUUID().replaceAll("-", "")}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_pairing_sessions
          (pairing_id, workspace_id, api_key_id, credential_hash, credential_prefix, status, created_by, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    args: [pairingId, input.workspaceId, keyId, digest(token), token.slice(0, 20), address, now, expiresAt],
  });
  await appendAuditEvent({
    action: "agent.pairing_created",
    actorKind: isRateLoopPrincipalId(address) ? "principal" : "account",
    actorReference: address,
    assuranceMethod: "rateloop_session",
    metadata: { expiresAt: expiresAt.toISOString() },
    purpose: "agent_connection",
    reason: "workspace_administrator_request",
    result: "success",
    targetId: pairingId,
    targetKind: "agent_pairing",
    workspaceId: input.workspaceId,
  });
  return {
    pairing: {
      pairingId,
      workspaceId: input.workspaceId,
      status: "open",
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
    secret: token,
    mcpUrl: `${input.origin.replace(/\/$/, "")}/api/agent/v1/mcp`,
  };
}

export async function listAgentConnections(input: { accountAddress: string; workspaceId: string }) {
  await management(input.accountAddress, input.workspaceId);
  const now = new Date();
  const expired = await dbClient.execute({
    sql: `UPDATE tokenless_agent_pairing_sessions
          SET status = 'expired'
          WHERE workspace_id = ? AND status IN ('open','claimed') AND expires_at <= ?
          RETURNING pairing_id`,
    args: [input.workspaceId, now],
  });
  await Promise.all(
    expired.rows.map(row =>
      appendAuditEvent({
        action: "agent.pairing_expired",
        actorKind: "system",
        actorReference: "agent-connection-expiry",
        assuranceMethod: "system_clock",
        purpose: "agent_connection",
        reason: "pairing_deadline_elapsed",
        result: "success",
        targetId: text(row as Row, "pairing_id")!,
        targetKind: "agent_pairing",
        workspaceId: input.workspaceId,
      }),
    ),
  );
  const [pairings, integrations] = await Promise.all([
    dbClient.execute({
      sql: "SELECT * FROM tokenless_agent_pairing_sessions WHERE workspace_id = ? ORDER BY created_at DESC",
      args: [input.workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT i.*, k.key_prefix AS credential_prefix,
                             COALESCE(k.expires_at, f.absolute_expires_at) AS expires_at,
                             a.external_id, v.display_name, c.status AS connection_status,
                             rp.audience_policy_json
                             FROM tokenless_agent_integrations i
                             LEFT JOIN tokenless_workspace_api_keys k ON k.key_id = i.api_key_id
                             LEFT JOIN tokenless_agent_oauth_token_families f ON f.token_family_id = i.token_family_id
                             LEFT JOIN tokenless_agent_connection_intents c ON c.intent_id = i.connection_intent_id
                             JOIN tokenless_agents a ON a.agent_id = i.agent_id
                             JOIN tokenless_agent_versions v ON v.version_id = i.agent_version_id
                             JOIN tokenless_agent_review_policies rp
                               ON rp.workspace_id = i.workspace_id AND rp.policy_id = i.review_policy_id
                              AND rp.version = i.review_policy_version
                             WHERE i.workspace_id = ? ORDER BY i.created_at DESC`,
      args: [input.workspaceId],
    }),
  ]);
  return {
    pairings: pairings.rows.map(row => pairingFromRow(row as Row)),
    integrations: integrations.rows.map(value => {
      const row = value as Row;
      return {
        ...bindingFromRow({ ...row, status: text(row, "status") === "active" ? "active" : "active" }),
        status: text(row, "status"),
        apiKeyId: text(row, "api_key_id"),
        externalId: text(row, "external_id"),
        displayName: text(row, "display_name"),
        credentialPrefix: text(row, "credential_prefix"),
        expiresAt: iso(row.expires_at),
        createdAt: iso(row.created_at),
        revokedAt: iso(row.revoked_at),
        activationMode: text(row, "activation_mode"),
        connectionStatus: text(row, "connection_status"),
        oauthClientId: text(row, "oauth_client_id"),
      };
    }),
  };
}

export async function rehydrateOAuthAgentMcpPrincipal(
  oauth: AgentOAuthAccessPrincipal,
): Promise<Extract<AgentMcpPrincipal, { kind: "oauth" }>> {
  const now = new Date();
  if (oauth.expiresAt <= now) {
    throw new TokenlessServiceError("The OAuth access token expired.", 401, "invalid_token");
  }
  const integrationResult = await dbClient.execute({
    sql: `SELECT i.*, c.status AS connection_status, rp.audience_policy_json
            FROM tokenless_agent_integrations i
            JOIN tokenless_agent_connection_intents c ON c.intent_id = i.connection_intent_id
            JOIN tokenless_agent_oauth_token_families f
              ON f.token_family_id = i.token_family_id
             AND f.subject_principal_id = i.oauth_subject_principal_id
            JOIN tokenless_agent_review_policies rp
              ON rp.workspace_id = i.workspace_id AND rp.policy_id = i.review_policy_id
             AND rp.version = i.review_policy_version
            WHERE i.token_family_id = ? AND i.oauth_subject_principal_id = ?
              AND i.oauth_client_id = ? AND i.status = 'active'
              AND f.client_id = ? AND f.subject_principal_id = ?
              AND f.resource = ? AND f.status = 'active' AND f.absolute_expires_at > ?
            LIMIT 1`,
    args: [
      oauth.tokenFamilyId,
      oauth.subjectPrincipalId,
      oauth.clientId,
      oauth.clientId,
      oauth.subjectPrincipalId,
      oauth.resource,
      now,
    ],
  });
  const row = integrationResult.rows[0] as Row | undefined;
  if (!row) return { kind: "oauth", oauth, principal: null, integration: null, connectionStatus: null };
  await dbClient.execute({
    sql: "UPDATE tokenless_agent_integrations SET last_seen_at = ?, updated_at = ? WHERE integration_id = ?",
    args: [now, now, text(row, "integration_id")],
  });
  const grantedScopes = jsonArray(row.granted_scopes_json, "granted scopes");
  if (grantedScopes.some(scope => !(OWNER_APPROVED_AGENT_SCOPES as readonly string[]).includes(scope))) {
    throw new TokenlessServiceError("Agent integration scopes are invalid.", 500, "agent_integration_invalid");
  }
  const principal: ApiPrincipal = {
    kind: "api_key",
    apiKeyId: oauth.tokenFamilyId,
    workspaceId: text(row, "workspace_id")!,
    role: "member",
    scopes: TOKENLESS_AGENT_SCOPES.filter(scope => grantedScopes.includes(scope)) as TokenlessAgentScope[],
    policyId: text(row, "publishing_policy_id"),
    expiresAt: oauth.expiresAt.toISOString(),
  };
  return {
    kind: "oauth",
    oauth,
    principal,
    integration: { ...bindingFromRow(row), lastSeenAt: now.toISOString() },
    connectionStatus: text(row, "connection_status"),
  };
}

export async function authenticateAgentMcpPrincipal(authorization: string | null): Promise<AgentMcpPrincipal> {
  if (/^Bearer\s+rlo_at_/i.test(authorization ?? "")) {
    let oauth: AgentOAuthAccessPrincipal;
    try {
      oauth = await authenticateAgentOAuthAccessToken(authorization);
    } catch (error) {
      if (error instanceof AgentOAuthError) {
        throw new TokenlessServiceError(error.message, error.status, error.code);
      }
      throw error;
    }
    return rehydrateOAuthAgentMcpPrincipal(oauth);
  }
  const match = authorization ? /^Bearer\s+(.+)$/i.exec(authorization) : null;
  if (!match || !TOKEN_PATTERN.test(match[1]))
    throw new TokenlessServiceError("Invalid agent credential.", 401, "invalid_agent_credential");
  const hash = digest(match[1]);
  const pairingResult = await dbClient.execute({
    sql: "SELECT * FROM tokenless_agent_pairing_sessions WHERE credential_hash = ? LIMIT 1",
    args: [hash],
  });
  const pairing = pairingResult.rows[0] as Row | undefined;
  if (!pairing) throw new TokenlessServiceError("Invalid agent credential.", 401, "invalid_agent_credential");
  const status = text(pairing, "status");
  if ((status === "open" || status === "claimed") && new Date(String(pairing.expires_at)).getTime() > Date.now()) {
    return {
      kind: "pairing",
      pairingId: text(pairing, "pairing_id")!,
      workspaceId: text(pairing, "workspace_id")!,
      apiKeyId: text(pairing, "api_key_id")!,
    };
  }
  if (status !== "approved")
    throw new TokenlessServiceError("Agent pairing is no longer active.", 401, "agent_pairing_inactive");
  let principal: ProductPrincipal;
  try {
    principal = await authenticateProductPrincipal({ authorization, sessionToken: undefined });
  } catch (error) {
    if (error instanceof TokenlessServiceError) {
      throw new TokenlessServiceError("Invalid agent credential.", 401, "invalid_agent_credential");
    }
    throw error;
  }
  if (principal.kind !== "api_key")
    throw new TokenlessServiceError("Invalid agent credential.", 401, "invalid_agent_credential");
  const integrationResult = await dbClient.execute({
    sql: `SELECT i.*, rp.audience_policy_json
          FROM tokenless_agent_integrations i
          JOIN tokenless_agent_review_policies rp
            ON rp.workspace_id = i.workspace_id AND rp.policy_id = i.review_policy_id
           AND rp.version = i.review_policy_version
          WHERE i.api_key_id = ? AND i.workspace_id = ? AND i.status = 'active' LIMIT 1`,
    args: [principal.apiKeyId, principal.workspaceId],
  });
  const row = integrationResult.rows[0] as Row | undefined;
  if (!row) throw new TokenlessServiceError("Agent integration is inactive.", 401, "agent_integration_inactive");
  const now = new Date();
  await dbClient.execute({
    sql: "UPDATE tokenless_agent_integrations SET last_seen_at = ?, updated_at = ? WHERE integration_id = ?",
    args: [now, now, text(row, "integration_id")],
  });
  return { kind: "integration", principal, integration: { ...bindingFromRow(row), lastSeenAt: now.toISOString() } };
}

export async function recordPairingClientInfo(input: {
  pairing: Extract<AgentMcpPrincipal, { kind: "pairing" }>;
  clientName?: string | null;
  clientVersion?: string | null;
  clientCapabilities?: string[];
}) {
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_pairing_sessions SET client_name = COALESCE(?, client_name), client_version = COALESCE(?, client_version), client_capabilities_json = ? WHERE pairing_id = ? AND status IN ('open','claimed')`,
    args: [
      input.clientName ?? null,
      input.clientVersion ?? null,
      JSON.stringify(input.clientCapabilities ?? []),
      input.pairing.pairingId,
    ],
  });
}

export async function recordPairingClientMetadata(
  pairing: Extract<AgentMcpPrincipal, { kind: "pairing" }>,
  metadata: { clientName?: string | null; clientVersion?: string | null; clientCapabilities?: string[] },
) {
  return recordPairingClientInfo({ pairing, ...metadata });
}

export async function recordOAuthMcpClientMetadata(
  principal: Extract<AgentMcpPrincipal, { kind: "oauth" }>,
  metadata: { clientName: string; clientVersion: string; clientCapabilities: string[] },
) {
  const now = new Date();
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_oauth_clients
          SET software_version = COALESCE(software_version, ?), updated_at = ?
          WHERE client_id = ? AND status = 'active'`,
    args: [metadata.clientVersion, now, principal.oauth.clientId],
  });
  if (!principal.integration) return;
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_integrations
          SET client_name = ?, client_version = ?, client_capabilities_json = ?,
              last_initialize_at = ?, updated_at = ?
          WHERE integration_id = ? AND token_family_id = ? AND status = 'active'`,
    args: [
      metadata.clientName,
      metadata.clientVersion,
      JSON.stringify(metadata.clientCapabilities),
      now,
      now,
      principal.integration.integrationId,
      principal.oauth.tokenFamilyId,
    ],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_connection_intents
          SET client_name = ?, client_version = ? WHERE claimed_token_family_id = ?`,
    args: [metadata.clientName, metadata.clientVersion, principal.oauth.tokenFamilyId],
  });
}

export async function recordOAuthAgentContextRead(principal: Extract<AgentMcpPrincipal, { kind: "oauth" }>) {
  if (!principal.integration) return;
  const now = new Date();
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_integrations SET last_context_at = ?, last_seen_at = ?, updated_at = ?
          WHERE integration_id = ? AND token_family_id = ? AND status = 'active'`,
    args: [now, now, now, principal.integration.integrationId, principal.oauth.tokenFamilyId],
  });
}

export async function submitAgentRegistration(input: {
  pairing: Extract<AgentMcpPrincipal, { kind: "pairing" }>;
  registration: unknown;
}) {
  const value = normalizeRegistration(input.registration);
  const now = new Date();
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_agent_pairing_sessions SET status = 'claimed', external_id = ?, display_name = ?, description = ?, declared_provider = ?, declared_model = ?, declared_model_version = ?, environment = ?, client_name = COALESCE(?, client_name), client_version = COALESCE(?, client_version), client_capabilities_json = ?, requested_workflow_keys_json = ?, claimed_at = COALESCE(claimed_at, ?) WHERE pairing_id = ? AND status IN ('open','claimed') AND expires_at > ? RETURNING *`,
    args: [
      value.externalId,
      value.displayName,
      value.description ?? null,
      value.provider,
      value.model,
      value.modelVersion ?? null,
      value.environment,
      value.clientName ?? null,
      value.clientVersion ?? null,
      JSON.stringify(value.clientCapabilities ?? []),
      JSON.stringify(value.requestedWorkflowKeys),
      now,
      input.pairing.pairingId,
      now,
    ],
  });
  if (!result.rowCount)
    throw new TokenlessServiceError("Pairing expired or was already resolved.", 410, "agent_pairing_expired");
  await appendAuditEvent({
    action: "agent.pairing_claimed",
    actorKind: "api_key",
    actorReference: input.pairing.apiKeyId,
    assuranceMethod: "pairing_credential",
    metadata: { environment: value.environment, requestedWorkflowCount: value.requestedWorkflowKeys.length },
    purpose: "agent_connection",
    reason: "agent_registration_submitted",
    result: "success",
    targetId: input.pairing.pairingId,
    targetKind: "agent_pairing",
    workspaceId: input.pairing.workspaceId,
  });
  return {
    registration: pairingFromRow(result.rows[0] as Row),
    nextAction:
      "Call rateloop_get_registration_status while the workspace owner reviews this registration. After approval, refresh the MCP tool list and call rateloop_get_agent_context.",
    pollAfterMs: 3_000,
  };
}

export async function getAgentRegistrationStatus(pairing: Extract<AgentMcpPrincipal, { kind: "pairing" }>) {
  const result = await dbClient.execute({
    sql: "SELECT * FROM tokenless_agent_pairing_sessions WHERE pairing_id = ? LIMIT 1",
    args: [pairing.pairingId],
  });
  if (!result.rowCount) throw new TokenlessServiceError("Registration not found.", 404, "registration_not_found");
  return {
    registration: pairingFromRow(result.rows[0] as Row),
    nextAction:
      "Keep checking registration status without exposing the credential. After approval, refresh the MCP tool list and call rateloop_get_agent_context.",
    pollAfterMs: 3_000,
  };
}

function versionCommitment(registration: AgentRegistrationInput) {
  return digest(
    stableJson({
      displayName: registration.displayName,
      description: registration.description ?? null,
      provider: registration.provider,
      model: registration.model,
      modelVersion: registration.modelVersion ?? null,
      environment: registration.environment,
    }),
  );
}

async function insertApproval(
  client: PoolClient,
  input: {
    workspaceId: string;
    pairing: Row;
    actor: string;
    registration: AgentRegistrationInput;
    publishingPolicyId: string;
    allowedWorkflowKeys: string[];
  },
) {
  const now = new Date();
  const publishing = await client.query(
    `SELECT version FROM tokenless_agent_publishing_policies WHERE workspace_id = $1 AND policy_id = $2 AND enabled = true AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > $3) FOR SHARE`,
    [input.workspaceId, input.publishingPolicyId, now],
  );
  if (publishing.rowCount !== 1)
    throw new TokenlessServiceError("Publishing policy not found.", 404, "publishing_policy_not_found");
  await assertCanCreateWorkspaceAgent(client, input.workspaceId, now);
  const agentId = `agt_${randomUUID().replaceAll("-", "")}`;
  const versionId = `agtv_${randomUUID().replaceAll("-", "")}`;
  const reviewPolicyId = `arp_${randomUUID().replaceAll("-", "")}`;
  const integrationId = `agi_${randomUUID().replaceAll("-", "")}`;
  const expiresAt = new Date(now.getTime() + ACTIVE_TTL_MS);
  await client.query(
    `INSERT INTO tokenless_agents (agent_id, workspace_id, external_id, owner_account_address, status, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,'active',$4,$5,$5)`,
    [agentId, input.workspaceId, input.registration.externalId, input.actor, now],
  );
  await client.query(
    `INSERT INTO tokenless_agent_versions (version_id, agent_id, workspace_id, version_number, display_name, description, declared_provider, declared_model, declared_model_version, environment, configuration_commitment, created_by, created_at) VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      versionId,
      agentId,
      input.workspaceId,
      input.registration.displayName,
      input.registration.description ?? null,
      input.registration.provider,
      input.registration.model,
      input.registration.modelVersion ?? null,
      input.registration.environment,
      versionCommitment(input.registration),
      input.actor,
      now,
    ],
  );
  await client.query(
    `INSERT INTO tokenless_agent_audit_events (event_id, workspace_id, agent_id, version_id, event_type, actor_account_address, details_json, created_at) VALUES ($1,$2,$3,$4,'agent.created',$5,$6,$7)`,
    [
      `agevt_${randomUUID().replaceAll("-", "")}`,
      input.workspaceId,
      agentId,
      versionId,
      input.actor,
      JSON.stringify({ externalId: input.registration.externalId, source: "pairing" }),
      now,
    ],
  );
  const audience = JSON.stringify({ reviewerSource: "private_invited" });
  await client.query(
    `INSERT INTO tokenless_agent_review_policies (policy_id, version, workspace_id, agent_id, agent_version_id, mode, enabled, agreement_threshold_bps, production_floor_bps, fixed_rate_bps, maximum_unreviewed_gap, rules_json, audience_policy_json, publishing_policy_id, created_by, approved_by, created_at) VALUES ($1,1,$2,$3,$4,'adaptive',true,${DEFAULT_ADAPTIVE_AGREEMENT_THRESHOLD_BPS},1000,NULL,20,$5,$6,$7,$8,$8,$9)`,
    [
      reviewPolicyId,
      input.workspaceId,
      agentId,
      versionId,
      JSON.stringify({
        enforcementMode: "advisory",
        requiredRiskTiers: ["high"],
        criticalRiskTiers: ["critical"],
        minimumConfidenceBps: 7000,
        maximumLatencyMs: 120000,
      }),
      audience,
      input.publishingPolicyId,
      input.actor,
      now,
    ],
  );
  await client.query(
    `INSERT INTO tokenless_workspace_api_keys (key_id, workspace_id, key_hash, key_prefix, name, role, scopes_json, policy_id, expires_at, created_at) VALUES ($1,$2,$3,$4,$5,'member',$6,$7,$8,$9)`,
    [
      text(input.pairing, "api_key_id"),
      input.workspaceId,
      text(input.pairing, "credential_hash"),
      text(input.pairing, "credential_prefix"),
      `${input.registration.displayName} integration`,
      JSON.stringify(TOKENLESS_AGENT_SCOPES),
      input.publishingPolicyId,
      expiresAt,
      now,
    ],
  );
  await client.query(
    `INSERT INTO tokenless_agent_integrations (integration_id, pairing_id, workspace_id, agent_id, agent_version_id, review_policy_id, review_policy_version, publishing_policy_id, publishing_policy_version, api_key_id, status, enforcement_mode, allowed_workflow_keys_json, client_name, client_version, client_capabilities_json, credential_expires_at, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,'active','advisory',$10,$11,$12,$13,$14,$15,$16,$16)`,
    [
      integrationId,
      text(input.pairing, "pairing_id"),
      input.workspaceId,
      agentId,
      versionId,
      reviewPolicyId,
      input.publishingPolicyId,
      Number(publishing.rows[0]?.version),
      text(input.pairing, "api_key_id"),
      JSON.stringify(input.allowedWorkflowKeys),
      text(input.pairing, "client_name"),
      text(input.pairing, "client_version"),
      String(input.pairing.client_capabilities_json ?? "[]"),
      expiresAt,
      input.actor,
      now,
    ],
  );
  await client.query(
    `INSERT INTO tokenless_agent_integration_events (event_id, integration_id, workspace_id, event_type, actor_type, actor_reference, details_json, created_at) VALUES ($1,$2,$3,'approved','account',$4,$5,$6)`,
    [
      `agie_${randomUUID().replaceAll("-", "")}`,
      integrationId,
      input.workspaceId,
      input.actor,
      JSON.stringify({ reviewPolicyId, publishingPolicyId: input.publishingPolicyId }),
      now,
    ],
  );
  await client.query(
    `UPDATE tokenless_agent_pairing_sessions SET status = 'approved', resolved_by = $1, approved_at = $2 WHERE pairing_id = $3`,
    [input.actor, now, text(input.pairing, "pairing_id")],
  );
  return { agentId, versionId, reviewPolicyId, integrationId, expiresAt };
}

export async function approveAgentPairing(input: {
  accountAddress: string;
  workspaceId: string;
  pairingId: string;
  body: unknown;
}) {
  const actor = await management(input.accountAddress, input.workspaceId);
  if (!input.body || typeof input.body !== "object" || Array.isArray(input.body))
    throw new TokenlessServiceError("Approval body is invalid.", 400, "invalid_agent_approval");
  const body = input.body as Record<string, unknown>;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const now = new Date();
    const result = await client.query(
      "SELECT * FROM tokenless_agent_pairing_sessions WHERE workspace_id = $1 AND pairing_id = $2 AND status = 'claimed' AND expires_at > $3 FOR UPDATE",
      [input.workspaceId, input.pairingId, now],
    );
    const pairing = result.rows[0] as Row | undefined;
    if (!pairing) {
      await client.query(
        `UPDATE tokenless_agent_pairing_sessions SET status = 'expired'
         WHERE workspace_id = $1 AND pairing_id = $2 AND status IN ('open','claimed') AND expires_at <= $3`,
        [input.workspaceId, input.pairingId, now],
      );
      throw new TokenlessServiceError("Claimed pairing not found or expired.", 404, "agent_pairing_not_found");
    }
    const registration = normalizeRegistration({
      externalId: body.externalId ?? pairing.external_id,
      displayName: body.displayName ?? pairing.display_name,
      description: body.description ?? pairing.description,
      provider: body.provider ?? pairing.declared_provider,
      model: body.model ?? pairing.declared_model,
      modelVersion: body.modelVersion ?? pairing.declared_model_version,
      environment: body.environment ?? pairing.environment,
      clientName: pairing.client_name,
      clientVersion: pairing.client_version,
      clientCapabilities: jsonArray(pairing.client_capabilities_json, "client capabilities"),
      requestedWorkflowKeys:
        body.allowedWorkflowKeys ?? jsonArray(pairing.requested_workflow_keys_json, "requested workflows"),
    });
    const publishingPolicyId = bounded(body.publishingPolicyId, "Publishing policy", 160)!;
    const allowedWorkflowKeys = stringList(
      body.allowedWorkflowKeys ?? registration.requestedWorkflowKeys,
      "Allowed workflows",
      WORKFLOW_PATTERN,
    );
    const created = await insertApproval(client, {
      workspaceId: input.workspaceId,
      pairing,
      actor,
      registration,
      publishingPolicyId,
      allowedWorkflowKeys,
    });
    await client.query("COMMIT");
    await appendAuditEvent({
      action: "agent.integration_approved",
      actorKind: isRateLoopPrincipalId(actor) ? "principal" : "account",
      actorReference: actor,
      assuranceMethod: "rateloop_session",
      metadata: {
        agentId: created.agentId,
        allowedWorkflowCount: allowedWorkflowKeys.length,
        publishingPolicyId,
        reviewPolicyId: created.reviewPolicyId,
      },
      purpose: "agent_connection",
      reason: "workspace_administrator_approval",
      result: "success",
      targetId: created.integrationId,
      targetKind: "agent_integration",
      workspaceId: input.workspaceId,
    });
    return {
      pairing: { pairingId: input.pairingId, status: "approved" },
      agent: { agentId: created.agentId, versionId: created.versionId },
      integration: {
        integrationId: created.integrationId,
        reviewPolicyId: created.reviewPolicyId,
        credentialExpiresAt: created.expiresAt.toISOString(),
        enforcementMode: "advisory",
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function rejectAgentPairing(input: { accountAddress: string; workspaceId: string; pairingId: string }) {
  const actor = await management(input.accountAddress, input.workspaceId);
  const now = new Date();
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_agent_pairing_sessions SET status = 'rejected', resolved_by = ?, rejected_at = ? WHERE workspace_id = ? AND pairing_id = ? AND status IN ('open','claimed') RETURNING pairing_id`,
    args: [actor, now, input.workspaceId, input.pairingId],
  });
  if (!result.rowCount) throw new TokenlessServiceError("Pairing not found.", 404, "agent_pairing_not_found");
  await appendAuditEvent({
    action: "agent.pairing_rejected",
    actorKind: isRateLoopPrincipalId(actor) ? "principal" : "account",
    actorReference: actor,
    assuranceMethod: "rateloop_session",
    purpose: "agent_connection",
    reason: "workspace_administrator_rejection",
    result: "success",
    targetId: input.pairingId,
    targetKind: "agent_pairing",
    workspaceId: input.workspaceId,
  });
  return { pairing: { pairingId: input.pairingId, status: "rejected" } };
}

function publishingActivationBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError("Publishing activation body is invalid.", 400, "invalid_publishing_activation");
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => key !== "publishingPolicyId" && key !== "allowedWorkflowKeys")) {
    throw new TokenlessServiceError(
      "Publishing activation body contains unsupported fields.",
      400,
      "invalid_publishing_activation",
    );
  }
  const publishingPolicyId = typeof body.publishingPolicyId === "string" ? body.publishingPolicyId.trim() : "";
  if (!/^agpol_[a-f0-9]{32}$/.test(publishingPolicyId)) {
    throw new TokenlessServiceError("Publishing policy is invalid.", 400, "invalid_publishing_activation");
  }
  if (
    !Array.isArray(body.allowedWorkflowKeys) ||
    body.allowedWorkflowKeys.length === 0 ||
    body.allowedWorkflowKeys.length > 32
  ) {
    throw new TokenlessServiceError("At least one allowed workflow is required.", 400, "invalid_publishing_activation");
  }
  const allowedWorkflowKeys = [
    ...new Set(body.allowedWorkflowKeys.map(value => (typeof value === "string" ? value.trim() : ""))),
  ];
  if (allowedWorkflowKeys.some(value => !WORKFLOW_PATTERN.test(value))) {
    throw new TokenlessServiceError("Allowed workflows are invalid.", 400, "invalid_publishing_activation");
  }
  return { publishingPolicyId, allowedWorkflowKeys };
}

export async function activateAgentIntegrationPublishing(input: {
  accountAddress: string;
  workspaceId: string;
  integrationId: string;
  body: unknown;
}) {
  const actor = await management(input.accountAddress, input.workspaceId);
  const activation = publishingActivationBody(input.body);
  const now = new Date();
  let scopes = [...OWNER_APPROVED_AGENT_SCOPES];
  const client = await dbPool.connect();
  let activated:
    | {
        agentId: string;
        agentVersionId: string;
        reviewPolicyId: string;
        reviewPolicyVersion: number;
        audiencePolicyHash: string;
        publishingPolicyVersion: number;
      }
    | undefined;
  try {
    await client.query("BEGIN");
    const integrationResult = await client.query(
      `SELECT i.*, c.status AS connection_status FROM tokenless_agent_integrations i
       JOIN tokenless_agent_connection_intents c ON c.intent_id = i.connection_intent_id
       WHERE i.workspace_id = $1 AND i.integration_id = $2 AND i.status = 'active'
       FOR UPDATE`,
      [input.workspaceId, input.integrationId],
    );
    const integration = integrationResult.rows[0] as Row | undefined;
    if (!integration) {
      throw new TokenlessServiceError("Integration not found.", 404, "agent_integration_not_found");
    }
    if (
      !text(integration, "token_family_id") ||
      !text(integration, "oauth_client_id") ||
      !text(integration, "oauth_subject_principal_id") ||
      text(integration, "connection_status") !== "connected" ||
      !["preauthorized_safe", "owner_approved"].includes(text(integration, "activation_mode") ?? "")
    ) {
      throw new TokenlessServiceError(
        "Only an OAuth-connected agent can receive this browser publishing grant.",
        409,
        "publishing_activation_not_supported",
      );
    }
    const agentId = text(integration, "agent_id")!;
    const versionResult = await client.query(
      `SELECT version_id FROM tokenless_agent_versions
       WHERE workspace_id = $1 AND agent_id = $2
       ORDER BY version_number DESC LIMIT 1 FOR SHARE`,
      [input.workspaceId, agentId],
    );
    const agentVersionId = text(versionResult.rows[0] as Row | undefined, "version_id");
    if (!agentVersionId) {
      throw new TokenlessServiceError("Current agent version not found.", 409, "agent_version_not_found");
    }
    const reviewResult = await client.query(
      `SELECT * FROM tokenless_agent_review_policies
       WHERE workspace_id = $1 AND agent_id = $2 AND agent_version_id = $3
         AND enabled = true AND superseded_at IS NULL
       ORDER BY version DESC LIMIT 1 FOR UPDATE`,
      [input.workspaceId, agentId, agentVersionId],
    );
    const review = reviewResult.rows[0] as Row | undefined;
    if (!review) {
      throw new TokenlessServiceError(
        "Create the current agent version's review behavior before granting autonomous access.",
        409,
        "review_policy_not_found",
      );
    }
    const activeBindingResult = await client.query(
      `SELECT b.binding_id,b.version,b.selection_policy_id,b.selection_policy_version,
              b.authority,b.publishing_policy_id,b.publishing_policy_version,
              r.compensation_mode,r.feedback_bonus_enabled
       FROM tokenless_agent_human_review_bindings b
       LEFT JOIN tokenless_agent_review_request_profiles r
         ON r.workspace_id=b.workspace_id AND r.profile_id=b.request_profile_id
        AND r.version=b.request_profile_version AND r.profile_hash=b.request_profile_hash
        AND r.agent_id=b.agent_id AND r.agent_version_id=b.agent_version_id
       WHERE b.workspace_id=$1 AND b.agent_id=$2 AND b.agent_version_id=$3
         AND b.enabled=true AND b.superseded_at IS NULL
       FOR SHARE`,
      [input.workspaceId, agentId, agentVersionId],
    );
    const activeBinding = activeBindingResult.rows[0] as Row | undefined;
    if ((activeBindingResult.rowCount ?? 0) > 1) {
      throw new TokenlessServiceError(
        "The active human-review configuration is ambiguous.",
        409,
        "human_review_configuration_required",
      );
    }
    const publishingResult = await client.query(
      `SELECT policy_id, version FROM tokenless_agent_publishing_policies
       WHERE workspace_id = $1 AND policy_id = $2 AND enabled = true AND revoked_at IS NULL
         AND effective_at <= $3 AND (expires_at IS NULL OR expires_at > $3)
       FOR SHARE`,
      [input.workspaceId, activation.publishingPolicyId, now],
    );
    const publishing = publishingResult.rows[0] as Row | undefined;
    if (!publishing) {
      throw new TokenlessServiceError("Publishing policy not found or inactive.", 404, "publishing_policy_not_found");
    }
    const reviewPolicyId = text(review, "policy_id")!;
    let reviewPolicyVersion = integer(review, "version");
    if (text(review, "publishing_policy_id") !== activation.publishingPolicyId) {
      if (activeBinding) {
        throw new TokenlessServiceError(
          "Change autonomous review through the human-review configuration so its exact bindings stay atomic.",
          409,
          "human_review_configuration_required",
        );
      }
      reviewPolicyVersion += 1;
      await client.query(
        `UPDATE tokenless_agent_review_policies SET enabled = false, superseded_at = $1
         WHERE workspace_id = $2 AND policy_id = $3 AND version = $4
           AND enabled = true AND superseded_at IS NULL`,
        [now, input.workspaceId, reviewPolicyId, reviewPolicyVersion - 1],
      );
      await client.query(
        `INSERT INTO tokenless_agent_review_policies
         (policy_id,version,workspace_id,agent_id,agent_version_id,mode,enabled,
          agreement_threshold_bps,production_floor_bps,fixed_rate_bps,maximum_unreviewed_gap,rules_json,
          audience_policy_json,publishing_policy_id,created_by,approved_by,created_at,superseded_at)
         VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,NULL)`,
        [
          reviewPolicyId,
          reviewPolicyVersion,
          input.workspaceId,
          agentId,
          agentVersionId,
          text(review, "mode"),
          integer(review, "agreement_threshold_bps"),
          integer(review, "production_floor_bps"),
          optionalInteger(review, "fixed_rate_bps"),
          integer(review, "maximum_unreviewed_gap"),
          String(review.rules_json),
          String(review.audience_policy_json),
          activation.publishingPolicyId,
          actor,
          now,
        ],
      );
    }
    const rules = jsonObject(review.rules_json, "review rules");
    const enforcementMode = rules.enforcementMode === "host_enforced" ? "host_enforced" : "advisory";
    if (enforcementMode === "host_enforced" && !text(integration, "host_enforcement_evidence_reference")) {
      throw new TokenlessServiceError(
        "Host-enforced review behavior requires verified host enforcement evidence.",
        409,
        "host_enforcement_evidence_required",
      );
    }
    const previousBinding = {
      agentVersionId: text(integration, "agent_version_id"),
      reviewPolicyId: text(integration, "review_policy_id"),
      reviewPolicyVersion: integer(integration, "review_policy_version"),
      publishingPolicyId: text(integration, "publishing_policy_id"),
      publishingPolicyVersion:
        integration.publishing_policy_version === null || integration.publishing_policy_version === undefined
          ? null
          : integer(integration, "publishing_policy_version"),
      allowedWorkflowKeys: jsonArray(integration.allowed_workflow_keys_json, "allowed workflows"),
      grantedScopes: jsonArray(integration.granted_scopes_json, "granted scopes"),
    };
    const publishingPolicyVersion = integer(publishing, "version");
    if (activeBinding) {
      const compensationMode = text(activeBinding, "compensation_mode");
      if (compensationMode !== "unpaid" && compensationMode !== "usdc") {
        throw new TokenlessServiceError(
          "The active human-review payment profile is invalid.",
          409,
          "human_review_configuration_required",
        );
      }
      const paymentProfile: HumanReviewPaymentProfile = {
        compensationMode,
        feedbackBonusEnabled:
          activeBinding.feedback_bonus_enabled === true || activeBinding.feedback_bonus_enabled === "t",
      };
      if (
        text(activeBinding, "selection_policy_id") !== reviewPolicyId ||
        integer(activeBinding, "selection_policy_version") !== reviewPolicyVersion ||
        text(activeBinding, "authority") !== "ask_automatically" ||
        text(activeBinding, "publishing_policy_id") !== activation.publishingPolicyId ||
        optionalInteger(activeBinding, "publishing_policy_version") !== publishingPolicyVersion ||
        text(integration, "human_review_binding_id") !== text(activeBinding, "binding_id") ||
        optionalInteger(integration, "human_review_binding_version") !== integer(activeBinding, "version")
      ) {
        throw new TokenlessServiceError(
          "Change autonomous review through the human-review configuration so its exact bindings stay atomic.",
          409,
          "human_review_configuration_required",
        );
      }
      scopes = automaticHumanReviewGrantScopes(paymentProfile);
    }
    await client.query(
      `UPDATE tokenless_agent_integrations
       SET agent_version_id = $1, review_policy_id = $2, review_policy_version = $3,
           publishing_policy_id = $4, publishing_policy_version = $5, enforcement_mode = $6,
           allowed_workflow_keys_json = $7, activation_mode = 'owner_approved',
           granted_scopes_json = $8, updated_at = $9
       WHERE integration_id = $10`,
      [
        agentVersionId,
        reviewPolicyId,
        reviewPolicyVersion,
        activation.publishingPolicyId,
        publishingPolicyVersion,
        enforcementMode,
        JSON.stringify(activation.allowedWorkflowKeys),
        JSON.stringify(scopes),
        now,
        input.integrationId,
      ],
    );
    const audiencePolicyHash = `sha256:${digest(
      stableJson(jsonObject(review.audience_policy_json, "audience policy")),
    )}`;
    await client.query(
      `INSERT INTO tokenless_agent_integration_events
       (event_id,integration_id,workspace_id,event_type,actor_type,actor_reference,details_json,created_at)
       VALUES ($1,$2,$3,'scope_upgraded','account',$4,$5,$6)`,
      [
        `agie_${randomUUID().replaceAll("-", "")}`,
        input.integrationId,
        input.workspaceId,
        actor,
        JSON.stringify({
          source: "browser_owner_step_up",
          explicitBrowserConsent: true,
          previousBinding,
          activeBinding: {
            agentId,
            agentVersionId,
            reviewPolicyId,
            reviewPolicyVersion,
            audiencePolicyHash,
            publishingPolicyId: activation.publishingPolicyId,
            publishingPolicyVersion,
            allowedWorkflowKeys: activation.allowedWorkflowKeys,
            grantedScopes: scopes,
          },
        }),
        now,
      ],
    );
    activated = {
      agentId,
      agentVersionId,
      reviewPolicyId,
      reviewPolicyVersion,
      audiencePolicyHash,
      publishingPolicyVersion,
    };
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (!activated) throw new Error("Publishing activation did not complete.");
  await appendAuditEvent({
    action: "agent.integration_scope_upgraded",
    actorKind: isRateLoopPrincipalId(actor) ? "principal" : "account",
    actorReference: actor,
    assuranceMethod: "rateloop_session",
    metadata: {
      agentId: activated.agentId,
      agentVersionId: activated.agentVersionId,
      reviewPolicyId: activated.reviewPolicyId,
      reviewPolicyVersion: activated.reviewPolicyVersion,
      publishingPolicyId: activation.publishingPolicyId,
      publishingPolicyVersion: activated.publishingPolicyVersion,
      allowedWorkflowCount: activation.allowedWorkflowKeys.length,
      explicitBrowserConsent: true,
    },
    purpose: "agent_publishing_step_up",
    reason: "workspace_administrator_browser_consent",
    result: "success",
    targetId: input.integrationId,
    targetKind: "agent_integration",
    workspaceId: input.workspaceId,
  });
  return {
    integration: {
      integrationId: input.integrationId,
      workspaceId: input.workspaceId,
      status: "active" as const,
      activationMode: "owner_approved" as const,
      agentId: activated.agentId,
      agentVersionId: activated.agentVersionId,
      reviewPolicyId: activated.reviewPolicyId,
      reviewPolicyVersion: activated.reviewPolicyVersion,
      audiencePolicyHash: activated.audiencePolicyHash,
      publishingPolicyId: activation.publishingPolicyId,
      publishingPolicyVersion: activated.publishingPolicyVersion,
      allowedWorkflowKeys: activation.allowedWorkflowKeys,
      grantedScopes: scopes,
      canPublish: true,
      canSpend: scopes.includes("payment:submit"),
    },
  };
}

export async function revokeAgentIntegration(input: {
  accountAddress: string;
  workspaceId: string;
  integrationId: string;
}) {
  const actor = await management(input.accountAddress, input.workspaceId);
  const now = new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT api_key_id,token_family_id FROM tokenless_agent_integrations
       WHERE workspace_id = $1 AND integration_id = $2 AND status = 'active' FOR UPDATE`,
      [input.workspaceId, input.integrationId],
    );
    if (!result.rowCount) throw new TokenlessServiceError("Integration not found.", 404, "agent_integration_not_found");
    await client.query("UPDATE tokenless_workspace_api_keys SET revoked_at = $1 WHERE key_id = $2", [
      now,
      result.rows[0]?.api_key_id,
    ]);
    const tokenFamilyId = text(result.rows[0] as Row, "token_family_id");
    if (tokenFamilyId) {
      await client.query(
        `UPDATE tokenless_agent_oauth_token_families
         SET status='revoked',revoked_at=$1,revoked_by=$2,revocation_reason='workspace_administrator_revocation'
         WHERE token_family_id=$3 AND status='active'`,
        [now, actor, tokenFamilyId],
      );
      await client.query(
        `UPDATE tokenless_agent_oauth_refresh_tokens
         SET revoked_at=COALESCE(revoked_at,$1),revocation_reason=COALESCE(revocation_reason,'workspace_administrator_revocation')
         WHERE token_family_id=$2`,
        [now, tokenFamilyId],
      );
      await client.query(
        `UPDATE tokenless_agent_oauth_access_tokens
         SET revoked_at=COALESCE(revoked_at,$1),revocation_reason=COALESCE(revocation_reason,'workspace_administrator_revocation')
         WHERE token_family_id=$2`,
        [now, tokenFamilyId],
      );
    }
    await client.query(
      "UPDATE tokenless_agent_integrations SET status = 'revoked', revoked_at = $1, updated_at = $1 WHERE integration_id = $2",
      [now, input.integrationId],
    );
    await client.query(
      `INSERT INTO tokenless_agent_integration_events (event_id,integration_id,workspace_id,event_type,actor_type,actor_reference,details_json,created_at) VALUES ($1,$2,$3,'revoked','account',$4,'{}',$5)`,
      [`agie_${randomUUID().replaceAll("-", "")}`, input.integrationId, input.workspaceId, actor, now],
    );
    await client.query("COMMIT");
    await appendAuditEvent({
      action: "agent.integration_revoked",
      actorKind: isRateLoopPrincipalId(actor) ? "principal" : "account",
      actorReference: actor,
      assuranceMethod: "rateloop_session",
      purpose: "agent_connection",
      reason: "workspace_administrator_revocation",
      result: "success",
      targetId: input.integrationId,
      targetKind: "agent_integration",
      workspaceId: input.workspaceId,
    });
    return { integration: { integrationId: input.integrationId, status: "revoked" } };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function rotateAgentIntegration(input: {
  accountAddress: string;
  workspaceId: string;
  integrationId: string;
  origin: string;
}) {
  const actor = await management(input.accountAddress, input.workspaceId);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ACTIVE_TTL_MS);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT api_key_id FROM tokenless_agent_integrations
       WHERE workspace_id = $1 AND integration_id = $2 AND status = 'active' FOR UPDATE`,
      [input.workspaceId, input.integrationId],
    );
    if (!result.rowCount) throw new TokenlessServiceError("Integration not found.", 404, "agent_integration_not_found");
    const oldKeyId = text(result.rows[0] as Row, "api_key_id");
    if (!oldKeyId) {
      throw new TokenlessServiceError(
        "OAuth connections rotate credentials in the agent host and cannot be rotated from RateLoop.",
        409,
        "credential_rotation_unavailable",
      );
    }
    const token = `rlk_${oldKeyId}_${randomBytes(32).toString("base64url")}`;
    await client.query(
      "UPDATE tokenless_workspace_api_keys SET key_hash = $1, key_prefix = $2, expires_at = $3, last_used_at = NULL WHERE key_id = $4",
      [digest(token), token.slice(0, 20), expiresAt, oldKeyId],
    );
    await client.query(
      "UPDATE tokenless_agent_pairing_sessions SET credential_hash = $1, credential_prefix = $2 WHERE api_key_id = $3",
      [digest(token), token.slice(0, 20), oldKeyId],
    );
    await client.query(
      "UPDATE tokenless_agent_integrations SET credential_expires_at = $1, credential_rotated_at = $2, updated_at = $2 WHERE integration_id = $3",
      [expiresAt, now, input.integrationId],
    );
    await client.query(
      `INSERT INTO tokenless_agent_integration_events (event_id,integration_id,workspace_id,event_type,actor_type,actor_reference,details_json,created_at) VALUES ($1,$2,$3,'credential_rotated','account',$4,$5,$6)`,
      [
        `agie_${randomUUID().replaceAll("-", "")}`,
        input.integrationId,
        input.workspaceId,
        actor,
        JSON.stringify({ apiKeyId: oldKeyId }),
        now,
      ],
    );
    await client.query("COMMIT");
    await appendAuditEvent({
      action: "agent.integration_credential_rotated",
      actorKind: isRateLoopPrincipalId(actor) ? "principal" : "account",
      actorReference: actor,
      assuranceMethod: "rateloop_session",
      metadata: { expiresAt: expiresAt.toISOString() },
      purpose: "agent_connection",
      reason: "workspace_administrator_rotation",
      result: "success",
      targetId: input.integrationId,
      targetKind: "agent_integration",
      workspaceId: input.workspaceId,
    });
    return {
      integration: { integrationId: input.integrationId, status: "active", expiresAt: expiresAt.toISOString() },
      secret: token,
      mcpUrl: `${input.origin.replace(/\/$/, "")}/api/agent/v1/mcp`,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
