import { PINNED_DRAND_CHAINS } from "@rateloop/node-utils/drand";
import { canonicalizeRfc8785 } from "@rateloop/node-utils/jcs";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  type DsaPart8AutomatedMeansEvaluationInput,
  normalizeDsaPart8AutomatedMeansEvaluationSet,
  recordDsaPart8DecisionFact,
} from "~~/lib/tokenless/dsaPart8SourceFacts";
import {
  type DsaPopulationRowInput,
  createDsaPopulationVersion,
  ingestDsaPopulationPage,
  reconcileAndFreezeDsaPopulation,
} from "~~/lib/tokenless/dsaPopulationLedger";
import {
  commitDsaReferenceSamplingEpoch,
  freezeDsaReferenceSamplingEpoch,
  loadDsaReferenceSamplingEpochSources,
} from "~~/lib/tokenless/dsaReferenceSamplingEpochs";
import { createAssuranceProject } from "~~/lib/tokenless/humanAssurance";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { deriveReferenceSystemIdentity } from "~~/lib/tokenless/referenceSampling";

const OWNER = "0x1111111111111111111111111111111111111111";
const SECOND_OWNER = "0x2222222222222222222222222222222222222222";
const chain = PINNED_DRAND_CHAINS["quicknet-t"];
const ROUND = 1;
const AVAILABLE_AT = new Date((chain.genesisTime + (ROUND - 1) * chain.period) * 1_000);
const COMMIT_AT = new Date(AVAILABLE_AT.getTime() - 10 * 60_000);
const SOURCE_FROZEN_AT = new Date(COMMIT_AT.getTime() - 1_000);
const FREEZE_AT = new Date(AVAILABLE_AT.getTime() + 1_000);
const POPULATION_END = new Date(COMMIT_AT.getTime() - 2 * 60 * 60_000);
const POPULATION_START = new Date(POPULATION_END.getTime() - 2 * 24 * 60 * 60_000);
const POPULATION_FROZEN_AT = new Date(COMMIT_AT.getTime() - 60 * 60_000);
const POPULATION_CREATED_AT = new Date(POPULATION_START.getTime() - 60_000);
const PAGE_INGESTED_AT = new Date(POPULATION_START.getTime() + 10 * 60_000);
const PART8_FACTS_CREATED_AT = new Date(POPULATION_START.getTime() + 20 * 60_000);
const beacon = {
  network: "quicknet-t" as const,
  chainInfo: {
    public_key: chain.publicKey,
    period: chain.period,
    genesis_time: chain.genesisTime,
    hash: chain.chainHash,
    groupHash: chain.groupHash,
    schemeID: chain.schemeId,
    metadata: { beaconID: chain.beaconId },
  },
  evidence: {
    round: 1,
    randomness: "5c1dd096cd32cd272fcd2ad6e4d46d33713d16618ede11bae63da90edc3fbb1b",
    signature: "81d347e1c4be0e4277112de281d3a52aa1190bbd2f0ad7954e22799d168e61b60b4a0c46fc5a2777963cb739a0243e21",
  },
  expectedRound: 1,
};

let databaseNow = COMMIT_AT;
let databaseCommitNow = COMMIT_AT;

function setMemoryDatabase() {
  __setDatabaseResourcesForTests(
    createMemoryDatabaseResources({
      transactionTimestamp: () => new Date(databaseNow.getTime()),
      commitTimestamp: () => new Date(databaseCommitNow.getTime()),
    }),
  );
}

beforeEach(() => {
  databaseNow = COMMIT_AT;
  databaseCommitNow = COMMIT_AT;
  setMemoryDatabase();
});
afterEach(() => __setDatabaseResourcesForTests(null));

type Fixture = Awaited<ReturnType<typeof fixture>>;

function row(index: number): DsaPopulationRowInput {
  const excluded = index === 6;
  return {
    engagementId: `sampling-engagement-${index}`,
    engagementVersion: 1,
    providerDecisionId: `sampling.decision:${index}`,
    decisionVersion: 1,
    service: "reference-pilot",
    sourceSystem: "moderation-api",
    decisionAt: new Date(POPULATION_START.getTime() + index * 60_000),
    language: "en",
    contentFormat: "text/plain",
    harmonisedCategory: "KEYWORD_OTHER",
    triggerSource: "automated_detection",
    policyVersion: "policy-2023-07",
    automatedSystemVersion: "classifier-2023-07",
    originalAutomatedLabel: index === 2 ? "restricted" : "allowed",
    originalRestriction: index === 2 ? "content_disabled" : "none",
    eligibilityStatus: excluded ? "excluded" : "eligible",
    exclusionReason: excluded ? "outside_sampling_scope" : null,
    contentHash: `sha256:${index.toString(16).padStart(64, "0")}`,
    contentLocator: `dsaobj_sampling_${String(index).padStart(16, "0")}`,
    partitionValues: { language: "en" },
    sorApplicability: "restriction_outside_article_17",
    nonRequiredBasis: "restriction_outside_article_17",
  };
}

function evaluation(
  index: number,
  suffix: string,
  systemId: "system_alpha" | "system_beta",
  automatedOutcome: "pass" | "fail",
): DsaPart8AutomatedMeansEvaluationInput {
  return {
    evaluationId: `evaluation_${String(index).padStart(8, "0")}_${suffix}`,
    systemId,
    systemVersion: systemId === "system_alpha" ? "1.0.0" : "2023.07",
    machineClass: systemId === "system_alpha" ? "text_classifier" : "rules_engine",
    publicDesignation: systemId === "system_alpha" ? "Alpha text moderation" : "Beta policy rules",
    automatedOutcome,
  };
}

function evaluationsFor(index: number): readonly DsaPart8AutomatedMeansEvaluationInput[] {
  if (index === 1)
    return [evaluation(index, "alpha", "system_alpha", "pass"), evaluation(index, "beta", "system_beta", "fail")];
  if (index === 2) return [evaluation(index, "alpha", "system_alpha", "fail")];
  if (index === 3) return [evaluation(index, "alpha", "system_alpha", "pass")];
  if (index === 4) return [];
  if (index === 5) return [evaluation(index, "beta", "system_beta", "pass")];
  return [evaluation(index, "alpha", "system_alpha", "pass")];
}

async function fixture(input: { owner?: string; name?: string; omitPart8Index?: number } = {}) {
  const owner = input.owner ?? OWNER;
  const workspace = await createWorkspace({ name: input.name ?? "Reference sampling", ownerAddress: owner });
  const project = await createAssuranceProject({
    principal: { kind: "workspace_session", accountAddress: owner, workspaceId: workspace.workspaceId, role: "owner" },
    name: "Reference benchmark",
    dataClassification: "public",
    visibility: "public",
    publicMaterialKind: "synthetic",
    confirmedNoSensitiveData: true,
    retentionDays: 365,
  });
  const rows = [1, 2, 3, 4, 5, 6].map(row);
  const populationId = owner === OWNER ? "sampling_population_first" : "sampling_population_second";
  databaseNow = POPULATION_CREATED_AT;
  await createDsaPopulationVersion({
    accountAddress: owner,
    workspaceId: workspace.workspaceId,
    populationId,
    version: 1,
    periodStart: POPULATION_START,
    periodEnd: POPULATION_END,
    sourceSystems: ["moderation-api"],
    partitionDimensions: ["language"],
    declaredSourceTotals: { "moderation-api": rows.length },
    declaredPartitionTotals: [{ values: { language: "en" }, total: rows.length }],
    expectedSourceManifest: rows.map(entry => ({
      providerDecisionId: entry.providerDecisionId,
      decisionVersion: entry.decisionVersion,
    })),
    expectedRowCount: rows.length,
    expectedPageCount: 1,
  });
  databaseNow = PAGE_INGESTED_AT;
  await ingestDsaPopulationPage({
    accountAddress: owner,
    workspaceId: workspace.workspaceId,
    populationId,
    populationVersion: 1,
    pageNumber: 1,
    idempotencyKey: "sampling-page-0001",
    rows,
  });
  databaseNow = PART8_FACTS_CREATED_AT;
  for (const [offset, source] of rows.entries()) {
    const index = offset + 1;
    if (index === input.omitPart8Index) continue;
    const evaluations = evaluationsFor(index);
    const evaluationSet = normalizeDsaPart8AutomatedMeansEvaluationSet(evaluations);
    await recordDsaPart8DecisionFact({
      accountAddress: owner,
      workspaceId: workspace.workspaceId,
      providerDecisionId: source.providerDecisionId,
      decisionVersion: source.decisionVersion,
      fact: {
        measureTaken: index !== 3,
        moderationMeasureId: index === 3 ? null : `measure_${String(index).padStart(8, "0")}`,
        origin: "own_initiative",
        automationProcessing: index === 4 ? "not_automated" : index === 5 ? "partially_automated" : "solely_automated",
        expectedEvaluationCount: evaluationSet.evaluations.length,
        evaluationSetRoot: evaluationSet.evaluationSetRoot,
        article16NoticeId: null,
        notifierClass: null,
        languageAttribution: { languageCodes: ["en"], noLanguageReason: null },
      },
      evaluations,
    });
  }
  databaseNow = POPULATION_FROZEN_AT;
  const frozen = await reconcileAndFreezeDsaPopulation({
    accountAddress: owner,
    workspaceId: workspace.workspaceId,
    populationId,
    populationVersion: 1,
  });
  assert.equal(frozen.status, "frozen");
  databaseNow = SOURCE_FROZEN_AT;
  databaseCommitNow = COMMIT_AT;
  return { owner, workspaceId: workspace.workspaceId, projectId: project.projectId, populationId, rows };
}

function commitInput(value: Fixture) {
  return {
    accountAddress: value.owner,
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    benchmarkId: "benchmark_reference_1",
    activationReference: "activation_reference_1",
    deploymentKey: "deployment_tokenless_1",
    populationId: value.populationId,
    populationVersion: 1,
    purpose: "dsa_reference",
    sampleSizePlanId: "sample_plan_pilot_1",
    sampleSizePlanVersion: 1,
    sampleSizes: [
      { systemId: "system_alpha", systemVersion: "1.0.0", automatedFail: 1, automatedPass: 1 },
      { systemId: "system_beta", systemVersion: "2023.07", automatedFail: 1, automatedPass: 1 },
    ],
    beaconNetwork: "quicknet-t" as const,
    beaconRound: ROUND,
  };
}

test("commits complete decision and multi-system evaluation projections", async () => {
  const context = await fixture();
  const committed = await commitDsaReferenceSamplingEpoch(commitInput(context));
  assert.equal(committed.idempotent, false);
  assert.equal(committed.commitment.witness.committedAt, COMMIT_AT.toISOString());
  assert.equal(committed.commitment.witness.sourceFrozenAt, SOURCE_FROZEN_AT.toISOString());
  assert.equal(committed.commitment.source.populationFrozenAt, POPULATION_FROZEN_AT.toISOString());
  assert.equal(committed.commitment.source.populationCount, 6);
  assert.equal(committed.commitment.source.eligibleDrawUnitCount, 5);
  assert.equal(committed.commitment.source.evaluatedDecisionCount, 4);
  assert.equal(committed.commitment.source.notAutomatedDecisionCount, 1);
  assert.equal(committed.commitment.source.excludedDecisionCount, 1);
  assert.equal(committed.commitment.strata.length, 4);
  assert.ok(committed.commitment.strata.every(cell => cell.sampleSize === 1 && cell.gap === null));

  const decisions = await dbClient.execute({
    sql: `SELECT disposition FROM tokenless_dsa_reference_decision_projections
          WHERE workspace_id=? AND epoch_id=? ORDER BY provider_decision_id`,
    args: [context.workspaceId, committed.epochId],
  });
  assert.deepEqual(
    decisions.rows.map(row => row.disposition),
    ["evaluated", "evaluated", "evaluated", "not_automated", "evaluated", "excluded"],
  );
  const evaluations = await dbClient.execute({
    sql: `SELECT provider_decision_id,disposition,system_id,automated_outcome
          FROM tokenless_dsa_reference_evaluation_projections
          WHERE workspace_id=? AND epoch_id=? ORDER BY provider_decision_id,evaluation_id`,
    args: [context.workspaceId, committed.epochId],
  });
  assert.equal(evaluations.rows.length, 6);
  assert.equal(evaluations.rows.filter(row => row.provider_decision_id === "sampling.decision:1").length, 2);
  assert.equal(evaluations.rows.filter(row => row.disposition === "eligible_draw").length, 5);
});

test("replay reconstructs exact decision and evaluation sets", async () => {
  const context = await fixture();
  const committed = await commitDsaReferenceSamplingEpoch(commitInput(context));
  const replay = await commitDsaReferenceSamplingEpoch(commitInput(context));
  assert.equal(replay.idempotent, true);
  assert.deepEqual(replay.commitment, committed.commitment);

  const loaded = await loadDsaReferenceSamplingEpochSources({
    accountAddress: context.owner,
    workspaceId: context.workspaceId,
    epochId: committed.epochId,
  });
  assert.equal(loaded.sources.length, 6);
  assert.equal(loaded.evaluations.length, 6);
  assert.deepEqual(loaded.commitment, committed.commitment);

  const stored = await dbClient.execute({
    sql: `SELECT projection_json FROM tokenless_dsa_reference_evaluation_projections
          WHERE workspace_id=? AND epoch_id=? AND evaluation_id=?`,
    args: [context.workspaceId, committed.epochId, "evaluation_00000001_alpha"],
  });
  const tampered = JSON.parse(String(stored.rows[0]!.projection_json)) as Record<string, unknown>;
  tampered.publicDesignation = "Tampered system";
  await dbClient.execute({
    sql: `UPDATE tokenless_dsa_reference_evaluation_projections SET projection_json=?
          WHERE workspace_id=? AND epoch_id=? AND evaluation_id=?`,
    args: [canonicalizeRfc8785(tampered), context.workspaceId, committed.epochId, "evaluation_00000001_alpha"],
  });
  await assert.rejects(
    loadDsaReferenceSamplingEpochSources({
      accountAddress: context.owner,
      workspaceId: context.workspaceId,
      epochId: committed.epochId,
    }),
    /Stored DSA reference-sampling evidence is invalid/u,
  );
});

test("freezes per-system samples with manifest-level probabilities and replays exactly", async () => {
  const context = await fixture();
  const committed = await commitDsaReferenceSamplingEpoch(commitInput(context));
  databaseNow = FREEZE_AT;
  const frozen = await freezeDsaReferenceSamplingEpoch({
    accountAddress: context.owner,
    workspaceId: context.workspaceId,
    epochId: committed.epochId,
    beacon,
  });
  assert.equal(frozen.idempotent, false);
  assert.equal(frozen.sample.manifest.length, 5);
  assert.equal(frozen.sample.manifest.filter(row => row.selected).length, 4);
  for (const row of frozen.sample.manifest) {
    assert.equal(row.systemIdentity, deriveReferenceSystemIdentity(row));
    const cell = committed.commitment.strata.find(
      candidate =>
        candidate.systemIdentity === row.systemIdentity && candidate.automatedOutcome === row.automatedOutcome,
    )!;
    assert.deepEqual(row.inclusionProbability, { numerator: cell.sampleSize, denominator: cell.eligibleCount });
  }
  const replay = await freezeDsaReferenceSamplingEpoch({
    accountAddress: context.owner,
    workspaceId: context.workspaceId,
    epochId: committed.epochId,
    beacon,
  });
  assert.equal(replay.idempotent, true);
  assert.deepEqual(replay.sample, frozen.sample);
});

test("fails closed on incomplete facts, late wall-clock commitment, and cross-tenant context", async () => {
  const incomplete = await fixture({ omitPart8Index: 3 });
  await assert.rejects(commitDsaReferenceSamplingEpoch(commitInput(incomplete)), /lack immutable Part 8 source facts/u);

  setMemoryDatabase();
  const context = await fixture({ name: "Late reference" });
  databaseCommitNow = new Date(AVAILABLE_AT.getTime() - 60_000);
  await assert.rejects(commitDsaReferenceSamplingEpoch(commitInput(context)), /at least five minutes/u);

  setMemoryDatabase();
  const first = await fixture({ name: "First context" });
  const second = await fixture({ owner: SECOND_OWNER, name: "Second context" });
  await assert.rejects(
    commitDsaReferenceSamplingEpoch({ ...commitInput(first), projectId: second.projectId }),
    /Assurance project not found/u,
  );
});
