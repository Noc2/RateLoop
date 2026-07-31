import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("0166 defaults to aggregate-only and makes reviewer analytics governance append-only and fail-closed", () => {
  const migration = readFileSync(join(process.cwd(), "drizzle", "0166_employment_data_governance.sql"), "utf8");

  assert.match(migration, /"processing_mode" text NOT NULL DEFAULT 'aggregate_only'/u);
  assert.match(migration, /"processing_mode" IN \('aggregate_only', 'reviewer_analytics'\)/u);
  assert.match(migration, /"dpia_status" IN \('not_started', 'not_required', 'completed', 'blocked'\)/u);
  assert.match(migration, /"works_council_status" IN \('not_applicable', 'agreement_recorded', 'blocked'\)/u);
  for (const gate of [
    "controller_role",
    "processor_role",
    "lawful_basis_record_reference",
    "necessity_record_reference",
    "worker_notice_reference",
    "retention_policy_reference",
    "access_policy_reference",
    "dpia_reference",
    "data_subject_process_reference",
    "works_council_reference",
    "reviewer_analytics_activated_at",
    "reviewer_analytics_activated_by",
  ]) {
    assert.match(migration, new RegExp(`"${gate}" IS NOT NULL`, "u"));
  }
  assert.match(migration, /"dpia_status" IN \('not_required', 'completed'\)/u);
  assert.match(migration, /"works_council_status" IN \('not_applicable', 'agreement_recorded'\)/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE/u);
  assert.match(migration, /employment data governance versions are append-only/u);
  assert.match(migration, /NOT EXISTS \(\s*SELECT 1 FROM tokenless_workspaces/u);
  assert.match(migration, /SELECT "workspace_id", 1, 'aggregate_only', 'not_started', 'blocked'/u);
});
