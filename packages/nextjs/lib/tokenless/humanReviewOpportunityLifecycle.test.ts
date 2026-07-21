import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { Pool } from "pg";
import { DataType, newDb } from "pg-mem";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import {
  HUMAN_REVIEW_OPPORTUNITY_TRANSITIONS,
  type HumanReviewOpportunityTransitionInput,
  isHumanReviewOpportunityTerminalState,
  transitionHumanReviewOpportunityLifecycle,
  transitionHumanReviewOpportunityLifecycleInTransaction,
} from "~~/lib/tokenless/humanReviewOpportunityLifecycle";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const migration = readFileSync(
  join(process.cwd(), "drizzle", "0060_human_review_opportunity_transition_events.sql"),
  "utf8",
);

function testPool() {
  const database = newDb();
  database.public.registerOperator({
    operator: "~",
    left: DataType.text,
    right: DataType.text,
    returns: DataType.bool,
    implementation: (value, pattern) => new RegExp(pattern).test(value),
  });
  database.public.registerFunction({
    name: "char_length",
    args: [DataType.text],
    returns: DataType.integer,
    implementation: value => value.length,
  });
  database.public.none(`
    CREATE TABLE tokenless_agent_review_opportunity_lifecycles (
      workspace_id text NOT NULL,
      opportunity_id text NOT NULL,
      state text NOT NULL,
      state_revision integer NOT NULL,
      reason_codes_json text NOT NULL,
      state_entered_at timestamp with time zone NOT NULL,
      terminal_at timestamp with time zone,
      created_at timestamp with time zone NOT NULL,
      updated_at timestamp with time zone NOT NULL,
      PRIMARY KEY (workspace_id, opportunity_id)
    );
  `);
  for (const statement of migration.split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (!sql || /^CREATE OR REPLACE FUNCTION/u.test(sql) || /^CREATE TRIGGER/u.test(sql)) continue;
    database.public.none(sql.replaceAll(" USING btree", ""));
  }
  const adapter = database.adapters.createPg();
  return new adapter.Pool() as unknown as Pool;
}

async function seedLifecycle(pool: Pool, opportunityId: string, state: string, revision = 1) {
  await pool.query(
    `INSERT INTO tokenless_agent_review_opportunity_lifecycles
       (workspace_id, opportunity_id, state, state_revision, reason_codes_json,
        state_entered_at, terminal_at, created_at, updated_at)
     VALUES ('workspace_a', $1, $2, $3, '[]', '2026-07-16T10:00:00Z', NULL,
             '2026-07-16T10:00:00Z', '2026-07-16T10:00:00Z')`,
    [opportunityId, state, revision],
  );
}

function transition(
  overrides: Partial<HumanReviewOpportunityTransitionInput> = {},
): HumanReviewOpportunityTransitionInput {
  return {
    workspaceId: "workspace_a",
    opportunityId: "opportunity_a",
    transitionKey: "evaluate:request-ready",
    expectedState: "evaluating",
    expectedRevision: 1,
    toState: "request_ready",
    reasonCodes: ["sampled", "policy_required", "sampled"],
    actor: { kind: "service", reference: "adaptive-review-evaluator" },
    details: { laneReadiness: "ready", attempt: 1 },
    occurredAt: new Date("2026-07-16T11:00:00Z"),
    ...overrides,
  };
}

test("the exported graph is lane-neutral and terminal states have no outgoing edges", () => {
  assert.deepEqual(HUMAN_REVIEW_OPPORTUNITY_TRANSITIONS.pending, [
    "blocked",
    "completed",
    "inconclusive",
    "failed_terminal",
  ]);
  assert.deepEqual(HUMAN_REVIEW_OPPORTUNITY_TRANSITIONS.blocked, [
    "approval_required",
    "request_ready",
    "pending",
    "completed",
    "inconclusive",
    "failed_terminal",
    "cancelled_before_commit",
  ]);
  for (const terminal of [
    "skipped",
    "completed",
    "inconclusive",
    "failed_terminal",
    "cancelled_before_commit",
  ] as const) {
    assert.equal(isHumanReviewOpportunityTerminalState(terminal), true);
    assert.deepEqual(HUMAN_REVIEW_OPPORTUNITY_TRANSITIONS[terminal], []);
  }
  assert.equal(JSON.stringify(HUMAN_REVIEW_OPPORTUNITY_TRANSITIONS).includes("public_paid"), false);
});

test("a guarded transition advances once and an exact retry returns the same event", async () => {
  const pool = testPool();
  await seedLifecycle(pool, "opportunity_a", "evaluating");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const first = await transitionHumanReviewOpportunityLifecycleInTransaction(client, transition());
    const replay = await transitionHumanReviewOpportunityLifecycleInTransaction(client, transition());
    await client.query("COMMIT");
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(replay.eventId, first.eventId);
    assert.deepEqual(first.reasonCodes, ["policy_required", "sampled"]);
    assert.deepEqual(first.details, { attempt: 1, laneReadiness: "ready" });

    const lifecycle = await pool.query(
      `SELECT state, state_revision, reason_codes_json, terminal_at
       FROM tokenless_agent_review_opportunity_lifecycles WHERE opportunity_id = 'opportunity_a'`,
    );
    assert.deepEqual(lifecycle.rows[0], {
      state: "request_ready",
      state_revision: 2,
      reason_codes_json: '["policy_required","sampled"]',
      terminal_at: null,
    });
    const events = await pool.query(
      "SELECT COUNT(*) AS count FROM tokenless_agent_review_opportunity_transition_events",
    );
    assert.equal(Number(events.rows[0]?.count), 1);
  } finally {
    client.release();
    await pool.end();
  }
});

test("idempotency conflicts, stale revisions, and forbidden edges fail closed", async () => {
  const pool = testPool();
  await seedLifecycle(pool, "opportunity_a", "evaluating");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await transitionHumanReviewOpportunityLifecycleInTransaction(client, transition());
    await assert.rejects(
      transitionHumanReviewOpportunityLifecycleInTransaction(
        client,
        transition({ toState: "blocked", reasonCodes: ["lane_unavailable"] }),
      ),
      (error: unknown) =>
        error instanceof TokenlessServiceError &&
        error.code === "human_review_lifecycle_transition_idempotency_conflict",
    );
    await assert.rejects(
      transitionHumanReviewOpportunityLifecycleInTransaction(
        client,
        transition({ transitionKey: "evaluate:second-attempt" }),
      ),
      (error: unknown) =>
        error instanceof TokenlessServiceError && error.code === "human_review_lifecycle_transition_conflict",
    );
    await assert.rejects(
      transitionHumanReviewOpportunityLifecycleInTransaction(
        client,
        transition({
          transitionKey: "ready:completed-directly",
          expectedState: "request_ready",
          expectedRevision: 2,
          toState: "completed",
        }),
      ),
      (error: unknown) =>
        error instanceof TokenlessServiceError && error.code === "human_review_lifecycle_transition_not_allowed",
    );
    await client.query("ROLLBACK");
  } finally {
    client.release();
    await pool.end();
  }
});

test("terminal transitions set terminal_at and cannot be advanced", async () => {
  const pool = testPool();
  await seedLifecycle(pool, "opportunity_pending", "pending", 4);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const completed = await transitionHumanReviewOpportunityLifecycleInTransaction(
      client,
      transition({
        opportunityId: "opportunity_pending",
        transitionKey: "pending:completed-result",
        expectedState: "pending",
        expectedRevision: 4,
        toState: "completed",
        reasonCodes: ["quorum_reached"],
      }),
    );
    await client.query("COMMIT");
    assert.equal(completed.toRevision, 5);
    const lifecycle = await pool.query(
      "SELECT state, state_revision, terminal_at FROM tokenless_agent_review_opportunity_lifecycles WHERE opportunity_id = 'opportunity_pending'",
    );
    assert.equal(lifecycle.rows[0]?.state, "completed");
    assert.equal(lifecycle.rows[0]?.state_revision, 5);
    assert.equal(new Date(lifecycle.rows[0]?.terminal_at as string).toISOString(), "2026-07-16T11:00:00.000Z");
    await assert.rejects(
      transitionHumanReviewOpportunityLifecycle({
        ...transition(),
        opportunityId: "opportunity_pending",
        transitionKey: "completed:blocked-retry",
        expectedState: "completed",
        expectedRevision: 5,
        toState: "blocked",
      }),
      (error: unknown) =>
        error instanceof TokenlessServiceError && error.code === "human_review_lifecycle_transition_not_allowed",
    );
  } finally {
    await pool.end();
  }
});

test("the managed transaction rolls back the lifecycle if event insertion fails", async () => {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [], rowCount: null };
      if (sql.startsWith("SET LOCAL ")) return { rows: [], rowCount: null };
      if (sql.includes("FROM tokenless_agent_review_opportunity_lifecycles")) {
        return { rows: [{ state: "evaluating", state_revision: 1, terminal_at: null }], rowCount: 1 };
      }
      if (sql.includes("FROM tokenless_agent_review_opportunity_transition_events")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("UPDATE tokenless_agent_review_opportunity_lifecycles")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO tokenless_agent_review_opportunity_transition_events")) {
        throw new Error("simulated append failure");
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {
      queries.push("RELEASE");
    },
  };
  __setDatabaseResourcesForTests({ pool: { connect: async () => client } } as never);
  try {
    await assert.rejects(transitionHumanReviewOpportunityLifecycle(transition()), /simulated append failure/);
    assert.equal(queries[0], "BEGIN");
    assert.equal(queries.includes("COMMIT"), false);
    assert.deepEqual(queries.slice(-2), ["ROLLBACK", "RELEASE"]);
  } finally {
    __setDatabaseResourcesForTests(null);
  }
});
