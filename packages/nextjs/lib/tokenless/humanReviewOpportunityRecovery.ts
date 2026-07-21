import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import { classifyAcceptedWorkFailurePayment } from "~~/lib/tokenless/acceptedWorkPaymentGuarantees";
import {
  type HumanReviewOpportunityState,
  canonicalizeHumanReviewReasonCodes,
  transitionHumanReviewOpportunityLifecycleInTransaction,
} from "~~/lib/tokenless/humanReviewOpportunityLifecycle";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type QueryableClient = Pick<PoolClient, "query">;

export const MAXIMUM_HUMAN_REVIEW_RECOVERY_FAILURES = 3;
const TRANSITION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{7,199}$/u;
const ERROR_CODE_PATTERN = /^[a-z0-9][a-z0-9:._-]{0,95}$/u;
const RECOVERABLE_STATES = new Set<HumanReviewOpportunityState>([
  "approval_required",
  "request_ready",
  "pending",
  "blocked",
]);

export type HumanReviewFailureSignal =
  | "response_deadline_elapsed"
  | "all_assignments_expired"
  | "owner_policy_disabled"
  | "adapter_failure"
  | "infrastructure_failure";

export type HumanReviewRecoveryAction =
  | "blocked_for_retry"
  | "retry_remains_blocked"
  | "retry_resumed"
  | "terminal_inconclusive"
  | "terminal_failed"
  | "cancelled_before_commit";

export type HumanReviewRecoveryEvent = {
  eventId: string;
  workspaceId: string;
  opportunityId: string;
  transitionKey: string;
  requestCommitment: string;
  signal: HumanReviewFailureSignal | "retry_succeeded";
  action: HumanReviewRecoveryAction;
  fromState: HumanReviewOpportunityState;
  toState: HumanReviewOpportunityState;
  fromRevision: number;
  toRevision: number;
  failureCount: number;
  acceptedWorkCount: number;
  committedWorkCount: number;
  responseCount: number;
  reasonCodes: string[];
  details: Record<string, unknown>;
  occurredAt: string;
  replayed: boolean;
};

type OpportunitySnapshot = {
  state: HumanReviewOpportunityState;
  revision: number;
  responseDeadline: Date;
  operationKey: string | null;
  runId: string | null;
  policyDisabled: boolean;
};

type WorkSnapshot = {
  acceptedWorkCount: number;
  committedWorkCount: number;
  responseCount: number;
  publicPayableWorkCount: number;
  paidAcceptedWorkCount: number;
  paidPayableWorkCount: number;
  assignmentCount: number;
  activeAssignmentCount: number;
  expiredAssignmentCount: number;
};

type RecoveryState = {
  status: "recovery_required" | "recovered" | "terminal";
  resumeState: "approval_required" | "request_ready" | "pending" | null;
  failureCount: number;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Human-review recovery input is not canonicalizable.");
  return encoded;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function requiredIdentifier(value: string, field: string) {
  if (!value.trim() || value.length > 200) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_human_review_recovery");
  }
  return value;
}

function transitionKey(value: string) {
  if (!TRANSITION_KEY_PATTERN.test(value)) {
    throw new TokenlessServiceError("transitionKey is invalid.", 400, "invalid_human_review_recovery");
  }
  return value;
}

function errorCode(value: string | undefined) {
  if (value === undefined) return null;
  if (!ERROR_CODE_PATTERN.test(value)) {
    throw new TokenlessServiceError("errorCode is invalid.", 400, "invalid_human_review_recovery");
  }
  return value;
}

function integer(row: Row | undefined, key: string, minimum = 0) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Stored ${key} is invalid.`);
  return value;
}

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function bool(row: Row | undefined, key: string) {
  return row?.[key] === true || row?.[key] === "t" || row?.[key] === 1;
}

function date(value: unknown, field: string) {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Stored ${field} is invalid.`);
  return parsed;
}

function state(value: unknown): HumanReviewOpportunityState {
  const normalized = String(value) as HumanReviewOpportunityState;
  if (!RECOVERABLE_STATES.has(normalized)) throw new Error("Stored recovery lifecycle state is invalid.");
  return normalized;
}

function parseObject(value: unknown, field: string) {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Stored ${field} is invalid.`);
  }
}

function parseReasons(value: unknown) {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== "string")) throw new Error();
    return canonicalizeHumanReviewReasonCodes(parsed as string[]);
  } catch {
    throw new Error("Stored human-review recovery reasons are invalid.");
  }
}

function recoveryEventFromRow(row: Row, replayed: boolean): HumanReviewRecoveryEvent {
  return {
    eventId: String(row.event_id),
    workspaceId: String(row.workspace_id),
    opportunityId: String(row.opportunity_id),
    transitionKey: String(row.transition_key),
    requestCommitment: String(row.request_commitment),
    signal: String(row.signal) as HumanReviewRecoveryEvent["signal"],
    action: String(row.action) as HumanReviewRecoveryAction,
    fromState: String(row.from_state) as HumanReviewOpportunityState,
    toState: String(row.to_state) as HumanReviewOpportunityState,
    fromRevision: integer(row, "from_revision", 1),
    toRevision: integer(row, "to_revision", 1),
    failureCount: integer(row, "failure_count"),
    acceptedWorkCount: integer(row, "accepted_work_count"),
    committedWorkCount: integer(row, "committed_work_count"),
    responseCount: integer(row, "response_count"),
    reasonCodes: parseReasons(row.reason_codes_json),
    details: parseObject(row.details_json, "recovery event details"),
    occurredAt: date(row.occurred_at, "recovery event time").toISOString(),
    replayed,
  };
}

async function loadOpportunitySnapshot(
  client: QueryableClient,
  workspaceId: string,
  opportunityId: string,
): Promise<OpportunitySnapshot> {
  const lockedLifecycle = await client.query(
    `SELECT state,state_revision,terminal_at
     FROM tokenless_agent_review_opportunity_lifecycles
     WHERE workspace_id = $1 AND opportunity_id = $2
     FOR UPDATE`,
    [workspaceId, opportunityId],
  );
  const lockedRow = lockedLifecycle.rows[0] as Row | undefined;
  if (!lockedRow) {
    throw new TokenlessServiceError(
      "Human-review opportunity lifecycle not found.",
      404,
      "human_review_lifecycle_not_found",
    );
  }
  if (lockedRow.terminal_at !== null && lockedRow.terminal_at !== undefined) {
    throw new TokenlessServiceError(
      "Human-review opportunity is already terminal.",
      409,
      "human_review_lifecycle_terminal",
    );
  }
  const result = await client.query(
    `SELECT l.state, l.state_revision, l.terminal_at,
            o.operation_key, o.run_id, o.created_at AS opportunity_created_at,
            p.response_window_seconds,
            policy.enabled AS policy_enabled, policy.superseded_at AS policy_superseded_at,
            binding.enabled AS binding_enabled, binding.superseded_at AS binding_superseded_at,
            private_request.response_deadline AS private_response_deadline,
            private_delivery.response_deadline AS private_delivery_deadline
     FROM tokenless_agent_review_opportunity_lifecycles l
     JOIN tokenless_agent_review_opportunities o
       ON o.workspace_id = l.workspace_id AND o.opportunity_id = l.opportunity_id
     JOIN tokenless_agent_review_request_profiles p
       ON p.workspace_id = o.workspace_id
      AND p.profile_id = o.request_profile_id
      AND p.version = o.request_profile_version
      AND p.profile_hash = o.request_profile_hash
     JOIN tokenless_agent_review_policies policy
       ON policy.workspace_id = o.workspace_id
      AND policy.policy_id = o.policy_id AND policy.version = o.policy_version
     JOIN tokenless_agent_human_review_bindings binding
       ON binding.workspace_id = o.workspace_id
      AND binding.binding_id = o.human_review_binding_id
      AND binding.version = o.human_review_binding_version
     LEFT JOIN tokenless_private_unpaid_review_deliveries private_delivery
       ON private_delivery.workspace_id = o.workspace_id
      AND private_delivery.opportunity_id = o.opportunity_id
     LEFT JOIN tokenless_private_review_requests private_request
       ON private_request.workspace_id = o.workspace_id
      AND private_request.private_review_id = private_delivery.private_review_id
     WHERE l.workspace_id = $1 AND l.opportunity_id = $2`,
    [workspaceId, opportunityId],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new Error("Locked human-review opportunity snapshot could not be loaded.");
  const approvalResult = await client.query(
    `SELECT expires_at
     FROM tokenless_agent_review_approval_requests
     WHERE workspace_id = $1 AND opportunity_id = $2
       AND status IN ('approved', 'consumed')
     ORDER BY revision DESC LIMIT 1`,
    [workspaceId, opportunityId],
  );
  const approvalDeadline = (approvalResult.rows[0] as Row | undefined)?.expires_at ?? null;
  const currentState = state(row.state);
  const frozenDeadline =
    row.private_delivery_deadline ??
    row.private_response_deadline ??
    approvalDeadline ??
    new Date(
      date(row.opportunity_created_at, "opportunity creation time").getTime() +
        integer(row, "response_window_seconds", 1) * 1_000,
    );
  return {
    state: currentState,
    revision: integer(row, "state_revision", 1),
    responseDeadline: date(frozenDeadline, "response deadline"),
    operationKey: text(row, "operation_key"),
    runId: text(row, "run_id"),
    policyDisabled:
      !bool(row, "policy_enabled") ||
      row.policy_superseded_at !== null ||
      !bool(row, "binding_enabled") ||
      row.binding_superseded_at !== null,
  };
}

async function loadWorkSnapshot(
  client: QueryableClient,
  input: { workspaceId: string; opportunityId: string; operationKey: string | null; runId: string | null },
): Promise<WorkSnapshot> {
  const privateResult = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE assignment.accepted_at IS NOT NULL
                         OR assignment.status IN ('accepted','completed')) AS accepted,
       COUNT(*) AS assignment_count,
       COUNT(*) FILTER (WHERE assignment.status IN ('reserved','accepted')) AS active_assignment_count,
       COUNT(*) FILTER (WHERE assignment.status = 'expired') AS expired_assignment_count
     FROM tokenless_private_unpaid_review_assignments assignment
     JOIN tokenless_private_unpaid_review_deliveries delivery
       ON delivery.delivery_id = assignment.delivery_id
     WHERE delivery.workspace_id = $1 AND delivery.opportunity_id = $2`,
    [input.workspaceId, input.opportunityId],
  );
  const privateRow = privateResult.rows[0] as Row | undefined;
  if (!privateRow) throw new Error("Private human-review work snapshot was not returned.");

  let publicResponses = 0;
  let publicPayableWorkCount = 0;
  let publicCommits = 0;
  let paidCommits = 0;
  if (input.operationKey) {
    const publicResult = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM tokenless_public_rater_responses response
           WHERE response.operation_key = $1) AS responses,
         (SELECT COUNT(*) FROM tokenless_public_rater_responses response
           WHERE response.operation_key = $1 AND response.hash_verified_at IS NOT NULL) AS paid_payable,
         (SELECT COUNT(*) FROM tokenless_rater_commits commit_record
            JOIN tokenless_public_rater_responses response ON response.voucher_id = commit_record.voucher_id
           WHERE response.operation_key = $1) AS commits,
         (SELECT COUNT(*) FROM tokenless_paid_vouchers voucher
            JOIN tokenless_agent_asks ask ON ask.operation_key = $1
           WHERE ask.round_id IS NOT NULL AND voucher.round_id = CAST(ask.round_id AS numeric)
             AND (voucher.committed_at IS NOT NULL OR voucher.status = 'committed')) AS paid_commits`,
      [input.operationKey],
    );
    const publicRow = publicResult.rows[0] as Row | undefined;
    if (!publicRow) throw new Error("Public human-review work snapshot was not returned.");
    publicResponses = integer(publicRow, "responses");
    publicPayableWorkCount = integer(publicRow, "paid_payable");
    publicCommits = integer(publicRow, "commits");
    paidCommits = integer(publicRow, "paid_commits");
  }

  let assuranceAccepted = 0;
  let assuranceResponses = 0;
  let assurancePaidAccepted = 0;
  let assurancePaidPayable = 0;
  let assuranceAssignmentCount = 0;
  let assuranceActiveAssignmentCount = 0;
  let assuranceExpiredAssignmentCount = 0;
  if (input.runId) {
    const assuranceResult = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE assignment.accepted_at IS NOT NULL
                           OR assignment.status IN ('accepted','completed')) AS accepted,
         COUNT(*) FILTER (WHERE assignment.paid_assignment = true
                           AND (assignment.accepted_at IS NOT NULL
                             OR assignment.status IN ('accepted','completed'))) AS paid_accepted,
         COUNT(*) FILTER (WHERE assignment.paid_assignment = true AND assignment.status = 'completed'
                           AND EXISTS (SELECT 1 FROM tokenless_assurance_responses response
                                       WHERE response.run_id = assignment.run_id)) AS paid_payable,
         COUNT(*) AS assignment_count,
         COUNT(*) FILTER (WHERE assignment.status IN ('reserved','accepted')) AS active_assignment_count,
         COUNT(*) FILTER (WHERE assignment.status IN ('expired','released')) AS expired_assignment_count,
         (SELECT COUNT(*) FROM tokenless_assurance_responses response WHERE response.run_id = $1) AS responses
       FROM tokenless_assurance_assignments assignment
       WHERE assignment.run_id = $1`,
      [input.runId],
    );
    const assuranceRow = assuranceResult.rows[0] as Row | undefined;
    if (!assuranceRow) throw new Error("Assurance work snapshot was not returned.");
    assuranceAccepted = integer(assuranceRow, "accepted");
    assuranceResponses = integer(assuranceRow, "responses");
    assurancePaidAccepted = integer(assuranceRow, "paid_accepted");
    assurancePaidPayable = integer(assuranceRow, "paid_payable");
    assuranceAssignmentCount = integer(assuranceRow, "assignment_count");
    assuranceActiveAssignmentCount = integer(assuranceRow, "active_assignment_count");
    assuranceExpiredAssignmentCount = integer(assuranceRow, "expired_assignment_count");
  }

  const privateAccepted = integer(privateRow, "accepted");
  return {
    acceptedWorkCount: privateAccepted + assuranceAccepted + paidCommits,
    committedWorkCount: publicCommits + paidCommits,
    responseCount: publicResponses + assuranceResponses,
    publicPayableWorkCount,
    paidAcceptedWorkCount: assurancePaidAccepted + Math.max(paidCommits, publicResponses),
    paidPayableWorkCount: assurancePaidPayable + publicPayableWorkCount,
    assignmentCount: integer(privateRow, "assignment_count") + assuranceAssignmentCount,
    activeAssignmentCount: integer(privateRow, "active_assignment_count") + assuranceActiveAssignmentCount,
    expiredAssignmentCount: integer(privateRow, "expired_assignment_count") + assuranceExpiredAssignmentCount,
  };
}

async function loadRecoveryState(
  client: QueryableClient,
  workspaceId: string,
  opportunityId: string,
): Promise<RecoveryState | null> {
  const result = await client.query(
    `SELECT status,resume_state,failure_count
     FROM tokenless_agent_review_opportunity_recovery_states
     WHERE workspace_id = $1 AND opportunity_id = $2 FOR UPDATE`,
    [workspaceId, opportunityId],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) return null;
  return {
    status: String(row.status) as RecoveryState["status"],
    resumeState: text(row, "resume_state") as RecoveryState["resumeState"],
    failureCount: integer(row, "failure_count"),
  };
}

async function replayRecoveryEvent(
  client: QueryableClient,
  input: { workspaceId: string; opportunityId: string; transitionKey: string; requestCommitment: string },
) {
  const result = await client.query(
    `SELECT * FROM tokenless_agent_review_opportunity_recovery_events
     WHERE workspace_id = $1 AND opportunity_id = $2 AND transition_key = $3`,
    [input.workspaceId, input.opportunityId, input.transitionKey],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) return null;
  if (text(row, "request_commitment") !== input.requestCommitment) {
    throw new TokenlessServiceError(
      "transitionKey was already used for a different recovery request.",
      409,
      "human_review_recovery_idempotency_conflict",
    );
  }
  return recoveryEventFromRow(row, true);
}

function hasAcceptedWork(work: WorkSnapshot) {
  return work.acceptedWorkCount > 0 || work.committedWorkCount > 0 || work.responseCount > 0;
}

function terminalDecision(_signal: HumanReviewFailureSignal, work: WorkSnapshot, cancellationIsPreCommit: boolean) {
  if (!hasAcceptedWork(work) && cancellationIsPreCommit) {
    return { toState: "cancelled_before_commit" as const, action: "cancelled_before_commit" as const };
  }
  return hasAcceptedWork(work)
    ? { toState: "inconclusive" as const, action: "terminal_inconclusive" as const }
    : { toState: "failed_terminal" as const, action: "terminal_failed" as const };
}

function recoveryBackoffMs(failureCount: number) {
  return Math.min(5 * 60_000, 30_000 * 2 ** Math.max(0, failureCount - 1));
}

async function writeRecoveryState(
  client: QueryableClient,
  input: {
    workspaceId: string;
    opportunityId: string;
    status: RecoveryState["status"];
    resumeState: RecoveryState["resumeState"];
    failureCount: number;
    signal: HumanReviewRecoveryEvent["signal"];
    errorCode: string | null;
    firstFailureAt: Date | null;
    lastFailureAt: Date | null;
    nextRetryAt: Date | null;
    terminalState: "inconclusive" | "failed_terminal" | "cancelled_before_commit" | null;
    now: Date;
  },
) {
  await client.query(
    `INSERT INTO tokenless_agent_review_opportunity_recovery_states
       (workspace_id,opportunity_id,status,resume_state,failure_count,maximum_failures,
        last_signal,last_error_code,first_failure_at,last_failure_at,next_retry_at,
        terminal_state,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
     ON CONFLICT (workspace_id,opportunity_id) DO UPDATE SET
       status = EXCLUDED.status, resume_state = EXCLUDED.resume_state,
       failure_count = EXCLUDED.failure_count, last_signal = EXCLUDED.last_signal,
       last_error_code = EXCLUDED.last_error_code,
       first_failure_at = COALESCE(tokenless_agent_review_opportunity_recovery_states.first_failure_at,
                                   EXCLUDED.first_failure_at),
       last_failure_at = COALESCE(EXCLUDED.last_failure_at,
                                  tokenless_agent_review_opportunity_recovery_states.last_failure_at),
       next_retry_at = EXCLUDED.next_retry_at,
       terminal_state = EXCLUDED.terminal_state, updated_at = EXCLUDED.updated_at`,
    [
      input.workspaceId,
      input.opportunityId,
      input.status,
      input.resumeState,
      input.failureCount,
      MAXIMUM_HUMAN_REVIEW_RECOVERY_FAILURES,
      input.signal,
      input.errorCode,
      input.firstFailureAt,
      input.lastFailureAt,
      input.nextRetryAt,
      input.terminalState,
      input.now,
    ],
  );
}

async function appendRecoveryEvent(
  client: QueryableClient,
  input: Omit<HumanReviewRecoveryEvent, "eventId" | "occurredAt" | "replayed"> & { occurredAt: Date },
) {
  const eventId = `hrre_${createHash("sha256")
    .update(`${input.workspaceId}\0${input.opportunityId}\0${input.transitionKey}`)
    .digest("hex")
    .slice(0, 40)}`;
  const result = await client.query(
    `INSERT INTO tokenless_agent_review_opportunity_recovery_events
       (event_id,workspace_id,opportunity_id,transition_key,request_commitment,signal,action,
        from_state,to_state,from_revision,to_revision,failure_count,accepted_work_count,
        committed_work_count,response_count,reason_codes_json,details_json,occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [
      eventId,
      input.workspaceId,
      input.opportunityId,
      input.transitionKey,
      input.requestCommitment,
      input.signal,
      input.action,
      input.fromState,
      input.toState,
      input.fromRevision,
      input.toRevision,
      input.failureCount,
      input.acceptedWorkCount,
      input.committedWorkCount,
      input.responseCount,
      JSON.stringify(input.reasonCodes),
      stableJson(input.details),
      input.occurredAt,
    ],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new Error("Human-review recovery event was not persisted.");
  return recoveryEventFromRow(row, false);
}

export async function recordHumanReviewOpportunityFailure(input: {
  workspaceId: string;
  opportunityId: string;
  transitionKey: string;
  signal: HumanReviewFailureSignal;
  errorCode?: string;
  retryable?: boolean;
  occurredAt?: Date;
}): Promise<HumanReviewRecoveryEvent> {
  const workspaceId = requiredIdentifier(input.workspaceId, "workspaceId");
  const opportunityId = requiredIdentifier(input.opportunityId, "opportunityId");
  const key = transitionKey(input.transitionKey);
  const normalizedErrorCode = errorCode(input.errorCode);
  const occurredAt = input.occurredAt ?? new Date();
  if (!Number.isFinite(occurredAt.getTime())) {
    throw new TokenlessServiceError("occurredAt is invalid.", 400, "invalid_human_review_recovery");
  }
  const isTransient = input.signal === "adapter_failure" || input.signal === "infrastructure_failure";
  if (!isTransient && (input.errorCode !== undefined || input.retryable !== undefined)) {
    throw new TokenlessServiceError(
      "Only adapter or infrastructure failures accept errorCode and retryable.",
      400,
      "invalid_human_review_recovery",
    );
  }
  const retryable = isTransient ? (input.retryable ?? true) : false;
  const requestCommitment = sha256({
    schemaVersion: "rateloop.human-review-recovery-request.v1",
    workspaceId,
    opportunityId,
    transitionKey: key,
    signal: input.signal,
    errorCode: normalizedErrorCode,
    retryable,
  });
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const opportunity = await loadOpportunitySnapshot(client, workspaceId, opportunityId);
    const replay = await replayRecoveryEvent(client, {
      workspaceId,
      opportunityId,
      transitionKey: key,
      requestCommitment,
    });
    if (replay) {
      await client.query("COMMIT");
      return replay;
    }
    const recovery = await loadRecoveryState(client, workspaceId, opportunityId);
    if (opportunity.state === "blocked" && (!recovery || recovery.status !== "recovery_required")) {
      throw new TokenlessServiceError(
        "Blocked human-review opportunity has no matching recovery state.",
        409,
        "human_review_recovery_state_conflict",
      );
    }
    const work = await loadWorkSnapshot(client, { workspaceId, opportunityId, ...opportunity });
    if (input.signal === "response_deadline_elapsed" && occurredAt < opportunity.responseDeadline) {
      throw new TokenlessServiceError(
        "The frozen response deadline has not elapsed.",
        409,
        "human_review_response_deadline_active",
      );
    }
    if (
      input.signal === "all_assignments_expired" &&
      (work.assignmentCount === 0 ||
        work.activeAssignmentCount !== 0 ||
        work.expiredAssignmentCount !== work.assignmentCount)
    ) {
      throw new TokenlessServiceError(
        "Assignments are not all expired.",
        409,
        "human_review_assignments_still_actionable",
      );
    }
    if (input.signal === "owner_policy_disabled" && !opportunity.policyDisabled) {
      throw new TokenlessServiceError(
        "The frozen owner policy is still active.",
        409,
        "human_review_policy_still_active",
      );
    }

    const priorFailureCount = recovery?.failureCount ?? 0;
    const failureCount = isTransient
      ? Math.min(MAXIMUM_HUMAN_REVIEW_RECOVERY_FAILURES, priorFailureCount + 1)
      : priorFailureCount;
    const shouldRetry =
      isTransient &&
      retryable &&
      failureCount < MAXIMUM_HUMAN_REVIEW_RECOVERY_FAILURES &&
      occurredAt < opportunity.responseDeadline;
    let toState: HumanReviewOpportunityState;
    let action: HumanReviewRecoveryAction;
    let reasons: string[];
    let nextRetryAt: Date | null = null;
    let resumeState = recovery?.resumeState ?? null;
    let payment: ReturnType<typeof classifyAcceptedWorkFailurePayment> | null = null;
    if (shouldRetry) {
      resumeState =
        resumeState ??
        (opportunity.state === "approval_required" ||
        opportunity.state === "request_ready" ||
        opportunity.state === "pending"
          ? opportunity.state
          : null);
      if (!resumeState) {
        throw new TokenlessServiceError(
          "Blocked recovery is missing its exact resume state.",
          409,
          "human_review_recovery_state_conflict",
        );
      }
      toState = "blocked";
      action = opportunity.state === "blocked" ? "retry_remains_blocked" : "blocked_for_retry";
      nextRetryAt = new Date(occurredAt.getTime() + recoveryBackoffMs(failureCount));
      reasons = [input.signal, "recovery_required", `retry_${failureCount}_of_3`];
      if (action === "blocked_for_retry") {
        await transitionHumanReviewOpportunityLifecycleInTransaction(client, {
          workspaceId,
          opportunityId,
          transitionKey: `recovery:${key}`,
          expectedState: opportunity.state,
          expectedRevision: opportunity.revision,
          toState,
          reasonCodes: reasons,
          actor: { kind: "service", reference: "human-review-recovery-v1" },
          details: {
            failureCount,
            maximumFailures: MAXIMUM_HUMAN_REVIEW_RECOVERY_FAILURES,
            resumeState,
            nextRetryAt: nextRetryAt.toISOString(),
            errorCode: normalizedErrorCode,
          },
          occurredAt,
        });
      }
      await writeRecoveryState(client, {
        workspaceId,
        opportunityId,
        status: "recovery_required",
        resumeState,
        failureCount,
        signal: input.signal,
        errorCode: normalizedErrorCode,
        firstFailureAt: occurredAt,
        lastFailureAt: occurredAt,
        nextRetryAt,
        terminalState: null,
        now: occurredAt,
      });
    } else {
      const cancellationIsPreCommit =
        opportunity.state === "approval_required" ||
        opportunity.state === "request_ready" ||
        (opportunity.state === "blocked" &&
          (recovery?.resumeState === "approval_required" || recovery?.resumeState === "request_ready"));
      const terminal = terminalDecision(input.signal, work, cancellationIsPreCommit);
      toState = terminal.toState;
      action = terminal.action;
      payment = classifyAcceptedWorkFailurePayment({
        terminalState: toState,
        anyAcceptedWork: hasAcceptedWork(work),
        paidAcceptedWorkCount: work.paidAcceptedWorkCount,
        paidPayableWorkCount: work.paidPayableWorkCount,
      });
      reasons = [input.signal];
      if (isTransient && failureCount >= MAXIMUM_HUMAN_REVIEW_RECOVERY_FAILURES) {
        reasons.push("recovery_retries_exhausted");
      } else if (isTransient && !retryable) {
        reasons.push("non_retryable_failure");
      } else if (isTransient && occurredAt >= opportunity.responseDeadline) {
        reasons.push("response_deadline_elapsed");
      }
      if (hasAcceptedWork(work)) reasons.push("accepted_work_payable", "no_post_commit_cancellation");
      else reasons.push("no_accepted_work");
      reasons = canonicalizeHumanReviewReasonCodes(reasons);
      await transitionHumanReviewOpportunityLifecycleInTransaction(client, {
        workspaceId,
        opportunityId,
        transitionKey: `recovery:${key}`,
        expectedState: opportunity.state,
        expectedRevision: opportunity.revision,
        toState,
        reasonCodes: reasons,
        actor: { kind: "service", reference: "human-review-recovery-v1" },
        details: {
          acceptedWorkCount: work.acceptedWorkCount,
          committedWorkCount: work.committedWorkCount,
          responseCount: work.responseCount,
          payment,
          failureCount,
          errorCode: normalizedErrorCode,
        },
        occurredAt,
      });
      await writeRecoveryState(client, {
        workspaceId,
        opportunityId,
        status: "terminal",
        resumeState,
        failureCount,
        signal: input.signal,
        errorCode: normalizedErrorCode,
        firstFailureAt: isTransient ? occurredAt : null,
        lastFailureAt: isTransient ? occurredAt : null,
        nextRetryAt: null,
        terminalState: toState as "inconclusive" | "failed_terminal" | "cancelled_before_commit",
        now: occurredAt,
      });
      await client.query(
        `UPDATE tokenless_agent_review_opportunities
         SET status = 'failed', updated_at = $1
         WHERE workspace_id = $2 AND opportunity_id = $3 AND status IN ('decided','review_requested')`,
        [occurredAt, workspaceId, opportunityId],
      );
      await client.query(
        `UPDATE tokenless_private_unpaid_review_deliveries
         SET status = $1, updated_at = $2
         WHERE workspace_id = $3 AND opportunity_id = $4 AND status = 'pending'`,
        [toState === "inconclusive" ? "inconclusive" : "failed_terminal", occurredAt, workspaceId, opportunityId],
      );
    }
    reasons = canonicalizeHumanReviewReasonCodes(reasons);
    const event = await appendRecoveryEvent(client, {
      workspaceId,
      opportunityId,
      transitionKey: key,
      requestCommitment,
      signal: input.signal,
      action,
      fromState: opportunity.state,
      toState,
      fromRevision: opportunity.revision,
      toRevision: opportunity.state === toState ? opportunity.revision : opportunity.revision + 1,
      failureCount,
      acceptedWorkCount: work.acceptedWorkCount,
      committedWorkCount: work.committedWorkCount,
      responseCount: work.responseCount,
      reasonCodes: reasons,
      details: {
        assignmentCount: work.assignmentCount,
        activeAssignmentCount: work.activeAssignmentCount,
        expiredAssignmentCount: work.expiredAssignmentCount,
        responseDeadline: opportunity.responseDeadline.toISOString(),
        nextRetryAt: nextRetryAt?.toISOString() ?? null,
        resumeState,
        acceptedWorkPayable: hasAcceptedWork(work),
        payment,
        errorCode: normalizedErrorCode,
      },
      occurredAt,
    });
    await client.query("COMMIT");
    return event;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function resumeHumanReviewOpportunityAfterRecovery(input: {
  workspaceId: string;
  opportunityId: string;
  transitionKey: string;
  occurredAt?: Date;
}): Promise<HumanReviewRecoveryEvent> {
  const workspaceId = requiredIdentifier(input.workspaceId, "workspaceId");
  const opportunityId = requiredIdentifier(input.opportunityId, "opportunityId");
  const key = transitionKey(input.transitionKey);
  const occurredAt = input.occurredAt ?? new Date();
  if (!Number.isFinite(occurredAt.getTime())) {
    throw new TokenlessServiceError("occurredAt is invalid.", 400, "invalid_human_review_recovery");
  }
  const requestCommitment = sha256({
    schemaVersion: "rateloop.human-review-recovery-request.v1",
    workspaceId,
    opportunityId,
    transitionKey: key,
    signal: "retry_succeeded",
  });
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const opportunity = await loadOpportunitySnapshot(client, workspaceId, opportunityId);
    const replay = await replayRecoveryEvent(client, {
      workspaceId,
      opportunityId,
      transitionKey: key,
      requestCommitment,
    });
    if (replay) {
      await client.query("COMMIT");
      return replay;
    }
    const recovery = await loadRecoveryState(client, workspaceId, opportunityId);
    if (
      opportunity.state !== "blocked" ||
      !recovery ||
      recovery.status !== "recovery_required" ||
      !recovery.resumeState
    ) {
      throw new TokenlessServiceError(
        "Human-review opportunity is not awaiting recovery.",
        409,
        "human_review_recovery_not_required",
      );
    }
    if (occurredAt >= opportunity.responseDeadline) {
      throw new TokenlessServiceError(
        "The frozen response deadline elapsed before recovery.",
        409,
        "human_review_response_deadline_elapsed",
      );
    }
    const work = await loadWorkSnapshot(client, { workspaceId, opportunityId, ...opportunity });
    const reasons = ["recovery_succeeded", `retry_${recovery.failureCount}_of_3`];
    await transitionHumanReviewOpportunityLifecycleInTransaction(client, {
      workspaceId,
      opportunityId,
      transitionKey: `recovery:${key}`,
      expectedState: "blocked",
      expectedRevision: opportunity.revision,
      toState: recovery.resumeState,
      reasonCodes: reasons,
      actor: { kind: "service", reference: "human-review-recovery-v1" },
      details: { failureCount: recovery.failureCount, resumeState: recovery.resumeState },
      occurredAt,
    });
    await writeRecoveryState(client, {
      workspaceId,
      opportunityId,
      status: "recovered",
      resumeState: recovery.resumeState,
      failureCount: recovery.failureCount,
      signal: "retry_succeeded",
      errorCode: null,
      firstFailureAt: null,
      lastFailureAt: null,
      nextRetryAt: null,
      terminalState: null,
      now: occurredAt,
    });
    const event = await appendRecoveryEvent(client, {
      workspaceId,
      opportunityId,
      transitionKey: key,
      requestCommitment,
      signal: "retry_succeeded",
      action: "retry_resumed",
      fromState: "blocked",
      toState: recovery.resumeState,
      fromRevision: opportunity.revision,
      toRevision: opportunity.revision + 1,
      failureCount: recovery.failureCount,
      acceptedWorkCount: work.acceptedWorkCount,
      committedWorkCount: work.committedWorkCount,
      responseCount: work.responseCount,
      reasonCodes: reasons,
      details: {
        responseDeadline: opportunity.responseDeadline.toISOString(),
        resumeState: recovery.resumeState,
        acceptedWorkPayable: hasAcceptedWork(work),
      },
      occurredAt,
    });
    await client.query("COMMIT");
    return event;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const __humanReviewOpportunityRecoveryTestUtils = {
  hasAcceptedWork,
  recoveryBackoffMs,
  sha256,
  stableJson,
  terminalDecision,
};
