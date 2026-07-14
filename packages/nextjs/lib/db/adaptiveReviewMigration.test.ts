import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(join(process.cwd(), "drizzle", "0031_adaptive_review_evidence.sql"), "utf8");

test("adaptive evidence migration records every decision and immutable agent-version provenance", () => {
  for (const table of [
    "tokenless_agent_review_policies",
    "tokenless_agent_evaluation_scopes",
    "tokenless_agent_review_opportunities",
    "tokenless_agent_evaluation_observations",
    "tokenless_agent_evaluation_rollups",
    "tokenless_agent_review_policy_events",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }
  assert.match(migration, /"agent_version_id" text NOT NULL/);
  assert.match(migration, /"external_opportunity_id" text NOT NULL/);
  assert.match(migration, /"selection_probability_bps" integer NOT NULL/);
  assert.match(migration, /"suggestion_commitment" text NOT NULL/);
  assert.match(migration, /"suggestion_ciphertext" text/);
  assert.match(migration, /"suggestion_key_ref" text/);
  assert.doesNotMatch(migration, /"suggestion_json"/);
});

test("adaptive observations remain rebuildable from source evidence and preserve uncertainty inputs", () => {
  assert.match(migration, /"evidence_reference" text NOT NULL/);
  assert.match(migration, /"source_payload_hash" text NOT NULL/);
  assert.match(migration, /"agreement" IN \('agree', 'disagree', 'abstain', 'inconclusive'\)/);
  assert.match(migration, /"human_human_agreement_bps" integer/);
  assert.match(migration, /"agreement_lower_95_bps" integer/);
  assert.match(migration, /UNIQUE \("opportunity_id"\)/);
});
