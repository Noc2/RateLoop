import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./dsaNamedReferencePanel.ts", import.meta.url), "utf8");

test("named-panel outcomes are derived from exact stored response choices", () => {
  assert.match(source, /referenceOutcomeForStoredAssuranceChoice/u);
  assert.match(source, /assuranceReviewerKey/u);
  assert.match(source, /reviewer_key=ANY\(\$3::text\[\]\)/u);
  assert.match(source, /validity='valid'/u);
  assert.match(source, /responseEvidenceRoot/u);
  assert.match(source, /adjudicationEvidenceDigest/u);
});

test("the blinded public response contract is translated to the frozen assurance polarity", () => {
  assert.match(source, /referenceOutcomeForNamedPanelPolicyChoice/u);
  assert.match(source, /candidate_artifact_id/u);
  assert.match(source, /baseline_artifact_id/u);
  assert.match(source, /submitAssuranceResponses/u);
  assert.match(source, /displayedOption/u);
  assert.match(source, /accessedAt > submittedAt/u);
  assert.match(source, /access_order_invalid/u);
  assert.match(source, /if \(!lookup\) return null/u);
  assert.match(source, /lookup\.has_exact_access !== true/u);
  assert.match(source, /dsa_named_panel_access_required/u);
  assert.doesNotMatch(source, /withheld_snapshot_json/u);
});

test("registered DSA assignments cannot fall through generic task or response paths", () => {
  assert.match(source, /hasPendingNamedPanelRegistration/u);
  assert.equal((source.match(/dsa_named_panel_acceptance_required/gu) ?? []).length, 2);
  assert.match(source, /Register the DSA named-panel unit before any reviewer assignment or response exists/u);
  assert.match(source, /idempotent: true/u);
});

test("disagreement requires an independent qualified adjudicator", () => {
  assert.match(source, /A panel reviewer cannot adjudicate their own disagreement/u);
  assert.match(source, /dsa-policy-category:/u);
  assert.match(source, /responses\.rowCount \?\? 0/u);
  assert.match(source, /An independent adjudication is required for reviewer disagreement/u);
  assert.match(source, /language:.*:reading:cefr/u);
  assert.match(source, /cleared adjudicator conflict declaration is required/u);
  assert.match(source, /languageEvidenceJson/u);
  assert.match(source, /conflictJson/u);
});

test("database transaction time freezes evidence", () => {
  assert.match(source, /SELECT transaction_timestamp\(\) AS now/u);
  assert.match(source, /BEGIN ISOLATION LEVEL SERIALIZABLE/u);
  assert.equal((source.match(/databaseNow\(client\)/gu) ?? []).length >= 5, true);
});
