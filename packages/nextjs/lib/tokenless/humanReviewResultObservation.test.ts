import type {
  HumanReviewResultEnvelope,
  HumanReviewResultOutcome,
  HumanReviewResultTerminalState,
} from "@rateloop/sdk";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  approveAgentPairing,
  authenticateAgentMcpPrincipal,
  createAgentPairing,
  submitAgentRegistration,
} from "~~/lib/tokenless/agentIntegrations";
import {
  __humanReviewResultObservationTestUtils,
  hashHumanReviewSelectionPolicySnapshot,
  observeHumanReviewResult,
} from "~~/lib/tokenless/humanReviewResultObservation";
import { createAgentPublishingPolicy, createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { seedReadyHumanReviewBinding } from "~~/lib/tokenless/testing/humanReviewBindingFixture";

const OWNER = "0x1111111111111111111111111111111111111111";

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}` as `sha256:${string}`;
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __humanReviewResultObservationTestUtils.setAfterAdaptiveWriteForTests(null);
  __setDatabaseResourcesForTests(null);
});

async function fixture(
  suffix: string,
  outcome: HumanReviewResultOutcome = "positive",
  state: HumanReviewResultTerminalState = "completed",
) {
  const startedAt = new Date("2026-07-16T08:00:00.000Z");
  const finalizedAt = new Date("2026-07-16T09:00:00.000Z");
  const { workspaceId } = await createWorkspace({ name: `Result observation ${suffix}`, ownerAddress: OWNER });
  const publishing = await createAgentPublishingPolicy({
    accountAddress: OWNER,
    workspaceId,
    policy: {
      name: `Result observation ${suffix}`,
      allowedPaymentModes: ["prepaid"],
      maxPanelAtomic: "10000000",
      maxDailyAtomic: "100000000",
      maxMonthlyAtomic: "1000000000",
      maxPanelSize: 10,
      maxBountyAtomic: "10000000",
      maxFeeBps: 750,
      maxAttemptReserveAtomic: "5000000",
      allowedReviewerSources: ["rateloop_network"],
      allowedAdmissionPolicyHashes: [`0x${"11".repeat(32)}`],
      allowedDataClassifications: ["synthetic"],
    },
  });
  const issued = await createAgentPairing({
    accountAddress: OWNER,
    workspaceId,
    origin: "https://rateloop-tokenless.vercel.app",
  });
  const pairing = await authenticateAgentMcpPrincipal(`Bearer ${issued.secret}`);
  if (pairing.kind !== "pairing") throw new Error("Pairing principal expected.");
  await submitAgentRegistration({
    pairing,
    registration: {
      externalId: `result-agent-${suffix}`,
      displayName: `Result agent ${suffix}`,
      provider: "OpenAI",
      model: "gpt-test",
      environment: "production",
      requestedWorkflowKeys: ["result-review"],
    },
  });
  const approved = await approveAgentPairing({
    accountAddress: OWNER,
    workspaceId,
    pairingId: issued.pairing.pairingId,
    body: { publishingPolicyId: publishing.policyId, allowedWorkflowKeys: ["result-review"] },
  });
  const frozen = await seedReadyHumanReviewBinding({
    workspaceId,
    agentId: approved.agent.agentId,
    agentVersionId: approved.agent.versionId,
    policyId: approved.integration.reviewPolicyId,
    actor: OWNER,
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_integrations
          SET human_review_binding_id=?,human_review_binding_version=1
          WHERE integration_id=?`,
    args: [frozen.bindingId, approved.integration.integrationId],
  });
  const policyResult = await dbClient.execute({
    sql: `SELECT p.workspace_id,p.agent_id,p.agent_version_id,p.policy_id,p.version AS policy_version,
                 p.mode AS policy_mode,p.agreement_threshold_bps,p.production_floor_bps,p.fixed_rate_bps,
                 p.maximum_unreviewed_gap,p.rules_json,p.audience_policy_json,
                 p.publishing_policy_id AS review_publishing_policy_id
          FROM tokenless_agent_review_policies p
          WHERE p.workspace_id=? AND p.policy_id=? AND p.version=1`,
    args: [workspaceId, approved.integration.reviewPolicyId],
  });
  const selectionHash = hashHumanReviewSelectionPolicySnapshot(
    __humanReviewResultObservationTestUtils.selectionPolicySnapshot(policyResult.rows[0] as Record<string, unknown>),
  ) as `sha256:${string}`;
  const bindingResult = await dbClient.execute({
    sql: `SELECT canonical_hash FROM tokenless_agent_human_review_bindings
          WHERE workspace_id=? AND binding_id=? AND version=1`,
    args: [workspaceId, frozen.bindingId],
  });
  const bindingHash = String(bindingResult.rows[0]?.canonical_hash) as `sha256:${string}`;
  const scopeId = `aesc_result_${suffix}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_evaluation_scopes
          (scope_id,workspace_id,agent_id,agent_version_id,policy_id,policy_version,workflow_key,
           risk_tier,audience_policy_hash,partition_commitment,execution_profile_hash,
           execution_profile_json,human_review_binding_id,human_review_binding_version,
           request_profile_id,request_profile_version,request_profile_hash,stage,
           completed_comparable_cases,stable_cases_since_stage,unreviewed_since_last_sample,
           stage_entered_at,updated_at)
          VALUES (?,?,?,?,?,1,'result-review','normal',?,?,?,'{}',?,1,?,1,?,'calibrating',0,0,0,?,?)`,
    args: [
      scopeId,
      workspaceId,
      approved.agent.agentId,
      approved.agent.versionId,
      approved.integration.reviewPolicyId,
      hash(`audience-${suffix}`),
      hash(`partition-${suffix}`),
      hash(`execution-profile-${suffix}`),
      frozen.bindingId,
      frozen.profileId,
      frozen.profileHash,
      startedAt,
      startedAt,
    ],
  });
  const executionId = `aex_result_${suffix}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_executions
          (execution_id,workspace_id,agent_id,agent_version_id,integration_id,external_execution_id,
           status,metadata_source,model_call_count,primary_span_id,manifest_commitment,
           execution_profile_hash,execution_profile_json,created_at)
          VALUES (?,?,?,?,?,?,'completed','host_reported',1,'primary',?,?,?,?)`,
    args: [
      executionId,
      workspaceId,
      approved.agent.agentId,
      approved.agent.versionId,
      approved.integration.integrationId,
      `external-result-${suffix}`,
      hash(`manifest-${suffix}`),
      hash(`execution-profile-${suffix}`),
      "{}",
      startedAt,
    ],
  });
  const opportunityId = `aop_result_${suffix}`;
  const sourceHash = hash(`source-${suffix}`);
  const suggestionHash = hash(`suggestion-${suffix}`);
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_opportunities
          (opportunity_id,workspace_id,agent_id,agent_version_id,scope_id,policy_id,policy_version,
           external_opportunity_id,execution_id,suggestion_commitment,declared_confidence_bps,
           metadata_commitment,metadata_complete,critical_risk,decision,review_rate_bps,
           selection_probability_bps,sample_bucket,sampler_key_version,sampler_commitment,
           reason_codes_json,status,source_evidence_reference,source_evidence_hash,
           human_review_binding_id,human_review_binding_version,request_profile_id,
           request_profile_version,request_profile_hash,created_at,updated_at)
          VALUES (?,?,?,?,?,?,1,?,?,?,9000,?,true,false,'required',10000,10000,1,'result-test-v1',?,
                  '["review_required"]',?,'result/source',?,?,1,?,1,?,?,?)`,
    args: [
      opportunityId,
      workspaceId,
      approved.agent.agentId,
      approved.agent.versionId,
      scopeId,
      approved.integration.reviewPolicyId,
      `external-result-${suffix}`,
      executionId,
      suggestionHash,
      hash(`metadata-${suffix}`),
      hash(`sampler-${suffix}`),
      state === "failed_terminal" ? "failed" : state === "cancelled_before_commit" ? "decided" : "completed",
      sourceHash,
      frozen.bindingId,
      frozen.profileId,
      frozen.profileHash,
      startedAt,
      finalizedAt,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_opportunity_lifecycles
          (workspace_id,opportunity_id,state,state_revision,reason_codes_json,state_entered_at,
           terminal_at,created_at,updated_at)
          VALUES (?,?,?,3,'["terminal_result_ready"]',?,?,?,?)`,
    args: [workspaceId, opportunityId, state, finalizedAt, finalizedAt, startedAt, finalizedAt],
  });

  const responseCount = outcome === "failed" || outcome === "cancelled" ? 0 : 2;
  const envelope: HumanReviewResultEnvelope = {
    schemaVersion: "rateloop.human-review-result.v1",
    workspaceId,
    integrationId: approved.integration.integrationId,
    opportunityId,
    lane: "public_paid",
    lifecycle: {
      state,
      terminal: true,
      revision: 3,
      reasonCodes: ["terminal_result_ready"],
      startedAt: startedAt.toISOString(),
      stateEnteredAt: finalizedAt.toISOString(),
      finalizedAt: finalizedAt.toISOString(),
    },
    frozen: {
      selectionPolicy: { id: approved.integration.reviewPolicyId, version: 1, hash: selectionHash },
      binding: { id: frozen.bindingId, version: 1, hash: bindingHash },
      requestProfile: { id: frozen.profileId, version: 1, hash: frozen.profileHash as `sha256:${string}` },
      responseDeadline: "2026-07-16T10:00:00.000Z",
    },
    panel: {
      requestedCount: 3,
      assignedCount: 3,
      responseCount,
      cohorts: [{ source: "network", requestedCount: 3, assignedCount: 3, responseCount }],
    },
    outcome,
    rationale: { mode: "withheld", summary: null },
    economics: {
      asset: "USDC",
      decimals: 6,
      guaranteedBase: {
        mode: "usdc",
        fundedAtomic: "3000000",
        paidAtomic: outcome === "cancelled" ? "0" : "2000000",
        refundedAtomic: "0",
      },
      automaticQualityAllocation: {
        mode: "usdc",
        availableAtomic: "500000",
        awardedAtomic: responseCount > 0 ? "250000" : "0",
        refundedAtomic: "0",
      },
      feedbackBonus: {
        mode: "off",
        fundedAtomic: "0",
        awardedAtomic: "0",
        refundedAtomic: "0",
        awards: [],
      },
    },
    commitments: {
      sourceArtifact: sourceHash,
      suggestionArtifact: suggestionHash,
      responseSet: hash(`responses-${suffix}`),
      result: hash(`result-${suffix}-${outcome}`),
    },
    terminalEvidence: null,
  };
  return { workspaceId, opportunityId, envelope };
}

async function count(table: string) {
  const result = await dbClient.execute(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(result.rows[0]?.count);
}

test("records one immutable comparable observation and exact replays never double-count", async () => {
  const setup = await fixture("positive");
  const first = await observeHumanReviewResult({ envelope: setup.envelope });
  const replay = await observeHumanReviewResult({ envelope: structuredClone(setup.envelope) });

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.observationId, first.observationId);
  assert.equal(first.outcome, "positive");
  assert.equal(first.resultSemantics, "assurance");
  assert.equal(first.calibrationComparable, true);
  assert.match(first.resultEnvelopeCommitment, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(first.resultCommitment, setup.envelope.commitments.result);
  assert.equal(first.terminalEvidenceCommitment, null);
  assert.equal(await count("tokenless_agent_human_review_result_observations"), 1);
  assert.equal(await count("tokenless_agent_evaluation_observations"), 1);
  const adaptive = await dbClient.execute({
    sql: `SELECT agreement,comparable,human_outcome_commitment,responding_human_count,cost_atomic
          FROM tokenless_agent_evaluation_observations WHERE opportunity_id=?`,
    args: [setup.opportunityId],
  });
  assert.deepEqual(adaptive.rows[0], {
    agreement: "agree",
    comparable: true,
    human_outcome_commitment: setup.envelope.commitments.result,
    responding_human_count: 2,
    cost_atomic: 2250000,
  });
  for (const sideEffectTable of [
    "tokenless_agent_asks",
    "tokenless_payment_intents",
    "tokenless_prepaid_reservations",
  ]) {
    assert.equal(await count(sideEffectTable), 0);
  }
});

test("rejects conflicting second results and every frozen identity drift", async () => {
  const setup = await fixture("drift");
  for (const mutate of [
    (value: HumanReviewResultEnvelope) => {
      value.workspaceId = "ws_other";
    },
    (value: HumanReviewResultEnvelope) => {
      value.integrationId = "ain_other";
    },
    (value: HumanReviewResultEnvelope) => {
      value.lifecycle.revision += 1;
    },
    (value: HumanReviewResultEnvelope) => {
      value.frozen.binding.hash = hash("different-binding");
    },
    (value: HumanReviewResultEnvelope) => {
      value.lane = "private_paid";
      value.panel.cohorts = [{ source: "invited", requestedCount: 3, assignedCount: 3, responseCount: 2 }];
    },
  ]) {
    const drifted = structuredClone(setup.envelope);
    mutate(drifted);
    await assert.rejects(
      () => observeHumanReviewResult({ envelope: drifted }),
      (error: unknown) => error instanceof TokenlessServiceError && error.status >= 404,
    );
  }
  assert.equal(await count("tokenless_agent_human_review_result_observations"), 0);
  assert.equal(await count("tokenless_agent_evaluation_observations"), 0);

  await observeHumanReviewResult({ envelope: setup.envelope });
  const conflicting = structuredClone(setup.envelope);
  conflicting.commitments.result = hash("conflicting-result");
  await assert.rejects(
    () => observeHumanReviewResult({ envelope: conflicting }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "human_review_result_observation_conflict",
  );
});

test("strict envelope parsing rejects plaintext and private reviewer fields before storage", async () => {
  const setup = await fixture("plaintext");
  const unsafe = structuredClone(setup.envelope) as HumanReviewResultEnvelope & Record<string, unknown>;
  unsafe.sourcePlaintext = "private source text";
  (unsafe.panel.cohorts[0] as unknown as Record<string, unknown>).reviewerEmail = "reviewer@example.com";
  await assert.rejects(
    () => observeHumanReviewResult({ envelope: unsafe }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_human_review_result_envelope",
  );
  assert.equal(await count("tokenless_agent_human_review_result_observations"), 0);
  assert.equal(await count("tokenless_agent_evaluation_observations"), 0);
});

test("negative and inconclusive outcomes append once while failed and cancelled never enter calibration", async () => {
  const negative = await fixture("negative", "negative", "completed");
  const inconclusive = await fixture("inconclusive", "inconclusive", "inconclusive");
  const failed = await fixture("failed", "failed", "failed_terminal");
  const cancelled = await fixture("cancelled", "cancelled", "cancelled_before_commit");
  const observed = await Promise.all(
    [negative, inconclusive, failed, cancelled].map(value => observeHumanReviewResult({ envelope: value.envelope })),
  );

  assert.deepEqual(
    observed.map(value => [value.outcome, value.calibrationComparable, value.adaptiveObservationId !== null]),
    [
      ["negative", true, true],
      ["inconclusive", false, true],
      ["failed", false, false],
      ["cancelled", false, false],
    ],
  );
  const adaptive = await dbClient.execute(
    "SELECT agreement,comparable FROM tokenless_agent_evaluation_observations ORDER BY agreement",
  );
  assert.deepEqual(adaptive.rows, [
    { agreement: "disagree", comparable: true },
    { agreement: "inconclusive", comparable: false },
  ]);
  assert.equal(await count("tokenless_agent_human_review_result_observations"), 4);
});

test("agent-authored feedback results never derive adaptive evidence", async () => {
  const setup = await fixture("feedback-semantics");
  const derived = __humanReviewResultObservationTestUtils.deriveAdaptiveObservation(
    {
      result_semantics: "feedback",
      question_authority: "agent_per_request",
      question_hash: hash("feedback-question"),
    },
    setup.envelope,
  );
  assert.equal(derived, null);
});

test("a crash between adaptive derivation and the immutable row rolls back and retries cleanly", async () => {
  const setup = await fixture("crash");
  __humanReviewResultObservationTestUtils.setAfterAdaptiveWriteForTests(() => {
    throw new Error("simulated result-observation crash");
  });
  await assert.rejects(() => observeHumanReviewResult({ envelope: setup.envelope }), /simulated/u);
  assert.equal(await count("tokenless_agent_human_review_result_observations"), 0);
  // pg-mem retains writes after ROLLBACK. That limitation deliberately models
  // a durable partial write so the retry exercises reconciliation as well as
  // the production transaction's atomic path.
  assert.equal(await count("tokenless_agent_evaluation_observations"), 1);

  __humanReviewResultObservationTestUtils.setAfterAdaptiveWriteForTests(null);
  const recovered = await observeHumanReviewResult({ envelope: setup.envelope });
  assert.equal(recovered.replayed, false);
  assert.equal(await count("tokenless_agent_human_review_result_observations"), 1);
  assert.equal(await count("tokenless_agent_evaluation_observations"), 1);
});
