import { createHash, randomBytes } from "node:crypto";
import "server-only";
import { dbClient, dbPool } from "~~/lib/db";
import { TOKENLESS_MCP_PROTOCOL_VERSIONS, TOKENLESS_MCP_STABLE_PROTOCOL_VERSION } from "~~/lib/mcp/protocol";
import type { AgentMcpPrincipal } from "~~/lib/tokenless/agentIntegrations";
import { decideHumanReviewApprovalForOwner } from "~~/lib/tokenless/humanReviewApprovals";
import type { HumanReviewRoutingResult } from "~~/lib/tokenless/humanReviewRequestRouter";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type JsonRecord = Record<string, unknown>;
type Row = Record<string, unknown>;

const SESSION = /^mcps_[A-Za-z0-9_-]{32,128}$/u;
const REQUEST = /^mcpel_[0-9a-f]{48}$/u;
const SESSION_TTL_MS = 24 * 60 * 60 * 1_000;
const ELICITATION_TTL_MS = 30 * 60 * 1_000;
const PROCESSING_LEASE_MS = 60_000;
const DELIVERY_LEASE_MS = 30_000;

function object(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function date(row: Row | undefined, key: string) {
  const parsed = new Date(String(row?.[key]));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Stored ${key} is invalid.`);
  return parsed;
}

function sessionHash(value: string) {
  if (!SESSION.test(value)) {
    throw new TokenlessServiceError("MCP session is invalid.", 400, "invalid_mcp_session");
  }
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function requestId(input: { sessionHash: string; approvalId: string; revision: number }) {
  return `mcpel_${createHash("sha256")
    .update(`${input.sessionHash}\n${input.approvalId}\n${input.revision}`)
    .digest("hex")
    .slice(0, 48)}`;
}

function oauthSessionPrincipal(principal: AgentMcpPrincipal) {
  if (principal.kind !== "oauth" || !principal.integration || principal.connectionStatus !== "connected") {
    return null;
  }
  return {
    workspaceId: principal.integration.workspaceId,
    integrationId: principal.integration.integrationId,
    subjectPrincipalId: principal.oauth.subjectPrincipalId,
    tokenFamilyId: principal.oauth.tokenFamilyId,
    tokenExpiresAt: principal.oauth.expiresAt,
  };
}

function elicitationMode(protocolVersion: string, capabilities: unknown) {
  const value = object(capabilities);
  return protocolVersion === TOKENLESS_MCP_STABLE_PROTOCOL_VERSION &&
    value !== null &&
    object(value.elicitation) !== null
    ? ("form" as const)
    : ("none" as const);
}

function protocolVersion(value: string) {
  if (!TOKENLESS_MCP_PROTOCOL_VERSIONS.includes(value as never)) {
    throw new TokenlessServiceError("MCP protocol version is invalid.", 400, "unsupported_protocol_version");
  }
  return value;
}

function lastEventId(value: string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  if (value.length > 256 || /[\r\n\0]/u.test(value)) {
    throw new TokenlessServiceError("Last-Event-ID is invalid.", 400, "invalid_last_event_id");
  }
  return value;
}

export function isSuccessfulWorkspaceMcpInitializeResponse(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("result" in value)) return false;
  const result = value.result;
  return Boolean(
    result &&
      typeof result === "object" &&
      !Array.isArray(result) &&
      "protocolVersion" in result &&
      typeof result.protocolVersion === "string",
  );
}

function elicitationRequest(input: {
  id: string;
  result: Extract<HumanReviewRoutingResult, { action: "owner_approval_required" }>;
}) {
  const approval = input.result.approval;
  const prepared = approval.preparedRequest;
  const bonus = approval.feedbackBonusEconomics;
  const expertise = prepared.audience.requiredExpertiseKeys?.length
    ? prepared.audience.requiredExpertiseKeys.join(", ")
    : "none";
  return {
    jsonrpc: "2.0" as const,
    id: input.id,
    method: "elicitation/create" as const,
    params: {
      message:
        `Approve RateLoop review ${approval.approvalId}? ` +
        `Question: ${prepared.question.criterion}; ` +
        `Audience: ${prepared.audience.kind}; material: ${prepared.audience.contentBoundary}; ` +
        `required expertise: ${expertise}; ` +
        `panel: ${prepared.panel.size}; ` +
        `response window: ${prepared.timing.responseWindowSeconds}s; ` +
        `compensation: ${
          approval.economics.compensationMode === "unpaid"
            ? "unpaid"
            : `${approval.economics.bountyPerSeatAtomic} atomic USDC per seat`
        }; ` +
        `maximum charge: ${approval.maximumConsentAtomic} atomic USDC; ` +
        `optional feedback bonus: ${bonus.enabled ? `${bonus.poolAtomic} atomic USDC` : "off"}. ` +
        `Request profile: ${prepared.requestProfile.hash}; ` +
        `source commitment: ${prepared.contentCommitments.source}; ` +
        `suggestion commitment: ${prepared.contentCommitments.suggestion}. ` +
        "No source or suggestion content is included here.",
      requestedSchema: {
        type: "object" as const,
        properties: {
          approve: {
            type: "boolean" as const,
            title: "Approve RateLoop review",
            description:
              "Approve the exact frozen audience, material boundary, timing, panel, compensation, and spend terms summarized above.",
          },
        },
        required: ["approve"] as ["approve"],
      },
    },
  };
}

function responseDecision(value: unknown) {
  const response = object(value);
  if (!response || response.jsonrpc !== "2.0" || typeof response.id !== "string" || !REQUEST.test(response.id)) {
    throw new TokenlessServiceError("MCP elicitation response is invalid.", 400, "invalid_elicitation_response");
  }
  if ("error" in response) {
    return {
      id: response.id,
      action: "cancel" as const,
      canonical: JSON.stringify({ jsonrpc: "2.0", id: response.id, result: { action: "cancel" } }),
    };
  }
  const result = object(response.result);
  if (!result || !["accept", "decline", "cancel"].includes(String(result.action))) {
    throw new TokenlessServiceError("MCP elicitation response is invalid.", 400, "invalid_elicitation_response");
  }
  if (result.action !== "accept") {
    if (Object.keys(result).some(key => !["action", "content"].includes(key))) {
      throw new TokenlessServiceError("MCP elicitation response is invalid.", 400, "invalid_elicitation_response");
    }
    return {
      id: response.id,
      action: result.action as "decline" | "cancel",
      canonical: JSON.stringify({ jsonrpc: "2.0", id: response.id, result: { action: result.action } }),
    };
  }
  const content = object(result.content);
  if (!content || Object.keys(content).length !== 1 || typeof content.approve !== "boolean") {
    throw new TokenlessServiceError("MCP elicitation response is invalid.", 400, "invalid_elicitation_response");
  }
  return {
    id: response.id,
    action: content.approve ? ("approve" as const) : ("reject" as const),
    canonical: JSON.stringify({
      jsonrpc: "2.0",
      id: response.id,
      result: { action: "accept", content: { approve: content.approve } },
    }),
  };
}

function authorizeProcessingLease(input: { row: Row; canonicalResponse: string; now: Date }) {
  const state = text(input.row, "state");
  if (state === "delivered") return;
  if (state === "processing") {
    if (text(input.row, "processing_response_json") !== input.canonicalResponse) {
      throw new TokenlessServiceError("Conflicting MCP elicitation replay.", 409, "elicitation_replay_conflict");
    }
    const processingAt = input.row.processing_started_at ? date(input.row, "processing_started_at") : null;
    if (!processingAt || input.now.getTime() - processingAt.getTime() < PROCESSING_LEASE_MS) {
      throw new TokenlessServiceError(
        "MCP elicitation response is already processing.",
        409,
        "elicitation_not_actionable",
      );
    }
    return;
  }
  throw new TokenlessServiceError("MCP elicitation is not awaiting a response.", 409, "elicitation_not_actionable");
}

export async function createWorkspaceMcpSession(input: {
  sessionId: string;
  principal: AgentMcpPrincipal;
  clientInfo: unknown;
  capabilities: unknown;
  protocolVersion: string;
  now?: Date;
}) {
  const owner = oauthSessionPrincipal(input.principal);
  if (!owner) return false;
  const clientInfo = object(input.clientInfo);
  if (
    !clientInfo ||
    typeof clientInfo.name !== "string" ||
    !clientInfo.name.trim() ||
    typeof clientInfo.version !== "string" ||
    !clientInfo.version.trim()
  ) {
    throw new TokenlessServiceError("MCP clientInfo is invalid.", 400, "invalid_mcp_session");
  }
  const now = input.now ?? new Date();
  const negotiatedProtocolVersion = protocolVersion(input.protocolVersion);
  const expiresAt = new Date(Math.min(owner.tokenExpiresAt.getTime(), now.getTime() + SESSION_TTL_MS));
  if (expiresAt <= now) {
    throw new TokenlessServiceError("MCP access token has expired.", 401, "mcp_session_expired");
  }
  await dbClient.execute({
    sql: `INSERT INTO tokenless_mcp_sessions
            (session_hash,workspace_id,integration_id,subject_principal_id,token_family_id,
             client_name,client_version,protocol_version,elicitation_mode,status,created_at,last_seen_at,expires_at)
          VALUES (?,?,?,?,?,?,?,?,?, 'active',?,?,?)
          ON CONFLICT(session_hash) DO NOTHING`,
    args: [
      sessionHash(input.sessionId),
      owner.workspaceId,
      owner.integrationId,
      owner.subjectPrincipalId,
      owner.tokenFamilyId,
      clientInfo.name.trim().slice(0, 160),
      clientInfo.version.trim().slice(0, 80),
      negotiatedProtocolVersion,
      elicitationMode(negotiatedProtocolVersion, input.capabilities),
      now,
      now,
      expiresAt,
    ],
  });
  return true;
}

export async function requireWorkspaceMcpSession(input: {
  sessionId: string;
  principal: AgentMcpPrincipal;
  protocolVersion: string;
  now?: Date;
}) {
  const owner = oauthSessionPrincipal(input.principal);
  if (!owner) throw new TokenlessServiceError("MCP session is unavailable.", 400, "mcp_session_required");
  const now = input.now ?? new Date();
  const hash = sessionHash(input.sessionId);
  const requestedProtocolVersion = protocolVersion(input.protocolVersion);
  await dbClient.execute({
    sql: `UPDATE tokenless_mcp_sessions
          SET status='expired',last_seen_at=?
          WHERE session_hash=? AND status='active' AND expires_at<=?`,
    args: [now, hash, now],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_mcp_elicitation_requests
          SET state='expired'
          WHERE tokenless_mcp_elicitation_requests.session_hash=?
            AND tokenless_mcp_elicitation_requests.state IN ('queued','delivered','processing')
            AND tokenless_mcp_elicitation_requests.expires_at<=?`,
    args: [hash, now],
  });
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT s.protocol_version,s.elicitation_mode
       FROM tokenless_mcp_sessions s
       JOIN tokenless_agent_integrations i
         ON i.integration_id=s.integration_id AND i.workspace_id=s.workspace_id
         AND i.token_family_id=s.token_family_id
         AND i.oauth_subject_principal_id=s.subject_principal_id
       JOIN tokenless_agent_oauth_token_families f
         ON f.token_family_id=s.token_family_id AND f.subject_principal_id=s.subject_principal_id
       WHERE s.session_hash=$1 AND s.workspace_id=$2 AND s.integration_id=$3
         AND s.subject_principal_id=$4 AND s.token_family_id=$5
         AND s.protocol_version=$6 AND s.status='active' AND s.expires_at>$7
         AND i.status='active' AND f.status='active' AND f.absolute_expires_at>$7
       FOR UPDATE`,
      [
        hash,
        owner.workspaceId,
        owner.integrationId,
        owner.subjectPrincipalId,
        owner.tokenFamilyId,
        requestedProtocolVersion,
        now,
      ],
    );
    const row = result.rows[0] as Row | undefined;
    if (!row) {
      throw new TokenlessServiceError("MCP session is expired or mismatched.", 404, "mcp_session_not_found");
    }
    await client.query(
      `UPDATE tokenless_mcp_sessions SET last_seen_at=$1
       WHERE session_hash=$2 AND status='active'`,
      [now, hash],
    );
    await client.query("COMMIT");
    return {
      sessionHash: hash,
      protocolVersion: text(row, "protocol_version")!,
      elicitationMode: text(row, "elicitation_mode") as "none" | "form",
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeWorkspaceMcpSession(input: {
  sessionId: string;
  principal: AgentMcpPrincipal;
  protocolVersion: string;
  now?: Date;
}) {
  const session = await requireWorkspaceMcpSession(input);
  await dbClient.execute({
    sql: `UPDATE tokenless_mcp_sessions SET status='revoked',last_seen_at=?
          WHERE session_hash=? AND status='active'`,
    args: [input.now ?? new Date(), session.sessionHash],
  });
}

export async function enqueueOwnerApprovalElicitation(input: {
  sessionId: string;
  principal: AgentMcpPrincipal;
  protocolVersion: string;
  result: HumanReviewRoutingResult;
  now?: Date;
}) {
  if (input.result.action !== "owner_approval_required") return null;
  const session = await requireWorkspaceMcpSession(input);
  if (session.elicitationMode !== "form") return null;
  const owner = oauthSessionPrincipal(input.principal)!;
  const now = input.now ?? new Date();
  const approval = input.result.approval;
  const expiresAt = new Date(Math.min(Date.parse(approval.expiresAt), now.getTime() + ELICITATION_TTL_MS));
  if (expiresAt <= now) return null;
  const id = requestId({
    sessionHash: session.sessionHash,
    approvalId: approval.approvalId,
    revision: approval.revision,
  });
  const request = elicitationRequest({ id, result: input.result });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_mcp_elicitation_requests
            (request_id,session_hash,workspace_id,opportunity_id,approval_id,approval_revision,
             prepared_request_hash,derived_economics_hash,request_json,state,created_at,expires_at)
          VALUES (?,?,?,?,?,?,?,?,?,'queued',?,?)
          ON CONFLICT(session_hash,approval_id,approval_revision) DO NOTHING`,
    args: [
      id,
      session.sessionHash,
      owner.workspaceId,
      input.result.opportunityId,
      approval.approvalId,
      approval.revision,
      approval.preparedRequestHash,
      approval.derivedEconomicsHash,
      JSON.stringify(request),
      now,
      expiresAt,
    ],
  });
  return request;
}

export async function deliverWorkspaceMcpElicitation(input: {
  sessionId: string;
  principal: AgentMcpPrincipal;
  protocolVersion: string;
  lastEventId?: string | null;
  now?: Date;
}) {
  const session = await requireWorkspaceMcpSession(input);
  if (session.elicitationMode !== "form") return null;
  const now = input.now ?? new Date();
  const priorEventId = lastEventId(input.lastEventId);
  const leaseExpiresAt = new Date(now.getTime() + DELIVERY_LEASE_MS);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE tokenless_mcp_elicitation_requests
       SET state='expired'
       WHERE session_hash=$1 AND state IN ('queued','delivered','processing') AND expires_at<=$2`,
      [session.sessionHash, now],
    );
    const found = await client.query(
      `SELECT * FROM tokenless_mcp_elicitation_requests
       WHERE session_hash=$1 AND expires_at>$2
         AND (
           state='queued'
           OR (
             state='delivered' AND delivery_lease_expires_at<=$2
             AND ($3::text IS NULL OR last_event_id <> $3)
           )
         )
       ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
      [session.sessionHash, now, priorEventId],
    );
    const row = found.rows[0] as Row | undefined;
    if (!row) {
      await client.query("COMMIT");
      return null;
    }
    const delivered = await client.query(
      `UPDATE tokenless_mcp_elicitation_requests
       SET state='delivered',delivery_count=delivery_count+1,last_delivered_at=$1,
           last_event_id=request_id || ':' || (delivery_count+1)::text,
           delivery_lease_expires_at=$2
       WHERE request_id=$3
       RETURNING *`,
      [now, leaseExpiresAt, text(row, "request_id")],
    );
    await client.query("COMMIT");
    const deliveredRow = delivered.rows[0] as Row | undefined;
    return {
      eventId: text(deliveredRow, "last_event_id")!,
      request: JSON.parse(text(deliveredRow, "request_json")!) as unknown,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function handleWorkspaceMcpElicitationResponse(input: {
  sessionId: string;
  principal: AgentMcpPrincipal;
  protocolVersion: string;
  response: unknown;
  now?: Date;
}) {
  const session = await requireWorkspaceMcpSession(input);
  const decision = responseDecision(input.response);
  const now = input.now ?? new Date();
  const processingLeaseId = `mcpl_${randomBytes(24).toString("hex")}`;
  const client = await dbPool.connect();
  let row: Row;
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT * FROM tokenless_mcp_elicitation_requests
       WHERE request_id=$1 AND session_hash=$2 FOR UPDATE`,
      [decision.id, session.sessionHash],
    );
    const candidate = found.rows[0] as Row | undefined;
    if (!candidate) throw new TokenlessServiceError("MCP elicitation not found.", 404, "elicitation_not_found");
    if (text(candidate, "state") === "responded") {
      if (text(candidate, "response_json") !== decision.canonical) {
        throw new TokenlessServiceError("Conflicting MCP elicitation replay.", 409, "elicitation_replay_conflict");
      }
      await client.query("COMMIT");
      return { replayed: true };
    }
    if (date(candidate, "expires_at") <= now) {
      await client.query(`UPDATE tokenless_mcp_elicitation_requests SET state='expired' WHERE request_id=$1`, [
        decision.id,
      ]);
      await client.query("COMMIT");
      throw new TokenlessServiceError("MCP elicitation expired.", 409, "elicitation_expired");
    }
    authorizeProcessingLease({ row: candidate, canonicalResponse: decision.canonical, now });
    await client.query(
      `UPDATE tokenless_mcp_elicitation_requests
       SET state='processing',processing_started_at=$1,processing_lease_id=$2,
           processing_response_json=$3,delivery_lease_expires_at=NULL
       WHERE request_id=$4`,
      [now, processingLeaseId, decision.canonical, decision.id],
    );
    await client.query("COMMIT");
    row = candidate;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  if (decision.action === "approve" || decision.action === "reject") {
    const owner = oauthSessionPrincipal(input.principal)!;
    try {
      await decideHumanReviewApprovalForOwner({
        accountAddress: owner.subjectPrincipalId,
        workspaceId: text(row, "workspace_id")!,
        approvalId: text(row, "approval_id")!,
        body: {
          revision: Number(row.approval_revision),
          preparedRequestHash: text(row, "prepared_request_hash"),
          derivedEconomicsHash: text(row, "derived_economics_hash"),
          decision: decision.action,
          note: null,
        },
      });
    } catch (error) {
      const reconciled = await dbClient.execute({
        sql: `SELECT status,revision,prepared_request_hash,derived_economics_hash,decided_by
                FROM tokenless_agent_review_approval_requests
                WHERE workspace_id=? AND approval_id=? LIMIT 1`,
        args: [text(row, "workspace_id"), text(row, "approval_id")],
      });
      const approval = reconciled.rows[0] as Row | undefined;
      const expectedStatus = decision.action === "approve" ? "approved" : "denied";
      if (
        text(approval, "status") !== expectedStatus ||
        Number(approval?.revision) !== Number(row.approval_revision) ||
        text(approval, "prepared_request_hash") !== text(row, "prepared_request_hash") ||
        text(approval, "derived_economics_hash") !== text(row, "derived_economics_hash") ||
        text(approval, "decided_by") !== owner.subjectPrincipalId
      ) {
        throw error;
      }
    }
  }
  const completed = await dbClient.execute({
    sql: `UPDATE tokenless_mcp_elicitation_requests
            SET state='responded',response_json=?,responded_at=?,processing_started_at=NULL,
                processing_lease_id=NULL,processing_response_json=NULL,delivery_lease_expires_at=NULL
            WHERE request_id=? AND session_hash=? AND state='processing' AND processing_lease_id=?
            RETURNING request_id`,
    args: [decision.canonical, now, decision.id, session.sessionHash, processingLeaseId],
  });
  if (completed.rows.length !== 1) {
    throw new TokenlessServiceError(
      "MCP elicitation processing lease was superseded.",
      409,
      "elicitation_processing_lease_lost",
    );
  }
  return { replayed: false };
}

export const __workspaceElicitationTestUtils = {
  elicitationMode,
  elicitationRequest,
  isSuccessfulWorkspaceMcpInitializeResponse,
  authorizeProcessingLease,
  lastEventId,
  protocolVersion,
  responseDecision,
  sessionHash,
};
