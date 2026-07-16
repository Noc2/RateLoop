import { getTableColumns } from "drizzle-orm";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { tokenlessAgentHumanReviewBindingEvents, tokenlessAgentHumanReviewBindings } from "~~/lib/db/schema";

const migration = readFileSync(join(process.cwd(), "drizzle", "0056_agent_human_review_bindings.sql"), "utf8");

test("0056 creates immutable exact-version human-review bindings and audit events", () => {
  assert.match(migration, /CREATE TABLE "tokenless_agent_human_review_bindings"/);
  assert.match(migration, /PRIMARY KEY \("binding_id", "version"\)/);
  assert.match(migration, /UNIQUE \("workspace_id", "canonical_hash"\)/);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "selection_policy_id", "selection_policy_version"\)\s+REFERENCES "tokenless_agent_review_policies" \("workspace_id", "policy_id", "version"\)/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "request_profile_id", "request_profile_version", "request_profile_hash"\)\s+REFERENCES "tokenless_agent_review_request_profiles"\s+\("workspace_id", "profile_id", "version", "profile_hash"\)/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "publishing_policy_id", "publishing_policy_version"\)\s+REFERENCES "tokenless_agent_publishing_policies" \("workspace_id", "policy_id", "version"\)/,
  );
  assert.match(migration, /WHERE "enabled" = true AND "superseded_at" IS NULL/);
  assert.match(migration, /CREATE TABLE "tokenless_agent_human_review_binding_events"/);
  assert.match(migration, /"event_type" IN \('created', 'configuration_changed', 'disabled'\)/);
});

test("0056 freezes authority and fails closed for incomplete autonomous grants", () => {
  assert.match(migration, /"authority" IN \('check_only', 'prepare_for_approval', 'ask_automatically'\)/);
  assert.match(
    migration,
    /"authority" <> 'ask_automatically'\s+OR \("publishing_policy_id" IS NOT NULL AND "publishing_policy_version" >= 1\)/,
  );
  assert.match(migration, /NOT "enabled" OR \("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL\)/);
  assert.match(migration, /"canonical_hash" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/);
});

test("0056 attaches nullable frozen provenance without weakening opportunity idempotency", () => {
  for (const table of [
    "tokenless_agent_integrations",
    "tokenless_workspace_agent_setups",
    "tokenless_agent_evaluation_scopes",
    "tokenless_agent_review_opportunities",
  ]) {
    const section = migration.slice(migration.indexOf(`ALTER TABLE "${table}"`));
    assert.match(section, /"human_review_binding_id" text/);
    assert.match(section, /"human_review_binding_version" integer/);
  }
  assert.match(migration, /ALTER TABLE "tokenless_agent_evaluation_scopes"[\s\S]*"request_profile_hash" text/);
  assert.match(migration, /ALTER TABLE "tokenless_agent_review_opportunities"[\s\S]*"request_profile_hash" text/);
  assert.match(
    migration,
    /"request_profile_id" IS NULL AND "request_profile_version" IS NULL AND "request_profile_hash" IS NULL/,
  );
  assert.doesNotMatch(migration, /ALTER COLUMN "request_profile_hash" SET NOT NULL/);
  assert.doesNotMatch(migration, /sha256:0000000000000000000000000000000000000000000000000000000000000000/);
  assert.doesNotMatch(migration, /DROP CONSTRAINT "tokenless_agent_evaluation_scopes_partition_unique"/);
  assert.doesNotMatch(migration, /DROP CONSTRAINT "tokenless_agent_review_opportunities_external_unique"/);
});

test("Drizzle exposes binding and event provenance fields", () => {
  const binding = getTableColumns(tokenlessAgentHumanReviewBindings);
  assert.equal(binding.bindingId.name, "binding_id");
  assert.equal(binding.selectionPolicyVersion.name, "selection_policy_version");
  assert.equal(binding.requestProfileHash.name, "request_profile_hash");
  assert.equal(binding.publishingPolicyVersion.name, "publishing_policy_version");
  assert.equal(binding.authority.name, "authority");
  assert.equal(binding.canonicalHash.name, "canonical_hash");
  assert.equal(binding.approvedAt.name, "approved_at");
  assert.equal(binding.supersededAt.name, "superseded_at");

  const event = getTableColumns(tokenlessAgentHumanReviewBindingEvents);
  assert.equal(event.bindingVersion.name, "binding_version");
  assert.equal(event.detailsJson.name, "details_json");
  assert.equal(event.eventHash.name, "event_hash");
});
