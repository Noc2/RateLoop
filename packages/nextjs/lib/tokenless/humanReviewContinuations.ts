import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import {
  type HumanReviewOpportunityState,
  isHumanReviewOpportunityTerminalState,
} from "~~/lib/tokenless/humanReviewOpportunityLifecycle";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const HUMAN_REVIEW_CONTINUATION_OPERATIONS = ["request_review", "wait_for_review"] as const;
export type HumanReviewContinuationOperation = (typeof HUMAN_REVIEW_CONTINUATION_OPERATIONS)[number];
export type HumanReviewContinuationCredential = {
  integrationId: string;
  kind: "api_key" | "oauth_token_family";
  id: string;
};

export type HumanReviewContinuation = {
  token: string;
  allowedNextOperation: HumanReviewContinuationOperation;
  lifecycleRevision: number;
  expiresAt: string;
  retryAfterMs: number;
};

export type HumanReviewContinuationAuthorization = {
  workspaceId: string;
  integrationId: string;
  opportunityId: string;
  allowedOperation: HumanReviewContinuationOperation;
  lifecycleRevision: number;
  currentLifecycle: { state: HumanReviewOpportunityState; revision: number; terminal: boolean };
  replayed: boolean;
};

type Row = Record<string, unknown>;
type ContinuationEventType =
  | "issued"
  | "issue_replaced"
  | "consumed"
  | "consume_replayed"
  | "rotated"
  | "rotation_replaced"
  | "terminal_completed"
  | "revoked"
  | "expired";

const TOKEN_PATTERN = /^hrc_[A-Za-z0-9_-]{43}$/u;
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{7,199}$/u;
const DEFAULT_TTL_MS = 30 * 60_000;
const MIN_TTL_MS = 5_000;
const MAX_TTL_MS = 24 * 60 * 60_000;
const DEFAULT_RETRY_AFTER_MS = 1_000;
const MIN_RETRY_AFTER_MS = 250;
const MAX_RETRY_AFTER_MS = 60_000;
const OPERATION_STATES: Record<HumanReviewContinuationOperation, ReadonlySet<HumanReviewOpportunityState>> = {
  request_review: new Set(["approval_required", "request_ready"]),
  wait_for_review: new Set(["approval_required", "pending"]),
};
const FROZEN_DEADLINE_JOINS = `
  JOIN tokenless_agent_review_request_profiles profile
    ON profile.workspace_id = o.workspace_id
   AND profile.profile_id = o.request_profile_id
   AND profile.version = o.request_profile_version
   AND profile.profile_hash = o.request_profile_hash
  LEFT JOIN tokenless_private_unpaid_review_deliveries private_delivery
    ON private_delivery.workspace_id = o.workspace_id
   AND private_delivery.opportunity_id = o.opportunity_id
  LEFT JOIN tokenless_private_review_requests private_request
    ON private_request.workspace_id = o.workspace_id
   AND private_request.private_review_id = private_delivery.private_review_id
  LEFT JOIN tokenless_chain_executions chain_execution
    ON chain_execution.operation_key = o.operation_key
  LEFT JOIN (
    SELECT workspace_id, opportunity_id, MAX(revision) AS approval_revision
    FROM tokenless_agent_review_approval_requests
    WHERE status IN ('pending', 'approved', 'consumed')
    GROUP BY workspace_id, opportunity_id
  ) latest_approval
    ON latest_approval.workspace_id = o.workspace_id AND latest_approval.opportunity_id = o.opportunity_id
  LEFT JOIN tokenless_agent_review_approval_requests approval
    ON approval.workspace_id = latest_approval.workspace_id
   AND approval.opportunity_id = latest_approval.opportunity_id
   AND approval.revision = latest_approval.approval_revision`;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Continuation audit data is not canonicalizable.");
  return encoded;
}

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function tokenHash(token: string) {
  if (!TOKEN_PATTERN.test(token)) {
    throw new TokenlessServiceError("The review continuation is invalid.", 401, "invalid_review_continuation");
  }
  return hash(token);
}

function opaqueToken() {
  return `hrc_${randomBytes(32).toString("base64url")}`;
}

function idempotencyHash(value: string, field: string) {
  if (!KEY_PATTERN.test(value)) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_review_continuation_request");
  }
  return hash(value);
}

function positiveInteger(row: Row, key: string) {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Database returned an invalid ${key}.`);
  return value;
}

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function date(row: Row, key: string) {
  const value = row[key];
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Database returned an invalid ${key}.`);
  return parsed;
}

function lifecycleState(row: Row): HumanReviewOpportunityState {
  const value = text(row, "lifecycle_state");
  if (
    value !== "evaluating" &&
    value !== "skipped" &&
    value !== "approval_required" &&
    value !== "request_ready" &&
    value !== "pending" &&
    value !== "blocked" &&
    value !== "completed" &&
    value !== "inconclusive" &&
    value !== "failed_terminal" &&
    value !== "cancelled_before_commit"
  ) {
    throw new Error("Database returned an invalid review lifecycle state.");
  }
  return value;
}

function operation(value: unknown): HumanReviewContinuationOperation {
  if (value !== "request_review" && value !== "wait_for_review") {
    throw new TokenlessServiceError(
      "The requested continuation operation is invalid.",
      400,
      "invalid_review_continuation_request",
    );
  }
  return value;
}

function boundedTiming(input: { retryAfterMs?: number; ttlMs?: number }) {
  const retryAfterMs = input.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS;
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < MIN_RETRY_AFTER_MS || retryAfterMs > MAX_RETRY_AFTER_MS) {
    throw new TokenlessServiceError(
      "retryAfterMs must be between 250 and 60000.",
      400,
      "invalid_review_continuation_request",
    );
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS) {
    throw new TokenlessServiceError(
      "ttlMs must be between 5000 and 86400000.",
      400,
      "invalid_review_continuation_request",
    );
  }
  return { retryAfterMs, ttlMs };
}

function frozenDeadline(row: Row) {
  if (row.private_delivery_deadline !== null && row.private_delivery_deadline !== undefined) {
    return date(row, "private_delivery_deadline");
  }
  if (row.private_response_deadline !== null && row.private_response_deadline !== undefined) {
    return date(row, "private_response_deadline");
  }
  const roundTerms = text(row, "round_terms_json");
  if (roundTerms) {
    let commitDeadline: unknown;
    try {
      commitDeadline = (JSON.parse(roundTerms) as { commitDeadline?: unknown }).commitDeadline;
    } catch {
      throw new Error("Database returned invalid frozen round terms.");
    }
    if (typeof commitDeadline !== "string" || !/^(0|[1-9]\d*)$/u.test(commitDeadline)) {
      throw new Error("Database returned an invalid frozen commit deadline.");
    }
    const milliseconds = Number(BigInt(commitDeadline) * 1_000n);
    if (!Number.isSafeInteger(milliseconds)) throw new Error("Database returned an invalid frozen commit deadline.");
    const parsed = new Date(milliseconds);
    if (!Number.isFinite(parsed.getTime())) throw new Error("Database returned an invalid frozen commit deadline.");
    return parsed;
  }
  if (row.approval_deadline !== null && row.approval_deadline !== undefined) {
    return date(row, "approval_deadline");
  }
  const responseWindowSeconds = positiveInteger(row, "response_window_seconds");
  const fallback = new Date(date(row, "opportunity_created_at").getTime() + responseWindowSeconds * 1_000);
  if (!Number.isFinite(fallback.getTime())) throw new Error("Database returned an invalid frozen response deadline.");
  return fallback;
}

function cappedExpiry(now: Date, ttlMs: number, deadline: Date) {
  if (now >= deadline) {
    throw new TokenlessServiceError(
      "The frozen review response deadline has elapsed.",
      410,
      "review_continuation_deadline_elapsed",
    );
  }
  return new Date(Math.min(now.getTime() + ttlMs, deadline.getTime()));
}

function assertCredential(input: HumanReviewContinuationCredential, row: Row) {
  const expectedIntegrationId = text(row, "integration_id");
  const expectedApiKeyId = text(row, "api_key_id");
  const expectedTokenFamilyId = text(row, "token_family_id");
  const storedCredentialKind = text(row, "caller_credential_kind");
  const storedCredentialId = text(row, "caller_credential_id");
  const sourceMatches =
    input.kind === "api_key"
      ? expectedApiKeyId === input.id && expectedTokenFamilyId === null
      : expectedTokenFamilyId === input.id && expectedApiKeyId === null;
  if (
    text(row, "integration_status") !== "active" ||
    input.integrationId !== expectedIntegrationId ||
    !sourceMatches ||
    (storedCredentialKind !== null && storedCredentialKind !== input.kind) ||
    (storedCredentialId !== null && storedCredentialId !== input.id)
  ) {
    throw new TokenlessServiceError(
      "The review continuation is not bound to this credential.",
      403,
      "review_continuation_binding_mismatch",
    );
  }
}

function assertOperationAllowed(state: HumanReviewOpportunityState, requested: HumanReviewContinuationOperation) {
  if (isHumanReviewOpportunityTerminalState(state)) {
    throw new TokenlessServiceError(
      "Terminal review results do not use a polling continuation.",
      409,
      "review_continuation_not_required",
    );
  }
  if (!OPERATION_STATES[requested].has(state)) {
    throw new TokenlessServiceError(
      `The ${requested} continuation is not valid while the review is ${state}.`,
      409,
      "review_continuation_operation_not_allowed",
    );
  }
}

async function loadOpportunityForIssue(client: PoolClient, integrationId: string, opportunityId: string) {
  const result = await client.query(
    `SELECT i.integration_id, i.workspace_id, i.api_key_id, i.token_family_id,
            i.status AS integration_status, o.opportunity_id,
            o.created_at AS opportunity_created_at, profile.response_window_seconds,
            private_request.response_deadline AS private_response_deadline,
            private_delivery.response_deadline AS private_delivery_deadline,
            chain_execution.round_terms_json, approval.expires_at AS approval_deadline,
            l.state AS lifecycle_state, l.state_revision AS lifecycle_revision, l.terminal_at
     FROM tokenless_agent_integrations i
     JOIN tokenless_agent_review_opportunities o
       ON o.workspace_id = i.workspace_id
      AND o.agent_id = i.agent_id AND o.agent_version_id = i.agent_version_id
     JOIN tokenless_agent_review_opportunity_lifecycles l
       ON l.workspace_id = o.workspace_id AND l.opportunity_id = o.opportunity_id
     ${FROZEN_DEADLINE_JOINS}
     WHERE i.integration_id = $1 AND o.opportunity_id = $2
     FOR UPDATE`,
    [integrationId, opportunityId],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) {
    throw new TokenlessServiceError("Review opportunity not found.", 404, "review_opportunity_not_found");
  }
  return row;
}

async function loadByToken(client: PoolClient, presentedToken: string) {
  const result = await client.query(
    `SELECT c.*, i.api_key_id, i.token_family_id, i.status AS integration_status,
            o.created_at AS opportunity_created_at, profile.response_window_seconds,
            private_request.response_deadline AS private_response_deadline,
            private_delivery.response_deadline AS private_delivery_deadline,
            chain_execution.round_terms_json, approval.expires_at AS approval_deadline,
            l.state AS lifecycle_state, l.state_revision AS current_lifecycle_revision, l.terminal_at
     FROM tokenless_agent_review_continuations c
     JOIN tokenless_agent_integrations i
       ON i.integration_id = c.integration_id AND i.workspace_id = c.workspace_id
     JOIN tokenless_agent_review_opportunities o
       ON o.workspace_id = c.workspace_id AND o.opportunity_id = c.opportunity_id
      AND o.agent_id = i.agent_id AND o.agent_version_id = i.agent_version_id
     JOIN tokenless_agent_review_opportunity_lifecycles l
       ON l.workspace_id = c.workspace_id AND l.opportunity_id = c.opportunity_id
     ${FROZEN_DEADLINE_JOINS}
     WHERE c.token_hash = $1
     FOR UPDATE`,
    [tokenHash(presentedToken)],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) {
    throw new TokenlessServiceError("The review continuation is invalid.", 401, "invalid_review_continuation");
  }
  return row;
}

function continuationFrom(token: string, row: Row): HumanReviewContinuation {
  return {
    token,
    allowedNextOperation: operation(row.allowed_operation),
    lifecycleRevision: positiveInteger(row, "lifecycle_revision"),
    expiresAt: date(row, "expires_at").toISOString(),
    retryAfterMs: positiveInteger(row, "retry_after_ms"),
  };
}

async function appendEvent(
  client: PoolClient,
  input: {
    row: Row;
    type: ContinuationEventType;
    credential: HumanReviewContinuationCredential;
    reasonCode: string;
    occurredAt: Date;
    relatedContinuationId?: string | null;
  },
) {
  const payload = {
    schemaVersion: "rateloop.human-review-continuation-event.v1",
    continuationId: text(input.row, "continuation_id"),
    workspaceId: text(input.row, "workspace_id"),
    integrationId: text(input.row, "integration_id"),
    opportunityId: text(input.row, "opportunity_id"),
    lifecycleRevision: positiveInteger(input.row, "lifecycle_revision"),
    eventType: input.type,
    allowedOperation: operation(input.row.allowed_operation),
    actorCredentialKind: input.credential.kind,
    actorCredentialCommitment: hash(`${input.credential.kind}:${input.credential.id}`),
    relatedContinuationId: input.relatedContinuationId ?? null,
    reasonCode: input.reasonCode,
    occurredAt: input.occurredAt.toISOString(),
  };
  await client.query(
    `INSERT INTO tokenless_agent_review_continuation_events
     (event_id,continuation_id,workspace_id,integration_id,opportunity_id,lifecycle_revision,
      event_type,allowed_operation,actor_credential_kind,actor_credential_commitment,
      related_continuation_id,reason_code,event_commitment,occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      `hrce_${randomUUID().replaceAll("-", "")}`,
      payload.continuationId,
      payload.workspaceId,
      payload.integrationId,
      payload.opportunityId,
      payload.lifecycleRevision,
      payload.eventType,
      payload.allowedOperation,
      payload.actorCredentialKind,
      payload.actorCredentialCommitment,
      payload.relatedContinuationId,
      payload.reasonCode,
      hash(stableJson(payload)),
      input.occurredAt,
    ],
  );
}

async function insertContinuation(
  client: PoolClient,
  input: {
    credential: HumanReviewContinuationCredential;
    opportunityId: string;
    workspaceId: string;
    lifecycleRevision: number;
    allowedOperation: HumanReviewContinuationOperation;
    issuanceKeyHash: string;
    predecessorContinuationId?: string | null;
    retryAfterMs: number;
    expiresAt: Date;
    now: Date;
  },
) {
  const token = opaqueToken();
  const continuationId = `hrc_${randomUUID().replaceAll("-", "")}`;
  const row: Row = {
    continuation_id: continuationId,
    workspace_id: input.workspaceId,
    integration_id: input.credential.integrationId,
    opportunity_id: input.opportunityId,
    lifecycle_revision: input.lifecycleRevision,
    allowed_operation: input.allowedOperation,
    caller_credential_kind: input.credential.kind,
    caller_credential_id: input.credential.id,
    retry_after_ms: input.retryAfterMs,
    expires_at: input.expiresAt,
  };
  await client.query(
    `INSERT INTO tokenless_agent_review_continuations
     (continuation_id,token_hash,workspace_id,integration_id,opportunity_id,lifecycle_revision,
      allowed_operation,caller_credential_kind,caller_credential_id,issuance_key_hash,status,
      predecessor_continuation_id,retry_after_ms,issued_at,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$12,$13,$14)`,
    [
      continuationId,
      tokenHash(token),
      input.workspaceId,
      input.credential.integrationId,
      input.opportunityId,
      input.lifecycleRevision,
      input.allowedOperation,
      input.credential.kind,
      input.credential.id,
      input.issuanceKeyHash,
      input.predecessorContinuationId ?? null,
      input.retryAfterMs,
      input.now,
      input.expiresAt,
    ],
  );
  return { token, row };
}

async function expireRow(client: PoolClient, row: Row, credential: HumanReviewContinuationCredential, now: Date) {
  await client.query(
    `UPDATE tokenless_agent_review_continuations
     SET status = 'expired', expired_at = $1
     WHERE continuation_id = $2 AND status = 'active'`,
    [now, text(row, "continuation_id")],
  );
  await appendEvent(client, {
    row,
    type: "expired",
    credential,
    reasonCode: "continuation_deadline_elapsed",
    occurredAt: now,
  });
}

export async function issueHumanReviewContinuation(input: {
  credential: HumanReviewContinuationCredential;
  opportunityId: string;
  lifecycleRevision: number;
  allowedNextOperation: HumanReviewContinuationOperation;
  issuanceKey: string;
  retryAfterMs?: number;
  ttlMs?: number;
  now?: Date;
}): Promise<{ continuation: HumanReviewContinuation | null; replayed: boolean }> {
  const now = input.now ?? new Date();
  const requestedOperation = operation(input.allowedNextOperation);
  const issuanceKeyHash = idempotencyHash(input.issuanceKey, "issuanceKey");
  const timing = boundedTiming(input);
  const client = await dbPool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const binding = await loadOpportunityForIssue(client, input.credential.integrationId, input.opportunityId);
    assertCredential(input.credential, binding);
    const state = lifecycleState(binding);
    const revision = positiveInteger(binding, "lifecycle_revision");
    if (isHumanReviewOpportunityTerminalState(state)) {
      await client.query("COMMIT");
      transactionOpen = false;
      return { continuation: null, replayed: false };
    }
    if (revision !== input.lifecycleRevision) {
      throw new TokenlessServiceError(
        "The continuation lifecycle revision is stale.",
        409,
        "review_continuation_revision_conflict",
      );
    }
    assertOperationAllowed(state, requestedOperation);
    const expiresAt = cappedExpiry(now, timing.ttlMs, frozenDeadline(binding));
    const activeResult = await client.query(
      `SELECT * FROM tokenless_agent_review_continuations
       WHERE workspace_id = $1 AND integration_id = $2 AND opportunity_id = $3
         AND lifecycle_revision = $4 AND allowed_operation = $5 AND status = 'active'
       FOR UPDATE`,
      [
        text(binding, "workspace_id"),
        input.credential.integrationId,
        input.opportunityId,
        revision,
        requestedOperation,
      ],
    );
    const active = activeResult.rows[0] as Row | undefined;
    let replayed = false;
    if (active && date(active, "expires_at") <= now) {
      await expireRow(client, active, input.credential, now);
    } else if (active) {
      assertCredential(input.credential, { ...binding, ...active });
      if (text(active, "issuance_key_hash") !== issuanceKeyHash) {
        throw new TokenlessServiceError(
          "Another continuation is already active for this lifecycle operation.",
          409,
          "review_continuation_conflict",
        );
      }
      replayed = true;
    }
    if (active && date(active, "expires_at") > now) {
      await client.query(
        `UPDATE tokenless_agent_review_continuations
         SET status = 'revoked', revoked_at = $1
         WHERE continuation_id = $2 AND status = 'active'`,
        [now, text(active, "continuation_id")],
      );
    }
    const created = await insertContinuation(client, {
      credential: input.credential,
      opportunityId: input.opportunityId,
      workspaceId: text(binding, "workspace_id")!,
      lifecycleRevision: revision,
      allowedOperation: requestedOperation,
      issuanceKeyHash,
      retryAfterMs: timing.retryAfterMs,
      expiresAt,
      now,
    });
    if (active && date(active, "expires_at") > now) {
      await appendEvent(client, {
        row: active,
        type: "issue_replaced",
        credential: input.credential,
        reasonCode: "idempotent_issuance_replay",
        relatedContinuationId: text(created.row, "continuation_id"),
        occurredAt: now,
      });
    }
    await appendEvent(client, {
      row: created.row,
      type: "issued",
      credential: input.credential,
      reasonCode: replayed ? "idempotent_replacement_issued" : "continuation_issued",
      relatedContinuationId: active ? text(active, "continuation_id") : null,
      occurredAt: now,
    });
    await client.query("COMMIT");
    transactionOpen = false;
    return { continuation: continuationFrom(created.token, created.row), replayed };
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function consumeHumanReviewContinuation(input: {
  credential: HumanReviewContinuationCredential;
  token: string;
  operation: HumanReviewContinuationOperation;
  consumptionKey: string;
  now?: Date;
}): Promise<HumanReviewContinuationAuthorization> {
  const now = input.now ?? new Date();
  const requestedOperation = operation(input.operation);
  const consumptionKeyHash = idempotencyHash(input.consumptionKey, "consumptionKey");
  const client = await dbPool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const row = await loadByToken(client, input.token);
    assertCredential(input.credential, row);
    if (operation(row.allowed_operation) !== requestedOperation) {
      throw new TokenlessServiceError(
        "The review continuation does not allow this operation.",
        409,
        "review_continuation_operation_mismatch",
      );
    }
    const status = text(row, "status");
    if (status === "revoked" || status === "expired") {
      throw new TokenlessServiceError(
        "The review continuation is no longer active.",
        410,
        "review_continuation_inactive",
      );
    }
    if (date(row, "expires_at") <= now) {
      if (status === "active") await expireRow(client, row, input.credential, now);
      await client.query("COMMIT");
      transactionOpen = false;
      throw new TokenlessServiceError("The review continuation has expired.", 410, "review_continuation_expired");
    }
    const state = lifecycleState(row);
    const currentRevision = positiveInteger(row, "current_lifecycle_revision");
    const issuedRevision = positiveInteger(row, "lifecycle_revision");
    let replayed = false;
    if (status === "active") {
      if (currentRevision !== issuedRevision && !isHumanReviewOpportunityTerminalState(state)) {
        throw new TokenlessServiceError(
          "The review continuation lifecycle revision is stale.",
          409,
          "review_continuation_revision_conflict",
        );
      }
      if (!isHumanReviewOpportunityTerminalState(state)) assertOperationAllowed(state, requestedOperation);
      await client.query(
        `UPDATE tokenless_agent_review_continuations
         SET status = 'consumed', consumption_key_hash = $1, consumed_at = $2
         WHERE continuation_id = $3 AND status = 'active'`,
        [consumptionKeyHash, now, text(row, "continuation_id")],
      );
      await appendEvent(client, {
        row,
        type: isHumanReviewOpportunityTerminalState(state) ? "terminal_completed" : "consumed",
        credential: input.credential,
        reasonCode: isHumanReviewOpportunityTerminalState(state)
          ? "terminal_result_requires_no_continuation"
          : "operation_authorized",
        occurredAt: now,
      });
    } else if (status === "consumed" || status === "rotated") {
      if (text(row, "consumption_key_hash") !== consumptionKeyHash) {
        throw new TokenlessServiceError(
          "The review continuation was already consumed by another logical operation.",
          409,
          "review_continuation_consumption_conflict",
        );
      }
      replayed = true;
      await appendEvent(client, {
        row,
        type: "consume_replayed",
        credential: input.credential,
        reasonCode: "idempotent_consumption_replay",
        occurredAt: now,
      });
    } else {
      throw new Error("Database returned an invalid review continuation status.");
    }
    await client.query("COMMIT");
    transactionOpen = false;
    return {
      workspaceId: text(row, "workspace_id")!,
      integrationId: text(row, "integration_id")!,
      opportunityId: text(row, "opportunity_id")!,
      allowedOperation: requestedOperation,
      lifecycleRevision: issuedRevision,
      currentLifecycle: {
        state,
        revision: currentRevision,
        terminal: isHumanReviewOpportunityTerminalState(state),
      },
      replayed,
    };
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function rotateHumanReviewContinuation(input: {
  credential: HumanReviewContinuationCredential;
  consumedToken: string;
  consumptionKey: string;
  allowedNextOperation: HumanReviewContinuationOperation;
  retryAfterMs?: number;
  ttlMs?: number;
  now?: Date;
}): Promise<{ continuation: HumanReviewContinuation | null; replayed: boolean }> {
  const now = input.now ?? new Date();
  const nextOperation = operation(input.allowedNextOperation);
  const consumptionKeyHash = idempotencyHash(input.consumptionKey, "consumptionKey");
  const timing = boundedTiming(input);
  const client = await dbPool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const source = await loadByToken(client, input.consumedToken);
    assertCredential(input.credential, source);
    const sourceStatus = text(source, "status");
    if (
      (sourceStatus !== "consumed" && sourceStatus !== "rotated") ||
      text(source, "consumption_key_hash") !== consumptionKeyHash
    ) {
      throw new TokenlessServiceError(
        "Only the exact consumed continuation operation can be rotated.",
        409,
        "review_continuation_rotation_conflict",
      );
    }
    const state = lifecycleState(source);
    const currentRevision = positiveInteger(source, "current_lifecycle_revision");
    const deadline = frozenDeadline(source);
    if (!isHumanReviewOpportunityTerminalState(state)) cappedExpiry(now, timing.ttlMs, deadline);
    if (date(source, "expires_at") <= now && !isHumanReviewOpportunityTerminalState(state)) {
      throw new TokenlessServiceError(
        "The consumed review continuation has expired.",
        410,
        "review_continuation_expired",
      );
    }
    const oldSuccessorId = text(source, "successor_continuation_id");
    if (oldSuccessorId) {
      const successorResult = await client.query(
        `SELECT * FROM tokenless_agent_review_continuations
         WHERE continuation_id = $1 FOR UPDATE`,
        [oldSuccessorId],
      );
      const successor = successorResult.rows[0] as Row | undefined;
      if (successor && text(successor, "status") === "active") {
        await client.query(
          `UPDATE tokenless_agent_review_continuations
           SET status = 'revoked', revoked_at = $1
           WHERE continuation_id = $2 AND status = 'active'`,
          [now, oldSuccessorId],
        );
        await appendEvent(client, {
          row: successor,
          type: "rotation_replaced",
          credential: input.credential,
          reasonCode: isHumanReviewOpportunityTerminalState(state)
            ? "terminal_state_reached"
            : "idempotent_rotation_replay",
          relatedContinuationId: text(source, "continuation_id"),
          occurredAt: now,
        });
      }
    }
    if (isHumanReviewOpportunityTerminalState(state)) {
      await client.query(
        `UPDATE tokenless_agent_review_continuations
         SET status = 'consumed', rotated_at = NULL, successor_continuation_id = NULL
         WHERE continuation_id = $1 AND status IN ('consumed', 'rotated')`,
        [text(source, "continuation_id")],
      );
      await appendEvent(client, {
        row: source,
        type: "terminal_completed",
        credential: input.credential,
        reasonCode: "terminal_result_requires_no_continuation",
        occurredAt: now,
      });
      await client.query("COMMIT");
      transactionOpen = false;
      return { continuation: null, replayed: sourceStatus === "rotated" };
    }
    assertOperationAllowed(state, nextOperation);
    const expiresAt = cappedExpiry(now, timing.ttlMs, deadline);
    const conflictingResult = await client.query(
      `SELECT * FROM tokenless_agent_review_continuations
       WHERE workspace_id = $1 AND integration_id = $2 AND opportunity_id = $3
         AND lifecycle_revision = $4 AND allowed_operation = $5 AND status = 'active'
       FOR UPDATE`,
      [
        text(source, "workspace_id"),
        input.credential.integrationId,
        text(source, "opportunity_id"),
        currentRevision,
        nextOperation,
      ],
    );
    const conflict = conflictingResult.rows[0] as Row | undefined;
    if (conflict && text(conflict, "continuation_id") !== oldSuccessorId) {
      throw new TokenlessServiceError(
        "Another continuation is already active for the next lifecycle operation.",
        409,
        "review_continuation_conflict",
      );
    }
    const created = await insertContinuation(client, {
      credential: input.credential,
      opportunityId: text(source, "opportunity_id")!,
      workspaceId: text(source, "workspace_id")!,
      lifecycleRevision: currentRevision,
      allowedOperation: nextOperation,
      issuanceKeyHash: hash(`rotation:${text(source, "continuation_id")}:${consumptionKeyHash}`),
      predecessorContinuationId: text(source, "continuation_id"),
      retryAfterMs: timing.retryAfterMs,
      expiresAt,
      now,
    });
    await client.query(
      `UPDATE tokenless_agent_review_continuations
       SET status = 'rotated', rotated_at = $1, successor_continuation_id = $2
       WHERE continuation_id = $3 AND status IN ('consumed', 'rotated') AND consumption_key_hash = $4`,
      [now, text(created.row, "continuation_id"), text(source, "continuation_id"), consumptionKeyHash],
    );
    await appendEvent(client, {
      row: source,
      type: "rotated",
      credential: input.credential,
      reasonCode: sourceStatus === "rotated" ? "idempotent_replacement_rotated" : "continuation_rotated",
      relatedContinuationId: text(created.row, "continuation_id"),
      occurredAt: now,
    });
    await appendEvent(client, {
      row: created.row,
      type: "issued",
      credential: input.credential,
      reasonCode: "rotation_successor_issued",
      relatedContinuationId: text(source, "continuation_id"),
      occurredAt: now,
    });
    await client.query("COMMIT");
    transactionOpen = false;
    return { continuation: continuationFrom(created.token, created.row), replayed: sourceStatus === "rotated" };
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Workspace-stop primitive: revokes every active continuation in a workspace
 * inside the caller's transaction. Each revocation appends the standard
 * `revoked` continuation event attributed to the continuation's bound
 * credential; the initiating human actor is recorded by the caller in the
 * workspace audit chain.
 */
export async function revokeWorkspaceHumanReviewContinuations(
  client: PoolClient,
  input: { workspaceId: string; reasonCode: string; now: Date },
): Promise<number> {
  const active = await client.query(
    `SELECT * FROM tokenless_agent_review_continuations
     WHERE workspace_id = $1 AND status = 'active' ORDER BY continuation_id ASC FOR UPDATE`,
    [input.workspaceId],
  );
  for (const value of active.rows as Row[]) {
    await client.query(
      `UPDATE tokenless_agent_review_continuations
       SET status = 'revoked', revoked_at = $1
       WHERE continuation_id = $2 AND status = 'active'`,
      [input.now, text(value, "continuation_id")],
    );
    await appendEvent(client, {
      row: value,
      type: "revoked",
      credential: {
        integrationId: text(value, "integration_id")!,
        kind: text(value, "caller_credential_kind") as HumanReviewContinuationCredential["kind"],
        id: text(value, "caller_credential_id")!,
      },
      reasonCode: input.reasonCode,
      occurredAt: input.now,
    });
  }
  return active.rows.length;
}

export async function revokeHumanReviewContinuation(input: {
  credential: HumanReviewContinuationCredential;
  token: string;
  now?: Date;
}): Promise<{ revoked: boolean; replayed: boolean }> {
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const row = await loadByToken(client, input.token);
    assertCredential(input.credential, row);
    const status = text(row, "status");
    if (status === "revoked") {
      await client.query("COMMIT");
      transactionOpen = false;
      return { revoked: true, replayed: true };
    }
    if (status !== "active") {
      throw new TokenlessServiceError(
        "Only an active review continuation can be revoked.",
        409,
        "review_continuation_inactive",
      );
    }
    if (date(row, "expires_at") <= now) {
      await expireRow(client, row, input.credential, now);
      await client.query("COMMIT");
      transactionOpen = false;
      return { revoked: false, replayed: false };
    }
    await client.query(
      `UPDATE tokenless_agent_review_continuations
       SET status = 'revoked', revoked_at = $1
       WHERE continuation_id = $2 AND status = 'active'`,
      [now, text(row, "continuation_id")],
    );
    await appendEvent(client, {
      row,
      type: "revoked",
      credential: input.credential,
      reasonCode: "continuation_revoked",
      occurredAt: now,
    });
    await client.query("COMMIT");
    transactionOpen = false;
    return { revoked: true, replayed: false };
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
