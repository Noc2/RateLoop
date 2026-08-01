import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PoolClient } from "pg";
import {
  __dsaNamedPanelQualificationTestUtils,
  loadDsaNamedPanelLabelInputs,
} from "~~/lib/tokenless/dsaNamedReferencePanel";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const source = readFileSync(new URL("./dsaNamedReferencePanel.ts", import.meta.url), "utf8");
const audienceAssignmentsSource = readFileSync(new URL("./audienceAssignments.ts", import.meta.url), "utf8");
const reviewerAssignmentsSource = readFileSync(new URL("./reviewerAssignments.ts", import.meta.url), "utf8");
const acceptanceRouteSource = readFileSync(
  new URL("../../app/api/account/assurance/assignments/[assignmentId]/dsa-reference-panel/route.ts", import.meta.url),
  "utf8",
);
const artifactRouteSource = readFileSync(
  new URL(
    "../../app/api/account/assurance/assignments/[assignmentId]/artifacts/[artifactId]/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const managementRouteSource = readFileSync(
  new URL("../../app/api/account/workspaces/[workspaceId]/compliance/dsa/reference-panel/route.ts", import.meta.url),
  "utf8",
);

test("named-panel outcomes are derived from exact stored response choices", () => {
  const freeze = source.slice(source.indexOf("export async function freezeDsaNamedPanelOutcome"));
  assert.match(source, /referenceOutcomeForStoredAssuranceChoice/u);
  assert.match(source, /assuranceReviewerKey/u);
  assert.match(source, /reviewer_key=ANY\(\$3::text\[\]\)/u);
  assert.match(source, /validity='valid'/u);
  assert.match(source, /responseEvidenceRoot/u);
  assert.match(source, /adjudicationEvidenceDigest/u);
  assert.match(freeze, /agreementState,\s+adjudicationId,\s+gapEvidenceId: null,\s+responseEvidenceRoot/u);
  assert.doesNotMatch(freeze, /assuranceReviewerKey|getAssuranceResponseKeyrings/u);
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

test("each named response safely materializes replayable evidence before adjudicator discovery", () => {
  const submission = source.slice(
    source.indexOf("export async function submitDsaNamedPanelResponseIfExists"),
    source.indexOf("async function materializeResponses"),
  );
  const submitAt = submission.indexOf("await submitAssuranceResponses");
  const unitLockAt = submission.lastIndexOf("tokenless_dsa_named_panel_units");
  const materializeAt = submission.indexOf("await materializeResponses");
  assert.ok(submitAt >= 0 && unitLockAt > submitAt && materializeAt > unitLockAt);
  assert.match(submission, /FOR UPDATE/u);
  assert.match(submission, /allowIncomplete: true/u);
  const materialization = source.slice(
    source.indexOf("async function materializeResponses"),
    source.indexOf("export async function reconcileDsaNamedPanelResponseEvidenceForPrincipal"),
  );
  assert.match(materialization, /tokenless_dsa_named_panel_assignment_response_bindings/u);
  assert.match(materialization, /response_binding_required !== true/u);
  assert.doesNotMatch(materialization, /assertDsaNamedPanelPrincipalEligible/u);
  assert.match(materialization, /legacyKeyrings \?\?= getAssuranceResponseKeyrings/u);
  assert.ok(
    materialization.indexOf("tokenless_dsa_named_panel_assignment_response_bindings") <
      materialization.indexOf("legacyKeyrings ??= getAssuranceResponseKeyrings"),
  );
  assert.match(materialization, /submittedAt > instant\(row, "panel_deadline"\)/u);
  assert.match(materialization, /Stored named-panel response evidence conflicts/u);
});

test("reconciliation isolates units, skips locks, and permits only managers or the exact auditor role", () => {
  const reconciliation = source.slice(
    source.indexOf("export async function reconcileDsaNamedPanelResponseEvidenceForPrincipal"),
    source.indexOf("async function requireAssignedDsaNamedPanelAdjudicator"),
  );
  assert.match(reconciliation, /for \(let attempt = 0; attempt < 128; attempt \+= 1\)/u);
  assert.match(reconciliation, /LIMIT 1 FOR UPDATE OF unit SKIP LOCKED/u);
  assert.match(reconciliation, /member\.role IN \('owner','admin'\)/u);
  assert.match(reconciliation, /access\.role='auditor'/u);
  assert.doesNotMatch(reconciliation, /potential_adjudicator/u);
  assert.doesNotMatch(reconciliation, /tokenless_assurance_cohort_reviewers/u);
  assert.match(reconciliation, /tokenless_dsa_named_panel_assignment_response_bindings/u);
  assert.match(reconciliation, /materializedResponseCount/u);
  assert.match(reconciliation, /failedUnitCount/u);
  assert.match(reconciliation, /if \(!candidateRef\.current\) throw error/u);
  assert.match(reconciliation, /tokenless_dsa_named_panel_materialization_retries/u);
  assert.match(reconciliation, /ORDER BY COALESCE\(retry\.failure_count,0\)[\s\S]*encode\(convert_to\(unit\.epoch_id/u);
  assert.match(reconciliation, /retry\.next_retry_at<=transaction_timestamp\(\)/u);
  assert.match(reconciliation, /response_evidence_materialization_failed/u);
  assert.match(reconciliation, /dsaNamedPanelMaterializationFailureState/u);
  assert.match(reconciliation, /cooldownUnitCount/u);
  assert.doesNotMatch(reconciliation, /error\.message|String\(error\)|failure_detail|stack/iu);
});

test("the explicit adjudicator assignment authenticates and qualifies its exact principal before recovery materialization", () => {
  const assignment = source.slice(
    source.indexOf("export async function assignDsaNamedPanelAdjudicator"),
    source.indexOf("export async function issueDsaNamedPanelAdjudicationArtifactLease"),
  );
  const eligibilityAt = assignment.indexOf("await assertDsaNamedPanelPrincipalEligible");
  const panelConflictAt = assignment.indexOf("A panel reviewer cannot be assigned to adjudicate");
  const qualificationAt = assignment.indexOf("await loadQualifiedAdjudicatorEvidence");
  const materializationAt = assignment.indexOf("await materializeResponses");
  assert.ok(
    eligibilityAt >= 0 &&
      panelConflictAt > eligibilityAt &&
      qualificationAt > panelConflictAt &&
      materializationAt > qualificationAt,
  );
});

test("registered DSA assignments cannot fall through generic task or response paths", () => {
  assert.match(source, /hasPendingNamedPanelRegistration/u);
  assert.equal((source.match(/dsa_named_panel_acceptance_required/gu) ?? []).length, 2);
  assert.match(source, /Register the DSA named-panel unit before any reviewer assignment or response exists/u);
  assert.match(source, /idempotent: true/u);
});

test("disagreement requires a qualified non-panel adjudicator", () => {
  assert.match(source, /A panel reviewer cannot be assigned to adjudicate their own disagreement/u);
  assert.match(source, /dsa-policy-category:/u);
  assert.match(source, /responses\.rowCount \?\? 0/u);
  assert.match(source, /A role-separated adjudication is required for reviewer disagreement/u);
  assert.match(source, /language:.*:reading:cefr/u);
  assert.match(source, /cleared adjudicator conflict declaration is required/u);
  assert.match(source, /languageEvidenceJson/u);
  assert.match(source, /conflictJson/u);
});

test("frozen label inputs replay the persisted adjudicator binding across key rotation", async () => {
  const previous = process.env.TOKENLESS_EVIDENCE_TENANT_COMMITMENT_KEY;
  const persistedBinding = `hmac-sha256:v1:${"b".repeat(64)}`;
  try {
    const load = async () => {
      let query = 0;
      const client = {
        async query() {
          query += 1;
          if (query === 1) return { rows: [{ unit_count: "1" }], rowCount: 1 };
          return {
            rows: [
              {
                unit_id: "rsu_abcdefghijklmnopqrstuv",
                reference_label: "uncertain",
                agreement_state: "adjudicated",
                adjudication_evidence_digest: `sha256:${"a".repeat(64)}`,
                adjudication_id: "dsapa_adj_exact",
                gap_reason: null,
                adjudicator_label_binding: persistedBinding,
              },
            ],
            rowCount: 1,
          };
        },
      } as unknown as PoolClient;
      return loadDsaNamedPanelLabelInputs(client, "workspace_named_panel", `rse_${"1".repeat(40)}`);
    };

    process.env.TOKENLESS_EVIDENCE_TENANT_COMMITMENT_KEY = Buffer.alloc(32, 7).toString("base64url");
    const beforeRotation = await load();
    process.env.TOKENLESS_EVIDENCE_TENANT_COMMITMENT_KEY = Buffer.alloc(32, 8).toString("base64url");
    const afterRotation = await load();
    assert.deepEqual(afterRotation, beforeRotation);
    assert.equal(afterRotation?.[0]?.adjudicatedBy, persistedBinding);
    assert.doesNotMatch(afterRotation?.[0]?.adjudicatedBy ?? "", /rlp_exact_adjudicator/u);
    const labelLoader = source.slice(source.indexOf("export async function loadDsaNamedPanelLabelInputs"));
    assert.match(source, /TOKENLESS_EVIDENCE_TENANT_COMMITMENT_KEY/u);
    assert.match(source, /rateloop\.dsa-adjudicator-label-binding\.v1/u);
    assert.doesNotMatch(labelLoader, /getAssuranceResponseKeyrings/u);
    assert.doesNotMatch(labelLoader, /adjudicatorLabelBinding/u);
  } finally {
    if (previous === undefined) delete process.env.TOKENLESS_EVIDENCE_TENANT_COMMITMENT_KEY;
    else process.env.TOKENLESS_EVIDENCE_TENANT_COMMITMENT_KEY = previous;
  }
});

test("adjudicated label inputs fail closed without the exact adjudicator principal", async () => {
  let query = 0;
  const client = {
    async query() {
      query += 1;
      if (query === 1) return { rows: [{ unit_count: "1" }], rowCount: 1 };
      return {
        rows: [
          {
            unit_id: "rsu_abcdefghijklmnopqrstuv",
            reference_label: "uncertain",
            agreement_state: "adjudicated",
            adjudication_evidence_digest: `sha256:${"a".repeat(64)}`,
            adjudication_id: "dsapa_adj_missing",
            gap_reason: null,
            adjudicator_label_binding: null,
            run_id: "run_missing_adjudication",
          },
        ],
        rowCount: 1,
      };
    },
  } as unknown as PoolClient;

  await assert.rejects(
    () => loadDsaNamedPanelLabelInputs(client, "workspace_named_panel", `rse_${"1".repeat(40)}`),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "dsa_named_panel_adjudication_incomplete",
  );
});

test("database transaction time freezes evidence", () => {
  assert.match(source, /SELECT transaction_timestamp\(\) AS now/u);
  assert.match(source, /BEGIN ISOLATION LEVEL SERIALIZABLE/u);
  assert.equal((source.match(/databaseNow\(client\)/gu) ?? []).length >= 5, true);
});

test("reviewer qualifications must already be verified while covering the full response deadline", () => {
  const evidence = (verifiedAt: string, expiresAt: string) => [
    {
      key: "language:de:reading:cefr",
      value: "C1",
      source: "verified-language",
      assertedBy: "qualification-provider",
      verifiedAt,
      expiresAt,
      evidenceReferenceHash: `sha256:${"a".repeat(64)}`,
      evidenceVersion: "v1",
    },
  ];
  const input = {
    key: "language:de:reading:cefr",
    predicate: (value: unknown) => value === "C1",
    verifiedAtThrough: new Date("2030-01-01T00:00:00.000Z"),
    expiresThrough: new Date("2030-01-04T00:00:00.000Z"),
  };
  assert.throws(() =>
    __dsaNamedPanelQualificationTestUtils.qualificationEntry({
      ...input,
      provenance: evidence("2030-01-02T00:00:00.000Z", "2030-01-05T00:00:00.000Z"),
    }),
  );
  assert.throws(() =>
    __dsaNamedPanelQualificationTestUtils.qualificationEntry({
      ...input,
      provenance: evidence("2029-12-31T00:00:00.000Z", "2030-01-03T00:00:00.000Z"),
    }),
  );
  assert.equal(
    __dsaNamedPanelQualificationTestUtils.qualificationEntry({
      ...input,
      provenance: evidence("2029-12-31T00:00:00.000Z", "2030-01-05T00:00:00.000Z"),
    }).value,
    "C1",
  );
});

test("expired incomplete panels terminate as auditor-declared sampled gaps", () => {
  const gap = source.slice(
    source.indexOf("export async function declareDsaNamedPanelUnitGap"),
    source.indexOf("export async function freezeDsaNamedPanelOutcome"),
  );
  assert.match(gap, /reviewer_nonresponse/u);
  assert.match(gap, /access\.role='auditor'/u);
  assert.match(gap, /member\.account_address IS NULL/u);
  assert.match(gap, /assignmentDeadline >= declaredAt/u);
  assert.match(gap, /allowIncomplete: true/u);
  assert.match(gap, /tokenless_dsa_named_panel_selections/u);
  assert.match(gap, /max\(selection\.panel_deadline\)/u);
  assert.match(gap, /acceptedAssignmentCount/u);
  assert.match(gap, /partialResponseRoot/u);
  assert.match(gap, /referenceLabel: "uncertain"/u);
  assert.match(gap, /agreementState: "gap"/u);
  assert.match(managementRouteSource, /body\.action === "declare_gap"/u);
});

test("registration derives the blinded case from the selected append-only DSA sources", () => {
  const registration = source.slice(
    source.indexOf("export async function registerDsaNamedPanelUnit"),
    source.indexOf("export async function acceptDsaNamedPanelAssignment"),
  );
  const registrationInput = registration.slice(0, registration.indexOf("}) {"));
  assert.doesNotMatch(registrationInput, /policyQuestion/u);
  assert.doesNotMatch(registrationInput, /payload: DsaBlindedCasePayload/u);
  assert.doesNotMatch(registrationInput, /withheld: DsaWithheldCaseValues/u);
  assert.match(registration, /JOIN tokenless_dsa_source_engagement_versions engagement_source/u);
  assert.match(registration, /JOIN tokenless_dsa_source_decision_versions decision/u);
  assert.match(registration, /LEFT JOIN tokenless_dsa_transparency_payload_versions payload/u);
  assert.match(registration, /LEFT JOIN tokenless_dsa_transparency_receipt_versions receipt/u);
  assert.match(registration, /JOIN tokenless_dsa_named_panel_reference_definitions definition/u);
  assert.match(
    registration,
    /FOR SHARE OF m,epoch,e,projection,engagement,engagement_source,decision,definition,c,rc,run,a/u,
  );
  assert.match(registration, /subpanel\.source='customer_invited'/u);
  assert.match(registration, /subpanel\.selection='customer_named'/u);
  assert.match(registration, /audience_reviewer_target_count/u);
  assert.match(registration, /mapping\.content\.contentHash !== engagement\.contentHash/u);
  assert.match(registration, /mapping\.content\.contentType !== engagement\.contentFormat/u);
  assert.match(registration, /mapping\.content\.language !== engagement\.language/u);
  assert.match(registration, /mapping\.policy\.categoryCode !== engagement\.harmonisedCategory/u);
  assert.match(registration, /referenceDefinitionHash: mapping\.policy\.policyHash/u);
  assert.match(registration, /responseWindowMs: DSA_NAMED_PANEL_RESPONSE_WINDOW_MS/u);
  assert.match(registration, /sourceDecisionHash: text\(row, "source_decision_hash"\)/u);
  assert.match(registration, /engagementHash: text\(row, "engagement_hash"\)/u);
  assert.match(registration, /transparencyPayloadHash: text\(row, "payload_hash"\)/u);
  assert.match(registration, /transparencyReceiptHash: text\(row, "receipt_hash"\)/u);
  assert.doesNotMatch(registration, /appealResult/u);
});

test("adjudication leases close under the same unit lock as adjudication and terminal outcomes", () => {
  const issuance = source.slice(
    source.indexOf("export async function issueDsaNamedPanelAdjudicationArtifactLease"),
    source.indexOf("export async function adjudicateDsaNamedPanelDisagreement"),
  );
  assert.match(issuance, /FOR UPDATE/u);
  assert.match(issuance, /tokenless_dsa_named_panel_adjudications/u);
  assert.match(issuance, /tokenless_dsa_named_panel_unit_outcomes/u);
  assert.match(issuance, /dsa_named_panel_adjudication_lease_closed/u);
});

test("generic assignment surfaces preserve the named-panel acceptance and blinding boundary", () => {
  assert.match(audienceAssignmentsSource, /mode: "generic" \| "dsa_named_panel" = "generic"/u);
  assert.match(audienceAssignmentsSource, /mode !== "dsa_named_panel"/u);
  assert.match(
    audienceAssignmentsSource,
    /const leases = requiresDsaReferencePanelAcceptance\s+\? \[\]\s+: await issueAssignmentArtifactLeases/u,
  );
  assert.match(audienceAssignmentsSource, /dsa_named_panel_acceptance_required/u);
  assert.match(reviewerAssignmentsSource, /JOIN tokenless_assurance_run_cases rc ON rc\.run_id=a\.run_id/u);
  assert.match(reviewerAssignmentsSource, /ELSE 'Blinded policy review' END AS project_name/u);
  assert.match(reviewerAssignmentsSource, /named_unit\.unit_id IS NULL AND p\.name ILIKE/u);
  assert.match(acceptanceRouteSource, /const expected = \["conflictDeclaration"\]/u);
  assert.match(artifactRouteSource, /readDsaNamedPanelArtifactIfExists/u);
});

test("task metadata is read-only and artifact access is recorded only after successful decryption and reauthorization", () => {
  const taskRead = source.slice(
    source.indexOf("export async function getDsaNamedPanelTaskIfExists"),
    source.indexOf("export async function readDsaNamedPanelArtifactIfExists"),
  );
  const artifactRead = source.slice(
    source.indexOf("export async function readDsaNamedPanelArtifactIfExists"),
    source.indexOf("export async function submitDsaNamedPanelResponseIfExists"),
  );
  assert.doesNotMatch(taskRead, /INSERT INTO tokenless_dsa_named_panel_artifact_accesses/u);
  const decryptAt = artifactRead.indexOf("await readEncryptedArtifact");
  const reauthorizeAt = artifactRead.lastIndexOf("await assertDsaNamedPanelPrincipalEligible");
  const recordAt = artifactRead.indexOf("INSERT INTO tokenless_dsa_named_panel_artifact_accesses");
  assert.ok(decryptAt >= 0 && reauthorizeAt > decryptAt && recordAt > reauthorizeAt);
});

test("principal eligibility is enforced before acceptance, delivery, and adjudication but not replay recovery", () => {
  assert.equal((source.match(/await assertDsaNamedPanelPrincipalEligible/gu) ?? []).length >= 7, true);
  const materialization = source.slice(
    source.indexOf("async function materializeResponses"),
    source.indexOf("export async function reconcileDsaNamedPanelResponseEvidenceForPrincipal"),
  );
  assert.doesNotMatch(materialization, /assertDsaNamedPanelPrincipalEligible/u);
});

test("a project auditor without workspace membership freezes one immutable reference definition per epoch", () => {
  const definition = source.slice(
    source.indexOf("export async function registerDsaNamedPanelReferenceDefinition"),
    source.indexOf("type ProvenanceEntry"),
  );
  assert.match(definition, /access\.role='auditor'/u);
  assert.match(definition, /access\.expires_at>\$5/u);
  assert.match(definition, /member\.account_address IS NULL/u);
  assert.match(definition, /rateloop\.dsa-named-panel-reference-definition\.v1/u);
  assert.match(definition, /project_auditor_without_workspace_membership/u);
  assert.match(definition, /standardId/u);
  assert.match(definition, /standardVersion/u);
  assert.match(definition, /standardHash/u);
  assert.match(definition, /policyMatches: "fail"/u);
  assert.match(definition, /policyDoesNotMatch: "pass"/u);
  assert.match(definition, /reviewers_binary_adjudicator_may_choose_uncertain/u);
  assert.match(definition, /qualified_non_panel_principal_required_on_disagreement/u);
  assert.match(definition, /ON CONFLICT \(workspace_id,epoch_id\) DO NOTHING/u);
  assert.match(definition, /dsa_named_panel_reference_definition_conflict/u);
  assert.match(managementRouteSource, /body\.action === "register_definition"/u);
  assert.match(managementRouteSource, /"standardHash"/u);
  assert.match(managementRouteSource, /"standardId"/u);
  assert.match(managementRouteSource, /"standardVersion"/u);
  assert.match(managementRouteSource, /body\.action === "open_adjudication_artifact"/u);
  assert.match(managementRouteSource, /issueDsaNamedPanelAdjudicationArtifactLease/u);
  assert.doesNotMatch(managementRouteSource, /policyQuestion/u);
  assert.match(managementRouteSource, /exact\(body, \["action", "epochId"\]\)/u);
});
