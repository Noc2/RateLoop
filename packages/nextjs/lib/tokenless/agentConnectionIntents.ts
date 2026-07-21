import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { isRateLoopPrincipalId, normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { assertCanCreateWorkspaceAgent } from "~~/lib/billing/entitlements";
import { dbClient, dbPool } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { DEFAULT_ADAPTIVE_AGREEMENT_THRESHOLD_BPS } from "~~/lib/tokenless/adaptiveReviewDefaults";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

export const SAFE_AGENT_CONNECTION_SCOPES = [
  "connection:claim",
  "context:read",
  "evaluation:read",
  "review:decide",
] as const;

/**
 * Connection lanes describe how a connection landed, not what is proven.
 * 'device-flow' is server-detected from the OAuth device-authorization grant.
 * 'plugin-with-hooks' is only ever a host self-declaration recorded at claim
 * time; RateLoop never verifies hook presence. Anything unreported defaults to
 * the weakest assumption, 'mcp-oauth'.
 */
export const AGENT_CONNECTION_LANES = ["plugin-with-hooks", "mcp-oauth", "device-flow"] as const;
export type AgentConnectionLane = (typeof AGENT_CONNECTION_LANES)[number] | (string & {});
export const HOST_REPORTABLE_CONNECTION_LANES = ["plugin-with-hooks", "mcp-oauth"] as const;

const REPORTED_LANE_MARKER_PREFIX = "reported-lane:";
const DEVICE_AUTHORIZATION_GRANT_MARKER = "grant:device-authorization";

export function connectionLaneFromClientCapabilitiesJson(value: unknown): AgentConnectionLane {
  const capabilities = jsonStrings(value);
  const reported = capabilities
    .find(entry => entry.startsWith(REPORTED_LANE_MARKER_PREFIX))
    ?.slice(REPORTED_LANE_MARKER_PREFIX.length);
  if (reported === "plugin-with-hooks") return "plugin-with-hooks";
  if (capabilities.includes(DEVICE_AUTHORIZATION_GRANT_MARKER)) return "device-flow";
  return "mcp-oauth";
}

export function connectionLaneStatement(lane: AgentConnectionLane) {
  if (lane === "plugin-with-hooks") {
    return "Connected via RateLoop plugin — host-reported; hook presence is not verified.";
  }
  if (lane === "device-flow") return "Device-flow connection — plugin hooks not reported.";
  return "Advisory MCP connection — plugin hooks not reported.";
}

const CLAIM_TTL_MS = 30 * 60_000;
const HARD_TTL_MS = 45 * 60_000;
const MOVE_TTL_MS = 30 * 60_000;
const SAFE_WORKFLOW_KEYS = ["general-assistance"];
const ACTIVE_INTENT_STATUSES = [
  "issued",
  "install_required",
  "authorizing",
  "approval_required",
  "testing",
  "action_required",
] as const;

export type OAuthConnectionPrincipal = {
  tokenFamilyId: string;
  clientId: string;
  clientName: string;
  subjectPrincipalId: string;
  resource: string;
  scopes: string[];
};

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

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function iso(value: unknown) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function jsonStrings(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    return Array.isArray(parsed) && parsed.every(entry => typeof entry === "string") ? parsed : [];
  } catch {
    return [];
  }
}

async function management(accountAddress: string, workspaceId: string) {
  let address: string;
  try {
    address = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("Account identity is invalid.", 400, "invalid_account");
  }
  const result = await dbClient.execute({
    sql: `SELECT m.role FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.workspace_id = ? AND m.account_address = ?
            AND m.role IN ('owner','admin') AND w.status = 'active' LIMIT 1`,
    args: [workspaceId, address],
  });
  if (!result.rowCount) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return address;
}

async function ownerManagement(accountAddress: string, workspaceId: string) {
  let address: string;
  try {
    address = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("Account identity is invalid.", 400, "invalid_account");
  }
  const result = await dbClient.execute({
    sql: `SELECT 1 FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id
          WHERE m.workspace_id=? AND m.account_address=? AND m.role='owner' AND w.status='active' LIMIT 1`,
    args: [workspaceId, address],
  });
  if (!result.rowCount) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return address;
}

function publicIntent(row: Row) {
  const moveId = text(row, "move_id");
  return {
    intentId: text(row, "intent_id")!,
    status: text(row, "status")!,
    profile: {
      key: text(row, "profile_key")!,
      version: Number(row.profile_version),
      summary:
        "Can check when human review is needed. Cannot spend, publish, read private files, or administer the workspace.",
    },
    maximumScopes: jsonStrings(row.maximum_scopes_json),
    allowedWorkflowKeys: jsonStrings(row.allowed_workflow_keys_json),
    createdAt: iso(row.created_at),
    claimExpiresAt: iso(row.claim_expires_at),
    hardExpiresAt: iso(row.hard_expires_at),
    clientName: text(row, "client_name"),
    clientVersion: text(row, "client_version"),
    lastTransitionAt: iso(row.last_transition_at),
    lastTransitionReason: text(row, "last_transition_reason"),
    diagnosticCode: text(row, "last_diagnostic_code"),
    recoveryAction: text(row, "recovery_action"),
    reconnectIntegrationId: text(row, "reconnect_integration_id"),
    workspaceMove: moveId
      ? {
          transferId: moveId,
          status: text(row, "move_status")!,
          sourceConfirmedAt: iso(row.source_confirmed_at),
          targetApprovedAt: iso(row.target_approved_at),
          expiresAt: iso(row.move_expires_at),
        }
      : null,
  };
}

async function appendIntentEvent(
  client: Pick<PoolClient, "query">,
  input: {
    intentId: string;
    workspaceId: string;
    fromStatus: string | null;
    toStatus: string;
    actorType: "account" | "principal" | "oauth_client" | "service";
    actorReference: string;
    reason: string;
    diagnosticCode?: string | null;
    details?: Record<string, unknown>;
    now: Date;
  },
) {
  await client.query(
    `INSERT INTO tokenless_agent_connection_intent_events
     (event_id,intent_id,workspace_id,from_status,to_status,actor_type,actor_reference,reason,diagnostic_code,details_json,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      `acie_${randomUUID().replaceAll("-", "")}`,
      input.intentId,
      input.workspaceId,
      input.fromStatus,
      input.toStatus,
      input.actorType,
      input.actorReference,
      input.reason,
      input.diagnosticCode ?? null,
      JSON.stringify(input.details ?? {}),
      input.now,
    ],
  );
}

async function expireConnectionIntents(workspaceId: string | null, now = new Date()) {
  const args: unknown[] = [now];
  const workspaceClause = workspaceId ? " AND workspace_id = $2" : "";
  if (workspaceId) args.push(workspaceId);
  await dbPool.query(
    `UPDATE tokenless_agent_workspace_moves
     SET status='expired'
     WHERE status IN ('source_confirmation_required','owner_approval_required')
       AND expires_at <= $1
       ${workspaceId ? "AND target_intent_id IN (SELECT intent_id FROM tokenless_agent_connection_intents WHERE workspace_id=$2)" : ""}`,
    args,
  );
  await dbPool.query(
    `UPDATE tokenless_agent_connection_intents
     SET status = 'expired', last_transition_at = $1, last_transition_reason = 'deadline_elapsed',
         last_diagnostic_code = 'connection_intent_expired', last_diagnostic_at = $1,
         recovery_action = 'Create a new connection message.'
     WHERE status IN (${ACTIVE_INTENT_STATUSES.map(status => `'${status}'`).join(",")})
       AND ((claimed_at IS NULL AND claim_expires_at <= $1) OR hard_expires_at <= $1)${workspaceClause}`,
    args,
  );
}

export async function createAgentConnectionIntent(input: {
  accountAddress: string;
  workspaceId: string;
  origin: string;
  setupRevision?: number;
  reconnectIntegrationId?: string;
}) {
  const actor = await management(input.accountAddress, input.workspaceId);
  const now = new Date();
  const claimExpiresAt = new Date(now.getTime() + CLAIM_TTL_MS);
  const hardExpiresAt = new Date(now.getTime() + HARD_TTL_MS);
  const intentId = `aci_${randomUUID().replaceAll("-", "")}`;
  const claimNonce = randomBytes(32).toString("base64url");
  const client = await dbPool.connect();
  let nextSetupRevision: number | null = null;
  try {
    await client.query("BEGIN");
    if (input.reconnectIntegrationId !== undefined) {
      if (input.setupRevision !== undefined) {
        throw new TokenlessServiceError(
          "Workspace setup cannot reconnect an existing integration.",
          409,
          "agent_setup_reconnect_not_allowed",
        );
      }
      if (!/^agi_[a-f0-9]{32}$/u.test(input.reconnectIntegrationId)) {
        throw new TokenlessServiceError("Agent integration is invalid.", 400, "invalid_agent_integration");
      }
      const target = await client.query(
        `SELECT integration_id,workspace_id,agent_id,agent_version_id,status,activation_mode,token_family_id
         FROM tokenless_agent_integrations
         WHERE integration_id=$1 AND workspace_id=$2 FOR UPDATE`,
        [input.reconnectIntegrationId, input.workspaceId],
      );
      const targetRow = target.rows[0] as Row | undefined;
      if (!targetRow || !isReconnectTargetIntegration(targetRow)) {
        throw new TokenlessServiceError("Saved OAuth integration not found.", 404, "agent_integration_not_found");
      }
      if (text(targetRow, "status") === "revoked") {
        const replacement = await client.query(
          `SELECT integration_id FROM tokenless_agent_integrations
           WHERE workspace_id=$1 AND agent_id=$2 AND agent_version_id=$3
             AND status='active' AND integration_id<>$4 FOR UPDATE`,
          [
            input.workspaceId,
            text(targetRow, "agent_id"),
            text(targetRow, "agent_version_id"),
            input.reconnectIntegrationId,
          ],
        );
        if (replacement.rowCount) {
          throw new TokenlessServiceError(
            "This saved agent already has an active connection.",
            409,
            "agent_integration_already_active",
          );
        }
      }
      await client.query(
        `UPDATE tokenless_agent_workspace_moves
         SET status='cancelled'
         WHERE target_integration_id=$1
           AND status IN ('source_confirmation_required','owner_approval_required')`,
        [input.reconnectIntegrationId],
      );
      await client.query(
        `UPDATE tokenless_agent_connection_intents
         SET status='superseded',last_transition_at=$1,last_transition_reason='reconnect_intent_replaced',
             recovery_action=NULL
         WHERE reconnect_integration_id=$2
           AND status IN (${ACTIVE_INTENT_STATUSES.map(status => `'${status}'`).join(",")})`,
        [now, input.reconnectIntegrationId],
      );
    }
    if (input.setupRevision !== undefined) {
      if (!Number.isSafeInteger(input.setupRevision) || input.setupRevision < 1) {
        throw new TokenlessServiceError("Setup revision is invalid.", 400, "invalid_agent_setup_revision");
      }
      const setup = await client.query(
        `SELECT status,revision,primary_connection_intent_id
         FROM tokenless_workspace_agent_setups WHERE workspace_id=$1 FOR UPDATE`,
        [input.workspaceId],
      );
      const setupRow = setup.rows[0] as Row | undefined;
      if (!setupRow || text(setupRow, "status") !== "in_progress") {
        throw new TokenlessServiceError("Workspace setup is not active.", 409, "agent_setup_not_active");
      }
      if (Number(setupRow.revision) !== input.setupRevision) {
        throw new TokenlessServiceError("Workspace setup changed. Reload and try again.", 409, "agent_setup_conflict");
      }
      const priorIntentId = text(setupRow, "primary_connection_intent_id");
      if (priorIntentId) {
        await client.query(
          `UPDATE tokenless_agent_connection_intents
           SET status='cancelled',cancelled_at=$1,last_transition_at=$1,
               last_transition_reason='setup_connection_replaced',recovery_action=NULL
           WHERE intent_id=$2 AND status IN (${ACTIVE_INTENT_STATUSES.map(status => `'${status}'`).join(",")})`,
          [now, priorIntentId],
        );
      }
    }
    await client.query(
      `INSERT INTO tokenless_agent_connection_intents
      (intent_id,claim_nonce_hash,workspace_id,created_by,status,profile_key,profile_version,
       maximum_scopes_json,allowed_workflow_keys_json,review_preset_json,allowed_host_families_json,
       auto_activate,created_at,claim_expires_at,hard_expires_at,last_transition_at,last_transition_reason,
       reconnect_integration_id)
      VALUES ($1,$2,$3,$4,'issued','safe_review_decisions',1,$5,$6,$7,'[]',true,$8,$9,$10,$8,$11,$12)`,
      [
        intentId,
        digest(claimNonce),
        input.workspaceId,
        actor,
        JSON.stringify(SAFE_AGENT_CONNECTION_SCOPES),
        JSON.stringify(SAFE_WORKFLOW_KEYS),
        JSON.stringify({ mode: "adaptive", enforcementMode: "advisory" }),
        now,
        claimExpiresAt,
        hardExpiresAt,
        input.reconnectIntegrationId ? "owner_created_reconnect_intent" : "owner_created_safe_intent",
        input.reconnectIntegrationId ?? null,
      ],
    );
    await client.query(
      `INSERT INTO tokenless_agent_connection_intent_events
          (event_id,intent_id,workspace_id,from_status,to_status,actor_type,actor_reference,reason,details_json,created_at)
          VALUES ($1,$2,$3,NULL,'issued',$4,$5,$6,$7,$8)`,
      [
        `acie_${randomUUID().replaceAll("-", "")}`,
        intentId,
        input.workspaceId,
        isRateLoopPrincipalId(actor) ? "principal" : "account",
        actor,
        input.reconnectIntegrationId ? "owner_created_reconnect_intent" : "owner_created_safe_intent",
        JSON.stringify(input.reconnectIntegrationId ? { reconnectIntegrationId: input.reconnectIntegrationId } : {}),
        now,
      ],
    );
    if (input.setupRevision !== undefined) {
      nextSetupRevision = input.setupRevision + 1;
      await client.query(
        `UPDATE tokenless_workspace_agent_setups
         SET primary_connection_intent_id=$1,primary_integration_id=NULL,
             confirmed_agent_version_id=NULL,agent_confirmed_at=NULL,agent_confirmed_by=NULL,
             review_draft_json='{}',review_policy_id=NULL,review_policy_version=NULL,
             reviews_confirmed_at=NULL,reviews_confirmed_by=NULL,people_decision=NULL,
             private_group_id=NULL,people_decided_at=NULL,people_decided_by=NULL,
             current_step='connect',revision=$2,updated_at=$3
         WHERE workspace_id=$4`,
        [intentId, nextSetupRevision, now, input.workspaceId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await appendAuditEvent({
    action: "agent.connection_intent_created",
    actorKind: isRateLoopPrincipalId(actor) ? "principal" : "account",
    actorReference: actor,
    assuranceMethod: "rateloop_session",
    metadata: {
      claimExpiresAt: claimExpiresAt.toISOString(),
      profileKey: "safe_review_decisions",
      reconnectIntegrationId: input.reconnectIntegrationId ?? null,
    },
    purpose: "agent_connection",
    reason: "workspace_administrator_request",
    result: "success",
    targetId: intentId,
    targetKind: "agent_connection_intent",
    workspaceId: input.workspaceId,
  });
  const origin = new URL(input.origin).origin;
  return {
    intent: {
      intentId,
      status: "issued",
      createdAt: now.toISOString(),
      claimExpiresAt: claimExpiresAt.toISOString(),
      hardExpiresAt: hardExpiresAt.toISOString(),
      reconnectIntegrationId: input.reconnectIntegrationId ?? null,
    },
    connectionUrl: `${origin}/connect/${intentId}#claim=${claimNonce}`,
    setupRevision: nextSetupRevision,
  };
}

export async function listAgentConnectionIntents(input: { accountAddress: string; workspaceId: string }) {
  await management(input.accountAddress, input.workspaceId);
  await expireConnectionIntents(input.workspaceId);
  const result = await dbClient.execute({
    sql: `SELECT c.*,m.move_id,m.status AS move_status,m.source_confirmed_at,m.target_approved_at,
                 m.expires_at AS move_expires_at
          FROM tokenless_agent_connection_intents c
          LEFT JOIN tokenless_agent_workspace_moves m ON m.target_intent_id=c.intent_id
          WHERE c.workspace_id = ? ORDER BY c.created_at DESC`,
    args: [input.workspaceId],
  });
  return { intents: result.rows.map(row => publicIntent(row as Row)) };
}

export async function getPublicAgentConnectionIntent(intentId: string) {
  if (!/^aci_[a-f0-9]{32}$/.test(intentId)) {
    throw new TokenlessServiceError("Connection not found.", 404, "connection_intent_not_found");
  }
  await expireConnectionIntents(null);
  const result = await dbClient.execute({
    sql: `SELECT c.*,m.move_id,m.status AS move_status,m.source_confirmed_at,m.target_approved_at,
                 m.expires_at AS move_expires_at
          FROM tokenless_agent_connection_intents c
          LEFT JOIN tokenless_agent_workspace_moves m ON m.target_intent_id=c.intent_id
          WHERE c.intent_id = ? LIMIT 1`,
    args: [intentId],
  });
  if (!result.rowCount) throw new TokenlessServiceError("Connection not found.", 404, "connection_intent_not_found");
  return publicIntent(result.rows[0] as Row);
}

export async function cancelAgentConnectionIntent(input: {
  accountAddress: string;
  workspaceId: string;
  intentId: string;
}) {
  const actor = await management(input.accountAddress, input.workspaceId);
  const now = new Date();
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_agent_connection_intents
          SET status = 'cancelled', cancelled_at = ?, last_transition_at = ?,
              last_transition_reason = 'owner_cancelled', recovery_action = NULL
          WHERE workspace_id = ? AND intent_id = ?
            AND status IN ('issued','install_required','authorizing','approval_required','testing','action_required')
          RETURNING intent_id`,
    args: [now, now, input.workspaceId, input.intentId],
  });
  if (!result.rowCount)
    throw new TokenlessServiceError("Active connection not found.", 404, "connection_intent_not_found");
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_workspace_moves SET status='cancelled'
          WHERE target_intent_id=? AND status IN ('source_confirmation_required','owner_approval_required')`,
    args: [input.intentId],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_connection_intent_events
          (event_id,intent_id,workspace_id,from_status,to_status,actor_type,actor_reference,reason,details_json,created_at)
          VALUES (?, ?, ?, NULL, 'cancelled', ?, ?, 'owner_cancelled', '{}', ?)`,
    args: [
      `acie_${randomUUID().replaceAll("-", "")}`,
      input.intentId,
      input.workspaceId,
      isRateLoopPrincipalId(actor) ? "principal" : "account",
      actor,
      now,
    ],
  });
  return { intent: { intentId: input.intentId, status: "cancelled" } };
}

function parseConnectionUrl(connectionUrl: string, origin: string) {
  let url: URL;
  try {
    url = new URL(connectionUrl);
  } catch {
    throw new TokenlessServiceError("Connection URL is invalid.", 400, "invalid_connection_url");
  }
  const expectedOrigin = new URL(origin).origin;
  const pathMatch = /^\/connect\/(aci_[a-f0-9]{32})$/.exec(url.pathname);
  const claimNonce = new URLSearchParams(url.hash.slice(1)).get("claim");
  if (
    url.origin !== expectedOrigin ||
    !pathMatch ||
    url.search ||
    !claimNonce ||
    !/^[A-Za-z0-9_-]{43}$/.test(claimNonce)
  ) {
    throw new TokenlessServiceError("Connection URL is invalid.", 400, "invalid_connection_url");
  }
  return { intentId: pathMatch[1], claimNonce };
}

function requireSafeScopes(principal: OAuthConnectionPrincipal) {
  if (SAFE_AGENT_CONNECTION_SCOPES.some(scope => !principal.scopes.includes(scope))) {
    throw new TokenlessServiceError("The OAuth grant lacks the safe connection scopes.", 403, "insufficient_scope");
  }
}

function versionCommitment(input: { clientId: string; clientName: string; tokenFamilyId: string }) {
  return digest(
    stableJson({
      clientId: input.clientId,
      clientName: input.clientName,
      declaredModel: "unknown",
      declaredModelVersion: null,
      declaredProvider: "unknown",
      environment: "production",
      tokenFamilyId: input.tokenFamilyId,
    }),
  );
}

async function activeClaimForFamily(client: PoolClient, tokenFamilyId: string) {
  const result = await client.query(
    `SELECT i.integration_id,i.connection_intent_id,i.workspace_id,i.agent_id,i.agent_version_id,
            i.review_policy_id,i.review_policy_version,i.status,c.status AS connection_status,
            c.client_capabilities_json
     FROM tokenless_agent_integrations i
     JOIN tokenless_agent_connection_intents c ON c.intent_id = i.connection_intent_id
     WHERE i.token_family_id = $1 AND i.status='active' LIMIT 2`,
    [tokenFamilyId],
  );
  if ((result.rowCount ?? 0) > 1) {
    throw new TokenlessServiceError("OAuth connection binding is invalid.", 500, "oauth_binding_invalid");
  }
  const row = result.rows[0] as Row | undefined;
  if (!row) return null;
  return {
    connectionIntentId: text(row, "connection_intent_id")!,
    integrationId: text(row, "integration_id")!,
    workspaceId: text(row, "workspace_id")!,
    agentId: text(row, "agent_id")!,
    agentVersionId: text(row, "agent_version_id")!,
    reviewPolicyId: text(row, "review_policy_id")!,
    reviewPolicyVersion: Number(row.review_policy_version),
    status: text(row, "connection_status")!,
    reportedLane: connectionLaneFromClientCapabilitiesJson(row.client_capabilities_json),
  };
}

function targetBindingHash(row: Row) {
  return `sha256:${digest(
    stableJson({
      activationMode: text(row, "activation_mode"),
      agentId: text(row, "agent_id"),
      agentVersionId: text(row, "agent_version_id"),
      allowedWorkflowKeys: jsonStrings(row.allowed_workflow_keys_json),
      enforcementMode: text(row, "enforcement_mode"),
      grantedScopes: jsonStrings(row.granted_scopes_json),
      integrationId: text(row, "integration_id"),
      oauthClientId: text(row, "oauth_client_id"),
      oauthSubjectPrincipalId: text(row, "oauth_subject_principal_id"),
      publishingPolicyId: text(row, "publishing_policy_id"),
      publishingPolicyVersion: row.publishing_policy_version === null ? null : Number(row.publishing_policy_version),
      reviewPolicyId: text(row, "review_policy_id"),
      reviewPolicyVersion: Number(row.review_policy_version),
      status: text(row, "status"),
      tokenFamilyId: text(row, "token_family_id"),
      workspaceId: text(row, "workspace_id"),
    }),
  )}`;
}

function isReconnectTargetIntegration(row: Row) {
  if (!["preauthorized_safe", "owner_approved"].includes(text(row, "activation_mode") ?? "")) return false;
  const status = text(row, "status");
  return (status === "active" && Boolean(text(row, "token_family_id"))) || status === "revoked";
}

function workspaceMovePayload(row: Row) {
  return {
    status: text(row, "status")!,
    transferId: text(row, "move_id")!,
    expiresAt: iso(row.expires_at)!,
    consequence: "Moving this connection disconnects it from its current RateLoop workspace.",
    nextAction:
      text(row, "status") === "source_confirmation_required"
        ? "confirm_workspace_move"
        : text(row, "status") === "owner_approval_required"
          ? "owner_approve_then_retry_connection"
          : "retry_connection",
  };
}

async function prepareAgentWorkspaceMove(
  client: PoolClient,
  input: {
    intent: Row;
    principal: OAuthConnectionPrincipal;
    mcpSessionHash: string | undefined;
    source: Awaited<ReturnType<typeof activeClaimForFamily>>;
    clientCapabilitiesJson: string;
    now: Date;
  },
) {
  const targetIntegrationId = text(input.intent, "reconnect_integration_id");
  if (!targetIntegrationId) {
    throw new TokenlessServiceError(
      "This OAuth connection is already bound to another workspace.",
      409,
      "workspace_conflict",
    );
  }
  if (!input.mcpSessionHash || !/^sha256:[0-9a-f]{64}$/u.test(input.mcpSessionHash)) {
    throw new TokenlessServiceError("MCP-Session-Id is required.", 400, "mcp_session_required");
  }
  if (input.source?.integrationId === targetIntegrationId) {
    return { existingConnection: input.source } as const;
  }
  const targetResult = await client.query(
    `SELECT * FROM tokenless_agent_integrations
     WHERE integration_id=$1 AND workspace_id=$2 FOR UPDATE`,
    [targetIntegrationId, text(input.intent, "workspace_id")],
  );
  const target = targetResult.rows[0] as Row | undefined;
  if (!target || !isReconnectTargetIntegration(target)) {
    throw new TokenlessServiceError("Saved OAuth integration not found.", 404, "agent_integration_not_found");
  }
  if (text(target, "status") === "revoked") {
    const replacement = await client.query(
      `SELECT integration_id FROM tokenless_agent_integrations
       WHERE workspace_id=$1 AND agent_id=$2 AND agent_version_id=$3
         AND status='active' AND integration_id<>$4 FOR UPDATE`,
      [text(target, "workspace_id"), text(target, "agent_id"), text(target, "agent_version_id"), targetIntegrationId],
    );
    if (replacement.rowCount) {
      throw new TokenlessServiceError(
        "This saved agent already has an active connection.",
        409,
        "agent_integration_already_active",
      );
    }
  }
  const session = await client.query(
    `SELECT session_hash FROM tokenless_mcp_sessions
     WHERE session_hash=$1 AND subject_principal_id=$2 AND token_family_id=$3
       AND status='active' AND expires_at>$4 FOR UPDATE`,
    [input.mcpSessionHash, input.principal.subjectPrincipalId, input.principal.tokenFamilyId, input.now],
  );
  if (!session.rowCount) {
    throw new TokenlessServiceError("MCP session is expired or mismatched.", 404, "mcp_session_not_found");
  }
  const priorMove = await client.query(
    `SELECT * FROM tokenless_agent_workspace_moves WHERE target_intent_id=$1 FOR UPDATE`,
    [text(input.intent, "intent_id")],
  );
  const existing = priorMove.rows[0] as Row | undefined;
  if (existing) {
    if (
      text(existing, "source_token_family_id") !== input.principal.tokenFamilyId ||
      text(existing, "oauth_subject_principal_id") !== input.principal.subjectPrincipalId
    ) {
      throw new TokenlessServiceError("This reconnect belongs to another credential.", 409, "claimant_mismatch");
    }
    return { workspaceMove: workspaceMovePayload(existing), idempotent: true } as const;
  }
  const moveId = `acm_${randomUUID().replaceAll("-", "")}`;
  const expiresAt = new Date(
    Math.min(input.now.getTime() + MOVE_TTL_MS, new Date(String(input.intent.hard_expires_at)).getTime()),
  );
  await client.query(
    `INSERT INTO tokenless_agent_workspace_moves
     (move_id,target_intent_id,source_token_family_id,source_integration_id,source_workspace_id,
      target_integration_id,target_workspace_id,target_prior_token_family_id,target_prior_connection_intent_id,
      oauth_client_id,oauth_subject_principal_id,initiating_mcp_session_hash,target_binding_hash,status,created_at,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'source_confirmation_required',$14,$15)`,
    [
      moveId,
      text(input.intent, "intent_id"),
      input.principal.tokenFamilyId,
      input.source?.integrationId ?? null,
      input.source?.workspaceId ?? null,
      targetIntegrationId,
      text(input.intent, "workspace_id"),
      text(target, "token_family_id"),
      text(target, "connection_intent_id"),
      input.principal.clientId,
      input.principal.subjectPrincipalId,
      input.mcpSessionHash,
      targetBindingHash(target),
      input.now,
      expiresAt,
    ],
  );
  await client.query(
    `UPDATE tokenless_agent_connection_intents
     SET status='action_required',client_name=$1,client_capabilities_json=$2,last_transition_at=$3,
         last_transition_reason='workspace_move_source_confirmation_required',
         last_diagnostic_code='workspace_move_source_confirmation_required',last_diagnostic_at=$3,
         recovery_action='The connected agent must confirm moving its current RateLoop connection.'
     WHERE intent_id=$4`,
    [input.principal.clientName, input.clientCapabilitiesJson, input.now, text(input.intent, "intent_id")],
  );
  return {
    workspaceMove: workspaceMovePayload({
      move_id: moveId,
      status: "source_confirmation_required",
      expires_at: expiresAt,
    }),
    idempotent: false,
  } as const;
}

export async function confirmAgentWorkspaceMove(input: {
  principal: OAuthConnectionPrincipal;
  transferId: string;
  origin: string;
}) {
  requireSafeScopes(input.principal);
  if (!/^acm_[a-f0-9]{32}$/u.test(input.transferId)) {
    throw new TokenlessServiceError("Workspace move not found.", 404, "workspace_move_not_found");
  }
  const now = new Date();
  const client = await dbPool.connect();
  let workspaceId: string | null = null;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT m.*,c.status AS intent_status
       FROM tokenless_agent_workspace_moves m
       JOIN tokenless_agent_connection_intents c ON c.intent_id=m.target_intent_id
       WHERE m.move_id=$1 FOR UPDATE`,
      [input.transferId],
    );
    const move = result.rows[0] as Row | undefined;
    if (!move) throw new TokenlessServiceError("Workspace move not found.", 404, "workspace_move_not_found");
    workspaceId = text(move, "target_workspace_id")!;
    if (
      text(move, "source_token_family_id") !== input.principal.tokenFamilyId ||
      text(move, "oauth_client_id") !== input.principal.clientId ||
      text(move, "oauth_subject_principal_id") !== input.principal.subjectPrincipalId
    ) {
      throw new TokenlessServiceError("This workspace move belongs to another credential.", 403, "claimant_mismatch");
    }
    if (new Date(String(move.expires_at)).getTime() <= now.getTime()) {
      if (["source_confirmation_required", "owner_approval_required"].includes(text(move, "status")!)) {
        await client.query("UPDATE tokenless_agent_workspace_moves SET status='expired' WHERE move_id=$1", [
          input.transferId,
        ]);
      }
      throw new TokenlessServiceError("This workspace move has expired.", 410, "workspace_move_expired");
    }
    const status = text(move, "status")!;
    if (status === "completed") {
      await client.query("COMMIT");
      const approvalUrl = new URL(
        `/agents?tab=connect&workspace=${encodeURIComponent(workspaceId)}&move=${encodeURIComponent(input.transferId)}`,
        new URL(input.origin).origin,
      ).toString();
      return {
        workspaceMove: { ...workspaceMovePayload(move), approvalUrl },
        idempotent: true,
      };
    }
    if (status === "expired" || status === "cancelled") {
      throw new TokenlessServiceError("This workspace move is no longer active.", 410, "workspace_move_inactive");
    }
    const session = await client.query(
      `SELECT 1 FROM tokenless_mcp_sessions
       WHERE session_hash=$1 AND subject_principal_id=$2 AND token_family_id=$3
         AND status='active' AND expires_at>$4 FOR UPDATE`,
      [
        text(move, "initiating_mcp_session_hash"),
        input.principal.subjectPrincipalId,
        input.principal.tokenFamilyId,
        now,
      ],
    );
    if (!session.rowCount) {
      throw new TokenlessServiceError("MCP session is expired or mismatched.", 404, "mcp_session_not_found");
    }
    let idempotent = true;
    if (status === "source_confirmation_required") {
      await client.query(
        `UPDATE tokenless_agent_workspace_moves
         SET status='owner_approval_required',source_confirmed_at=$1 WHERE move_id=$2`,
        [now, input.transferId],
      );
      await client.query(
        `UPDATE tokenless_agent_connection_intents
         SET status='approval_required',last_transition_at=$1,
             last_transition_reason='workspace_move_source_confirmed',
             last_diagnostic_code='workspace_move_owner_approval_required',last_diagnostic_at=$1,
             recovery_action='Approve this reconnect from the target workspace.'
         WHERE intent_id=$2`,
        [now, text(move, "target_intent_id")],
      );
      await appendIntentEvent(client, {
        intentId: text(move, "target_intent_id")!,
        workspaceId,
        fromStatus: text(move, "intent_status"),
        toStatus: "approval_required",
        actorType: "oauth_client",
        actorReference: input.principal.clientId,
        reason: "workspace_move_source_confirmed",
        details: { transferId: input.transferId },
        now,
      });
      idempotent = false;
    }
    await client.query("COMMIT");
    const approvalUrl = new URL(
      `/agents?tab=connect&workspace=${encodeURIComponent(workspaceId)}&move=${encodeURIComponent(input.transferId)}`,
      new URL(input.origin).origin,
    ).toString();
    const workspaceMove = workspaceMovePayload({
      ...move,
      status: "owner_approval_required",
      source_confirmed_at: move.source_confirmed_at ?? now,
    });
    return { workspaceMove: { ...workspaceMove, approvalUrl }, idempotent };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function completedWorkspaceMoveConnection(client: PoolClient, integrationId: string) {
  const result = await client.query(
    `SELECT i.integration_id,i.connection_intent_id,i.workspace_id,i.agent_id,i.agent_version_id,
            i.review_policy_id,i.review_policy_version,c.status AS connection_status,c.client_capabilities_json
     FROM tokenless_agent_integrations i
     JOIN tokenless_agent_connection_intents c ON c.intent_id=i.connection_intent_id
     WHERE i.integration_id=$1 LIMIT 1`,
    [integrationId],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new Error("Completed workspace move is missing its integration.");
  return {
    intentId: text(row, "connection_intent_id")!,
    integrationId: text(row, "integration_id")!,
    workspaceId: text(row, "workspace_id")!,
    agentId: text(row, "agent_id")!,
    agentVersionId: text(row, "agent_version_id")!,
    reviewPolicyId: text(row, "review_policy_id")!,
    reviewPolicyVersion: Number(row.review_policy_version),
    status: text(row, "connection_status")!,
    reportedLane: connectionLaneFromClientCapabilitiesJson(row.client_capabilities_json),
  };
}

export async function approveAgentWorkspaceMove(input: {
  accountAddress: string;
  workspaceId: string;
  transferId: string;
}) {
  const actor = await ownerManagement(input.accountAddress, input.workspaceId);
  if (!/^acm_[a-f0-9]{32}$/u.test(input.transferId)) {
    throw new TokenlessServiceError("Workspace move not found.", 404, "workspace_move_not_found");
  }
  const now = new Date();
  const client = await dbPool.connect();
  let connection: Awaited<ReturnType<typeof completedWorkspaceMoveConnection>> | null = null;
  let idempotent = false;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT m.*,c.maximum_scopes_json,c.client_name AS intent_client_name,
              c.client_version AS intent_client_version,c.client_capabilities_json
       FROM tokenless_agent_workspace_moves m
       JOIN tokenless_agent_connection_intents c ON c.intent_id=m.target_intent_id
       WHERE m.move_id=$1 AND m.target_workspace_id=$2 FOR UPDATE`,
      [input.transferId, input.workspaceId],
    );
    const move = result.rows[0] as Row | undefined;
    if (!move) throw new TokenlessServiceError("Workspace move not found.", 404, "workspace_move_not_found");
    const status = text(move, "status")!;
    if (status === "completed") {
      connection = await completedWorkspaceMoveConnection(client, text(move, "completed_integration_id")!);
      idempotent = true;
      await client.query("COMMIT");
      return { connection, workspaceMove: workspaceMovePayload(move), idempotent };
    }
    if (new Date(String(move.expires_at)).getTime() <= now.getTime()) {
      if (["source_confirmation_required", "owner_approval_required"].includes(status)) {
        await client.query("UPDATE tokenless_agent_workspace_moves SET status='expired' WHERE move_id=$1", [
          input.transferId,
        ]);
      }
      throw new TokenlessServiceError("This workspace move has expired.", 410, "workspace_move_expired");
    }
    if (status === "source_confirmation_required") {
      throw new TokenlessServiceError(
        "The connected agent must confirm this move first.",
        409,
        "workspace_move_source_confirmation_required",
      );
    }
    if (status !== "owner_approval_required") {
      throw new TokenlessServiceError("This workspace move is no longer active.", 410, "workspace_move_inactive");
    }
    const targetResult = await client.query(
      `SELECT i.*,c.status AS connection_status FROM tokenless_agent_integrations i
       JOIN tokenless_agent_connection_intents c ON c.intent_id=i.connection_intent_id
       WHERE i.integration_id=$1 AND i.workspace_id=$2 FOR UPDATE`,
      [text(move, "target_integration_id"), input.workspaceId],
    );
    const target = targetResult.rows[0] as Row | undefined;
    const targetPriorFamilyId = text(move, "target_prior_token_family_id");
    const targetStatus = text(target, "status");
    const targetFamilyId = text(target, "token_family_id");
    const targetStateMatches =
      targetStatus === "active"
        ? Boolean(targetPriorFamilyId) && targetFamilyId === targetPriorFamilyId
        : targetStatus === "revoked" && (targetPriorFamilyId === null || targetFamilyId === targetPriorFamilyId);
    if (
      !target ||
      !isReconnectTargetIntegration(target) ||
      !targetStateMatches ||
      targetBindingHash(target) !== text(move, "target_binding_hash")
    ) {
      throw new TokenlessServiceError(
        "The target connection changed. Create a new reconnect link.",
        409,
        "workspace_move_binding_changed",
      );
    }
    const activeReplacement = await client.query(
      `SELECT integration_id FROM tokenless_agent_integrations
       WHERE workspace_id=$1 AND agent_id=$2 AND agent_version_id=$3
         AND status='active' AND integration_id<>$4 FOR UPDATE`,
      [
        text(target, "workspace_id"),
        text(target, "agent_id"),
        text(target, "agent_version_id"),
        text(target, "integration_id"),
      ],
    );
    if (activeReplacement.rowCount) {
      throw new TokenlessServiceError(
        "This saved agent already has an active connection.",
        409,
        "agent_integration_already_active",
      );
    }
    const familyResult = await client.query(
      `SELECT * FROM tokenless_agent_oauth_token_families
       WHERE token_family_id=$1 AND client_id=$2 AND subject_principal_id=$3
         AND status='active' AND absolute_expires_at>$4 FOR UPDATE`,
      [
        text(move, "source_token_family_id"),
        text(move, "oauth_client_id"),
        text(move, "oauth_subject_principal_id"),
        now,
      ],
    );
    const family = familyResult.rows[0] as Row | undefined;
    if (!family) {
      throw new TokenlessServiceError(
        "The source credential is no longer active.",
        409,
        "workspace_move_source_changed",
      );
    }
    const currentScopes = new Set(jsonStrings(family.granted_scopes_json));
    if (jsonStrings(move.maximum_scopes_json).some(scope => !currentScopes.has(scope))) {
      throw new TokenlessServiceError("The OAuth grant lacks the reconnect scopes.", 403, "insufficient_scope");
    }
    let source: Row | undefined;
    const sourceIntegrationId = text(move, "source_integration_id");
    if (sourceIntegrationId) {
      const sourceResult = await client.query(
        `SELECT i.*,c.status AS connection_status FROM tokenless_agent_integrations i
         JOIN tokenless_agent_connection_intents c ON c.intent_id=i.connection_intent_id
         WHERE i.integration_id=$1 AND i.workspace_id=$2 FOR UPDATE`,
        [sourceIntegrationId, text(move, "source_workspace_id")],
      );
      source = sourceResult.rows[0] as Row | undefined;
      if (
        !source ||
        text(source, "status") !== "active" ||
        text(source, "token_family_id") !== text(move, "source_token_family_id")
      ) {
        throw new TokenlessServiceError(
          "The source connection changed. Start the reconnect again.",
          409,
          "workspace_move_source_changed",
        );
      }
    }
    const inFlight = await client.query(
      `SELECT 1 FROM tokenless_agent_review_continuations
       WHERE status='active' AND (integration_id=$1 OR integration_id=$2) LIMIT 1`,
      [sourceIntegrationId, text(move, "target_integration_id")],
    );
    if (inFlight.rowCount) {
      throw new TokenlessServiceError(
        "Finish the active review request before reconnecting.",
        409,
        "workspace_move_work_in_progress",
      );
    }
    const pendingOpportunity = await client.query(
      `SELECT 1 FROM tokenless_agent_review_opportunities o
       JOIN tokenless_agent_review_opportunity_lifecycles l
         ON l.workspace_id=o.workspace_id AND l.opportunity_id=o.opportunity_id
       WHERE l.state IN ('evaluating','approval_required','request_ready','pending','blocked')
         AND ((o.workspace_id=$1 AND o.agent_id=$2 AND o.agent_version_id=$3)
           OR (o.workspace_id=$4 AND o.agent_id=$5 AND o.agent_version_id=$6)) LIMIT 1`,
      [
        source ? text(source, "workspace_id") : "",
        source ? text(source, "agent_id") : "",
        source ? text(source, "agent_version_id") : "",
        text(target, "workspace_id"),
        text(target, "agent_id"),
        text(target, "agent_version_id"),
      ],
    );
    if (pendingOpportunity.rowCount) {
      throw new TokenlessServiceError(
        "Finish the active review request before reconnecting.",
        409,
        "workspace_move_work_in_progress",
      );
    }
    const sourceFamilyId = text(move, "source_token_family_id")!;
    const affectedFamilies = [sourceFamilyId, targetPriorFamilyId ?? sourceFamilyId];
    await client.query(
      `UPDATE tokenless_mcp_elicitation_requests SET state='expired'
       WHERE state <> 'responded' AND state <> 'expired'
         AND session_hash IN (
           SELECT session_hash FROM tokenless_mcp_sessions WHERE token_family_id=$1 OR token_family_id=$2
         )`,
      affectedFamilies,
    );
    await client.query(
      `UPDATE tokenless_mcp_sessions SET status='revoked',last_seen_at=$1
       WHERE status='active' AND (token_family_id=$2 OR token_family_id=$3)`,
      [now, ...affectedFamilies],
    );
    if (targetPriorFamilyId) {
      await client.query(
        `UPDATE tokenless_agent_oauth_authorization_codes SET revoked_at=$1
         WHERE token_family_id=$2 AND revoked_at IS NULL`,
        [now, targetPriorFamilyId],
      );
      await client.query(
        `UPDATE tokenless_agent_oauth_refresh_tokens
         SET revoked_at=$1,revocation_reason='workspace_connection_replaced'
         WHERE token_family_id=$2 AND revoked_at IS NULL`,
        [now, targetPriorFamilyId],
      );
      await client.query(
        `UPDATE tokenless_agent_oauth_access_tokens
         SET revoked_at=$1,revocation_reason='workspace_connection_replaced'
         WHERE token_family_id=$2 AND revoked_at IS NULL`,
        [now, targetPriorFamilyId],
      );
      await client.query(
        `UPDATE tokenless_agent_oauth_token_families
         SET status='revoked',revoked_at=$1,revoked_by=$2,revocation_reason='workspace_connection_replaced'
         WHERE token_family_id=$3 AND status='active'`,
        [now, actor, targetPriorFamilyId],
      );
    }
    const revokedIntegrations: Array<{ integrationId: string; workspaceId: string }> = [];
    if (targetStatus === "active") {
      revokedIntegrations.push({
        integrationId: text(target, "integration_id")!,
        workspaceId: text(target, "workspace_id")!,
      });
    }
    if (source) {
      revokedIntegrations.push({
        integrationId: text(source, "integration_id")!,
        workspaceId: text(source, "workspace_id")!,
      });
    }
    for (const revoked of revokedIntegrations) {
      await client.query(
        `UPDATE tokenless_agent_integrations
         SET status='revoked',token_family_id=NULL,revoked_at=$1,updated_at=$1,
             last_diagnostic_code='workspace_connection_replaced',last_diagnostic_at=$1,
             recovery_action=NULL WHERE integration_id=$2`,
        [now, revoked.integrationId],
      );
      await client.query(
        `INSERT INTO tokenless_agent_integration_events
         (event_id,integration_id,workspace_id,event_type,actor_type,actor_reference,details_json,created_at)
         VALUES ($1,$2,$3,'revoked','account',$4,$5,$6)`,
        [
          `agie_${randomUUID().replaceAll("-", "")}`,
          revoked.integrationId,
          revoked.workspaceId,
          actor,
          JSON.stringify({ reason: "workspace_connection_replaced", transferId: input.transferId }),
          now,
        ],
      );
    }
    const sourceIntentId = source ? text(source, "connection_intent_id") : null;
    if (sourceIntentId) {
      await client.query(
        `UPDATE tokenless_agent_connection_intents
         SET status='superseded',claimed_token_family_id=NULL,last_transition_at=$1,
             last_transition_reason='workspace_connection_moved',recovery_action=NULL WHERE intent_id=$2`,
        [now, sourceIntentId],
      );
      await appendIntentEvent(client, {
        intentId: sourceIntentId,
        workspaceId: text(source, "workspace_id")!,
        fromStatus: text(source, "connection_status") ?? "connected",
        toStatus: "superseded",
        actorType: "account",
        actorReference: actor,
        reason: "workspace_connection_moved",
        details: { transferId: input.transferId },
        now,
      });
    }
    const targetPriorIntentId = text(move, "target_prior_connection_intent_id");
    if (targetPriorIntentId && text(target, "connection_status") !== "superseded") {
      await client.query(
        `UPDATE tokenless_agent_connection_intents
         SET status='superseded',claimed_token_family_id=NULL,last_transition_at=$1,
             last_transition_reason='workspace_connection_replaced',recovery_action=NULL WHERE intent_id=$2`,
        [now, targetPriorIntentId],
      );
      await appendIntentEvent(client, {
        intentId: targetPriorIntentId,
        workspaceId: text(target, "workspace_id")!,
        fromStatus: text(target, "connection_status") ?? "connected",
        toStatus: "superseded",
        actorType: "account",
        actorReference: actor,
        reason: "workspace_connection_replaced",
        details: { transferId: input.transferId },
        now,
      });
    }
    const integrationId = `agi_${randomUUID().replaceAll("-", "")}`;
    await client.query(
      `INSERT INTO tokenless_agent_integrations
       (integration_id,pairing_id,workspace_id,agent_id,agent_version_id,review_policy_id,review_policy_version,
        publishing_policy_id,publishing_policy_version,api_key_id,status,enforcement_mode,allowed_workflow_keys_json,
        client_name,client_version,client_capabilities_json,host_enforcement_evidence_reference,credential_expires_at,
        credential_rotated_at,created_by,created_at,updated_at,connection_intent_id,token_family_id,activation_mode,
        granted_scopes_json,oauth_client_id,oauth_subject_principal_id,human_review_binding_id,human_review_binding_version)
       VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8,NULL,'active',$9,$10,$11,$12,$13,$14,NULL,NULL,$15,$16,$16,$17,$18,
               $19,$20,$21,$22,$23,$24)`,
      [
        integrationId,
        text(target, "workspace_id"),
        text(target, "agent_id"),
        text(target, "agent_version_id"),
        text(target, "review_policy_id"),
        Number(target.review_policy_version),
        text(target, "publishing_policy_id"),
        target.publishing_policy_version === null ? null : Number(target.publishing_policy_version),
        text(target, "enforcement_mode"),
        String(target.allowed_workflow_keys_json),
        text(move, "intent_client_name") ?? text(target, "client_name"),
        text(move, "intent_client_version") ?? text(target, "client_version"),
        String(move.client_capabilities_json ?? "[]"),
        text(target, "host_enforcement_evidence_reference"),
        actor,
        now,
        text(move, "target_intent_id"),
        text(move, "source_token_family_id"),
        text(target, "activation_mode"),
        String(target.granted_scopes_json),
        text(move, "oauth_client_id"),
        text(move, "oauth_subject_principal_id"),
        text(target, "human_review_binding_id"),
        target.human_review_binding_version == null ? null : Number(target.human_review_binding_version),
      ],
    );
    await client.query(
      `UPDATE tokenless_agent_connection_intents
       SET status='testing',claimed_at=$1,consumed_at=$1,claimed_token_family_id=$2,
           claimed_oauth_client_id=$3,claimed_subject_principal_id=$4,last_transition_at=$1,
           last_transition_reason='workspace_move_approved',last_diagnostic_code=NULL,last_diagnostic_at=$1,
           recovery_action='Retry connection initialization.' WHERE intent_id=$5`,
      [
        now,
        text(move, "source_token_family_id"),
        text(move, "oauth_client_id"),
        text(move, "oauth_subject_principal_id"),
        text(move, "target_intent_id"),
      ],
    );
    await client.query(
      `UPDATE tokenless_agent_workspace_moves
       SET status='completed',target_approved_at=$1,target_approved_by=$2,completed_at=$1,
           completed_integration_id=$3 WHERE move_id=$4`,
      [now, actor, integrationId, input.transferId],
    );
    await client.query(
      `INSERT INTO tokenless_agent_integration_events
       (event_id,integration_id,workspace_id,event_type,actor_type,actor_reference,details_json,created_at)
       VALUES ($1,$2,$3,'approved','account',$4,$5,$6)`,
      [
        `agie_${randomUUID().replaceAll("-", "")}`,
        integrationId,
        input.workspaceId,
        actor,
        JSON.stringify({ activationMode: text(target, "activation_mode"), transferId: input.transferId }),
        now,
      ],
    );
    await appendIntentEvent(client, {
      intentId: text(move, "target_intent_id")!,
      workspaceId: input.workspaceId,
      fromStatus: "approval_required",
      toStatus: "testing",
      actorType: "account",
      actorReference: actor,
      reason: "workspace_move_approved",
      details: { integrationId, transferId: input.transferId },
      now,
    });
    connection = await completedWorkspaceMoveConnection(client, integrationId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await appendAuditEvent({
    action: "agent.workspace_move_approved",
    actorKind: isRateLoopPrincipalId(actor) ? "principal" : "account",
    actorReference: actor,
    assuranceMethod: "rateloop_session",
    metadata: { integrationId: connection!.integrationId, transferId: input.transferId },
    purpose: "agent_connection",
    reason: "workspace_owner_approved",
    result: "success",
    targetId: input.transferId,
    targetKind: "agent_workspace_move",
    workspaceId: input.workspaceId,
  });
  return {
    connection: connection!,
    workspaceMove: workspaceMovePayload({
      move_id: input.transferId,
      status: "completed",
      expires_at: now,
    }),
    idempotent,
    nextAction: "Reconnect the RateLoop tool session, then verify the connection.",
  };
}

async function bindMcpSessionToClaim(
  client: PoolClient,
  input: {
    mcpSessionHash: string | undefined;
    principal: OAuthConnectionPrincipal;
    workspaceId: string;
    integrationId: string;
    now: Date;
  },
) {
  if (!input.mcpSessionHash) return;
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.mcpSessionHash)) {
    throw new TokenlessServiceError("MCP session is invalid.", 400, "invalid_mcp_session");
  }
  const result = await client.query(
    `UPDATE tokenless_mcp_sessions
     SET workspace_id=$1,integration_id=$2,last_seen_at=$3
     WHERE session_hash=$4 AND subject_principal_id=$5 AND token_family_id=$6
       AND status='active' AND expires_at>$3
       AND EXISTS (
         SELECT 1 FROM tokenless_agent_oauth_token_families f
         WHERE f.token_family_id=$6 AND f.subject_principal_id=$5
           AND f.status='active' AND f.absolute_expires_at>$3
       )
       AND ((workspace_id IS NULL AND integration_id IS NULL)
         OR (workspace_id=$1 AND integration_id=$2))
     RETURNING session_hash`,
    [
      input.workspaceId,
      input.integrationId,
      input.now,
      input.mcpSessionHash,
      input.principal.subjectPrincipalId,
      input.principal.tokenFamilyId,
    ],
  );
  if (!result.rowCount) {
    throw new TokenlessServiceError("MCP session is expired or bound elsewhere.", 404, "mcp_session_not_found");
  }
}

export async function claimAgentConnectionIntent(input: {
  connectionUrl: string;
  origin: string;
  principal: OAuthConnectionPrincipal;
  mcpSessionHash?: string;
  /** Host self-declared connection lane. Recorded verbatim as untrusted; never treated as proof of hooks. */
  reportedLane?: string;
}) {
  requireSafeScopes(input.principal);
  if (
    input.reportedLane !== undefined &&
    !(HOST_REPORTABLE_CONNECTION_LANES as readonly string[]).includes(input.reportedLane)
  ) {
    throw new TokenlessServiceError("The reported connection lane is invalid.", 400, "invalid_reported_lane");
  }
  const parsed = parseConnectionUrl(input.connectionUrl, input.origin);
  const now = new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM tokenless_agent_connection_intents
       WHERE intent_id = $1 AND claim_nonce_hash = $2 FOR UPDATE`,
      [parsed.intentId, digest(parsed.claimNonce)],
    );
    const intent = result.rows[0] as Row | undefined;
    if (!intent) {
      throw new TokenlessServiceError("Connection not found.", 404, "connection_intent_not_found");
    }
    const status = text(intent, "status")!;
    const source = await activeClaimForFamily(client, input.principal.tokenFamilyId);
    if (source?.connectionIntentId === parsed.intentId) {
      await bindMcpSessionToClaim(client, {
        mcpSessionHash: input.mcpSessionHash,
        principal: input.principal,
        workspaceId: source.workspaceId,
        integrationId: source.integrationId,
        now,
      });
      await client.query("COMMIT");
      return {
        connection: source,
        workspaceMove: undefined as never,
        idempotent: true,
        nextAction: "Call rateloop_get_agent_context.",
      };
    }
    if (text(intent, "claimed_token_family_id")) {
      throw new TokenlessServiceError("This connection was claimed by another client.", 409, "claimant_mismatch");
    }
    if (!ACTIVE_INTENT_STATUSES.includes(status as (typeof ACTIVE_INTENT_STATUSES)[number])) {
      throw new TokenlessServiceError("This connection is no longer active.", 410, "connection_intent_inactive");
    }
    if (new Date(String(intent.claim_expires_at)).getTime() <= now.getTime()) {
      await client.query(
        `UPDATE tokenless_agent_connection_intents
         SET status='expired',last_transition_at=$1,last_transition_reason='claim_deadline_elapsed',
             last_diagnostic_code='connection_intent_expired',last_diagnostic_at=$1,
             recovery_action='Create a new connection message.' WHERE intent_id=$2`,
        [now, parsed.intentId],
      );
      throw new TokenlessServiceError("This connection has expired.", 410, "connection_intent_expired");
    }
    const deviceGrant = await client.query(
      `SELECT 1 FROM tokenless_agent_oauth_device_authorizations
       WHERE token_family_id=$1 AND status='consumed' LIMIT 1`,
      [input.principal.tokenFamilyId],
    );
    const laneMarkers = [
      ...(input.reportedLane ? [`${REPORTED_LANE_MARKER_PREFIX}${input.reportedLane}`] : []),
      ...(deviceGrant.rowCount ? [DEVICE_AUTHORIZATION_GRANT_MARKER] : []),
    ];
    const reportedLane = connectionLaneFromClientCapabilitiesJson(JSON.stringify(laneMarkers));
    if (text(intent, "reconnect_integration_id")) {
      const prepared = await prepareAgentWorkspaceMove(client, {
        intent,
        principal: input.principal,
        mcpSessionHash: input.mcpSessionHash,
        source,
        clientCapabilitiesJson: JSON.stringify(laneMarkers),
        now,
      });
      if (prepared.existingConnection) {
        await client.query(
          `UPDATE tokenless_agent_connection_intents
           SET status='superseded',last_transition_at=$1,last_transition_reason='reconnect_already_current',
               recovery_action=NULL WHERE intent_id=$2`,
          [now, parsed.intentId],
        );
        await client.query("COMMIT");
        return {
          connection: prepared.existingConnection,
          workspaceMove: undefined as never,
          idempotent: true,
          nextAction: "Call rateloop_get_agent_context.",
        };
      }
      if (!prepared.idempotent) {
        await appendIntentEvent(client, {
          intentId: parsed.intentId,
          workspaceId: text(intent, "workspace_id")!,
          fromStatus: status,
          toStatus: "action_required",
          actorType: "oauth_client",
          actorReference: input.principal.clientId,
          reason: "workspace_move_source_confirmation_required",
          details: { transferId: prepared.workspaceMove.transferId, reportedLane },
          now,
        });
      }
      await client.query("COMMIT");
      return {
        ...prepared,
        connection: undefined as never,
        nextAction: prepared.workspaceMove.nextAction,
      };
    }
    if (source) {
      throw new TokenlessServiceError(
        "This OAuth connection is already bound to another workspace.",
        409,
        "workspace_conflict",
      );
    }
    if (text(intent, "created_by") !== input.principal.subjectPrincipalId) {
      throw new TokenlessServiceError(
        "Authorize RateLoop with the workspace owner account that created this connection.",
        403,
        "connection_owner_mismatch",
      );
    }
    await assertCanCreateWorkspaceAgent(client, text(intent, "workspace_id")!, now);
    const workspaceId = text(intent, "workspace_id")!;
    const actor = text(intent, "created_by")!;
    const agentId = `agt_${randomUUID().replaceAll("-", "")}`;
    const agentVersionId = `agtv_${randomUUID().replaceAll("-", "")}`;
    const reviewPolicyId = `arp_${randomUUID().replaceAll("-", "")}`;
    const integrationId = `agi_${randomUUID().replaceAll("-", "")}`;
    const externalId = `oauth:${digest(`${input.principal.clientId}:${input.principal.tokenFamilyId}`).slice(0, 40)}`;
    const displayName = input.principal.clientName || "Connected agent";
    await client.query(
      `INSERT INTO tokenless_agents
       (agent_id,workspace_id,external_id,owner_account_address,status,created_by,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'active',$4,$5,$5)`,
      [agentId, workspaceId, externalId, actor, now],
    );
    await client.query(
      `INSERT INTO tokenless_agent_versions
       (version_id,agent_id,workspace_id,version_number,display_name,description,declared_provider,declared_model,
        declared_model_version,environment,configuration_commitment,created_by,created_at)
       VALUES ($1,$2,$3,1,$4,$5,'unknown','unknown',NULL,'production',$6,$7,$8)`,
      [
        agentVersionId,
        agentId,
        workspaceId,
        displayName,
        "OAuth-connected RateLoop agent. Provider and model were not attested by the host.",
        versionCommitment({ ...input.principal, clientName: displayName }),
        actor,
        now,
      ],
    );
    await client.query(
      `INSERT INTO tokenless_agent_audit_events
       (event_id,workspace_id,agent_id,version_id,event_type,actor_account_address,details_json,created_at)
       VALUES ($1,$2,$3,$4,'agent.created',$5,$6,$7)`,
      [
        `agevt_${randomUUID().replaceAll("-", "")}`,
        workspaceId,
        agentId,
        agentVersionId,
        actor,
        JSON.stringify({ externalId, source: "connection_intent" }),
        now,
      ],
    );
    await client.query(
      `INSERT INTO tokenless_agent_review_policies
       (policy_id,version,workspace_id,agent_id,agent_version_id,mode,enabled,agreement_threshold_bps,
        production_floor_bps,fixed_rate_bps,maximum_unreviewed_gap,rules_json,audience_policy_json,publishing_policy_id,
        created_by,approved_by,created_at)
       VALUES ($1,1,$2,$3,$4,'adaptive',true,${DEFAULT_ADAPTIVE_AGREEMENT_THRESHOLD_BPS},1000,NULL,20,$5,$6,NULL,$7,$7,$8)`,
      [
        reviewPolicyId,
        workspaceId,
        agentId,
        agentVersionId,
        JSON.stringify({
          enforcementMode: "advisory",
          requiredRiskTiers: ["high"],
          criticalRiskTiers: ["critical"],
          minimumConfidenceBps: 7000,
          maximumLatencyMs: 120000,
        }),
        JSON.stringify({ reviewerSource: "private_invited" }),
        actor,
        now,
      ],
    );
    await client.query(
      `INSERT INTO tokenless_agent_integrations
       (integration_id,pairing_id,workspace_id,agent_id,agent_version_id,review_policy_id,review_policy_version,
        publishing_policy_id,publishing_policy_version,api_key_id,status,enforcement_mode,allowed_workflow_keys_json,
        client_name,client_version,client_capabilities_json,credential_expires_at,created_by,created_at,updated_at,
        connection_intent_id,token_family_id,activation_mode,granted_scopes_json,oauth_client_id,
        oauth_subject_principal_id,last_initialize_at,last_context_at,last_connection_test_at)
       VALUES ($1,NULL,$2,$3,$4,$5,1,NULL,NULL,NULL,'active','advisory',$6,$7,NULL,'[]',NULL,$8,$9,$9,
               $10,$11,'preauthorized_safe',$12,$13,$14,$9,NULL,NULL)`,
      [
        integrationId,
        workspaceId,
        agentId,
        agentVersionId,
        reviewPolicyId,
        JSON.stringify(SAFE_WORKFLOW_KEYS),
        displayName,
        actor,
        now,
        parsed.intentId,
        input.principal.tokenFamilyId,
        JSON.stringify(SAFE_AGENT_CONNECTION_SCOPES),
        input.principal.clientId,
        input.principal.subjectPrincipalId,
      ],
    );
    await client.query(
      `UPDATE tokenless_agent_connection_intents
       SET status='testing',claimed_at=$1,consumed_at=$1,claimed_token_family_id=$2,
           claimed_oauth_client_id=$3,claimed_subject_principal_id=$4,client_name=$5,
           client_capabilities_json=$6,
           last_transition_at=$1,last_transition_reason='safe_intent_claimed',recovery_action='Retry connection verification.'
       WHERE intent_id=$7`,
      [
        now,
        input.principal.tokenFamilyId,
        input.principal.clientId,
        input.principal.subjectPrincipalId,
        displayName,
        JSON.stringify(laneMarkers),
        parsed.intentId,
      ],
    );
    await client.query(
      `INSERT INTO tokenless_agent_integration_events
       (event_id,integration_id,workspace_id,event_type,actor_type,actor_reference,details_json,created_at)
       VALUES ($1,$2,$3,'approved','oauth_client',$4,$5,$6)`,
      [
        `agie_${randomUUID().replaceAll("-", "")}`,
        integrationId,
        workspaceId,
        input.principal.clientId,
        JSON.stringify({ activationMode: "preauthorized_safe", reviewPolicyId }),
        now,
      ],
    );
    await bindMcpSessionToClaim(client, {
      mcpSessionHash: input.mcpSessionHash,
      principal: input.principal,
      workspaceId,
      integrationId,
      now,
    });
    await appendIntentEvent(client, {
      intentId: parsed.intentId,
      workspaceId,
      fromStatus: status,
      toStatus: "testing",
      actorType: "oauth_client",
      actorReference: input.principal.clientId,
      reason: "safe_intent_claimed",
      details: { integrationId, reportedLane },
      now,
    });
    await client.query("COMMIT");
    await appendAuditEvent({
      action: "agent.connection_intent_claimed",
      actorKind: "system",
      actorReference: input.principal.tokenFamilyId,
      assuranceMethod: "oauth_token_family",
      metadata: { clientId: input.principal.clientId, integrationId },
      purpose: "agent_connection",
      reason: "preauthorized_safe_claim",
      result: "success",
      targetId: parsed.intentId,
      targetKind: "agent_connection_intent",
      workspaceId,
    });
    return {
      connection: {
        intentId: parsed.intentId,
        integrationId,
        workspaceId,
        agentId,
        agentVersionId,
        reviewPolicyId,
        reviewPolicyVersion: 1,
        status: "testing",
        reportedLane,
      },
      workspaceMove: undefined as never,
      idempotent: false,
      nextAction: "Call rateloop_get_agent_context, then rateloop_verify_connection.",
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function verifyAgentConnection(input: { principal: OAuthConnectionPrincipal; integrationId: string }) {
  const now = new Date();
  const client = await dbPool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const result = await client.query(
      `SELECT i.integration_id,i.workspace_id,i.agent_id,i.agent_version_id,i.review_policy_id,
              i.review_policy_version,i.connection_intent_id,c.status AS connection_status,c.hard_expires_at,
              c.connected_at,c.client_capabilities_json
       FROM tokenless_agent_integrations i
       JOIN tokenless_agent_connection_intents c ON c.intent_id=i.connection_intent_id
       WHERE i.integration_id=$1 AND i.token_family_id=$2 AND i.status='active' FOR UPDATE`,
      [input.integrationId, input.principal.tokenFamilyId],
    );
    const row = result.rows[0] as Row | undefined;
    if (!row) throw new TokenlessServiceError("Connection is not active.", 401, "connection_not_ready");
    const connectionStatus = text(row, "connection_status")!;
    if (connectionStatus === "testing" && new Date(String(row.hard_expires_at)).getTime() <= now.getTime()) {
      await client.query(
        `UPDATE tokenless_agent_connection_intents
         SET status='expired',last_transition_at=$1,last_transition_reason='hard_deadline_elapsed',
             last_diagnostic_code='connection_intent_expired',last_diagnostic_at=$1,
             recovery_action='Create a new connection message.' WHERE intent_id=$2`,
        [now, text(row, "connection_intent_id")!],
      );
      await client.query(
        `UPDATE tokenless_agent_integrations SET status='revoked',updated_at=$1,
         last_diagnostic_code='connection_intent_expired',last_diagnostic_at=$1,
         recovery_action='Create a new connection message.' WHERE integration_id=$2`,
        [now, input.integrationId],
      );
      await client.query("COMMIT");
      transactionOpen = false;
      throw new TokenlessServiceError("This connection has expired.", 410, "connection_intent_expired");
    }
    if (connectionStatus !== "testing" && connectionStatus !== "connected") {
      throw new TokenlessServiceError("Connection is not ready for verification.", 409, "connection_not_ready");
    }
    const workspaceId = text(row, "workspace_id")!;
    const intentId = text(row, "connection_intent_id")!;
    let verifiedAtValue: unknown = row.connected_at ?? now;
    if (connectionStatus !== "connected") {
      await client.query(
        `UPDATE tokenless_agent_integrations
         SET last_connection_test_at=$1,last_seen_at=$1,updated_at=$1,last_diagnostic_code=NULL,
             last_diagnostic_at=$1,recovery_action=NULL WHERE integration_id=$2`,
        [now, input.integrationId],
      );
      const connected = await client.query(
        `UPDATE tokenless_agent_connection_intents
         SET status='connected',tested_at=$1,connected_at=$1,last_transition_at=$1,
             last_transition_reason='connection_verified',last_diagnostic_code=NULL,last_diagnostic_at=$1,
             recovery_action=NULL WHERE intent_id=$2 RETURNING connected_at`,
        [now, intentId],
      );
      verifiedAtValue = connected.rows[0]?.connected_at ?? now;
      await client.query(
        `INSERT INTO tokenless_agent_integration_events
         (event_id,integration_id,workspace_id,event_type,actor_type,actor_reference,details_json,created_at)
         VALUES ($1,$2,$3,'connected','oauth_client',$4,'{}',$5)`,
        [`agie_${randomUUID().replaceAll("-", "")}`, input.integrationId, workspaceId, input.principal.clientId, now],
      );
      await appendIntentEvent(client, {
        intentId,
        workspaceId,
        fromStatus: connectionStatus,
        toStatus: "connected",
        actorType: "oauth_client",
        actorReference: input.principal.clientId,
        reason: "connection_verified",
        now,
      });
    }
    await client.query("COMMIT");
    transactionOpen = false;
    const verifiedAt = new Date(String(verifiedAtValue)).toISOString();
    const reportedLane = connectionLaneFromClientCapabilitiesJson(row.client_capabilities_json);
    return {
      schemaVersion: "rateloop.connection-verification.v1",
      connection: {
        status: "connected",
        integrationId: input.integrationId,
        workspaceId,
        agentId: text(row, "agent_id")!,
        agentVersionId: text(row, "agent_version_id")!,
        reportedLane,
      },
      reportedLaneStatement: connectionLaneStatement(reportedLane),
      safeAccess: {
        canCheckReviewRequirement: true,
        canSpend: false,
        canPublish: false,
        canReadPrivateArtifacts: false,
        canAdministerWorkspace: false,
      },
      verifiedAt,
    };
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const __agentConnectionIntentTestUtils = { parseConnectionUrl };
