import assert from "node:assert/strict";
import test from "node:test";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import {
  MAXIMUM_HUMAN_REVIEW_RECOVERY_FAILURES,
  recordHumanReviewOpportunityFailure,
  resumeHumanReviewOpportunityAfterRecovery,
} from "~~/lib/tokenless/humanReviewOpportunityRecovery";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

type FakeState = {
  lifecycle: { state: string; revision: number; terminalAt: Date | null; reasons: string };
  recovery: null | {
    status: string;
    resume_state: string | null;
    failure_count: number;
    first_failure_at: Date | null;
    last_failure_at: Date | null;
  };
  lifecycleEvents: Map<string, Row>;
  recoveryEvents: Map<string, Row>;
  legacyStatus: string;
  deliveryStatus: string;
};

type Work = {
  privateAccepted?: number;
  assuranceAccepted?: number;
  publicResponses?: number;
  publicPaidPayable?: number;
  assuranceResponses?: number;
  assurancePaidAccepted?: number;
  assurancePaidPayable?: number;
  publicCommits?: number;
  paidCommits?: number;
  assignmentCount?: number;
  activeAssignmentCount?: number;
  expiredAssignmentCount?: number;
};

function cloneState(value: FakeState): FakeState {
  return {
    lifecycle: { ...value.lifecycle },
    recovery: value.recovery ? { ...value.recovery } : null,
    lifecycleEvents: new Map([...value.lifecycleEvents].map(([key, row]) => [key, { ...row }])),
    recoveryEvents: new Map([...value.recoveryEvents].map(([key, row]) => [key, { ...row }])),
    legacyStatus: value.legacyStatus,
    deliveryStatus: value.deliveryStatus,
  };
}

class RecoveryClient {
  state: FakeState = {
    lifecycle: { state: "pending", revision: 1, terminalAt: null, reasons: "[]" },
    recovery: null,
    lifecycleEvents: new Map(),
    recoveryEvents: new Map(),
    legacyStatus: "review_requested",
    deliveryStatus: "pending",
  };
  beforeTransaction: FakeState | null = null;
  commits = 0;
  rollbacks = 0;
  failRecoveryEventInsert = false;
  policyDisabled = false;
  deadline = new Date("2026-07-16T12:00:00.000Z");
  work: Work = {};

  async query(sql: string, values: unknown[] = []) {
    const normalized = sql.trim();
    if (normalized === "BEGIN") {
      this.beforeTransaction = cloneState(this.state);
      return { rows: [], rowCount: null };
    }
    if (normalized === "COMMIT") {
      this.beforeTransaction = null;
      this.commits += 1;
      return { rows: [], rowCount: null };
    }
    if (normalized === "ROLLBACK") {
      if (this.beforeTransaction) this.state = this.beforeTransaction;
      this.beforeTransaction = null;
      this.rollbacks += 1;
      return { rows: [], rowCount: null };
    }
    if (normalized.startsWith("SELECT state,state_revision,terminal_at")) {
      return {
        rows: [
          {
            state: this.state.lifecycle.state,
            state_revision: this.state.lifecycle.revision,
            terminal_at: this.state.lifecycle.terminalAt,
          },
        ],
        rowCount: 1,
      };
    }
    if (
      normalized.includes("FROM tokenless_agent_review_opportunity_lifecycles l") &&
      normalized.includes("JOIN tokenless_agent_review_opportunities o")
    ) {
      return {
        rows: [
          {
            state: this.state.lifecycle.state,
            state_revision: this.state.lifecycle.revision,
            terminal_at: this.state.lifecycle.terminalAt,
            operation_key: "operation_a",
            run_id: Object.keys(this.work).some(key => key.startsWith("assurance")) ? "run_a" : null,
            opportunity_created_at: new Date("2026-07-16T10:00:00.000Z"),
            response_window_seconds: 7_200,
            policy_enabled: !this.policyDisabled,
            policy_superseded_at: null,
            binding_enabled: true,
            binding_superseded_at: null,
            private_response_deadline: this.deadline,
            private_delivery_deadline: this.deadline,
            approval_deadline: null,
          },
        ],
        rowCount: 1,
      };
    }
    if (normalized.startsWith("SELECT expires_at\n     FROM tokenless_agent_review_approval_requests")) {
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("SELECT * FROM tokenless_agent_review_opportunity_recovery_events")) {
      const row = this.state.recoveryEvents.get(String(values[2]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (normalized.startsWith("SELECT status,resume_state,failure_count")) {
      return { rows: this.state.recovery ? [this.state.recovery] : [], rowCount: this.state.recovery ? 1 : 0 };
    }
    if (normalized.includes("FROM tokenless_private_unpaid_review_assignments assignment")) {
      return {
        rows: [
          {
            accepted: this.work.privateAccepted ?? 0,
            assignment_count: this.work.assignmentCount ?? 0,
            active_assignment_count: this.work.activeAssignmentCount ?? 0,
            expired_assignment_count: this.work.expiredAssignmentCount ?? 0,
          },
        ],
        rowCount: 1,
      };
    }
    if (normalized.includes("FROM tokenless_public_rater_responses response")) {
      return {
        rows: [
          {
            responses: this.work.publicResponses ?? 0,
            paid_payable: this.work.publicPaidPayable ?? 0,
            commits: this.work.publicCommits ?? 0,
            paid_commits: this.work.paidCommits ?? 0,
          },
        ],
        rowCount: 1,
      };
    }
    if (normalized.includes("FROM tokenless_assurance_assignments assignment")) {
      return {
        rows: [
          {
            accepted: this.work.assuranceAccepted ?? 0,
            responses: this.work.assuranceResponses ?? 0,
            paid_accepted: this.work.assurancePaidAccepted ?? 0,
            paid_payable: this.work.assurancePaidPayable ?? 0,
            assignment_count: this.work.assignmentCount ?? 0,
            active_assignment_count: this.work.activeAssignmentCount ?? 0,
            expired_assignment_count: this.work.expiredAssignmentCount ?? 0,
          },
        ],
        rowCount: 1,
      };
    }
    if (normalized.startsWith("SELECT state, state_revision, terminal_at")) {
      return {
        rows: [
          {
            state: this.state.lifecycle.state,
            state_revision: this.state.lifecycle.revision,
            terminal_at: this.state.lifecycle.terminalAt,
          },
        ],
        rowCount: 1,
      };
    }
    if (normalized.startsWith("SELECT * FROM tokenless_agent_review_opportunity_transition_events")) {
      const row = this.state.lifecycleEvents.get(String(values[2]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (normalized.startsWith("UPDATE tokenless_agent_review_opportunity_lifecycles")) {
      if (this.state.lifecycle.state !== values[6] || this.state.lifecycle.revision !== values[7]) {
        return { rows: [], rowCount: 0 };
      }
      this.state.lifecycle = {
        state: String(values[0]),
        revision: this.state.lifecycle.revision + 1,
        terminalAt: (values[3] as Date | null) ?? null,
        reasons: String(values[1]),
      };
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("INSERT INTO tokenless_agent_review_opportunity_transition_events")) {
      const row = {
        event_id: values[0],
        workspace_id: values[1],
        opportunity_id: values[2],
        transition_key: values[3],
        from_state: values[4],
        to_state: values[5],
        from_revision: values[6],
        to_revision: values[7],
        reason_codes_json: values[8],
        actor_kind: values[9],
        actor_reference: values[10],
        details_json: values[11],
        transition_commitment: values[12],
        occurred_at: values[13],
      };
      this.state.lifecycleEvents.set(String(values[3]), row);
      return { rows: [row], rowCount: 1 };
    }
    if (normalized.startsWith("INSERT INTO tokenless_agent_review_opportunity_recovery_states")) {
      this.state.recovery = {
        status: String(values[2]),
        resume_state: values[3] === null ? null : String(values[3]),
        failure_count: Number(values[4]),
        first_failure_at: this.state.recovery?.first_failure_at ?? ((values[8] as Date | null) || null),
        last_failure_at: (values[9] as Date | null) ?? this.state.recovery?.last_failure_at ?? null,
      };
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE tokenless_agent_review_opportunities")) {
      this.state.legacyStatus = "failed";
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("UPDATE tokenless_private_unpaid_review_deliveries")) {
      this.state.deliveryStatus = String(values[0]);
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("INSERT INTO tokenless_agent_review_opportunity_recovery_events")) {
      if (this.failRecoveryEventInsert) throw new Error("simulated recovery audit write failure");
      const row = {
        event_id: values[0],
        workspace_id: values[1],
        opportunity_id: values[2],
        transition_key: values[3],
        request_commitment: values[4],
        signal: values[5],
        action: values[6],
        from_state: values[7],
        to_state: values[8],
        from_revision: values[9],
        to_revision: values[10],
        failure_count: values[11],
        accepted_work_count: values[12],
        committed_work_count: values[13],
        response_count: values[14],
        reason_codes_json: values[15],
        details_json: values[16],
        occurred_at: values[17],
      };
      this.state.recoveryEvents.set(String(values[3]), row);
      return { rows: [row], rowCount: 1 };
    }
    throw new Error(`Unexpected recovery test query: ${normalized}`);
  }

  release() {}
}

function install(client: RecoveryClient) {
  __setDatabaseResourcesForTests({ pool: { connect: async () => client } } as never);
}

async function transient(client: RecoveryClient, key: string, time: string) {
  install(client);
  return recordHumanReviewOpportunityFailure({
    workspaceId: "workspace_a",
    opportunityId: "opportunity_a",
    transitionKey: key,
    signal: "infrastructure_failure",
    errorCode: "queue_unavailable",
    occurredAt: new Date(time),
  });
}

async function resume(client: RecoveryClient, key: string, time: string) {
  install(client);
  return resumeHumanReviewOpportunityAfterRecovery({
    workspaceId: "workspace_a",
    opportunityId: "opportunity_a",
    transitionKey: key,
    occurredAt: new Date(time),
  });
}

test.afterEach(() => __setDatabaseResourcesForTests(null));

test("a transient failure blocks once, then resumes the exact pending revision", async () => {
  const client = new RecoveryClient();
  const blocked = await transient(client, "failure:first", "2026-07-16T10:30:00.000Z");
  assert.equal(blocked.action, "blocked_for_retry");
  assert.equal(blocked.fromRevision, 1);
  assert.equal(blocked.toRevision, 2);
  assert.equal(client.state.lifecycle.state, "blocked");
  assert.equal(client.state.recovery?.failure_count, 1);
  assert.equal(blocked.details.nextRetryAt, "2026-07-16T10:30:30.000Z");

  const recovered = await resume(client, "recovery:first", "2026-07-16T10:31:00.000Z");
  assert.equal(recovered.action, "retry_resumed");
  assert.equal(recovered.toState, "pending");
  assert.equal(recovered.fromRevision, 2);
  assert.equal(recovered.toRevision, 3);
  assert.equal(client.state.lifecycle.state, "pending");
  assert.equal(client.state.recovery?.status, "recovered");

  const replay = await resume(client, "recovery:first", "2026-07-16T10:35:00.000Z");
  assert.equal(replay.replayed, true);
  assert.equal(replay.eventId, recovered.eventId);
  assert.equal(client.state.lifecycle.revision, 3);
});

test("the third transient failure exhausts bounded retries", async () => {
  const client = new RecoveryClient();
  for (let attempt = 1; attempt < MAXIMUM_HUMAN_REVIEW_RECOVERY_FAILURES; attempt += 1) {
    await transient(client, `failure:attempt-${attempt}`, `2026-07-16T10:${20 + attempt}:00.000Z`);
    await resume(client, `recovery:attempt-${attempt}`, `2026-07-16T10:${20 + attempt}:45.000Z`);
  }
  const terminal = await transient(client, "failure:attempt-3", "2026-07-16T10:24:00.000Z");
  assert.equal(terminal.failureCount, 3);
  assert.equal(terminal.action, "terminal_failed");
  assert.equal(terminal.toState, "failed_terminal");
  assert.ok(terminal.reasonCodes.includes("recovery_retries_exhausted"));
  assert.equal(client.state.recovery?.status, "terminal");
  assert.equal(client.state.lifecycle.terminalAt?.toISOString(), "2026-07-16T10:24:00.000Z");
});

test("owner disable cancels only before acceptance and preserves accepted work as payable", async () => {
  const beforeCommit = new RecoveryClient();
  beforeCommit.policyDisabled = true;
  beforeCommit.state.lifecycle.state = "request_ready";
  install(beforeCommit);
  const cancelled = await recordHumanReviewOpportunityFailure({
    workspaceId: "workspace_a",
    opportunityId: "opportunity_a",
    transitionKey: "owner:disable-before-work",
    signal: "owner_policy_disabled",
    occurredAt: new Date("2026-07-16T10:30:00.000Z"),
  });
  assert.equal(cancelled.toState, "cancelled_before_commit");
  assert.ok(cancelled.reasonCodes.includes("no_accepted_work"));

  const publishedWithoutAcceptance = new RecoveryClient();
  publishedWithoutAcceptance.policyDisabled = true;
  install(publishedWithoutAcceptance);
  const publishedTerminal = await recordHumanReviewOpportunityFailure({
    workspaceId: "workspace_a",
    opportunityId: "opportunity_a",
    transitionKey: "owner:disable-after-publication",
    signal: "owner_policy_disabled",
    occurredAt: new Date("2026-07-16T10:30:00.000Z"),
  });
  assert.equal(publishedTerminal.fromState, "pending");
  assert.equal(publishedTerminal.toState, "failed_terminal");
  assert.notEqual(publishedTerminal.action, "cancelled_before_commit");

  const blockedAfterPublication = new RecoveryClient();
  await transient(blockedAfterPublication, "failure:block-published", "2026-07-16T10:20:00.000Z");
  blockedAfterPublication.policyDisabled = true;
  install(blockedAfterPublication);
  const blockedTerminal = await recordHumanReviewOpportunityFailure({
    workspaceId: "workspace_a",
    opportunityId: "opportunity_a",
    transitionKey: "owner:disable-blocked-published",
    signal: "owner_policy_disabled",
    occurredAt: new Date("2026-07-16T10:30:00.000Z"),
  });
  assert.equal(blockedTerminal.fromState, "blocked");
  assert.equal(blockedTerminal.details.resumeState, "pending");
  assert.equal(blockedTerminal.toState, "failed_terminal");
  assert.notEqual(blockedTerminal.action, "cancelled_before_commit");

  const afterCommit = new RecoveryClient();
  afterCommit.policyDisabled = true;
  afterCommit.work.privateAccepted = 1;
  install(afterCommit);
  const preserved = await recordHumanReviewOpportunityFailure({
    workspaceId: "workspace_a",
    opportunityId: "opportunity_a",
    transitionKey: "owner:disable-after-work",
    signal: "owner_policy_disabled",
    occurredAt: new Date("2026-07-16T10:30:00.000Z"),
  });
  assert.equal(preserved.toState, "inconclusive");
  assert.ok(preserved.reasonCodes.includes("accepted_work_payable"));
  assert.ok(preserved.reasonCodes.includes("no_post_commit_cancellation"));
  assert.equal(preserved.details.acceptedWorkPayable, true);
  assert.equal((preserved.details.payment as { disposition: string }).disposition, "not_applicable");
  assert.equal(afterCommit.state.deliveryStatus, "inconclusive");
});

test("paid accepted work reaches a payable or preserved terminal and never uses Feedback Bonus", async () => {
  const payable = new RecoveryClient();
  payable.work = { paidCommits: 1, publicResponses: 1, publicPaidPayable: 1 };
  install(payable);
  const payableTerminal = await recordHumanReviewOpportunityFailure({
    workspaceId: "workspace_a",
    opportunityId: "opportunity_a",
    transitionKey: "failure:paid-response",
    signal: "infrastructure_failure",
    retryable: false,
    errorCode: "result_adapter_failed",
    occurredAt: new Date("2026-07-16T10:30:00.000Z"),
  });
  assert.equal(payableTerminal.toState, "inconclusive");
  assert.deepEqual(payableTerminal.details.payment, {
    disposition: "payable_terminal",
    paidAcceptedWorkCount: 1,
    paidPayableWorkCount: 1,
    noPostCommitCancellation: true,
    feedbackBonusMaySatisfyBaseLiability: false,
  });

  const committed = new RecoveryClient();
  committed.work = { paidCommits: 1 };
  install(committed);
  const preserved = await recordHumanReviewOpportunityFailure({
    workspaceId: "workspace_a",
    opportunityId: "opportunity_a",
    transitionKey: "failure:paid-commit",
    signal: "adapter_failure",
    retryable: false,
    errorCode: "adapter_rejected",
    occurredAt: new Date("2026-07-16T10:31:00.000Z"),
  });
  assert.equal((preserved.details.payment as { disposition: string }).disposition, "compensation_path_preserved");
});

test("response timeout and all-expired signals are verified against durable state", async () => {
  const early = new RecoveryClient();
  install(early);
  await assert.rejects(
    recordHumanReviewOpportunityFailure({
      workspaceId: "workspace_a",
      opportunityId: "opportunity_a",
      transitionKey: "deadline:too-early",
      signal: "response_deadline_elapsed",
      occurredAt: new Date("2026-07-16T11:59:59.000Z"),
    }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "human_review_response_deadline_active",
  );

  const withResponse = new RecoveryClient();
  withResponse.work.publicResponses = 1;
  install(withResponse);
  const inconclusive = await recordHumanReviewOpportunityFailure({
    workspaceId: "workspace_a",
    opportunityId: "opportunity_a",
    transitionKey: "deadline:with-response",
    signal: "response_deadline_elapsed",
    occurredAt: new Date("2026-07-16T12:00:00.000Z"),
  });
  assert.equal(inconclusive.toState, "inconclusive");

  const expired = new RecoveryClient();
  expired.work = { assignmentCount: 2, activeAssignmentCount: 0, expiredAssignmentCount: 2 };
  install(expired);
  const failed = await recordHumanReviewOpportunityFailure({
    workspaceId: "workspace_a",
    opportunityId: "opportunity_a",
    transitionKey: "assignments:all-expired",
    signal: "all_assignments_expired",
    occurredAt: new Date("2026-07-16T11:00:00.000Z"),
  });
  assert.equal(failed.toState, "failed_terminal");
  assert.equal(expired.state.deliveryStatus, "failed_terminal");
});

test("audit insertion failure rolls back lifecycle and recovery, then exact retry succeeds", async () => {
  const client = new RecoveryClient();
  client.failRecoveryEventInsert = true;
  await assert.rejects(
    transient(client, "failure:crash-window", "2026-07-16T10:30:00.000Z"),
    /simulated recovery audit write failure/u,
  );
  assert.equal(client.rollbacks, 1);
  assert.deepEqual(client.state.lifecycle, {
    state: "pending",
    revision: 1,
    terminalAt: null,
    reasons: "[]",
  });
  assert.equal(client.state.recovery, null);
  assert.equal(client.state.lifecycleEvents.size, 0);

  client.failRecoveryEventInsert = false;
  const recovered = await transient(client, "failure:crash-window", "2026-07-16T10:30:00.000Z");
  assert.equal(recovered.action, "blocked_for_retry");
  assert.equal(client.state.lifecycle.state, "blocked");
  assert.equal(client.commits, 1);
});
