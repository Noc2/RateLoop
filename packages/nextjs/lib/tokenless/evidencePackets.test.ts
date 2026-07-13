import {
  canonicalizeEvidenceValue,
  computeEvidenceAggregation,
  evidenceSigningKeyId,
  sha256EvidenceValue,
} from "../../scripts/assurance-evidence-core.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  assertEvidenceGenerationRequest,
  generateAssuranceEvidencePacket,
  getAssuranceClientDecision,
  getAssuranceEvidencePacket,
  recordAssuranceClientDecision,
  verifyEvidenceExport,
} from "~~/lib/tokenless/evidencePackets";
import { canonicalizeHumanAssuranceDocument, hashHumanAssuranceDocument } from "~~/lib/tokenless/humanAssurance";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const DECISION_OWNER = "0x2222222222222222222222222222222222222222";
const MEMBER = "0x3333333333333333333333333333333333333333";
const TENANT_KEY = Buffer.alloc(32, 7);
const NOW = new Date("2026-07-13T12:00:00.000Z");

type SourceFixture = {
  source: "customer_invited" | "rateloop_network" | "sandbox";
  targetCount: number;
  paid?: boolean;
  responses: { choice: "baseline" | "candidate" | "tie"; validity: "valid" | "invalid" | "pending" }[];
};

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

test("aggregation keeps reviewer targets separate from multi-case judgments", () => {
  const passRule = {
    metric: "candidate_preference_share_bps",
    operator: "gte",
    thresholdBps: 6000,
    minimumValidResponses: 2,
  };
  const source = {
    source: "customer_invited",
    targetReviewerCount: 3,
    assignedReviewerCount: 3,
    paidReviewerCount: 0,
    respondingReviewerCount: 3,
    completeJudgmentSetReviewerCount: 3,
  };
  const caseCounts = (caseId: string, candidate: number, baseline: number) => ({
    caseId,
    overall: {
      targetReviewerCount: 3,
      assignedReviewerCount: 3,
      validReviewerCount: 3,
      invalidJudgmentCount: 0,
      pendingJudgmentCount: 0,
      suppressed: false,
      candidate,
      baseline,
      tie: 0,
    },
    sourceCounts: [
      {
        source: "customer_invited",
        targetReviewerCount: 3,
        assignedReviewerCount: 3,
        validReviewerCount: 3,
        invalidJudgmentCount: 0,
        pendingJudgmentCount: 0,
        suppressed: false,
        candidate,
        baseline,
        tie: 0,
      },
    ],
  });
  const aggregation = computeEvidenceAggregation(
    { reviewerSources: [source], cases: [caseCounts("case_a", 2, 1), caseCounts("case_b", 1, 2)] },
    2,
    passRule,
  );
  assert.equal(aggregation.reviewerCoverage.targetReviewerCount, 3);
  assert.equal(aggregation.reviewerCoverage.respondingReviewerCount, 3);
  assert.equal(aggregation.judgmentCoverage.caseCount, 2);
  assert.equal(aggregation.judgmentCoverage.targetExpectedJudgmentCount, 6);
  assert.equal(aggregation.judgmentCoverage.submittedJudgmentCount, 6);
  assert.equal(aggregation.cases[0].preference.candidateShareBps, 6667);
  assert.equal(aggregation.cases[1].preference.candidateShareBps, 3333);
  assert.equal(aggregation.suite.outcome, "fail");
  assert.equal("preference" in aggregation.reviewerCoverage, false);
  assert.doesNotMatch(JSON.stringify(aggregation), /wilson|interval/i);
});

function address(index: number) {
  return `0x${(1000 + index).toString(16).padStart(40, "0")}`;
}

async function insert(sql: string, args: unknown[]) {
  await dbClient.execute({ sql, args });
}

async function seedEvidenceFixture(input: {
  compensation: "paid" | "unpaid" | "mixed";
  minimumAggregationSize: number;
  sources: SourceFixture[];
  withChain?: boolean;
}) {
  const { workspaceId } = await createWorkspace({ name: "Evidence workspace", ownerAddress: OWNER });
  const projectId = "project_evidence";
  const suiteId = "suite_evidence";
  const rubricId = "rubric_evidence";
  const policyId = "policy_evidence";
  const runId = "run_evidence";
  const caseId = "case_evidence";
  const contentId = `0x${"ab".repeat(32)}`;
  const admissionPolicyHash = `0x${"cd".repeat(32)}`;
  const passRule = {
    metric: "candidate_preference_share_bps",
    operator: "gte",
    thresholdBps: 6000,
    minimumValidResponses: 3,
  };
  const rubric = { prompt: "Which is better?", failureTags: [], rationale: { mode: "optional" }, passRule };
  const suiteManifest = { kind: "suite_manifest", projectId, suiteId, version: 1, rubric, cases: [{ caseId }] };
  const suiteManifestHash = hashHumanAssuranceDocument(suiteManifest);
  const reviewerSource = input.sources.length > 1 ? "hybrid" : input.sources[0].source;
  const policy = {
    schemaVersion: "human-assurance-v1",
    policyId,
    version: 1,
    reviewerSource,
    compensation: input.compensation,
    cohorts: input.sources.map((source, index) => ({
      cohortId: `cohort_${index}`,
      minimumReviewers: source.targetCount,
    })),
    selection: "customer_named",
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: { requiredCapabilities: [], allowedProviders: [] },
    buyerPrivacy: {
      visibleFields: ["reviewer_source"],
      minimumAggregationSize: input.minimumAggregationSize,
      suppressSmallCells: true,
    },
    legalEligibilityRequired: input.compensation !== "unpaid",
  };
  const policyHash = hashHumanAssuranceDocument(policy);
  const runManifest = {
    schemaVersion: "human-assurance-run-orchestration-v1",
    kind: "run_orchestration_manifest",
    runId,
    projectId,
    suite: { suiteId, version: 1, manifestHash: suiteManifestHash },
    rubric: { rubricId, version: 1, passRule },
    audiencePolicy: { policyId, version: 1, manifestHash: policyHash, admissionPolicyHash },
  };
  const runManifestHash = hashHumanAssuranceDocument(runManifest);

  await insert(
    `INSERT INTO tokenless_assurance_projects
     (project_id, workspace_id, name, data_classification, status, retention_days, created_by, created_at, updated_at)
     VALUES (?, ?, 'Evidence project', 'confidential', 'active', 30, ?, ?, ?)`,
    [projectId, workspaceId, OWNER, NOW, NOW],
  );
  for (const [artifactId, role, marker] of [
    ["artifact_a", "baseline", "a"],
    ["artifact_b", "candidate", "b"],
  ] as const) {
    await insert(
      `INSERT INTO tokenless_assurance_artifacts
       (artifact_id, project_id, role, label, digest, content_type, size_bytes, storage_ref,
        redaction_status, renderer_policy, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'application/json', 10, ?, 'approved', 'safe_json', ?, ?)`,
      [artifactId, projectId, role, role, `sha256:${marker.repeat(64)}`, `private:${artifactId}`, NOW, NOW],
    );
  }
  await insert(
    `INSERT INTO tokenless_assurance_rubrics
     (rubric_id, project_id, version, prompt, failure_tags_json, rationale_json,
      pass_rule_json, rubric_json, created_at)
     VALUES (?, ?, 1, ?, '[]', ?, ?, ?, ?)`,
    [
      rubricId,
      projectId,
      rubric.prompt,
      JSON.stringify(rubric.rationale),
      JSON.stringify(passRule),
      JSON.stringify(rubric),
      NOW,
    ],
  );
  await insert(
    `INSERT INTO tokenless_assurance_suites
     (suite_id, project_id, name, version, status, rubric_id, rubric_version,
      manifest_hash, manifest_json, frozen_at, created_at, updated_at)
     VALUES (?, ?, 'Evidence suite', 1, 'frozen', ?, 1, ?, ?, ?, ?, ?)`,
    [suiteId, projectId, rubricId, suiteManifestHash, canonicalizeHumanAssuranceDocument(suiteManifest), NOW, NOW, NOW],
  );
  await insert(
    `INSERT INTO tokenless_assurance_cases
     (case_id, project_id, suite_id, suite_version, position, title, instructions,
      baseline_artifact_id, candidate_artifact_id, context_artifact_ids_json,
      status, created_at, updated_at, deterministic_checks_json)
     VALUES (?, ?, ?, 1, 1, 'Case', 'Compare', 'artifact_a', 'artifact_b', '[]', 'ready', ?, ?, '[]')`,
    [caseId, projectId, suiteId, NOW, NOW],
  );
  await insert(
    `INSERT INTO tokenless_assurance_audience_policies
     (policy_id, project_id, version, reviewer_source, compensation, cohorts_json, selection,
      fallbacks_json, required_qualifications_json, assurance_json, buyer_privacy_json,
      legal_eligibility_required, policy_hash, policy_json, created_at)
     VALUES (?, ?, 1, ?, ?, ?, 'customer_named', ?, '[]', ?, ?, ?, ?, ?, ?)`,
    [
      policyId,
      projectId,
      reviewerSource,
      input.compensation,
      JSON.stringify(policy.cohorts),
      JSON.stringify(policy.fallbacks),
      JSON.stringify(policy.assurance),
      JSON.stringify(policy.buyerPrivacy),
      input.compensation !== "unpaid",
      policyHash,
      canonicalizeHumanAssuranceDocument(policy),
      NOW,
    ],
  );
  await insert(
    `INSERT INTO tokenless_assurance_runs
     (run_id, project_id, suite_id, suite_version, audience_policy_id, audience_policy_version,
      status, policy_hash, manifest_hash, manifest_json, created_by, created_at, updated_at, frozen_at, completed_at)
     VALUES (?, ?, ?, 1, ?, 1, 'completed', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      projectId,
      suiteId,
      policyId,
      policyHash,
      runManifestHash,
      canonicalizeHumanAssuranceDocument(runManifest),
      OWNER,
      NOW,
      NOW,
      NOW,
      NOW,
    ],
  );
  await insert(
    `INSERT INTO tokenless_assurance_run_cases
     (run_id, case_id, position, variant_a_artifact_id, variant_b_artifact_id,
      blinding_commitment, blinding_secret_json, deterministic_checks_json,
      deterministic_checks_hash, deterministic_checks_status, content_id,
      admission_policy_hash, round_id, round_status, created_at, updated_at)
     VALUES (?, ?, 1, 'artifact_a', 'artifact_b', ?, '{}', '[]', ?, 'not_applicable', ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      caseId,
      hashHumanAssuranceDocument({ swap: false }),
      hashHumanAssuranceDocument([]),
      contentId,
      admissionPolicyHash,
      input.withChain ? "42" : null,
      input.withChain ? "terminal" : "offchain_complete",
      NOW,
      NOW,
    ],
  );

  let reviewerIndex = 0;
  for (const [sourceIndex, source] of input.sources.entries()) {
    const paidSource = source.paid ?? input.compensation === "paid";
    const cohortId = `cohort_${sourceIndex}`;
    const subpanelId = `subpanel_${sourceIndex}`;
    await insert(
      `INSERT INTO tokenless_assurance_cohorts
       (cohort_id, project_id, name, source, selection, capacity, active_reservations,
        qualification_rules_json, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'customer_named', ?, 0, '[]', 'active', ?, ?, ?)`,
      [cohortId, projectId, cohortId, source.source, source.targetCount, OWNER, NOW, NOW],
    );
    await insert(
      `INSERT INTO tokenless_assurance_run_subpanels
       (subpanel_id, workspace_id, project_id, run_id, cohort_id, source, selection,
        target_count, active_reservations, policy_id, policy_version, policy_hash, run_manifest_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'customer_named', ?, 0, ?, 1, ?, ?, ?)`,
      [
        subpanelId,
        workspaceId,
        projectId,
        runId,
        cohortId,
        source.source,
        source.targetCount,
        policyId,
        policyHash,
        runManifestHash,
        NOW,
      ],
    );
    for (let index = 0; index < source.targetCount; index += 1) {
      const reviewer = address(++reviewerIndex);
      await insert(
        `INSERT INTO tokenless_assurance_cohort_reviewers
         (project_id, cohort_id, reviewer_account_address, qualification_provenance_json,
          maximum_active_assignments, active_reservations, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, '[]', 1, 0, 'active', ?, ?, ?)`,
        [projectId, cohortId, reviewer, OWNER, NOW, NOW],
      );
      await insert(
        `INSERT INTO tokenless_assurance_assignments
         (assignment_id, workspace_id, project_id, run_id, subpanel_id, cohort_id,
          reviewer_account_address, source, selection, status, confidentiality_terms_hash,
          confidentiality_accepted_at, qualification_provenance_json, blinding_json,
          paid_assignment, paid_eligibility_checked_at, reservation_expires_at,
          assignment_expires_at, lease_issuer_account_address, lease_state,
          created_at, accepted_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'customer_named', 'completed', ?, ?, '[]', '{"swap":false}',
                 ?, ?, ?, ?, ?, 'expired', ?, ?, ?)`,
        [
          `assignment_${sourceIndex}_${index}`,
          workspaceId,
          projectId,
          runId,
          subpanelId,
          cohortId,
          reviewer,
          source.source,
          hashHumanAssuranceDocument({ confidentiality: true }),
          NOW,
          paidSource,
          paidSource ? NOW : null,
          new Date(NOW.getTime() + 60_000),
          new Date(NOW.getTime() + 60_000),
          OWNER,
          NOW,
          NOW,
          NOW,
        ],
      );
      const response = source.responses[index];
      if (response) {
        await insert(
          `INSERT INTO tokenless_assurance_responses
           (response_id, run_id, case_id, reviewer_key, reviewer_source, choice,
            failure_tag_keys_json, rationale_ciphertext, rationale_key_ref,
            qualification_keys_json, assurance_capabilities_json, response_digest,
            settlement_reference, validity, submitted_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, ?, ?, ?)`,
          [
            `response_${sourceIndex}_${index}`,
            runId,
            caseId,
            reviewer,
            source.source,
            response.choice,
            response.choice === "baseline" ? '["regression"]' : "[]",
            `ciphertext:private-rationale-${sourceIndex}-${index}`,
            `key:${sourceIndex}:${index}`,
            hashHumanAssuranceDocument({ sourceIndex, index, response }),
            paidSource ? `https://sepolia.basescan.org/tx/0x${"88".repeat(32)}` : null,
            response.validity,
            NOW,
            NOW,
          ],
        );
      }
    }
  }

  if (input.withChain) {
    await insert(
      `INSERT INTO tokenless_agent_quotes
       (quote_id, request_hash, request_json, response_json, expires_at, created_at)
       VALUES ('quote_evidence', 'hash', '{}', '{}', ?, ?)`,
      [new Date(NOW.getTime() + 60_000), NOW],
    );
    await insert(
      `INSERT INTO tokenless_agent_asks
       (operation_key, idempotency_key, request_hash, quote_id, request_json, economics_json,
        status, sandbox, created_at, updated_at)
       VALUES ('operation_evidence', 'idem_evidence', 'hash', 'quote_evidence', '{}', '{}', 'completed', false, ?, ?)`,
      [NOW, NOW],
    );
    await insert(
      `INSERT INTO tokenless_chain_executions
       (execution_id, operation_key, payment_mode, payment_reference, deployment_key, chain_id,
        deployment_block, panel_address, issuer_address, x402_submitter_address, usdc_address,
        funder_address, content_id, terms_hash, round_terms_json, total_funded_atomic,
        state, submission_transaction_hash, round_id, receipt_block_number, receipt_block_hash,
        created_at, updated_at, confirmed_at)
       VALUES ('execution_evidence', 'operation_evidence', 'prepaid', 'payment_evidence',
               'tokenless-v2:test', 84532, 123, ?, ?, ?, ?, ?, ?, ?, '{}', 1000,
               'confirmed', ?, 42, 456, ?, ?, ?, ?)`,
      [
        `0x${"11".repeat(20)}`,
        `0x${"22".repeat(20)}`,
        `0x${"33".repeat(20)}`,
        `0x${"44".repeat(20)}`,
        `0x${"55".repeat(20)}`,
        contentId,
        hashHumanAssuranceDocument({ terms: true }),
        `0x${"66".repeat(32)}`,
        `0x${"77".repeat(32)}`,
        NOW,
        NOW,
        NOW,
      ],
    );
    await insert(
      `INSERT INTO tokenless_transparency_events
       (event_id, operation_key, workspace_id, deployment_key, round_id, sequence,
        event_type, evidence_hash, evidence_json, occurred_at, recorded_at)
       VALUES ('event_evidence', 'operation_evidence', ?, 'tokenless-v2:test', 42, 1,
               'round.finalized', ?, '{"private":"not exported"}', ?, ?)`,
      [workspaceId, hashHumanAssuranceDocument({ event: "settled" }), NOW, NOW],
    );
  }

  return {
    workspaceId,
    runId,
    reviewerAddresses: Array.from({ length: reviewerIndex }, (_, index) => address(index + 1)),
  };
}

test("evidence derives private aggregates, verifies only against trusted pins, and is reproducible offline", async () => {
  const fixture = await seedEvidenceFixture({
    compensation: "unpaid",
    minimumAggregationSize: 3,
    sources: [
      {
        source: "customer_invited",
        targetCount: 6,
        responses: [
          { choice: "candidate", validity: "valid" },
          { choice: "candidate", validity: "valid" },
          { choice: "candidate", validity: "valid" },
          { choice: "baseline", validity: "valid" },
          { choice: "baseline", validity: "valid" },
          { choice: "baseline", validity: "valid" },
        ],
      },
    ],
  });
  const signer = generateKeyPairSync("ed25519");
  const packet = await generateAssuranceEvidencePacket({
    accountAddress: OWNER,
    workspaceId: fixture.workspaceId,
    runId: fixture.runId,
    now: NOW,
    signer: { privateKey: signer.privateKey },
    tenantCommitmentKey: TENANT_KEY,
  });
  assert.equal(packet.payload.aggregation.reviewerCoverage.targetReviewerCount, 6);
  assert.equal(packet.payload.aggregation.reviewerCoverage.respondingReviewerCount, 6);
  assert.equal(packet.payload.aggregation.judgmentCoverage.targetExpectedJudgmentCount, 6);
  assert.equal(packet.payload.aggregation.judgmentCoverage.submittedJudgmentCount, 6);
  assert.equal(packet.payload.aggregation.judgmentCoverage.validJudgmentCount, 6);
  assert.equal(packet.payload.aggregation.judgmentCoverage.invalidJudgmentCount, 0);
  assert.equal(packet.payload.aggregation.judgmentCoverage.missingTargetJudgmentCount, 0);
  assert.equal(packet.payload.aggregation.cases[0].preference.candidateShareBps, 5000);
  assert.equal(packet.payload.aggregation.cases[0].preference.method, "descriptive_case_share");
  assert.equal(packet.payload.aggregation.suite.outcome, "fail");
  assert.doesNotMatch(JSON.stringify(packet.payload.aggregation), /wilson|interval/i);
  assert.equal(packet.payload.settlement.mode, "no_onchain_settlement_unpaid_invited");
  assert.equal(packet.payload.settlement.links.length, 0);
  assert.match(packet.payload.tenantCommitment, /^hmac-sha256:[0-9a-f]{64}$/);
  const serialized = JSON.stringify(packet);
  assert.doesNotMatch(serialized, new RegExp(fixture.workspaceId));
  assert.doesNotMatch(serialized, /ciphertext:private-rationale|key:0:0/);
  for (const reviewer of fixture.reviewerAddresses) assert.doesNotMatch(serialized, new RegExp(reviewer));

  assert.deepEqual(verifyEvidenceExport(packet).errors, ["missing_trust_anchor"]);
  const trusted = verifyEvidenceExport(packet, {
    expectedPublicKey: packet.signing.publicKey,
    expectedKeyId: packet.signing.keyId,
  });
  assert.equal(trusted.valid, true);
  assert.equal(
    (await getAssuranceEvidencePacket({ accountAddress: OWNER, ...fixture })).packetDigest,
    packet.packetDigest,
  );

  const attacker = generateKeyPairSync("ed25519");
  const attackerPublicKey = createPublicKey(attacker.privateKey)
    .export({ format: "der", type: "spki" })
    .toString("base64url");
  const forgedDocument = {
    payload: packet.payload,
    signing: { algorithm: "Ed25519", keyId: evidenceSigningKeyId(attackerPublicKey), publicKey: attackerPublicKey },
  };
  const forged = {
    ...forgedDocument,
    packetDigest: sha256EvidenceValue(forgedDocument),
    signature: sign(null, Buffer.from(canonicalizeEvidenceValue(forgedDocument)), attacker.privateKey).toString(
      "base64url",
    ),
  };
  assert.ok(verifyEvidenceExport(forged).errors.includes("missing_trust_anchor"));
  assert.equal(verifyEvidenceExport(forged, { expectedPublicKey: packet.signing.publicKey }).valid, false);
  assert.ok(
    verifyEvidenceExport(forged, { expectedPublicKey: packet.signing.publicKey }).errors.includes(
      "untrusted_signing_key",
    ),
  );
  assert.equal(verifyEvidenceExport(packet, { expectedKeyId: "ed25519:000000000000000000000000" }).valid, false);
  assert.equal(
    verifyEvidenceExport(packet, {
      expectedPublicKey: packet.signing.publicKey,
      expectedKeyId: "ed25519:000000000000000000000000",
    }).valid,
    false,
  );

  const directory = await mkdtemp(join(tmpdir(), "rateloop-evidence-"));
  try {
    const packetPath = join(directory, "packet.json");
    const keyPath = join(directory, "trusted-public-key.txt");
    await writeFile(packetPath, JSON.stringify(packet));
    await writeFile(keyPath, packet.signing.publicKey);
    const script = fileURLToPath(new URL("../../scripts/verify-assurance-evidence.mjs", import.meta.url));
    const missingPin = spawnSync(process.execPath, [script, packetPath], { encoding: "utf8" });
    assert.equal(missingPin.status, 1);
    assert.match(missingPin.stdout, /missing_trust_anchor/);
    const correctPin = spawnSync(process.execPath, [script, packetPath, "--public-key", keyPath], {
      encoding: "utf8",
    });
    assert.equal(correctPin.status, 0, correctPin.stderr);
    assert.equal(JSON.parse(correctPin.stdout).valid, true);
    const fingerprintPin = spawnSync(process.execPath, [script, packetPath, "--key-id", packet.signing.keyId], {
      encoding: "utf8",
    });
    assert.equal(fingerprintPin.status, 0, fingerprintPin.stderr);
    const wrongPin = spawnSync(process.execPath, [script, packetPath, "--public-key", attackerPublicKey], {
      encoding: "utf8",
    });
    assert.equal(wrongPin.status, 1);
    assert.match(wrongPin.stdout, /untrusted_signing_key/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("evidence keeps mixed paid and unpaid source panels separate and links only stored settlement evidence", async () => {
  const fixture = await seedEvidenceFixture({
    compensation: "mixed",
    minimumAggregationSize: 3,
    withChain: true,
    sources: [
      {
        source: "customer_invited",
        paid: false,
        targetCount: 3,
        responses: [
          { choice: "candidate", validity: "valid" },
          { choice: "candidate", validity: "valid" },
          { choice: "baseline", validity: "valid" },
        ],
      },
      {
        source: "rateloop_network",
        paid: true,
        targetCount: 2,
        responses: [
          { choice: "candidate", validity: "valid" },
          { choice: "tie", validity: "valid" },
        ],
      },
    ],
  });
  const signer = generateKeyPairSync("ed25519");
  const packet = await generateAssuranceEvidencePacket({
    accountAddress: OWNER,
    workspaceId: fixture.workspaceId,
    runId: fixture.runId,
    signer: { privateKey: signer.privateKey },
    tenantCommitmentKey: TENANT_KEY,
  });
  assert.deepEqual(
    packet.payload.aggregation.reviewerCoverage.sourceSubpanels.map((panel: Record<string, unknown>) => panel.source),
    ["customer_invited", "rateloop_network"],
  );
  assert.equal(packet.payload.aggregation.reviewerCoverage.paidReviewerCount, 2);
  assert.deepEqual(
    packet.payload.aggregation.reviewerCoverage.sourceSubpanels.map(
      (panel: Record<string, unknown>) => panel.paidReviewerCount,
    ),
    [0, 2],
  );
  assert.equal(packet.payload.aggregation.cases[0].sourceSubpanels[1].suppressed, true);
  assert.equal(packet.payload.aggregation.cases[0].sourceSubpanels[1].preference, null);
  assert.equal("candidate" in packet.payload.recomputation.cases[0].sourceCounts[1], false);
  assert.equal("baseline" in packet.payload.recomputation.cases[0].sourceCounts[1], false);
  assert.equal("tie" in packet.payload.recomputation.cases[0].sourceCounts[1], false);
  assert.equal(packet.payload.settlement.mode, "onchain_evidence_recorded");
  assert.deepEqual(packet.payload.settlement.links, [`https://sepolia.basescan.org/tx/0x${"88".repeat(32)}`]);
  assert.equal(packet.payload.chainEvidence[0].execution.deploymentKey, "tokenless-v2:test");
  assert.equal(packet.payload.chainEvidence[0].execution.roundCreationTransactionHash, `0x${"66".repeat(32)}`);
  assert.equal(packet.payload.chainEvidence[0].indexedEvents[0].eventType, "round.finalized");
  assert.doesNotMatch(JSON.stringify(packet), /\"private\":\"not exported\"/);
});

test("client sign-off is decision-owner scoped, separate, and bound to the measured packet", async () => {
  const fixture = await seedEvidenceFixture({
    compensation: "unpaid",
    minimumAggregationSize: 2,
    sources: [
      {
        source: "customer_invited",
        targetCount: 3,
        responses: [
          { choice: "candidate", validity: "valid" },
          { choice: "candidate", validity: "valid" },
          { choice: "baseline", validity: "valid" },
        ],
      },
    ],
  });
  await insert(
    "INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at) VALUES (?, ?, 'member', ?), (?, ?, 'member', ?)",
    [fixture.workspaceId, DECISION_OWNER, NOW, fixture.workspaceId, MEMBER, NOW],
  );
  await insert(
    `INSERT INTO tokenless_workspace_member_governance
     (workspace_id, account_address, governance_role, created_by, created_at, updated_at)
     VALUES (?, ?, 'decision_owner', ?, ?, ?)`,
    [fixture.workspaceId, DECISION_OWNER, OWNER, NOW, NOW],
  );
  const signer = generateKeyPairSync("ed25519");
  const packet = await generateAssuranceEvidencePacket({
    accountAddress: OWNER,
    workspaceId: fixture.workspaceId,
    runId: fixture.runId,
    signer: { privateKey: signer.privateKey },
    tenantCommitmentKey: TENANT_KEY,
  });
  await assert.rejects(
    () => recordAssuranceClientDecision({ accountAddress: MEMBER, ...fixture, decision: "go" }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_decision_forbidden",
  );
  const decision = await recordAssuranceClientDecision({
    accountAddress: DECISION_OWNER,
    workspaceId: fixture.workspaceId,
    runId: fixture.runId,
    decision: "revise",
    note: "Address the documented regression before release.",
    now: NOW,
  });
  assert.equal(decision.evidencePacketDigest, packet.packetDigest);
  assert.equal(
    (
      await getAssuranceClientDecision({
        accountAddress: OWNER,
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
      })
    )?.decision,
    "revise",
  );
  assert.equal(
    (
      await recordAssuranceClientDecision({
        accountAddress: DECISION_OWNER,
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
        decision: "revise",
        note: "Address the documented regression before release.",
      })
    ).decisionDigest,
    decision.decisionDigest,
  );
  await assert.rejects(
    () =>
      recordAssuranceClientDecision({
        accountAddress: DECISION_OWNER,
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
        decision: "go",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_decision_conflict",
  );
  const stored = await dbClient.execute(
    "SELECT result_json FROM tokenless_assurance_evidence_packets WHERE run_id = 'run_evidence'",
  );
  assert.doesNotMatch(String(stored.rows[0]?.result_json), /revise|decision_owner/);
});

test("packet generation rejects a completed label with unaccounted reviewer-case judgments", async () => {
  const fixture = await seedEvidenceFixture({
    compensation: "unpaid",
    minimumAggregationSize: 2,
    sources: [
      {
        source: "customer_invited",
        targetCount: 3,
        responses: [
          { choice: "candidate", validity: "valid" },
          { choice: "baseline", validity: "valid" },
        ],
      },
    ],
  });
  const signer = generateKeyPairSync("ed25519");
  await assert.rejects(
    () =>
      generateAssuranceEvidencePacket({
        accountAddress: OWNER,
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
        signer: { privateKey: signer.privateKey },
        tenantCommitmentKey: TENANT_KEY,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_run_not_terminal",
  );
});

test("callers cannot inject measured outcome fields", () => {
  assert.doesNotThrow(() => assertEvidenceGenerationRequest({}));
  assert.throws(
    () => assertEvidenceGenerationRequest({ candidateShareBps: 10_000 }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "caller_metrics_rejected",
  );
});
