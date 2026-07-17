import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0100_workspace_expertise_definitions.sql", import.meta.url),
  "utf8",
);
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("workspace expertise definitions are immutable, versioned, and exactly referenced", () => {
  assert.match(migration, /CREATE TABLE "tokenless_reviewer_expertise_definitions"/u);
  assert.match(migration, /PRIMARY KEY \("definition_id", "version"\)/u);
  assert.match(migration, /UNIQUE \("definition_id", "version", "definition_hash"\)/u);
  assert.match(migration, /"scope" = 'global'.*"workspace_id" IS NULL/su);
  assert.match(migration, /"scope" = 'workspace'.*"workspace_id" IS NOT NULL.*"network_eligible" = false/su);
  assert.match(migration, /WHERE "superseded_at" IS NULL/u);
  assert.match(migration, /expertise definition versions may only be superseded once/u);
  assert.match(
    migration,
    /FOREIGN KEY \("expertise_definition_id", "expertise_definition_version", "expertise_definition_hash"\)/u,
  );
});

test("the six existing expertise keys are seeded as global definition versions", () => {
  for (const slug of [
    "code-review:typescript",
    "code-review:security",
    "finance:broker-dealer-supervision",
    "finance:investment-advisory",
    "legal:privacy-compliance",
    "operations:customer-support",
  ]) {
    assert.ok(migration.includes(`'${slug}'`));
  }
  assert.equal((migration.match(/'system:expertise-catalog'/gu) ?? []).length, 6);
});

test("v1 expertise inputs remain immutable while v2 profiles and exact grants are additive", () => {
  assert.match(migration, /ADD COLUMN "semantic_schema_version" integer DEFAULT 1 NOT NULL/u);
  assert.match(migration, /ADD COLUMN "expertise_requirements_json" text DEFAULT '\[\]' NOT NULL/u);
  assert.match(migration, /"semantic_schema_version" IN \(1, 2, 3\)/u);
  assert.match(migration, /"semantic_schema_version" IN \(1, 2\) AND "expertise_requirements_json" = '\[\]'/u);
  assert.match(migration, /"semantic_schema_version" = 3 AND "required_expertise_keys_json" = '\[\]'/u);
  assert.match(migration, /SET "expertise_record_schema_version" = 1\s+WHERE "qualification_kind" = 'expertise'/u);
  assert.doesNotMatch(migration, /UPDATE "tokenless_agent_review_request_profiles"/u);
  assert.doesNotMatch(migration, /DELETE FROM "tokenless_reviewer_qualifications"/u);
  assert.doesNotMatch(migration, /DROP COLUMN .*required_expertise_keys_json/su);
});

test("expertise-bearing invitations are pending, bound, single-redemption attestations", () => {
  assert.match(migration, /CREATE TABLE "tokenless_private_group_invitation_expertise_attestations"/u);
  assert.match(migration, /"status" = 'pending'.*"status" = 'materialized'.*"status" = 'revoked'/su);
  assert.match(migration, /"maximum_redemptions" <> 1/u);
  assert.match(
    migration,
    /invitation_record\."intended_account_address" IS NULL AND invitation_record\."intended_email_hash" IS NULL/u,
  );
  assert.match(migration, /invitation_record\."redemption_count" <> 0/u);
  assert.match(migration, /tokenless_private_group_invitations_expertise_binding_guard/u);
  assert.match(migration, /invited expertise must remain bound to the redeemed active membership/u);
  assert.match(migration, /workspace expertise must remain an owner-attested invited-reviewer qualification/u);
  assert.match(migration, /network expertise must use a platform-verified global definition/u);
});

test("workspace expertise migration follows the per-request question migration", () => {
  assert.equal(journal.entries.find(entry => entry.idx === 100)?.tag, "0100_workspace_expertise_definitions");
  assert.equal(journal.entries.at(-1)?.idx, 100);
});
