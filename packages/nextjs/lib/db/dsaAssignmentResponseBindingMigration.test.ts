import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMemoryDatabaseResources, readJournalMigrationFiles } from "~~/lib/db/testing/testMemory";

const migration = readFileSync(
  new URL("../../drizzle/0184_dsa_assignment_response_binding.sql", import.meta.url),
  "utf8",
);
const responseService = readFileSync(new URL("../tokenless/assuranceResponses.ts", import.meta.url), "utf8");
const selectionService = readFileSync(new URL("../tokenless/dsaNamedPanelSelections.ts", import.meta.url), "utf8");

test("0184 binds every new named-panel response to its exact immutable assignment in tx1", () => {
  assert.match(migration, /tokenless_dsa_named_panel_assignment_response_bindings/u);
  assert.match(migration, /response_binding_required/u);
  assert.match(migration, /tokenless_assurance_responses_dsa_binding_exact_unique/u);
  assert.match(migration, /response_digest","response_validity","response_choice","response_submitted_at/u);
  assert.match(migration, /response_submitted_at"<="panel_deadline/u);
  assert.match(
    migration,
    /response_binding_required"=true AND "bound_at"="response_submitted_at"[\s\S]*response_binding_required"=false AND "bound_at">="response_submitted_at"/u,
  );
  assert.match(migration, /completed_response_binding_at_commit/u);
  assert.match(migration, /named_panel_new_selection_binding_marker/u);
  assert.match(migration, /NEW\."response_binding_required" IS DISTINCT FROM true/u);
  assert.match(migration, /response_binding_transaction/u);
  assert.match(migration, /NEW\."bound_at" IS DISTINCT FROM date_trunc\('milliseconds',transaction_timestamp\(\)\)/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE/u);
});

test("0184 freezes qualification verification at acceptance while requiring deadline coverage", () => {
  assert.match(migration, /tokenless_dsa_named_panel_qualification_evidence_valid/u);
  assert.match(migration, /evidence_json IS JSON OBJECT WITH UNIQUE KEYS/u);
  assert.match(migration, /jsonb_typeof\(evidence_json::jsonb->'verifiedAt'\)='string'/u);
  assert.match(migration, /\(evidence_json::jsonb->>'verifiedAt'\)::timestamptz<=verified_at_through/u);
  assert.match(migration, /\(evidence_json::jsonb->>'expiresAt'\)::timestamptz>=expires_through/u);
  assert.match(migration, /SELECT COALESCE\(/u);
  assert.match(migration, /AND tokenless_dsa_named_panel_qualification_evidence_valid/u);
});

test("response submission preserves and verifies the binding before assignment completion or replay commit", () => {
  const submit = responseService.slice(responseService.indexOf("export async function submitAssuranceResponses"));
  const responseInsert = submit.indexOf("INSERT INTO tokenless_assurance_responses");
  const bindingWrite = submit.indexOf("await preserveDsaNamedPanelResponseBinding", responseInsert);
  const completion = submit.indexOf("UPDATE tokenless_assurance_assignments SET status = 'completed'");
  assert.ok(responseInsert >= 0 && bindingWrite > responseInsert && completion > bindingWrite);
  assert.match(responseService, /allowInsert: !rowBoolean\(assignment, "dsa_response_binding_required"\)/u);
  assert.match(responseService, /DSA named-panel response binding conflicts with immutable evidence/u);
  assert.match(responseService, /date_trunc\('milliseconds',transaction_timestamp\(\)\) AS response_submitted_at/u);
  assert.match(responseService, /boundAt\?\.getTime\(\) === input\.response\.submittedAt\.getTime\(\)/u);
  assert.match(responseService, /Boolean\(boundAt && boundAt >= input\.response\.submittedAt\)/u);
});

test("new selections require tx1 binding and assignment lookup fails closed on join cardinality", () => {
  assert.match(selectionService, /response_binding_required\)\s+VALUES[\s\S]*,true\)/u);
  assert.match(responseService, /if \(\(assignmentResult\.rowCount \?\? 0\) > 1\)/u);
  const lookup = responseService.slice(
    responseService.indexOf("const assignmentResult"),
    responseService.indexOf("const networkCases"),
  );
  assert.doesNotMatch(lookup, /LIMIT 1/u);
  assert.match(lookup, /named_selection\.run_id=a\.run_id/u);
  assert.match(lookup, /named_selection\.assignment_id=a\.assignment_id/u);
});

test("the journal and in-memory structural harness reach 0184", () => {
  const files = readJournalMigrationFiles(new URL("../../drizzle", import.meta.url).pathname);
  assert.ok(files.includes("0184_dsa_assignment_response_binding.sql"));
  const resources = createMemoryDatabaseResources();
  assert.ok(resources.pool);
});
