import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0063_human_review_result_observations.sql", import.meta.url),
  "utf8",
);

test("result observations bind one immutable terminal envelope to exact frozen references", () => {
  assert.match(migration, /tokenless_agent_human_review_result_observations/u);
  assert.match(migration, /UNIQUE \("workspace_id", "opportunity_id"\)/u);
  assert.match(migration, /UNIQUE \("workspace_id", "opportunity_id", "integration_id"\)/u);
  assert.match(migration, /"result_envelope_commitment" text NOT NULL/u);
  assert.match(migration, /"result_commitment" text NOT NULL/u);
  assert.match(migration, /"selection_policy_hash" text NOT NULL/u);
  assert.match(migration, /"human_review_binding_hash" text NOT NULL/u);
  assert.match(migration, /"request_profile_hash" text NOT NULL/u);
  assert.match(migration, /"terminal_evidence_commitment" text/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE/u);
  assert.match(migration, /append-only/u);
});

test("only verdict-bearing terminal outcomes append adaptive observations", () => {
  assert.match(migration, /"outcome" IN \('positive', 'negative'\)[\s\S]*"calibration_comparable" = true/u);
  assert.match(migration, /"outcome" = 'inconclusive'[\s\S]*"calibration_comparable" = false/u);
  assert.match(migration, /"outcome" IN \('failed', 'cancelled'\)[\s\S]*"adaptive_observation_id" IS NULL/u);
});

test("result observation storage has no plaintext or private identity fields", () => {
  assert.doesNotMatch(migration, /source_(?:body|bytes|json|text)|suggestion_(?:body|bytes|json|text)/iu);
  assert.doesNotMatch(migration, /rationale_(?:body|json|text)|reviewer_(?:identity|address|email)/iu);
  assert.doesNotMatch(migration, /payout_(?:destination|address)|feedback_(?:body|json|text)/iu);
});
