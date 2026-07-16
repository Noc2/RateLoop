import { getTableColumns } from "drizzle-orm";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DataType, newDb } from "pg-mem";
import { tokenlessAgentReviewApprovalRequests, tokenlessAgentReviewOpportunityLifecycles } from "~~/lib/db/schema";

const migration = readFileSync(join(process.cwd(), "drizzle", "0057_agent_review_lifecycle_approvals.sql"), "utf8");
const HASH = (character: string) => `sha256:${character.repeat(64)}`;

function migratedDatabase() {
  const database = newDb();
  database.public.registerOperator({
    operator: "~",
    left: DataType.text,
    right: DataType.text,
    returns: DataType.bool,
    implementation: (value, pattern) => new RegExp(pattern).test(value),
  });
  database.public.none(`
    CREATE TABLE tokenless_agent_review_request_profiles (
      profile_id text NOT NULL,
      version integer NOT NULL,
      workspace_id text NOT NULL,
      profile_hash text NOT NULL,
      PRIMARY KEY (profile_id, version),
      UNIQUE (workspace_id, profile_id, version, profile_hash)
    );
    CREATE TABLE tokenless_agent_review_opportunities (
      opportunity_id text PRIMARY KEY,
      workspace_id text NOT NULL,
      source_evidence_hash text NOT NULL,
      suggestion_commitment text NOT NULL,
      decision text NOT NULL,
      status text NOT NULL,
      reason_codes_json text NOT NULL,
      created_at timestamp with time zone NOT NULL,
      updated_at timestamp with time zone NOT NULL,
      UNIQUE (workspace_id, opportunity_id)
    );
    INSERT INTO tokenless_agent_review_request_profiles
      (profile_id, version, workspace_id, profile_hash)
    VALUES ('profile_a', 1, 'workspace_a', '${HASH("a")}');
    INSERT INTO tokenless_agent_review_opportunities
      (opportunity_id, workspace_id, source_evidence_hash, suggestion_commitment,
       decision, status, reason_codes_json, created_at, updated_at)
    VALUES
      ('op_required', 'workspace_a', '${HASH("b")}', '${HASH("c")}',
       'required', 'decided', '["sampled"]', '2026-07-16T10:00:00Z', '2026-07-16T10:01:00Z'),
      ('op_recommended', 'workspace_a', '${HASH("d")}', '${HASH("e")}',
       'recommended', 'decided', '["below_threshold"]', '2026-07-16T10:00:00Z', '2026-07-16T10:02:00Z'),
      ('op_skipped', 'workspace_a', '${HASH("f")}', '${HASH("0")}',
       'skip', 'skipped', '["not_sampled"]', '2026-07-16T10:00:00Z', '2026-07-16T10:03:00Z'),
      ('op_pending', 'workspace_a', '${HASH("1")}', '${HASH("2")}',
       'required', 'review_requested', '["sampled"]', '2026-07-16T10:00:00Z', '2026-07-16T10:04:00Z'),
      ('op_completed', 'workspace_a', '${HASH("3")}', '${HASH("4")}',
       'required', 'completed', '["sampled"]', '2026-07-16T10:00:00Z', '2026-07-16T10:05:00Z'),
      ('op_failed', 'workspace_a', '${HASH("5")}', '${HASH("6")}',
       'required', 'failed', '["adapter_failed"]', '2026-07-16T10:00:00Z', '2026-07-16T10:06:00Z');
  `);
  const pgMemMigration = migration.replaceAll(" USING btree", "");
  for (const statement of pgMemMigration.split("--> statement-breakpoint")) {
    if (statement.trim()) database.public.none(statement);
  }
  return database;
}

function sqlValue(value: string | number | null) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function insertApproval(
  database: ReturnType<typeof newDb>,
  overrides: Partial<Record<string, string | number | null>> = {},
) {
  const values = {
    approval_id: "approval_a",
    workspace_id: "workspace_a",
    opportunity_id: "op_required",
    revision: 1,
    request_profile_id: "profile_a",
    request_profile_version: 1,
    request_profile_hash: HASH("a"),
    source_evidence_hash: HASH("b"),
    suggestion_commitment: HASH("c"),
    prepared_request_json: '{"criterion":"Correct?"}',
    prepared_request_hash: HASH("7"),
    derived_economics_json: '{"maximumChargeAtomic":"0"}',
    derived_economics_hash: HASH("8"),
    maximum_charge_atomic: 0,
    status: "pending",
    owner_decision: null,
    prepared_by: "service_a",
    decided_by: null,
    decision_note: null,
    decided_at: null,
    invalidated_by: null,
    invalidated_at: null,
    expired_at: null,
    consumed_at: null,
    consumption_reference: null,
    created_at: "2026-07-16T11:00:00Z",
    expires_at: "2026-07-16T12:00:00Z",
    ...overrides,
  };
  const columns = Object.keys(values);
  database.public.none(
    `INSERT INTO tokenless_agent_review_approval_requests (${columns.join(", ")}) VALUES (${columns
      .map(column => sqlValue(values[column as keyof typeof values]))
      .join(", ")})`,
  );
}

test("0057 adds a one-to-one normative lifecycle without changing the legacy status contract", () => {
  assert.match(migration, /CREATE TABLE "tokenless_agent_review_opportunity_lifecycles"/);
  assert.match(migration, /PRIMARY KEY \("workspace_id", "opportunity_id"\)/);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "opportunity_id"\)\s+REFERENCES "tokenless_agent_review_opportunities" \("workspace_id", "opportunity_id"\)/,
  );
  assert.match(
    migration,
    /"tokenless_agent_review_opportunity_lifecycles_state_updated_idx"[\s\S]*WHERE "terminal_at" IS NULL/,
  );
  for (const state of [
    "evaluating",
    "skipped",
    "approval_required",
    "request_ready",
    "pending",
    "blocked",
    "completed",
    "inconclusive",
    "failed_terminal",
    "cancelled_before_commit",
  ]) {
    assert.match(migration, new RegExp(`'${state}'`));
  }
  assert.doesNotMatch(migration, /ALTER COLUMN "status"/);
  assert.doesNotMatch(migration, /UPDATE "tokenless_agent_review_opportunities"/);
});

test("0057 backfills every legacy opportunity into the normative state exactly once", () => {
  const database = migratedDatabase();
  const rows = database.public.many(`
    SELECT opportunity_id, state, state_revision, terminal_at
    FROM tokenless_agent_review_opportunity_lifecycles
    ORDER BY opportunity_id
  `) as Array<Record<string, unknown>>;
  assert.deepEqual(
    rows.map(row => [row.opportunity_id, row.state, row.state_revision, row.terminal_at !== null]),
    [
      ["op_completed", "completed", 1, true],
      ["op_failed", "failed_terminal", 1, true],
      ["op_pending", "pending", 1, false],
      ["op_recommended", "skipped", 1, true],
      ["op_required", "approval_required", 1, false],
      ["op_skipped", "skipped", 1, true],
    ],
  );
  assert.throws(() =>
    database.public.none(`
      INSERT INTO tokenless_agent_review_opportunity_lifecycles
        (workspace_id, opportunity_id, state, state_revision, reason_codes_json,
         state_entered_at, terminal_at, created_at, updated_at)
      VALUES ('workspace_a', 'op_required', 'evaluating', 1, '[]',
        '2026-07-16T11:00:00Z', NULL, '2026-07-16T10:00:00Z', '2026-07-16T11:00:00Z')
    `),
  );
});

test("0057 rejects contradictory lifecycle terminal and timestamp tuples", () => {
  const database = migratedDatabase();
  database.public.none(
    `DELETE FROM tokenless_agent_review_opportunity_lifecycles WHERE opportunity_id = 'op_required'`,
  );
  assert.throws(() =>
    database.public.none(`
      INSERT INTO tokenless_agent_review_opportunity_lifecycles
        (workspace_id, opportunity_id, state, state_revision, reason_codes_json,
         state_entered_at, terminal_at, created_at, updated_at)
      VALUES ('workspace_a', 'op_required', 'completed', 1, '[]',
        '2026-07-16T11:00:00Z', NULL, '2026-07-16T10:00:00Z', '2026-07-16T11:00:00Z')
    `),
  );
  assert.throws(() =>
    database.public.none(`
      INSERT INTO tokenless_agent_review_opportunity_lifecycles
        (workspace_id, opportunity_id, state, state_revision, reason_codes_json,
         state_entered_at, terminal_at, created_at, updated_at)
      VALUES ('workspace_a', 'op_required', 'blocked', 0, '[]',
        '2026-07-16T11:00:00Z', NULL, '2026-07-16T10:00:00Z', '2026-07-16T11:00:00Z')
    `),
  );
});

test("0057 binds approval revisions to exact profile and opportunity commitments", () => {
  insertApproval(migratedDatabase());
  assert.throws(() => insertApproval(migratedDatabase(), { request_profile_hash: HASH("9") }));
  assert.throws(() => insertApproval(migratedDatabase(), { source_evidence_hash: HASH("9") }));
  assert.throws(() => insertApproval(migratedDatabase(), { suggestion_commitment: HASH("9") }));
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "request_profile_id", "request_profile_version", "request_profile_hash"\)/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "opportunity_id", "source_evidence_hash", "suggestion_commitment"\)/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "opportunity_id"\)\s+REFERENCES "tokenless_agent_review_opportunity_lifecycles"/,
  );
  assert.match(
    migration,
    /"tokenless_agent_review_approval_requests_status_expiry_idx"[\s\S]*WHERE "status" IN \('pending', 'approved'\)/,
  );
  const missingLifecycle = migratedDatabase();
  missingLifecycle.public.none(
    "DELETE FROM tokenless_agent_review_opportunity_lifecycles WHERE opportunity_id = 'op_required'",
  );
  assert.throws(() => insertApproval(missingLifecycle));
});

test("0057 enforces one actionable revision and preserves invalidated revisions", () => {
  const database = migratedDatabase();
  insertApproval(database);
  assert.throws(() =>
    insertApproval(database, {
      approval_id: "approval_b",
      revision: 2,
      prepared_request_hash: HASH("9"),
    }),
  );
  database.public.none(`
    UPDATE tokenless_agent_review_approval_requests
    SET status = 'invalidated', invalidated_by = 'owner_a', invalidated_at = '2026-07-16T11:10:00Z'
    WHERE approval_id = 'approval_a'
  `);
  insertApproval(database, {
    approval_id: "approval_b",
    revision: 2,
    prepared_request_hash: HASH("9"),
  });
  assert.throws(() =>
    insertApproval(database, {
      approval_id: "approval_b_replay",
      revision: 2,
      prepared_request_hash: HASH("a"),
    }),
  );
  const rows = database.public.many(`
    SELECT approval_id, revision, status FROM tokenless_agent_review_approval_requests ORDER BY revision
  `);
  assert.deepEqual(rows, [
    { approval_id: "approval_a", revision: 1, status: "invalidated" },
    { approval_id: "approval_b", revision: 2, status: "pending" },
  ]);
});

test("0057 accepts each exact approval state tuple", () => {
  const database = migratedDatabase();
  insertApproval(database);
  insertApproval(database, {
    approval_id: "approval_approved",
    opportunity_id: "op_recommended",
    source_evidence_hash: HASH("d"),
    suggestion_commitment: HASH("e"),
    prepared_request_hash: HASH("9"),
    status: "approved",
    owner_decision: "approved",
    decided_by: "owner_a",
    decided_at: "2026-07-16T11:05:00Z",
  });
  insertApproval(database, {
    approval_id: "approval_denied",
    opportunity_id: "op_skipped",
    source_evidence_hash: HASH("f"),
    suggestion_commitment: HASH("0"),
    prepared_request_hash: HASH("a"),
    status: "denied",
    owner_decision: "denied",
    decided_by: "owner_a",
    decision_note: "Not this time.",
    decided_at: "2026-07-16T11:05:00Z",
  });
  insertApproval(database, {
    approval_id: "approval_invalidated",
    opportunity_id: "op_pending",
    source_evidence_hash: HASH("1"),
    suggestion_commitment: HASH("2"),
    prepared_request_hash: HASH("b"),
    status: "invalidated",
    invalidated_by: "owner_a",
    invalidated_at: "2026-07-16T11:05:00Z",
  });
  insertApproval(database, {
    approval_id: "approval_expired",
    opportunity_id: "op_completed",
    source_evidence_hash: HASH("3"),
    suggestion_commitment: HASH("4"),
    prepared_request_hash: HASH("c"),
    status: "expired",
    expired_at: "2026-07-16T12:00:00Z",
  });
  insertApproval(database, {
    approval_id: "approval_consumed",
    opportunity_id: "op_failed",
    source_evidence_hash: HASH("5"),
    suggestion_commitment: HASH("6"),
    prepared_request_hash: HASH("d"),
    status: "consumed",
    owner_decision: "approved",
    decided_by: "owner_a",
    decided_at: "2026-07-16T11:05:00Z",
    consumed_at: "2026-07-16T11:06:00Z",
    consumption_reference: "operation_a",
  });
  assert.equal(
    database.public.one("SELECT count(*)::integer AS count FROM tokenless_agent_review_approval_requests").count,
    6,
  );
});

test("0057 rejects contradictory owner-decision, expiry, and consumption tuples", () => {
  assert.throws(() => insertApproval(migratedDatabase(), { status: "approved" }));
  assert.throws(() =>
    insertApproval(migratedDatabase(), {
      status: "denied",
      owner_decision: "denied",
      decided_by: null,
      decided_at: "2026-07-16T11:05:00Z",
    }),
  );
  assert.throws(() =>
    insertApproval(migratedDatabase(), {
      status: "expired",
      expired_at: "2026-07-16T11:59:59Z",
    }),
  );
  insertApproval(migratedDatabase(), {
    status: "consumed",
    owner_decision: "approved",
    decided_by: "owner_a",
    decided_at: "2026-07-16T11:05:00Z",
    consumed_at: "2026-07-16T11:06:00Z",
    consumption_reference: "operation_a",
  });
});

test("0057 deduplicates prepared requests and consumption references", () => {
  const preparedDatabase = migratedDatabase();
  insertApproval(preparedDatabase);
  assert.throws(() =>
    insertApproval(preparedDatabase, {
      approval_id: "approval_same_prepared",
      opportunity_id: "op_skipped",
      source_evidence_hash: HASH("f"),
      suggestion_commitment: HASH("0"),
      prepared_request_hash: HASH("7"),
    }),
  );

  const consumptionDatabase = migratedDatabase();
  insertApproval(consumptionDatabase, {
    approval_id: "approval_consumed_a",
    status: "consumed",
    owner_decision: "approved",
    decided_by: "owner_a",
    decided_at: "2026-07-16T11:05:00Z",
    consumed_at: "2026-07-16T11:06:00Z",
    consumption_reference: "operation_a",
  });
  assert.throws(() =>
    insertApproval(consumptionDatabase, {
      approval_id: "approval_consumed_b",
      opportunity_id: "op_skipped",
      source_evidence_hash: HASH("f"),
      suggestion_commitment: HASH("0"),
      prepared_request_hash: HASH("9"),
      status: "consumed",
      owner_decision: "approved",
      decided_by: "owner_a",
      decided_at: "2026-07-16T11:05:00Z",
      consumed_at: "2026-07-16T11:06:00Z",
      consumption_reference: "operation_a",
    }),
  );
});

test("0057 exposes lifecycle and approval provenance through Drizzle", () => {
  const lifecycle = getTableColumns(tokenlessAgentReviewOpportunityLifecycles);
  assert.equal(lifecycle.opportunityId.name, "opportunity_id");
  assert.equal(lifecycle.stateRevision.name, "state_revision");
  assert.equal(lifecycle.reasonCodesJson.name, "reason_codes_json");
  assert.equal(lifecycle.stateEnteredAt.name, "state_entered_at");
  assert.equal(lifecycle.terminalAt.name, "terminal_at");

  const approval = getTableColumns(tokenlessAgentReviewApprovalRequests);
  assert.equal(approval.approvalId.name, "approval_id");
  assert.equal(approval.requestProfileHash.name, "request_profile_hash");
  assert.equal(approval.sourceEvidenceHash.name, "source_evidence_hash");
  assert.equal(approval.preparedRequestHash.name, "prepared_request_hash");
  assert.equal(approval.derivedEconomicsHash.name, "derived_economics_hash");
  assert.equal(approval.maximumChargeAtomic.name, "maximum_charge_atomic");
  assert.equal(approval.ownerDecision.name, "owner_decision");
  assert.equal(approval.consumptionReference.name, "consumption_reference");
});
