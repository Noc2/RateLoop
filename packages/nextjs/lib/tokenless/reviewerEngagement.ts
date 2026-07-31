import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const REVIEWER_ENGAGEMENT_EVENT_TYPES = [
  "first_artifact_access",
  "active_interaction",
  "idle",
  "reopened",
  "submitted",
] as const;
export type ReviewerEngagementEventType = (typeof REVIEWER_ENGAGEMENT_EVENT_TYPES)[number];

export const REVIEWER_ENGAGEMENT_MINIMUM_DENOMINATOR = 15;
export const REVIEWER_ENGAGEMENT_ACTIVE_INTERVAL_CAP_SECONDS = 300;
export const REVIEWER_ENGAGEMENT_IDENTITY_RETENTION_DAYS = 366;
const REVIEWER_ENGAGEMENT_MAX_EVENTS_PER_ASSIGNMENT = 10_000;
const REPORTING_WINDOW_MAX_MS = 366 * 24 * 60 * 60 * 1_000;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/u;
const EVENT_TYPE_SET = new Set<string>(REVIEWER_ENGAGEMENT_EVENT_TYPES);

type Row = Record<string, unknown>;

export type ReviewerEngagementEvent = {
  schemaVersion: "rateloop.reviewer-engagement-event.v1";
  eventId: string;
  workspaceId: string;
  assignmentId: string;
  reviewerSubjectId: string;
  sequence: number;
  eventType: ReviewerEngagementEventType;
  employmentGovernanceVersion: number;
  occurredAt: string;
};

type AssignmentEngagement = {
  assignmentId: string;
  reviewerSubjectId: string;
  reviewerAccountAddress: string | null;
  completed: boolean;
  activeEngagementMilliseconds: number;
  wallClockMilliseconds: number | null;
  idleIntervalCount: number;
  reopenCount: number;
  interactionCount: number;
  reviewerAnalyticsGoverned: boolean;
};

type EngagementMetricSummary = {
  completedAssignmentCount: number;
  medianActiveEngagementSeconds: number;
  meanActiveEngagementSeconds: number;
  medianWallClockSeconds: number;
  idleIntervalCount: number;
  reopenedAssignmentCount: number;
  zeroActiveEngagementCount: number;
};

type StoredEngagementEvent = ReviewerEngagementEvent & {
  processingMode: string | null;
  reviewerAccountAddress: string | null;
};

function text(row: Row | undefined, field: string) {
  const value = row?.[field];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row | undefined, field: string, minimum = 0) {
  const value = Number(row?.[field]);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TokenlessServiceError(
      "Stored reviewer engagement evidence is invalid.",
      500,
      "stored_reviewer_engagement_invalid",
    );
  }
  return value;
}

function date(value: unknown) {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new TokenlessServiceError(
      "Stored reviewer engagement evidence is invalid.",
      500,
      "stored_reviewer_engagement_invalid",
    );
  }
  return parsed;
}

function validNow(value: Date | undefined) {
  const now = value ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new TokenlessServiceError("now must be a valid date.", 400, "invalid_reviewer_engagement_event");
  }
  return now;
}

function normalizePrincipal(value: string) {
  try {
    return normalizeAccountSubject(value);
  } catch {
    throw new TokenlessServiceError("A valid reviewer account is required.", 400, "invalid_account");
  }
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function eventFromRow(row: Row | undefined): StoredEngagementEvent {
  const eventId = text(row, "event_id");
  const workspaceId = text(row, "workspace_id");
  const assignmentId = text(row, "assignment_id");
  const reviewerSubjectId = text(row, "reviewer_subject_id");
  const reviewerAccountAddress = text(row, "reviewer_account_address");
  const eventType = text(row, "event_type");
  const employmentGovernanceVersion = integer(row, "employment_governance_version", 1);
  if (
    !eventId ||
    !/^eng_[0-9a-f]{40}$/u.test(eventId) ||
    !workspaceId ||
    !assignmentId ||
    !reviewerSubjectId ||
    !/^engsub_[0-9a-f]{40}$/u.test(reviewerSubjectId) ||
    !eventType ||
    !EVENT_TYPE_SET.has(eventType)
  ) {
    throw new TokenlessServiceError(
      "Stored reviewer engagement evidence is invalid.",
      500,
      "stored_reviewer_engagement_invalid",
    );
  }
  return {
    schemaVersion: "rateloop.reviewer-engagement-event.v1",
    eventId,
    workspaceId,
    assignmentId,
    reviewerSubjectId,
    reviewerAccountAddress,
    sequence: integer(row, "sequence", 1),
    eventType: eventType as ReviewerEngagementEventType,
    employmentGovernanceVersion,
    occurredAt: date(row?.occurred_at).toISOString(),
    processingMode: text(row, "processing_mode"),
  };
}

function publicEvent(event: StoredEngagementEvent): ReviewerEngagementEvent {
  return {
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
    workspaceId: event.workspaceId,
    assignmentId: event.assignmentId,
    reviewerSubjectId: event.reviewerSubjectId,
    sequence: event.sequence,
    eventType: event.eventType,
    employmentGovernanceVersion: event.employmentGovernanceVersion,
    occurredAt: event.occurredAt,
  };
}

function assertTransition(previous: ReviewerEngagementEventType | null, next: ReviewerEngagementEventType) {
  const valid =
    (previous === null && next === "first_artifact_access") ||
    (previous !== null &&
      previous !== "submitted" &&
      ((next === "active_interaction" &&
        ["first_artifact_access", "active_interaction", "reopened"].includes(previous)) ||
        (next === "idle" && ["first_artifact_access", "active_interaction", "reopened"].includes(previous)) ||
        (next === "reopened" && previous === "idle") ||
        (next === "submitted" && ["first_artifact_access", "active_interaction", "reopened"].includes(previous))));
  if (!valid) {
    throw new TokenlessServiceError(
      "Reviewer engagement event is out of sequence.",
      409,
      "reviewer_engagement_transition_conflict",
    );
  }
}

async function requireActiveWorkspace(client: PoolClient, workspaceId: string) {
  const workspace = await client.query(
    "SELECT workspace_id FROM tokenless_workspaces WHERE workspace_id=$1 AND status='active' FOR UPDATE",
    [workspaceId],
  );
  if (workspace.rowCount !== 1) {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
}

async function requireManager(client: PoolClient, accountAddress: string, workspaceId: string) {
  let actor: string;
  try {
    actor = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("A valid signed-in account is required.", 401, "invalid_account");
  }
  const membership = await client.query(
    `SELECT m.role FROM tokenless_workspace_members m
     JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id AND w.status='active'
     WHERE m.workspace_id=$1 AND m.account_address=$2 AND m.role IN ('owner','admin') LIMIT 1`,
    [workspaceId, actor],
  );
  if (membership.rowCount !== 1) {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
}

async function latestGovernanceVersion(client: PoolClient, workspaceId: string, now: Date) {
  const result = await client.query(
    `SELECT version,effective_at
     FROM tokenless_workspace_employment_data_governance_versions
     WHERE workspace_id=$1 ORDER BY version DESC LIMIT 1`,
    [workspaceId],
  );
  const row = result.rows[0] as Row | undefined;
  const version = integer(row, "version", 1);
  if (!row || date(row.effective_at) > now) {
    throw new TokenlessServiceError(
      "Employment-data governance is unavailable for this event.",
      409,
      "reviewer_engagement_governance_unavailable",
    );
  }
  return version;
}

async function reviewerSubject(client: PoolClient, workspaceId: string, reviewerAccountAddress: string, now: Date) {
  const retentionUntil = new Date(now.getTime() + REVIEWER_ENGAGEMENT_IDENTITY_RETENTION_DAYS * 24 * 60 * 60 * 1_000);
  const existing = await client.query(
    `SELECT reviewer_subject_id,retention_until
     FROM tokenless_reviewer_engagement_subject_crosswalk
     WHERE workspace_id=$1 AND reviewer_account_address=$2 LIMIT 1`,
    [workspaceId, reviewerAccountAddress],
  );
  if (existing.rowCount === 1) {
    const row = existing.rows[0] as Row;
    const reviewerSubjectId = text(row, "reviewer_subject_id");
    if (!reviewerSubjectId || !/^engsub_[0-9a-f]{40}$/u.test(reviewerSubjectId)) {
      throw new TokenlessServiceError(
        "Stored reviewer engagement evidence is invalid.",
        500,
        "stored_reviewer_engagement_invalid",
      );
    }
    return {
      currentRetentionUntil: date(row.retention_until),
      desiredRetentionUntil: retentionUntil,
      reviewerSubjectId,
    };
  }
  const reviewerSubjectId = `engsub_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  await client.query(
    `INSERT INTO tokenless_reviewer_engagement_subject_crosswalk
       (workspace_id,reviewer_subject_id,reviewer_account_address,retention_until,created_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [workspaceId, reviewerSubjectId, reviewerAccountAddress, retentionUntil, now],
  );
  return { currentRetentionUntil: retentionUntil, desiredRetentionUntil: retentionUntil, reviewerSubjectId };
}

/**
 * Appends an event for a reviewer/assignment scope that the caller has already
 * authorized. Existing assignment services use this form while holding their
 * transaction, so artifact access and submission can share the same commit.
 */
export async function recordReviewerEngagementEventInTransaction(
  input: {
    workspaceId: string;
    assignmentId: string;
    reviewerAccountAddress: string;
    eventType: ReviewerEngagementEventType;
    idempotencyKey: string;
    now?: Date;
  },
  client: PoolClient,
): Promise<ReviewerEngagementEvent> {
  if (
    !IDENTIFIER_PATTERN.test(input.workspaceId) ||
    !IDENTIFIER_PATTERN.test(input.assignmentId) ||
    !EVENT_TYPE_SET.has(input.eventType) ||
    !IDEMPOTENCY_PATTERN.test(input.idempotencyKey)
  ) {
    throw new TokenlessServiceError("Reviewer engagement event is invalid.", 400, "invalid_reviewer_engagement_event");
  }
  const reviewer = normalizePrincipal(input.reviewerAccountAddress);
  const now = validNow(input.now);
  await requireActiveWorkspace(client, input.workspaceId);
  const governanceVersion = await latestGovernanceVersion(client, input.workspaceId, now);
  const reviewerScope = await reviewerSubject(client, input.workspaceId, reviewer, now);
  const { reviewerSubjectId } = reviewerScope;
  const idempotencyKeyHash = sha256(input.idempotencyKey);
  const requestHash = sha256(
    [
      "rateloop.reviewer-engagement-request.v1",
      input.workspaceId,
      input.assignmentId,
      reviewerSubjectId,
      input.eventType,
    ].join("\u0000"),
  );
  const existing = await client.query(
    `SELECT event_id,workspace_id,assignment_id,reviewer_subject_id,sequence,event_type,
            employment_governance_version,occurred_at,request_hash
     FROM tokenless_reviewer_engagement_events
     WHERE workspace_id=$1 AND assignment_id=$2 AND reviewer_subject_id=$3 AND idempotency_key_hash=$4
     LIMIT 1`,
    [input.workspaceId, input.assignmentId, reviewerSubjectId, idempotencyKeyHash],
  );
  if (existing.rowCount === 1) {
    if (text(existing.rows[0] as Row, "request_hash") !== requestHash) {
      throw new TokenlessServiceError(
        "The idempotency key was already used for another reviewer engagement event.",
        409,
        "reviewer_engagement_idempotency_conflict",
      );
    }
    return publicEvent(eventFromRow(existing.rows[0] as Row));
  }

  if (reviewerScope.currentRetentionUntil < reviewerScope.desiredRetentionUntil) {
    await client.query(
      `UPDATE tokenless_reviewer_engagement_subject_crosswalk
       SET retention_until=$3 WHERE workspace_id=$1 AND reviewer_account_address=$2`,
      [input.workspaceId, reviewer, reviewerScope.desiredRetentionUntil],
    );
  }

  const latest = await client.query(
    `SELECT event_id,workspace_id,assignment_id,reviewer_subject_id,sequence,event_type,
            employment_governance_version,occurred_at
     FROM tokenless_reviewer_engagement_events
     WHERE workspace_id=$1 AND assignment_id=$2 AND reviewer_subject_id=$3
     ORDER BY sequence DESC LIMIT 1`,
    [input.workspaceId, input.assignmentId, reviewerSubjectId],
  );
  const previous = latest.rowCount === 1 ? eventFromRow(latest.rows[0] as Row) : null;
  assertTransition(previous?.eventType ?? null, input.eventType);
  if (previous && new Date(previous.occurredAt) >= now) {
    throw new TokenlessServiceError(
      "Reviewer engagement timestamps must increase strictly.",
      409,
      "reviewer_engagement_timestamp_conflict",
    );
  }
  const sequence = (previous?.sequence ?? 0) + 1;
  if (sequence > REVIEWER_ENGAGEMENT_MAX_EVENTS_PER_ASSIGNMENT) {
    throw new TokenlessServiceError("Reviewer engagement event limit reached.", 409, "reviewer_engagement_event_limit");
  }
  const eventId = `eng_${sha256(
    [input.workspaceId, input.assignmentId, reviewerSubjectId, idempotencyKeyHash].join("\u0000"),
  ).slice("sha256:".length, "sha256:".length + 40)}`;
  const inserted = await client.query(
    `INSERT INTO tokenless_reviewer_engagement_events
       (event_id,workspace_id,assignment_id,reviewer_subject_id,sequence,event_type,
        idempotency_key_hash,request_hash,employment_governance_version,occurred_at,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
     RETURNING event_id,workspace_id,assignment_id,reviewer_subject_id,sequence,event_type,
               employment_governance_version,occurred_at`,
    [
      eventId,
      input.workspaceId,
      input.assignmentId,
      reviewerSubjectId,
      sequence,
      input.eventType,
      idempotencyKeyHash,
      requestHash,
      governanceVersion,
      now,
    ],
  );
  return publicEvent(eventFromRow(inserted.rows[0] as Row));
}

/** Records an event only when the signed-in reviewer owns the live assignment. */
export async function recordReviewerEngagementEvent(input: {
  accountAddress: string;
  workspaceId: string;
  assignmentId: string;
  eventType: ReviewerEngagementEventType;
  idempotencyKey: string;
  now?: Date;
}): Promise<ReviewerEngagementEvent> {
  const reviewer = normalizePrincipal(input.accountAddress);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await requireActiveWorkspace(client, input.workspaceId);
    const assignment = await client.query(
      `SELECT workspace_id,reviewer_account_address,status
       FROM tokenless_private_unpaid_review_assignments
       WHERE assignment_id=$1 AND workspace_id=$2 AND reviewer_account_address=$3
         AND status IN ('accepted','completed')
       UNION ALL
       SELECT workspace_id,reviewer_account_address,status
       FROM tokenless_assurance_assignments
       WHERE assignment_id=$1 AND workspace_id=$2 AND reviewer_account_address=$3
         AND status IN ('accepted','completed')`,
      [input.assignmentId, input.workspaceId, reviewer],
    );
    if (assignment.rowCount !== 1) {
      throw new TokenlessServiceError("Assignment not found.", 404, "assignment_not_found");
    }
    const status = text(assignment.rows[0] as Row, "status");
    if (status === "completed" && input.eventType !== "submitted") {
      throw new TokenlessServiceError("Assignment not found.", 404, "assignment_not_found");
    }
    const event = await recordReviewerEngagementEventInTransaction(
      {
        workspaceId: input.workspaceId,
        assignmentId: input.assignmentId,
        reviewerAccountAddress: reviewer,
        eventType: input.eventType,
        idempotencyKey: input.idempotencyKey,
        now: input.now,
      },
      client,
    );
    await client.query("COMMIT");
    return event;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Deletes only expired reviewer-identity mappings. Pseudonymous engagement
 * events are deliberately independent and remain available for aggregate
 * evidence after this maintenance operation.
 */
export async function purgeExpiredReviewerEngagementIdentitiesInTransaction(
  input: { now?: Date; limit?: number; workspaceId?: string },
  client: PoolClient,
) {
  const now = validNow(input.now);
  const limit = input.limit ?? 250;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1_000 ||
    (input.workspaceId !== undefined && !IDENTIFIER_PATTERN.test(input.workspaceId))
  ) {
    throw new TokenlessServiceError(
      "Reviewer engagement identity purge is invalid.",
      400,
      "invalid_reviewer_engagement_identity_purge",
    );
  }
  const candidates = await client.query(
    `SELECT workspace_id,reviewer_subject_id
     FROM tokenless_reviewer_engagement_subject_crosswalk
     WHERE retention_until <= $1${input.workspaceId === undefined ? "" : " AND workspace_id=$3"}
     ORDER BY retention_until,workspace_id,reviewer_subject_id
     LIMIT $2`,
    input.workspaceId === undefined ? [now, limit] : [now, limit, input.workspaceId],
  );
  let purgedIdentityCount = 0;
  for (const candidate of candidates.rows as Row[]) {
    const workspaceId = text(candidate, "workspace_id");
    const reviewerSubjectId = text(candidate, "reviewer_subject_id");
    if (!workspaceId || !reviewerSubjectId) {
      throw new TokenlessServiceError(
        "Stored reviewer engagement evidence is invalid.",
        500,
        "stored_reviewer_engagement_invalid",
      );
    }
    const removed = await client.query(
      `DELETE FROM tokenless_reviewer_engagement_subject_crosswalk
       WHERE workspace_id=$1 AND reviewer_subject_id=$2 AND retention_until <= $3`,
      [workspaceId, reviewerSubjectId, now],
    );
    purgedIdentityCount += removed.rowCount ?? 0;
  }
  return { examinedIdentityCount: candidates.rows.length, purgedIdentityCount };
}

export async function purgeWorkspaceExpiredReviewerEngagementIdentities(input: {
  accountAddress: string;
  workspaceId: string;
  now?: Date;
  limit?: number;
}) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await requireManager(client, input.accountAddress, input.workspaceId);
    await requireActiveWorkspace(client, input.workspaceId);
    const result = await purgeExpiredReviewerEngagementIdentitiesInTransaction(
      { limit: input.limit, now: input.now, workspaceId: input.workspaceId },
      client,
    );
    await client.query("COMMIT");
    return {
      schemaVersion: "rateloop.reviewer-engagement-identity-purge.v1" as const,
      workspaceId: input.workspaceId,
      ...result,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function calculateAssignmentEngagement(events: StoredEngagementEvent[]): AssignmentEngagement {
  if (events.length === 0) {
    throw new TokenlessServiceError(
      "Stored reviewer engagement evidence is invalid.",
      500,
      "stored_reviewer_engagement_invalid",
    );
  }
  let activeMilliseconds = 0;
  let idleIntervalCount = 0;
  let reopenCount = 0;
  let interactionCount = 0;
  let previous: StoredEngagementEvent | null = null;
  for (const event of events) {
    if (previous) {
      if (
        event.sequence !== previous.sequence + 1 ||
        event.workspaceId !== previous.workspaceId ||
        event.assignmentId !== previous.assignmentId ||
        event.reviewerSubjectId !== previous.reviewerSubjectId ||
        new Date(event.occurredAt) <= new Date(previous.occurredAt)
      ) {
        throw new TokenlessServiceError(
          "Stored reviewer engagement evidence is invalid.",
          500,
          "stored_reviewer_engagement_invalid",
        );
      }
      assertTransition(previous.eventType, event.eventType);
      if (["first_artifact_access", "active_interaction", "reopened"].includes(previous.eventType)) {
        const elapsed = new Date(event.occurredAt).getTime() - new Date(previous.occurredAt).getTime();
        activeMilliseconds += Math.min(elapsed, REVIEWER_ENGAGEMENT_ACTIVE_INTERVAL_CAP_SECONDS * 1_000);
      }
    } else if (event.sequence !== 1 || event.eventType !== "first_artifact_access") {
      throw new TokenlessServiceError(
        "Stored reviewer engagement evidence is invalid.",
        500,
        "stored_reviewer_engagement_invalid",
      );
    }
    if (event.eventType === "idle") idleIntervalCount += 1;
    if (event.eventType === "reopened") reopenCount += 1;
    if (event.eventType === "active_interaction") interactionCount += 1;
    previous = event;
  }
  const first = events[0]!;
  const last = events.at(-1)!;
  return {
    assignmentId: first.assignmentId,
    reviewerSubjectId: first.reviewerSubjectId,
    reviewerAccountAddress: first.reviewerAccountAddress,
    completed: last.eventType === "submitted",
    activeEngagementMilliseconds: activeMilliseconds,
    wallClockMilliseconds:
      last.eventType === "submitted"
        ? new Date(last.occurredAt).getTime() - new Date(first.occurredAt).getTime()
        : null,
    idleIntervalCount,
    reopenCount,
    interactionCount,
    reviewerAnalyticsGoverned: events.every(
      event => event.processingMode === "reviewer_analytics" && event.reviewerAccountAddress !== null,
    ),
  };
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function metricSummary(assignments: AssignmentEngagement[]): EngagementMetricSummary {
  const completed = assignments.filter(assignment => assignment.completed && assignment.wallClockMilliseconds !== null);
  const activeSeconds = completed.map(assignment => Math.floor(assignment.activeEngagementMilliseconds / 1_000));
  const wallClockSeconds = completed.map(assignment => Math.floor(assignment.wallClockMilliseconds! / 1_000));
  return {
    completedAssignmentCount: completed.length,
    medianActiveEngagementSeconds: median(activeSeconds),
    meanActiveEngagementSeconds:
      completed.length === 0 ? 0 : Math.round(activeSeconds.reduce((sum, value) => sum + value, 0) / completed.length),
    medianWallClockSeconds: median(wallClockSeconds),
    idleIntervalCount: completed.reduce((sum, assignment) => sum + assignment.idleIntervalCount, 0),
    reopenedAssignmentCount: completed.filter(assignment => assignment.reopenCount > 0).length,
    zeroActiveEngagementCount: completed.filter(assignment => assignment.activeEngagementMilliseconds < 1_000).length,
  };
}

function reportingWindow(input: { windowStartedAt: Date; windowEndedAt: Date }) {
  const startedAt = validNow(input.windowStartedAt);
  const endedAt = validNow(input.windowEndedAt);
  const duration = endedAt.getTime() - startedAt.getTime();
  if (duration <= 0 || duration > REPORTING_WINDOW_MAX_MS) {
    throw new TokenlessServiceError(
      "Reviewer engagement reporting window is invalid.",
      400,
      "invalid_reviewer_engagement_window",
    );
  }
  return { startedAt, endedAt };
}

async function loadWindowEvents(
  client: PoolClient,
  workspaceId: string,
  window: { startedAt: Date; endedAt: Date },
  includeReviewerIdentity: boolean,
) {
  const reviewerIdentityProjection = includeReviewerIdentity
    ? ",crosswalk.reviewer_account_address"
    : ",NULL::text AS reviewer_account_address";
  const reviewerIdentityJoin = includeReviewerIdentity
    ? `LEFT JOIN tokenless_reviewer_engagement_subject_crosswalk crosswalk
         ON crosswalk.workspace_id=e.workspace_id
        AND crosswalk.reviewer_subject_id=e.reviewer_subject_id
        AND crosswalk.retention_until > NOW()`
    : "";
  const result = await client.query(
    `SELECT e.event_id,e.workspace_id,e.assignment_id,e.reviewer_subject_id,e.sequence,e.event_type,
            e.employment_governance_version,e.occurred_at,g.processing_mode${reviewerIdentityProjection}
     FROM tokenless_reviewer_engagement_events e
     JOIN tokenless_workspace_employment_data_governance_versions g
       ON g.workspace_id=e.workspace_id AND g.version=e.employment_governance_version
     ${reviewerIdentityJoin}
     JOIN (
       SELECT workspace_id,assignment_id,reviewer_subject_id
       FROM tokenless_reviewer_engagement_events
       WHERE workspace_id=$1 AND event_type='first_artifact_access'
         AND occurred_at >= $2 AND occurred_at < $3
     ) included
       ON included.workspace_id=e.workspace_id
      AND included.assignment_id=e.assignment_id
      AND included.reviewer_subject_id=e.reviewer_subject_id
     WHERE e.workspace_id=$1 AND e.occurred_at < $3
     ORDER BY e.assignment_id,e.reviewer_subject_id,e.sequence
     LIMIT 100001`,
    [workspaceId, window.startedAt, window.endedAt],
  );
  if (result.rows.length > 100_000) {
    throw new TokenlessServiceError(
      "Reviewer engagement reporting window is too large.",
      409,
      "reviewer_engagement_window_too_large",
    );
  }
  return result.rows.map(row => eventFromRow(row as Row));
}

function groupAssignments(events: StoredEngagementEvent[]) {
  const grouped = new Map<string, StoredEngagementEvent[]>();
  for (const event of events) {
    const key = `${event.assignmentId}\u0000${event.reviewerSubjectId}`;
    const group = grouped.get(key) ?? [];
    group.push(event);
    grouped.set(key, group);
  }
  return [...grouped.values()].map(calculateAssignmentEngagement);
}

export async function getWorkspaceEngagementAggregate(input: {
  accountAddress: string;
  workspaceId: string;
  windowStartedAt: Date;
  windowEndedAt: Date;
}) {
  const window = reportingWindow(input);
  const client = await dbPool.connect();
  try {
    await requireManager(client, input.accountAddress, input.workspaceId);
    const assignments = groupAssignments(await loadWindowEvents(client, input.workspaceId, window, false));
    const summary = metricSummary(assignments);
    return {
      schemaVersion: "rateloop.workspace-engagement-aggregate.v1" as const,
      workspaceId: input.workspaceId,
      windowStartedAt: window.startedAt.toISOString(),
      windowEndedAt: window.endedAt.toISOString(),
      minimumDenominator: REVIEWER_ENGAGEMENT_MINIMUM_DENOMINATOR,
      completedAssignmentCount: summary.completedAssignmentCount,
      status:
        summary.completedAssignmentCount >= REVIEWER_ENGAGEMENT_MINIMUM_DENOMINATOR
          ? ("available" as const)
          : ("insufficient_data" as const),
      metrics: summary.completedAssignmentCount >= REVIEWER_ENGAGEMENT_MINIMUM_DENOMINATOR ? summary : null,
    };
  } finally {
    client.release();
  }
}

async function requireReviewerAnalyticsGovernance(client: PoolClient, workspaceId: string) {
  const result = await client.query(
    `SELECT version,processing_mode,controller_role,processor_role,lawful_basis_record_reference,
            necessity_record_reference,worker_notice_reference,retention_policy_reference,
            access_policy_reference,dpia_status,dpia_reference,data_subject_process_reference,
            works_council_status,works_council_reference,reviewer_analytics_activated_at,
            reviewer_analytics_activated_by
     FROM tokenless_workspace_employment_data_governance_versions
     WHERE workspace_id=$1 ORDER BY version DESC LIMIT 1`,
    [workspaceId],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row || text(row, "processing_mode") !== "reviewer_analytics") {
    throw new TokenlessServiceError(
      "Reviewer analytics are disabled for this workspace.",
      409,
      "reviewer_analytics_disabled",
    );
  }
  const requiredText = [
    "controller_role",
    "processor_role",
    "lawful_basis_record_reference",
    "necessity_record_reference",
    "worker_notice_reference",
    "retention_policy_reference",
    "access_policy_reference",
    "dpia_reference",
    "data_subject_process_reference",
    "works_council_reference",
    "reviewer_analytics_activated_by",
  ];
  if (
    requiredText.some(field => !text(row, field)?.trim()) ||
    !["completed", "not_required"].includes(text(row, "dpia_status") ?? "") ||
    !["agreement_recorded", "not_applicable"].includes(text(row, "works_council_status") ?? "") ||
    !row.reviewer_analytics_activated_at
  ) {
    throw new TokenlessServiceError(
      "Reviewer analytics governance is incomplete.",
      409,
      "reviewer_analytics_governance_incomplete",
    );
  }
}

async function beginReviewerAnalyticsRead(client: PoolClient, input: { accountAddress: string; workspaceId: string }) {
  await client.query("BEGIN");
  await requireManager(client, input.accountAddress, input.workspaceId);
  // Governance writers take this same workspace-row lock before appending a
  // version. Keep it through identity projection so an enabled gate cannot be
  // switched off between the check and the reviewer-level query.
  await requireActiveWorkspace(client, input.workspaceId);
  await requireReviewerAnalyticsGovernance(client, input.workspaceId);
}

export const __reviewerEngagementConcurrencyTestUtils = { beginReviewerAnalyticsRead };

export async function getWorkspaceReviewerEngagementAnalytics(input: {
  accountAddress: string;
  workspaceId: string;
  windowStartedAt: Date;
  windowEndedAt: Date;
}) {
  const window = reportingWindow(input);
  const client = await dbPool.connect();
  try {
    await beginReviewerAnalyticsRead(client, input);
    const assignments = groupAssignments(await loadWindowEvents(client, input.workspaceId, window, true)).filter(
      assignment => assignment.reviewerAnalyticsGoverned && assignment.reviewerAccountAddress !== null,
    );
    const byReviewer = new Map<string, AssignmentEngagement[]>();
    for (const assignment of assignments) {
      const reviewerAccountAddress = assignment.reviewerAccountAddress!;
      const group = byReviewer.get(reviewerAccountAddress) ?? [];
      group.push(assignment);
      byReviewer.set(reviewerAccountAddress, group);
    }
    const analytics = [...byReviewer.entries()]
      .map(([reviewerAccountAddress, reviewerAssignments]) => ({
        reviewerAccountAddress,
        ...metricSummary(reviewerAssignments),
      }))
      .filter(result => result.completedAssignmentCount >= REVIEWER_ENGAGEMENT_MINIMUM_DENOMINATOR)
      .sort((left, right) => left.reviewerAccountAddress.localeCompare(right.reviewerAccountAddress));
    const result = {
      schemaVersion: "rateloop.workspace-reviewer-engagement-analytics.v1" as const,
      workspaceId: input.workspaceId,
      windowStartedAt: window.startedAt.toISOString(),
      windowEndedAt: window.endedAt.toISOString(),
      minimumDenominator: REVIEWER_ENGAGEMENT_MINIMUM_DENOMINATOR,
      eligibleReviewerCount: analytics.length,
      suppressedReviewerCount: Math.max(0, byReviewer.size - analytics.length),
      analytics,
    };
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
