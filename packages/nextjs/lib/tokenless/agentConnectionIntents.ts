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

function publicIntent(row: Row) {
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
       auto_activate,created_at,claim_expires_at,hard_expires_at,last_transition_at,last_transition_reason)
      VALUES ($1,$2,$3,$4,'issued','safe_review_decisions',1,$5,$6,$7,'[]',true,$8,$9,$10,$8,$11)`,
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
        "owner_created_safe_intent",
      ],
    );
    await client.query(
      `INSERT INTO tokenless_agent_connection_intent_events
          (event_id,intent_id,workspace_id,from_status,to_status,actor_type,actor_reference,reason,details_json,created_at)
          VALUES ($1,$2,$3,NULL,'issued',$4,$5,'owner_created_safe_intent','{}',$6)`,
      [
        `acie_${randomUUID().replaceAll("-", "")}`,
        intentId,
        input.workspaceId,
        isRateLoopPrincipalId(actor) ? "principal" : "account",
        actor,
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
    metadata: { claimExpiresAt: claimExpiresAt.toISOString(), profileKey: "safe_review_decisions" },
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
    },
    connectionUrl: `${origin}/connect/${intentId}#claim=${claimNonce}`,
    setupRevision: nextSetupRevision,
  };
}

export async function listAgentConnectionIntents(input: { accountAddress: string; workspaceId: string }) {
  await management(input.accountAddress, input.workspaceId);
  await expireConnectionIntents(input.workspaceId);
  const result = await dbClient.execute({
    sql: `SELECT * FROM tokenless_agent_connection_intents
          WHERE workspace_id = ? ORDER BY created_at DESC`,
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
    sql: "SELECT * FROM tokenless_agent_connection_intents WHERE intent_id = ? LIMIT 1",
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

async function existingClaim(client: PoolClient, tokenFamilyId: string, intentId: string) {
  const result = await client.query(
    `SELECT i.integration_id,i.connection_intent_id,i.workspace_id,i.agent_id,i.agent_version_id,
            i.review_policy_id,i.review_policy_version,i.status,c.status AS connection_status,
            c.client_capabilities_json
     FROM tokenless_agent_integrations i
     JOIN tokenless_agent_connection_intents c ON c.intent_id = i.connection_intent_id
     WHERE i.token_family_id = $1 LIMIT 1`,
    [tokenFamilyId],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) return null;
  if (text(row, "connection_intent_id") !== intentId) {
    throw new TokenlessServiceError(
      "This OAuth connection is already bound to another workspace.",
      409,
      "workspace_conflict",
    );
  }
  return {
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
    const prior = await existingClaim(client, input.principal.tokenFamilyId, parsed.intentId);
    if (prior) {
      await bindMcpSessionToClaim(client, {
        mcpSessionHash: input.mcpSessionHash,
        principal: input.principal,
        workspaceId: prior.workspaceId,
        integrationId: prior.integrationId,
        now,
      });
      await client.query("COMMIT");
      return { connection: prior, idempotent: true, nextAction: "Call rateloop_get_agent_context." };
    }
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
    if (text(intent, "claimed_token_family_id") === input.principal.tokenFamilyId) {
      const repeated = await existingClaim(client, input.principal.tokenFamilyId, parsed.intentId);
      if (!repeated) throw new Error("Claimed connection is missing its integration.");
      await bindMcpSessionToClaim(client, {
        mcpSessionHash: input.mcpSessionHash,
        principal: input.principal,
        workspaceId: repeated.workspaceId,
        integrationId: repeated.integrationId,
        now,
      });
      await client.query("COMMIT");
      return { connection: repeated, idempotent: true, nextAction: "Call rateloop_get_agent_context." };
    }
    if (text(intent, "claimed_token_family_id")) {
      throw new TokenlessServiceError("This connection was claimed by another client.", 409, "claimant_mismatch");
    }
    if (text(intent, "created_by") !== input.principal.subjectPrincipalId) {
      throw new TokenlessServiceError(
        "Authorize RateLoop with the workspace owner account that created this connection.",
        403,
        "connection_owner_mismatch",
      );
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
    await assertCanCreateWorkspaceAgent(client, text(intent, "workspace_id")!, now);
    const workspaceId = text(intent, "workspace_id")!;
    const actor = text(intent, "created_by")!;
    const agentId = `agt_${randomUUID().replaceAll("-", "")}`;
    const agentVersionId = `agtv_${randomUUID().replaceAll("-", "")}`;
    const reviewPolicyId = `arp_${randomUUID().replaceAll("-", "")}`;
    const integrationId = `agi_${randomUUID().replaceAll("-", "")}`;
    const externalId = `oauth:${digest(`${input.principal.clientId}:${input.principal.tokenFamilyId}`).slice(0, 40)}`;
    const displayName = input.principal.clientName || "Connected agent";
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
