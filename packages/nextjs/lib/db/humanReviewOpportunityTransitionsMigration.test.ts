import { getTableColumns } from "drizzle-orm";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DataType, newDb } from "pg-mem";
import { tokenlessAgentReviewOpportunityTransitionEvents } from "~~/lib/db/schema";

const migration = readFileSync(
  join(process.cwd(), "drizzle", "0060_human_review_opportunity_transition_events.sql"),
  "utf8",
);
const journal = JSON.parse(readFileSync(join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

function migratedDatabase() {
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
      PRIMARY KEY (workspace_id, opportunity_id)
    );
    INSERT INTO tokenless_agent_review_opportunity_lifecycles
      (workspace_id, opportunity_id) VALUES ('workspace_a', 'opportunity_a');
  `);
  for (const statement of migration.split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (!sql || /^CREATE OR REPLACE FUNCTION/u.test(sql) || /^CREATE TRIGGER/u.test(sql)) continue;
    database.public.none(sql.replaceAll(" USING btree", ""));
  }
  return database;
}

function validInsert(overrides: Record<string, string | number> = {}) {
  const values = {
    event_id: "hrtr_event_a",
    workspace_id: "workspace_a",
    opportunity_id: "opportunity_a",
    transition_key: "evaluate:request-ready",
    from_state: "evaluating",
    to_state: "request_ready",
    from_revision: 1,
    to_revision: 2,
    reason_codes_json: '["sampled"]',
    actor_kind: "service",
    actor_reference: "adaptive-review-evaluator",
    details_json: "{}",
    transition_commitment: `sha256:${"a".repeat(64)}`,
    occurred_at: "2026-07-16T11:00:00Z",
    ...overrides,
  };
  const columns = Object.keys(values);
  const encoded = columns.map(column => {
    const value = values[column as keyof typeof values];
    return typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
  });
  return `INSERT INTO tokenless_agent_review_opportunity_transition_events (${columns.join(", ")})
          VALUES (${encoded.join(", ")})`;
}

test("0060 journals a lane-neutral append-only opportunity transition log", () => {
  assert.deepEqual(
    journal.entries.find(entry => entry.tag === "0060_human_review_opportunity_transition_events"),
    {
      idx: 60,
      version: "7",
      when: 1784156400000,
      tag: "0060_human_review_opportunity_transition_events",
      breakpoints: true,
    },
  );
  assert.match(migration, /CREATE TABLE "tokenless_agent_review_opportunity_transition_events"/);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "opportunity_id"\)[\s\S]*REFERENCES "tokenless_agent_review_opportunity_lifecycles"/,
  );
  assert.match(migration, /UNIQUE \("workspace_id", "opportunity_id", "transition_key"\)/);
  assert.match(migration, /UNIQUE \("workspace_id", "opportunity_id", "to_revision"\)/);
  assert.match(migration, /BEFORE UPDATE OR DELETE/);
  assert.match(migration, /append-only/);
  assert.doesNotMatch(migration, /public_paid_network|private_invited|hybrid_public_safe/);
});

test("0060 enforces the normative graph and monotonic revisions", () => {
  const database = migratedDatabase();
  database.public.none(validInsert());
  assert.throws(() => database.public.none(validInsert({ event_id: "hrtr_duplicate_key" })));
  assert.throws(() =>
    database.public.none(
      validInsert({
        event_id: "hrtr_duplicate_revision",
        transition_key: "evaluate:blocked",
        to_state: "blocked",
      }),
    ),
  );

  const invalidEdge = migratedDatabase();
  assert.throws(() =>
    invalidEdge.public.none(
      validInsert({
        event_id: "hrtr_invalid_edge",
        transition_key: "ready:completed",
        from_state: "request_ready",
        to_state: "completed",
      }),
    ),
  );
  assert.throws(() =>
    migratedDatabase().public.none(
      validInsert({ event_id: "hrtr_invalid_revision", from_revision: 3, to_revision: 7 }),
    ),
  );
});

test("0060 schema exports every immutable transition field", () => {
  assert.deepEqual(Object.keys(getTableColumns(tokenlessAgentReviewOpportunityTransitionEvents)), [
    "eventId",
    "workspaceId",
    "opportunityId",
    "transitionKey",
    "fromState",
    "toState",
    "fromRevision",
    "toRevision",
    "reasonCodesJson",
    "actorKind",
    "actorReference",
    "detailsJson",
    "transitionCommitment",
    "occurredAt",
  ]);
});
