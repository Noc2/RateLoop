import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0077_assurance_automated_eval_receipts.sql", import.meta.url),
  "utf8",
);

test("0077 stores tenant-scoped automated receipts without creating an automated human verdict", () => {
  assert.match(migration, /CREATE TABLE "tokenless_assurance_automated_eval_receipts"/u);
  assert.match(migration, /FOREIGN KEY \("workspace_id", "agent_id", "agent_version_id"\)/u);
  assert.match(migration, /"automated_outcome" IN \('pass', 'fail', 'uncertain'\)/u);
  assert.doesNotMatch(migration, /human_verdict|reviewer_verdict/iu);
  assert.match(migration, /UNIQUE \("workspace_id", "idempotency_key_hash"\)/u);
  assert.match(migration, /"content_commitment" ~ '\^sha256:/u);
  assert.doesNotMatch(migration, /"(?:prompt|response|rationale|email|wallet)[^"]*"/iu);
});

test("0077 maps only uncertainty into an append-only human-review escalation", () => {
  assert.match(migration, /CREATE TABLE "tokenless_assurance_automated_eval_escalations"/u);
  assert.match(migration, /"trigger_kind" = 'guardrail_uncertain'/u);
  assert.match(migration, /"state" = 'human_review_required'/u);
  assert.match(migration, /REFERENCES "tokenless_agent_review_opportunity_lifecycles"/u);
  assert.match(migration, /automated-eval receipts and escalations are append-only/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE/u);
});
