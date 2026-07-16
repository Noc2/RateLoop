import { getTableColumns } from "drizzle-orm";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { tokenlessAgentReviewRequestProfiles } from "~~/lib/db/schema";

const migration = readFileSync(join(process.cwd(), "drizzle", "0058_human_review_binding_backfill.sql"), "utf8");

test("0058 permits incomplete timing only for action-required profiles", () => {
  assert.match(migration, /DROP CONSTRAINT "tokenless_agent_review_request_profiles_criterion_check"/);
  assert.match(migration, /char_length\("criterion"\) BETWEEN 1 AND 500/);
  assert.match(migration, /ALTER COLUMN "response_window_seconds" DROP NOT NULL/);
  assert.match(migration, /ALTER COLUMN "panel_size" DROP NOT NULL/);
  assert.match(migration, /"response_window_seconds" IS NULL AND "configuration_status" = 'action_required'/);
  assert.match(migration, /OR "response_window_seconds" BETWEEN 1200 AND 86400/);
  assert.match(migration, /"panel_size" IS NULL AND "configuration_status" = 'action_required'/);
  assert.match(migration, /OR "panel_size" BETWEEN 1 AND 100/);

  const profile = getTableColumns(tokenlessAgentReviewRequestProfiles);
  assert.equal(profile.responseWindowSeconds.notNull, false);
  assert.equal(profile.panelSize.notNull, false);
});

test("0058 derives deterministic profiles from exact policy and private-group provenance", () => {
  assert.match(migration, /->> 'reviewerSource' IS NULL/);
  assert.match(migration, /NOT IN \('private_invited', 'public_network', 'hybrid'\)/);
  assert.match(migration, /left_policy\."enabled" = true AND left_policy\."superseded_at" IS NULL/);
  assert.match(migration, /right_policy\."enabled" = true AND right_policy\."superseded_at" IS NULL/);

  assert.match(migration, /g\."group_id" = p\."audience_json" -> 'group' ->> 'groupId'/);
  assert.match(migration, /gp\."version"::text = p\."audience_json" -> 'group' ->> 'policyVersion'/);
  assert.match(migration, /gp\."policy_hash" = p\."audience_json" -> 'group' ->> 'policyHash'/);
  assert.match(migration, /s\."review_policy_id" = p\."policy_id"/);
  assert.match(migration, /s\."review_policy_version" = p\."version"/);
  assert.match(migration, /g\."status" = 'active'/);
  assert.match(migration, /gp\."version" = g\."current_policy_version"/);

  assert.match(migration, /p\."reviewer_source" = 'private_invited' AND g\."group_id" IS NOT NULL THEN 1800 ELSE NULL/);
  assert.match(migration, /p\."reviewer_source" = 'private_invited' AND g\."group_id" IS NOT NULL THEN 1 ELSE NULL/);
  assert.match(migration, /p\."reviewer_source" = 'private_invited' THEN 'unpaid' ELSE 'usdc'/);
  assert.match(migration, /p\."reviewer_source" = 'private_invited' AND g\."group_id" IS NOT NULL THEN 'ready'/);
  assert.match(migration, /ELSE 'action_required'/);
  assert.match(migration, /"bountyPerSeatAtomic":null/);

  assert.match(
    migration,
    /'sha256:' \|\| encode\(digest\(convert_to\(d\."profile_document", 'UTF8'\), 'sha256'\), 'hex'\)/,
  );
  assert.match(
    migration,
    /'rrp_' \|\| substr\(encode\(digest\(convert_to\(i\."workspace_id" \|\| '\|' \|\| i\."profile_hash"/,
  );
  assert.match(migration, /'hrb_' \|\| substr\(encode\(digest\(convert_to\(/);
  assert.match(migration, /ON CONFLICT DO NOTHING/);
  assert.doesNotMatch(migration, /sha256:0{64}/);
  assert.doesNotMatch(migration, /sentinel/i);
});

test("0058 binds existing integrations and evaluator records to exact immutable provenance", () => {
  for (const table of [
    "tokenless_agent_integrations",
    "tokenless_workspace_agent_setups",
    "tokenless_agent_evaluation_scopes",
    "tokenless_agent_review_opportunities",
  ]) {
    assert.match(migration, new RegExp(`UPDATE "${table}"`));
  }
  assert.match(
    migration,
    /m\."selection_policy_id" = i\."review_policy_id"[\s\S]*m\."selection_policy_version" = i\."review_policy_version"/,
  );
  assert.match(
    migration,
    /m\."selection_policy_id" = s\."policy_id"[\s\S]*m\."selection_policy_version" = s\."policy_version"/,
  );
  assert.match(
    migration,
    /m\."selection_policy_id" = o\."policy_id"[\s\S]*m\."selection_policy_version" = o\."policy_version"/,
  );
  assert.match(migration, /SELECT 1 FROM "tokenless_agent_integrations"[\s\S]*"human_review_binding_id" IS NULL/);
  assert.match(migration, /SELECT 1 FROM "tokenless_agent_evaluation_scopes"[\s\S]*"request_profile_hash" IS NULL/);
  assert.match(migration, /SELECT 1 FROM "tokenless_agent_review_opportunities"[\s\S]*"request_profile_hash" IS NULL/);

  const integrationSection = migration.slice(
    migration.indexOf('UPDATE "tokenless_agent_integrations"'),
    migration.indexOf('UPDATE "tokenless_workspace_agent_setups"'),
  );
  assert.doesNotMatch(integrationSection, /ALTER COLUMN .* SET NOT NULL/);
  for (const table of ["tokenless_agent_evaluation_scopes", "tokenless_agent_review_opportunities"]) {
    const notNullSection = migration.slice(migration.indexOf(`ALTER TABLE "${table}"`));
    assert.match(notNullSection, /ALTER COLUMN "human_review_binding_id" SET NOT NULL/);
    assert.match(notNullSection, /ALTER COLUMN "request_profile_hash" SET NOT NULL/);
  }
  assert.match(
    migration,
    /UNIQUE \([\s\S]*"human_review_binding_id", "human_review_binding_version",[\s\S]*"request_profile_id", "request_profile_version", "request_profile_hash"/,
  );
});
