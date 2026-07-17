import { getTableColumns } from "drizzle-orm";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { tokenlessAgentReviewOpportunityQuestions, tokenlessAgentReviewRequestProfiles } from "~~/lib/db/schema";

const migration = readFileSync(
  new URL("../../drizzle/0099_agent_per_request_review_questions.sql", import.meta.url),
  "utf8",
);
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("0099 preserves existing profiles as fixed assurance without rewriting their hashes", () => {
  assert.match(migration, /SET "question_authority" = 'owner_fixed',\s+"result_semantics" = 'assurance'/u);
  assert.doesNotMatch(migration, /SET\s+"profile_hash"/u);
  assert.doesNotMatch(migration, /UPDATE\s+"tokenless_agent_human_review_bindings"/u);
  assert.equal(journal.entries.find(entry => entry.idx === 99)?.tag, "0099_agent_per_request_review_questions");
});

test("0099 stores a true discriminated question policy instead of placeholder fixed text", () => {
  assert.match(migration, /ALTER COLUMN "criterion" DROP NOT NULL/u);
  assert.match(migration, /ALTER COLUMN "positive_label" DROP NOT NULL/u);
  assert.match(migration, /ALTER COLUMN "negative_label" DROP NOT NULL/u);
  assert.match(migration, /"question_authority" = 'owner_fixed'[\s\S]*"result_semantics" = 'assurance'/u);
  assert.match(migration, /"question_authority" = 'agent_per_request'[\s\S]*"result_semantics" = 'feedback'/u);
  assert.match(
    migration,
    /"question_authority" = 'agent_per_request'[\s\S]*"criterion" IS NULL[\s\S]*"positive_label" IS NULL[\s\S]*"negative_label" IS NULL/u,
  );
  assert.match(migration, /lower\("positive_label"\) <> lower\("negative_label"\)/u);

  const columns = getTableColumns(tokenlessAgentReviewRequestProfiles);
  assert.equal(columns.questionAuthority.name, "question_authority");
  assert.equal(columns.resultSemantics.name, "result_semantics");
  assert.equal(columns.criterion.notNull, false);
  assert.equal(columns.positiveLabel.notNull, false);
  assert.equal(columns.negativeLabel.notNull, false);
});

test("0099 freezes each agent-authored question once with public/private storage separation", () => {
  assert.match(migration, /CREATE TABLE "tokenless_agent_review_opportunity_questions"/u);
  assert.match(migration, /PRIMARY KEY \("workspace_id", "opportunity_id"\)/u);
  assert.match(migration, /REFERENCES "tokenless_agent_review_opportunities" \("workspace_id", "opportunity_id"\)/u);
  assert.match(migration, /"schema_version" = 'rateloop\.binary-review-question\.v1'/u);
  assert.match(migration, /"question_hash" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/u);
  assert.match(
    migration,
    /"content_boundary" = 'public_or_test'[\s\S]*"question_json" IS NOT NULL[\s\S]*"question_ciphertext" IS NULL/u,
  );
  assert.match(
    migration,
    /"content_boundary" = 'private_workspace'[\s\S]*"question_json" IS NULL[\s\S]*"question_ciphertext" IS NOT NULL[\s\S]*"question_key_ref" IS NOT NULL/u,
  );
  assert.match(migration, /BEFORE UPDATE OR DELETE/u);
  assert.match(migration, /questions are append-only/u);

  const columns = getTableColumns(tokenlessAgentReviewOpportunityQuestions);
  assert.equal(columns.opportunityId.name, "opportunity_id");
  assert.equal(columns.questionHash.name, "question_hash");
  assert.equal(columns.questionJson.notNull, false);
  assert.equal(columns.questionCiphertext.notNull, false);
  assert.equal(columns.submittedByIntegrationId.name, "submitted_by_integration_id");
});
