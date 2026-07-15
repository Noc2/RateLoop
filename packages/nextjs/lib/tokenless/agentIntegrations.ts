import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { isRateLoopPrincipalId, normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { assertCanCreateWorkspaceAgent } from "~~/lib/billing/entitlements";
import { dbClient, dbPool } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import type { AgentEnvironment } from "~~/lib/tokenless/agentRegistry";
import {
  type ProductPrincipal,
  TOKENLESS_AGENT_SCOPES,
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

export type AgentRegistrationInput = {
  externalId: string;
  displayName: string;
  description?: string | null;
  provider: string;
  model: string;
  modelVersion?: string | null;
  deploymentName?: string | null;
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
  publishingPolicyId: string;
  publishingPolicyVersion: number;
  status: "active";
  enforcementMode: "advisory" | "host_enforced";
  allowedWorkflowKeys: string[];
  lastSeenAt: string | null;
};

export type AgentMcpPrincipal =
  | { kind: "pairing"; pairingId: string; workspaceId: string; apiKeyId: string }
  | { kind: "integration"; principal: ApiPrincipal; integration: AgentIntegrationBinding };

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Database returned invalid ${key}.`);
  return value;
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
  if (!["sandbox", "staging", "production"].includes(environment)) {
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
    deploymentName: bounded(input.deploymentName, "Deployment name", 160, true),
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
    deploymentName: text(row, "declared_deployment_name"),
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
    publishingPolicyId: text(row, "publishing_policy_id")!,
    publishingPolicyVersion: integer(row, "publishing_policy_version"),
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
  const [pairings, integrations] = await Promise.all([
    dbClient.execute({
      sql: "SELECT * FROM tokenless_agent_pairing_sessions WHERE workspace_id = ? ORDER BY created_at DESC",
      args: [input.workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT i.*, k.key_prefix AS credential_prefix, k.expires_at, a.external_id, v.display_name
                             FROM tokenless_agent_integrations i
                             JOIN tokenless_workspace_api_keys k ON k.key_id = i.api_key_id
                             JOIN tokenless_agents a ON a.agent_id = i.agent_id
                             JOIN tokenless_agent_versions v ON v.version_id = i.agent_version_id
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
        externalId: text(row, "external_id"),
        displayName: text(row, "display_name"),
        credentialPrefix: text(row, "credential_prefix"),
        expiresAt: iso(row.expires_at),
        createdAt: iso(row.created_at),
        revokedAt: iso(row.revoked_at),
      };
    }),
  };
}

export async function authenticateAgentMcpPrincipal(authorization: string | null): Promise<AgentMcpPrincipal> {
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
    sql: "SELECT * FROM tokenless_agent_integrations WHERE api_key_id = ? AND workspace_id = ? AND status = 'active' LIMIT 1",
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

export async function submitAgentRegistration(input: {
  pairing: Extract<AgentMcpPrincipal, { kind: "pairing" }>;
  registration: unknown;
}) {
  const value = normalizeRegistration(input.registration);
  const now = new Date();
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_agent_pairing_sessions SET status = 'claimed', external_id = ?, display_name = ?, description = ?, declared_provider = ?, declared_model = ?, declared_model_version = ?, declared_deployment_name = ?, environment = ?, client_name = COALESCE(?, client_name), client_version = COALESCE(?, client_version), client_capabilities_json = ?, requested_workflow_keys_json = ?, claimed_at = COALESCE(claimed_at, ?) WHERE pairing_id = ? AND status IN ('open','claimed') AND expires_at > ? RETURNING *`,
    args: [
      value.externalId,
      value.displayName,
      value.description ?? null,
      value.provider,
      value.model,
      value.modelVersion ?? null,
      value.deploymentName ?? null,
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
      deploymentName: registration.deploymentName ?? null,
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
    `INSERT INTO tokenless_agent_versions (version_id, agent_id, workspace_id, version_number, display_name, description, declared_provider, declared_model, declared_model_version, declared_deployment_name, environment, configuration_commitment, created_by, created_at) VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      versionId,
      agentId,
      input.workspaceId,
      input.registration.displayName,
      input.registration.description ?? null,
      input.registration.provider,
      input.registration.model,
      input.registration.modelVersion ?? null,
      input.registration.deploymentName ?? null,
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
    `INSERT INTO tokenless_agent_review_policies (policy_id, version, workspace_id, agent_id, agent_version_id, mode, enabled, agreement_threshold_bps, production_floor_bps, maximum_unreviewed_gap, rules_json, audience_policy_json, publishing_policy_id, created_by, approved_by, created_at) VALUES ($1,1,$2,$3,$4,'adaptive',true,9000,1000,20,$5,$6,$7,$8,$8,$9)`,
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
    const result = await client.query(
      "SELECT * FROM tokenless_agent_pairing_sessions WHERE workspace_id = $1 AND pairing_id = $2 AND status = 'claimed' FOR UPDATE",
      [input.workspaceId, input.pairingId],
    );
    const pairing = result.rows[0] as Row | undefined;
    if (!pairing) throw new TokenlessServiceError("Claimed pairing not found.", 404, "agent_pairing_not_found");
    const registration = normalizeRegistration({
      externalId: body.externalId ?? pairing.external_id,
      displayName: body.displayName ?? pairing.display_name,
      description: body.description ?? pairing.description,
      provider: body.provider ?? pairing.declared_provider,
      model: body.model ?? pairing.declared_model,
      modelVersion: body.modelVersion ?? pairing.declared_model_version,
      deploymentName: body.deploymentName ?? pairing.declared_deployment_name,
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
      "SELECT api_key_id FROM tokenless_agent_integrations WHERE workspace_id = $1 AND integration_id = $2 AND status = 'active' FOR UPDATE",
      [input.workspaceId, input.integrationId],
    );
    if (!result.rowCount) throw new TokenlessServiceError("Integration not found.", 404, "agent_integration_not_found");
    await client.query("UPDATE tokenless_workspace_api_keys SET revoked_at = $1 WHERE key_id = $2", [
      now,
      result.rows[0]?.api_key_id,
    ]);
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
      "SELECT api_key_id FROM tokenless_agent_integrations WHERE workspace_id = $1 AND integration_id = $2 AND status = 'active' FOR UPDATE",
      [input.workspaceId, input.integrationId],
    );
    if (!result.rowCount) throw new TokenlessServiceError("Integration not found.", 404, "agent_integration_not_found");
    const oldKeyId = String(result.rows[0]?.api_key_id);
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
