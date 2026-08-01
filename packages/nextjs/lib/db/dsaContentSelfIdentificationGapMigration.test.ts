import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMemoryDatabaseResources, readJournalMigrationFiles } from "~~/lib/db/testing/testMemory";

const migration = readFileSync(
  new URL("../../drizzle/0185_dsa_content_self_identification_gaps.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(new URL("../tokenless/dsaContentSelfIdentification.ts", import.meta.url), "utf8");
const responseRoute = readFileSync(
  new URL("../../app/api/account/assurance/assignments/[assignmentId]/responses/route.ts", import.meta.url),
  "utf8",
);

test("0185 accepts only an authenticated exact-access reviewer report and never a label", () => {
  assert.match(migration, /tokenless_dsa_named_panel_content_self_identification_reports/u);
  assert.match(migration, /gap_reason"='content_self_identification'/u);
  assert.match(migration, /tokenless_dsa_named_panel_artifact_accesses/u);
  assert.match(migration, /assignment\."status"='accepted'/u);
  assert.match(migration, /assignment\."paid_assignment"=false/u);
  assert.match(migration, /report_json" IS NOT JSON OBJECT WITH UNIQUE KEYS/u);
  assert.doesNotMatch(migration, /reference_label[^\n]*content_self_identification/u);
  assert.match(service, /has_exact_access|access\.access_id/u);
  assert.match(service, /responseCount: 0/u);
  assert.match(responseRoute, /dsaGapReport/u);
});

test("0185 narrowly permits no-response completion and closes every remaining exact assignment", () => {
  assert.match(
    migration,
    /expected_count=1 AND bound_count=0 AND self_identification_report_count=1 AND NEW\."paid_assignment"=false/u,
  );
  assert.match(migration, /report_terminal_at_commit/u);
  assert.match(migration, /gap_closes_assignments_at_commit/u);
  assert.match(migration, /tokenless_dsa_named_panel_capacity_releases/u);
  assert.match(migration, /capacity_release_request_guard/u);
  assert.match(migration, /assignment\."status"=NEW\."prior_status"/u);
  assert.match(migration, /capacity_release_at_commit/u);
  assert.match(migration, /must reconcile every reservation counter/u);
  assert.match(migration, /assignment\."status" IN \('reserved','accepted'\)/u);
  assert.match(service, /SET status=\$1,lease_state='expired'/u);
  assert.match(service, /dsa_named_panel_content_self_identification_capacity_conflict/u);
  assert.doesNotMatch(service, /Promise\.all/u);
  const receipt = service.indexOf("INSERT INTO tokenless_dsa_named_panel_capacity_releases");
  const terminalUpdate = service.indexOf("SET status=$1,lease_state='expired'", receipt);
  assert.ok(receipt >= 0 && terminalUpdate > receipt);
  assert.match(migration, /release\."release_reason"='content_self_identification_quarantine'/u);
  assert.match(migration, /report\."report_id"=release\."terminal_evidence_id"/u);
  assert.doesNotMatch(migration, /'content_self_identification_gap'/u);
  assert.doesNotMatch(service, /'content_self_identification_gap'/u);
});

test("0185 rejects paid selections both at migration and every later write boundary", () => {
  assert.match(migration, /0185 refuses existing paid DSA named-panel selections/u);
  assert.match(migration, /WHERE assignment\."paid_assignment"=true/u);
  assert.match(migration, /tokenless_dsa_named_panel_unpaid_selection_guard/u);
  assert.match(migration, /assignment\."paid_assignment"=false/u);
  assert.match(migration, /tokenless_dsa_named_panel_assignment_stays_unpaid_guard/u);
});

test("0185 binds reports, gaps, and terminal outcomes to database time and immediate quarantine", () => {
  assert.match(
    migration,
    /NEW\."reported_at" IS DISTINCT FROM date_trunc\('milliseconds',transaction_timestamp\(\)\)/u,
  );
  assert.match(
    migration,
    /NEW\."declared_at" IS DISTINCT FROM date_trunc\('milliseconds',transaction_timestamp\(\)\)/u,
  );
  assert.match(migration, /gap\."declared_by"=NEW\."frozen_by" AND gap\."declared_at"=NEW\."frozen_at"/u);
  assert.match(migration, /response_binding_open_unit_guard/u);
  assert.match(migration, /access_before_self_identification_guard/u);
});

test("0185 requires auditor confirmation and publishes only the typed gap reason", () => {
  assert.match(service, /access\.role='auditor'/u);
  assert.match(service, /member\.account_address IS NULL/u);
  assert.match(service, /authenticated_reviewer_report_auditor_confirmed/u);
  assert.match(service, /referenceLabel: "uncertain"/u);
  assert.match(service, /agreementState: "gap"/u);
  const gap = service.slice(service.indexOf("const gap = {"));
  assert.doesNotMatch(gap.slice(0, gap.indexOf("const gapJson")), /reviewerPrincipalId/u);
});

test("the journal and structural harness reach 0185", () => {
  const files = readJournalMigrationFiles(new URL("../../drizzle", import.meta.url).pathname);
  assert.ok(files.includes("0185_dsa_content_self_identification_gaps.sql"));
  assert.ok(createMemoryDatabaseResources().pool);
});
