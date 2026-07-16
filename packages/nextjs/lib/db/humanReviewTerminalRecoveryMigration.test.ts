import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { HUMAN_REVIEW_OPPORTUNITY_TRANSITIONS } from "~~/lib/tokenless/humanReviewOpportunityLifecycle";

const migration = readFileSync(join(process.cwd(), "drizzle", "0064_human_review_terminal_recovery.sql"), "utf8");

test("0064 persists bounded recovery state and an append-only idempotent audit trail", () => {
  assert.match(migration, /CREATE TABLE "tokenless_agent_review_opportunity_recovery_states"/u);
  assert.match(migration, /"maximum_failures" integer NOT NULL DEFAULT 3/u);
  assert.match(migration, /"maximum_failures" = 3/u);
  assert.match(migration, /"failure_count" BETWEEN 0 AND "maximum_failures"/u);
  assert.match(migration, /CREATE TABLE "tokenless_agent_review_opportunity_recovery_events"/u);
  assert.match(migration, /UNIQUE \("workspace_id", "opportunity_id", "transition_key"\)/u);
  assert.match(migration, /"request_commitment" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE/u);
  assert.match(migration, /human-review recovery events are append-only/u);
});

test("0064 database edges match the recoverable TypeScript graph", () => {
  assert.match(migration, /"from_state" = 'pending'[\s\S]*'blocked'[\s\S]*'failed_terminal'/u);
  const pendingEdge = migration.match(/"from_state" = 'pending'[\s\S]*?\)\)/u)?.[0] ?? "";
  assert.doesNotMatch(pendingEdge, /cancelled_before_commit/u);
  for (const state of HUMAN_REVIEW_OPPORTUNITY_TRANSITIONS.blocked) {
    assert.match(
      migration,
      new RegExp(`"from_state" = 'blocked'[\\s\\S]*'${state}'`, "u"),
      `blocked -> ${state} must be enforced by the database`,
    );
  }
  assert.doesNotMatch(migration, /"from_state" = 'completed'/u);
  assert.doesNotMatch(migration, /"from_state" = 'inconclusive'/u);
  assert.doesNotMatch(migration, /"from_state" = 'failed_terminal'/u);
  assert.doesNotMatch(migration, /"from_state" = 'cancelled_before_commit'/u);
});

test("0064 enumerates every operational terminal signal and preserves exact revisions", () => {
  for (const signal of [
    "response_deadline_elapsed",
    "all_assignments_expired",
    "owner_policy_disabled",
    "adapter_failure",
    "infrastructure_failure",
  ]) {
    assert.match(migration, new RegExp(`'${signal}'`, "u"));
  }
  assert.match(migration, /"to_revision" IN \("from_revision", "from_revision" \+ 1\)/u);
  assert.match(migration, /"from_state" = "to_state" AND "to_revision" = "from_revision"/u);
  assert.match(
    migration,
    /"action" <> 'cancelled_before_commit'[\s\S]*"from_state" IN \('approval_required', 'request_ready', 'blocked'\)/u,
  );
});
