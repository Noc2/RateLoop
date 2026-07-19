import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const HUMAN_REVIEW_OPPORTUNITY_TRANSITIONS = {
  evaluating: ["skipped", "approval_required", "request_ready", "blocked"],
  skipped: [],
  approval_required: ["request_ready", "blocked", "cancelled_before_commit"],
  request_ready: ["approval_required", "pending", "blocked", "cancelled_before_commit"],
  pending: ["blocked", "completed", "inconclusive", "failed_terminal"],
  blocked: [
    "approval_required",
    "request_ready",
    "pending",
    "completed",
    "inconclusive",
    "failed_terminal",
    "cancelled_before_commit",
  ],
  completed: [],
  inconclusive: [],
  failed_terminal: [],
  cancelled_before_commit: [],
} as const;

export type HumanReviewOpportunityState = keyof typeof HUMAN_REVIEW_OPPORTUNITY_TRANSITIONS;
export type HumanReviewOpportunityTerminalState =
  | "skipped"
  | "completed"
  | "inconclusive"
  | "failed_terminal"
  | "cancelled_before_commit";
export type HumanReviewOpportunityTransitionActorKind =
  | "agent"
  | "host"
  | "lane_adapter"
  | "owner"
  | "service"
  | "system";

export type HumanReviewOpportunityTransitionInput = {
  workspaceId: string;
  opportunityId: string;
  transitionKey: string;
  expectedState: HumanReviewOpportunityState;
  expectedRevision: number;
  toState: HumanReviewOpportunityState;
  reasonCodes: readonly string[];
  actor: {
    kind: HumanReviewOpportunityTransitionActorKind;
    reference: string;
  };
  details?: Readonly<Record<string, unknown>>;
  occurredAt?: Date;
};

export type HumanReviewOpportunityTransition = {
  eventId: string;
  workspaceId: string;
  opportunityId: string;
  transitionKey: string;
  fromState: HumanReviewOpportunityState;
  toState: HumanReviewOpportunityState;
  fromRevision: number;
  toRevision: number;
  reasonCodes: string[];
  actor: {
    kind: HumanReviewOpportunityTransitionActorKind;
    reference: string;
  };
  details: Record<string, unknown>;
  transitionCommitment: string;
  occurredAt: string;
  replayed: boolean;
};

type QueryableClient = Pick<PoolClient, "query">;
type Row = Record<string, unknown>;

const TRANSITION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{7,199}$/u;
const REASON_CODE_PATTERN = /^[a-z0-9][a-z0-9:._-]{0,95}$/u;
const TERMINAL_STATES = new Set<HumanReviewOpportunityState>([
  "skipped",
  "completed",
  "inconclusive",
  "failed_terminal",
  "cancelled_before_commit",
]);
const ACTOR_KINDS = new Set<HumanReviewOpportunityTransitionActorKind>([
  "agent",
  "host",
  "lane_adapter",
  "owner",
  "service",
  "system",
]);

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Transition details are not canonicalizable.");
  return encoded;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function requiredIdentifier(value: string, field: string) {
  if (!value.trim() || value.length > 200) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_human_review_lifecycle_transition");
  }
  return value;
}

function positiveInteger(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Stored ${field} is invalid.`);
  return parsed;
}

function state(value: unknown, field: string): HumanReviewOpportunityState {
  if (typeof value !== "string" || !(value in HUMAN_REVIEW_OPPORTUNITY_TRANSITIONS)) {
    throw new Error(`Stored ${field} is invalid.`);
  }
  return value as HumanReviewOpportunityState;
}

function actorKind(value: unknown): HumanReviewOpportunityTransitionActorKind {
  if (typeof value !== "string" || !ACTOR_KINDS.has(value as HumanReviewOpportunityTransitionActorKind)) {
    throw new Error("Stored transition actor kind is invalid.");
  }
  return value as HumanReviewOpportunityTransitionActorKind;
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

function parseReasonCodes(value: unknown) {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.some(reason => typeof reason !== "string" || !REASON_CODE_PATTERN.test(reason))
    ) {
      throw new Error();
    }
    return parsed as string[];
  } catch {
    throw new Error("Stored transition reason codes are invalid.");
  }
}

function dateIso(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error("Stored transition timestamp is invalid.");
  return date.toISOString();
}

export function canonicalizeHumanReviewReasonCodes(reasonCodes: readonly string[]) {
  if (reasonCodes.length > 32 || reasonCodes.some(reason => !REASON_CODE_PATTERN.test(reason))) {
    throw new TokenlessServiceError(
      "Human-review lifecycle reason codes are invalid.",
      400,
      "invalid_human_review_lifecycle_transition",
    );
  }
  return [...new Set(reasonCodes)].sort();
}

export function isHumanReviewOpportunityTerminalState(
  value: HumanReviewOpportunityState,
): value is HumanReviewOpportunityTerminalState {
  return TERMINAL_STATES.has(value);
}

export function isHumanReviewOpportunityTransitionAllowed(
  fromState: HumanReviewOpportunityState,
  toState: HumanReviewOpportunityState,
) {
  return (HUMAN_REVIEW_OPPORTUNITY_TRANSITIONS[fromState] as readonly HumanReviewOpportunityState[]).includes(toState);
}

function normalizeInput(input: HumanReviewOpportunityTransitionInput) {
  const workspaceId = requiredIdentifier(input.workspaceId, "workspaceId");
  const opportunityId = requiredIdentifier(input.opportunityId, "opportunityId");
  if (!TRANSITION_KEY_PATTERN.test(input.transitionKey)) {
    throw new TokenlessServiceError("transitionKey is invalid.", 400, "invalid_human_review_lifecycle_transition");
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new TokenlessServiceError("expectedRevision is invalid.", 400, "invalid_human_review_lifecycle_transition");
  }
  if (!isHumanReviewOpportunityTransitionAllowed(input.expectedState, input.toState)) {
    throw new TokenlessServiceError(
      `Human-review opportunities cannot transition from ${input.expectedState} to ${input.toState}.`,
      409,
      "human_review_lifecycle_transition_not_allowed",
    );
  }
  if (!ACTOR_KINDS.has(input.actor.kind) || !input.actor.reference.trim() || input.actor.reference.length > 256) {
    throw new TokenlessServiceError("Transition actor is invalid.", 400, "invalid_human_review_lifecycle_transition");
  }
  const occurredAt = input.occurredAt ?? new Date();
  if (!Number.isFinite(occurredAt.getTime())) {
    throw new TokenlessServiceError(
      "Transition timestamp is invalid.",
      400,
      "invalid_human_review_lifecycle_transition",
    );
  }
  const reasonCodes = canonicalizeHumanReviewReasonCodes(input.reasonCodes);
  const detailsJson = stableJson(input.details ?? {});
  const details = JSON.parse(detailsJson) as Record<string, unknown>;
  const commitmentPayload = {
    schemaVersion: "rateloop.human-review-lifecycle-transition.v1",
    workspaceId,
    opportunityId,
    transitionKey: input.transitionKey,
    from: { state: input.expectedState, revision: input.expectedRevision },
    to: { state: input.toState, revision: input.expectedRevision + 1 },
    reasonCodes,
    actor: input.actor,
    details,
  };
  const transitionCommitment = sha256(commitmentPayload);
  const eventId = `hrtr_${createHash("sha256")
    .update(`${workspaceId}\0${opportunityId}\0${input.transitionKey}`)
    .digest("hex")
    .slice(0, 40)}`;
  return {
    ...input,
    workspaceId,
    opportunityId,
    reasonCodes,
    details,
    detailsJson,
    occurredAt,
    transitionCommitment,
    eventId,
  };
}

function transitionFromRow(row: Row, replayed: boolean): HumanReviewOpportunityTransition {
  const reference = String(row.actor_reference ?? "");
  if (!reference) throw new Error("Stored transition actor reference is invalid.");
  const commitment = String(row.transition_commitment ?? "");
  if (!/^sha256:[0-9a-f]{64}$/u.test(commitment)) throw new Error("Stored transition commitment is invalid.");
  return {
    eventId: String(row.event_id),
    workspaceId: String(row.workspace_id),
    opportunityId: String(row.opportunity_id),
    transitionKey: String(row.transition_key),
    fromState: state(row.from_state, "transition from-state"),
    toState: state(row.to_state, "transition to-state"),
    fromRevision: positiveInteger(row.from_revision, "transition from-revision"),
    toRevision: positiveInteger(row.to_revision, "transition to-revision"),
    reasonCodes: parseReasonCodes(row.reason_codes_json),
    actor: { kind: actorKind(row.actor_kind), reference },
    details: parseObject(row.details_json, "transition details"),
    transitionCommitment: commitment,
    occurredAt: dateIso(row.occurred_at),
    replayed,
  };
}

export async function transitionHumanReviewOpportunityLifecycleInTransaction(
  client: QueryableClient,
  input: HumanReviewOpportunityTransitionInput,
): Promise<HumanReviewOpportunityTransition> {
  const normalized = normalizeInput(input);
  const lifecycleResult = await client.query(
    `SELECT state, state_revision, terminal_at
     FROM tokenless_agent_review_opportunity_lifecycles
     WHERE workspace_id = $1 AND opportunity_id = $2
     FOR UPDATE`,
    [normalized.workspaceId, normalized.opportunityId],
  );
  const lifecycle = lifecycleResult.rows[0] as Row | undefined;
  if (!lifecycle) {
    throw new TokenlessServiceError(
      "Human-review opportunity lifecycle not found.",
      404,
      "human_review_lifecycle_not_found",
    );
  }

  const replayResult = await client.query(
    `SELECT * FROM tokenless_agent_review_opportunity_transition_events
     WHERE workspace_id = $1 AND opportunity_id = $2 AND transition_key = $3`,
    [normalized.workspaceId, normalized.opportunityId, normalized.transitionKey],
  );
  const replay = replayResult.rows[0] as Row | undefined;
  if (replay) {
    if (String(replay.transition_commitment) !== normalized.transitionCommitment) {
      throw new TokenlessServiceError(
        "transitionKey was already used for a different lifecycle transition.",
        409,
        "human_review_lifecycle_transition_idempotency_conflict",
      );
    }
    return transitionFromRow(replay, true);
  }

  const currentState = state(lifecycle.state, "lifecycle state");
  const currentRevision = positiveInteger(lifecycle.state_revision, "lifecycle revision");
  if (
    currentState !== normalized.expectedState ||
    currentRevision !== normalized.expectedRevision ||
    lifecycle.terminal_at !== null
  ) {
    throw new TokenlessServiceError(
      "Human-review opportunity lifecycle changed. Reload it before transitioning.",
      409,
      "human_review_lifecycle_transition_conflict",
    );
  }

  const terminalAt = isHumanReviewOpportunityTerminalState(normalized.toState) ? normalized.occurredAt : null;
  const updateResult = await client.query(
    `UPDATE tokenless_agent_review_opportunity_lifecycles
     SET state = $1, state_revision = state_revision + 1, reason_codes_json = $2,
         state_entered_at = $3, terminal_at = $4, updated_at = $3
     WHERE workspace_id = $5 AND opportunity_id = $6 AND state = $7
       AND state_revision = $8 AND terminal_at IS NULL`,
    [
      normalized.toState,
      JSON.stringify(normalized.reasonCodes),
      normalized.occurredAt,
      terminalAt,
      normalized.workspaceId,
      normalized.opportunityId,
      normalized.expectedState,
      normalized.expectedRevision,
    ],
  );
  if (updateResult.rowCount !== 1) {
    throw new TokenlessServiceError(
      "Human-review opportunity lifecycle changed. Reload it before transitioning.",
      409,
      "human_review_lifecycle_transition_conflict",
    );
  }

  const eventResult = await client.query(
    `INSERT INTO tokenless_agent_review_opportunity_transition_events
       (event_id, workspace_id, opportunity_id, transition_key, from_state, to_state,
        from_revision, to_revision, reason_codes_json, actor_kind, actor_reference,
        details_json, transition_commitment, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      normalized.eventId,
      normalized.workspaceId,
      normalized.opportunityId,
      normalized.transitionKey,
      normalized.expectedState,
      normalized.toState,
      normalized.expectedRevision,
      normalized.expectedRevision + 1,
      JSON.stringify(normalized.reasonCodes),
      normalized.actor.kind,
      normalized.actor.reference,
      normalized.detailsJson,
      normalized.transitionCommitment,
      normalized.occurredAt,
    ],
  );
  const event = eventResult.rows[0] as Row | undefined;
  if (!event) throw new Error("Human-review lifecycle transition event was not persisted.");
  return transitionFromRow(event, false);
}

export async function transitionHumanReviewOpportunityLifecycle(
  input: HumanReviewOpportunityTransitionInput,
): Promise<HumanReviewOpportunityTransition> {
  const validated = normalizeInput(input);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const transition = await transitionHumanReviewOpportunityLifecycleInTransaction(client, {
      ...input,
      workspaceId: validated.workspaceId,
      opportunityId: validated.opportunityId,
      reasonCodes: validated.reasonCodes,
      details: validated.details,
      occurredAt: validated.occurredAt,
    });
    await client.query("COMMIT");
    return transition;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const __humanReviewOpportunityLifecycleTestUtils = { sha256, stableJson, transitionFromRow };
