import { sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import {
  DSA_PART8_COUNT_DECISION_PROJECTION_SCHEMA_VERSION,
  DSA_PART8_COUNT_EVALUATION_PROJECTION_SCHEMA_VERSION,
  DSA_PART8_COUNT_MEASURE_PROJECTION_SCHEMA_VERSION,
  DSA_PART8_COUNT_NOTICE_PROJECTION_SCHEMA_VERSION,
  DSA_PART8_WITNESSED_COUNT_CONTRACT_SCHEMA_VERSION,
  DSA_PART8_WITNESSED_COUNT_RESULT_SCHEMA_VERSION,
  type DsaPart8CountWitness,
  type WitnessedDsaPart8CountBundle,
  __testUtils,
  buildDsaPart8CountWitness,
  buildWitnessedDsaPart8CountBundle,
  verifyWitnessedDsaPart8CountBundle,
} from "~~/lib/tokenless/dsaPart8CountContracts";
import {
  __dsaPart8InventoryAndNoticesTestUtils,
  sealDsaPart8NoticeProcessingFact,
} from "~~/lib/tokenless/dsaPart8InventoryAndNotices";
import {
  DSA_PART8_EMPTY_AUTOMATED_MEANS_EVALUATION_SET_ROOT,
  normalizeDsaPart8AutomatedMeansEvaluation,
  normalizeDsaPart8AutomatedMeansEvaluationSet,
  normalizeDsaPart8DecisionFact,
} from "~~/lib/tokenless/dsaPart8SourceFacts";

const SYSTEM = {
  systemId: "classifier_primary",
  systemVersion: "2026.1",
  machineClass: "text_classifier",
  publicDesignation: "Safety text classifier",
} as const;
const POPULATION_ROOT = sha256Rfc8785({ population: "2026-h1" });

function testWitness() {
  return buildDsaPart8CountWitness({
    sourceFrozenAt: new Date("2027-01-01T00:03:00.000Z"),
    committedAt: new Date("2027-01-02T12:30:00.000Z"),
    audit: {
      eventId: "audit_0123456789abcdef0123456789abcdef",
      eventDigest: sha256Rfc8785({ audit: 1 }),
    },
    attestationJobId: "aat_0123456789abcdef0123456789abcdef01234567",
  });
}

function fixture(witness: DsaPart8CountWitness = testWitness()) {
  const automatedEvaluation = normalizeDsaPart8AutomatedMeansEvaluation({
    evaluationId: "evaluation_00000001",
    ...SYSTEM,
    automatedOutcome: "fail",
  });
  const evaluationSet = normalizeDsaPart8AutomatedMeansEvaluationSet([
    {
      evaluationId: automatedEvaluation.evaluationId,
      systemId: automatedEvaluation.systemId,
      systemVersion: automatedEvaluation.systemVersion,
      machineClass: automatedEvaluation.machineClass,
      publicDesignation: automatedEvaluation.publicDesignation,
      automatedOutcome: automatedEvaluation.automatedOutcome,
    },
  ]);
  const inventory = __dsaPart8InventoryAndNoticesTestUtils.buildFrozenInventory({
    workspaceId: "workspace_test",
    populationId: "population_2026_h1",
    populationVersion: 1,
    populationRoot: POPULATION_ROOT,
    populationFrozenAt: new Date("2027-01-01T00:00:00.000Z"),
    serviceId: "service.test",
    sourceRegistryDigest: sha256Rfc8785({ registry: 1 }),
    sourceFrozenAt: new Date("2027-01-01T00:01:00.000Z"),
    frozenAt: new Date("2027-01-01T00:02:00.000Z"),
    declaredSystems: [SYSTEM],
    observedSystems: [{ ...SYSTEM, observedEvaluationCount: 1 }],
  });
  const noAction = normalizeDsaPart8DecisionFact({
    measureTaken: false,
    moderationMeasureId: null,
    origin: "own_initiative",
    automationProcessing: "not_automated",
    expectedEvaluationCount: 0,
    evaluationSetRoot: DSA_PART8_EMPTY_AUTOMATED_MEANS_EVALUATION_SET_ROOT,
    article16NoticeId: null,
    notifierClass: null,
    languageAttribution: { languageCodes: [], noLanguageReason: "not_applicable" },
  });
  const partial = normalizeDsaPart8DecisionFact({
    measureTaken: true,
    moderationMeasureId: "measure_00000001",
    origin: "own_initiative",
    automationProcessing: "partially_automated",
    expectedEvaluationCount: 1,
    evaluationSetRoot: evaluationSet.evaluationSetRoot,
    article16NoticeId: null,
    notifierClass: null,
    languageAttribution: { languageCodes: ["en"], noLanguageReason: null },
  });
  const decisions = [
    {
      providerDecisionId: "decision_no_action",
      decisionVersion: 1,
      engagementId: "engagement_no_action",
      engagementVersion: 1,
      sourceDecisionHash: sha256Rfc8785({ decision: "no-action" }),
      engagementHash: sha256Rfc8785({ engagement: "no-action" }),
      decisionAt: "2026-03-01T00:00:00.000Z",
      part8Fact: noAction,
      part8FactHash: sha256Rfc8785(noAction),
    },
    {
      providerDecisionId: "decision_partial",
      decisionVersion: 1,
      engagementId: "engagement_partial",
      engagementVersion: 1,
      sourceDecisionHash: sha256Rfc8785({ decision: "partial" }),
      engagementHash: sha256Rfc8785({ engagement: "partial" }),
      decisionAt: "2026-04-01T00:00:00.000Z",
      part8Fact: partial,
      part8FactHash: sha256Rfc8785(partial),
    },
  ] as const;
  const notices = [
    sealDsaPart8NoticeProcessingFact({
      noticeId: "notice_00000001",
      factVersion: 2,
      serviceId: "service.test",
      receivedAt: new Date("2026-05-01T00:00:00.000Z"),
      sourceNoticeBinding: sha256Rfc8785({ notice: 1 }),
      processingStatus: "processing_incomplete",
      automationProcessing: null,
      notifierClass: "trusted_flagger",
      supersedesFactVersion: 1,
      correctionReason: "Correct the current processing state.",
    }),
  ];
  return buildWitnessedDsaPart8CountBundle({
    workspaceId: "workspace_test",
    contractId: "dsa8c_0123456789abcdef0123456789abcdef01234567",
    serviceId: "service.test",
    providerType: "online_platform",
    reportingPeriod: { startInclusive: "2026-01-01T00:00:00.000Z", endExclusive: "2027-01-01T00:00:00.000Z" },
    population: {
      populationId: "population_2026_h1",
      populationVersion: 1,
      populationRoot: POPULATION_ROOT,
      populationFrozenAt: "2027-01-01T00:00:00.000Z",
      reconciliationVersion: 2,
      reconciliationHash: sha256Rfc8785({ reconciliation: 2 }),
    },
    classifierInventory: inventory,
    witness,
    decisions,
    evaluations: [
      {
        providerDecisionId: "decision_partial",
        decisionVersion: 1,
        sourceEvaluationHash: sha256Rfc8785(automatedEvaluation),
        evaluation: automatedEvaluation,
      },
    ],
    notices,
  });
}

test("freezes four distinct exact roots and keeps no-action separate from the taken-measure subset", () => {
  const bundle = fixture();
  assert.equal(bundle.contract.schemaVersion, DSA_PART8_WITNESSED_COUNT_CONTRACT_SCHEMA_VERSION);
  assert.equal(bundle.result.schemaVersion, DSA_PART8_WITNESSED_COUNT_RESULT_SCHEMA_VERSION);
  assert.equal(bundle.contract.expectedDecisionCount, 2);
  assert.equal(bundle.contract.expectedMeasureCount, 1);
  assert.equal(bundle.decisionProjections.length, 2);
  assert.equal(bundle.measureProjections.length, 1);
  assert.equal(bundle.decisionProjections[0]?.schemaVersion, DSA_PART8_COUNT_DECISION_PROJECTION_SCHEMA_VERSION);
  assert.equal(bundle.measureProjections[0]?.schemaVersion, DSA_PART8_COUNT_MEASURE_PROJECTION_SCHEMA_VERSION);
  assert.equal(bundle.evaluationProjections[0]?.schemaVersion, DSA_PART8_COUNT_EVALUATION_PROJECTION_SCHEMA_VERSION);
  assert.equal(bundle.noticeProjections[0]?.schemaVersion, DSA_PART8_COUNT_NOTICE_PROJECTION_SCHEMA_VERSION);
  assert.notEqual(bundle.contract.decisionProjectionRoot, bundle.contract.measureProjectionRoot);
  assert.equal(bundle.result.partiallyAutomatedDecisionCount, 1);
  assert.equal(bundle.result.partiallyAutomatedMeasureCount, 1);
  assert.equal(bundle.result.incompleteNoticeCount, 1);
  assert.equal(bundle.result.expectedCellCount, 8);
  assert.equal(bundle.countCells.length, 8);
  assert.ok(bundle.countCells.some(cell => cell.result.status === "coverage_gap"));
  assert.deepEqual(verifyWitnessedDsaPart8CountBundle(bundle), bundle);
});

test("offline verification rejects audit, engagement, evaluation, notice, and count-cell substitution", () => {
  const bundle = fixture();
  assert.throws(() =>
    verifyWitnessedDsaPart8CountBundle({
      ...bundle,
      contract: {
        ...bundle.contract,
        witness: { ...bundle.contract.witness, auditEventId: "audit_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      },
    }),
  );
  assert.throws(() =>
    verifyWitnessedDsaPart8CountBundle({
      ...bundle,
      decisionProjections: bundle.decisionProjections.map((row, index) =>
        index ? { ...row, engagementId: "engagement_substitute" } : row,
      ),
    }),
  );
  assert.throws(() =>
    verifyWitnessedDsaPart8CountBundle({
      ...bundle,
      evaluationProjections: [{ ...bundle.evaluationProjections[0]!, providerDecisionId: "decision_no_action" }],
    }),
  );
  assert.throws(() =>
    verifyWitnessedDsaPart8CountBundle({
      ...bundle,
      noticeProjections: [{ ...bundle.noticeProjections[0]!, coverageGap: null }],
    }),
  );
  assert.throws(() =>
    verifyWitnessedDsaPart8CountBundle({
      ...bundle,
      countCells: bundle.countCells.slice(1),
    }),
  );
});

test("accepts a long transaction clock gap but rejects a commit clock before the source snapshot", () => {
  const bundle = fixture();
  assert.equal(bundle.contract.witness.committedAt, "2027-01-02T12:30:00.000Z");
  const input = {
    ...bundle,
    contract: {
      ...bundle.contract,
      witness: { ...bundle.contract.witness, committedAt: "2027-01-01T00:02:59.999Z" },
    },
  };
  assert.throws(() => verifyWitnessedDsaPart8CountBundle(input));
});

test("persistence transaction rolls back an audit when attestation enqueue fails and commits an exact reload", async () => {
  let stagedBundle: WitnessedDsaPart8CountBundle | null = null;
  let committedBundle: WitnessedDsaPart8CountBundle | null = null;
  let stagedAudit = false;
  const commands: string[] = [];
  const client = {
    async query(sql: string) {
      commands.push(sql);
      if (sql === "COMMIT") {
        committedBundle = stagedBundle;
        stagedAudit = false;
      }
      if (sql === "ROLLBACK") {
        stagedBundle = null;
        stagedAudit = false;
      }
      return { rowCount: 0, rows: [] };
    },
    release() {
      throw new Error("The injected transaction client must not be released by the facade.");
    },
  } as unknown as PoolClient;
  const auditResult = {
    eventId: "audit_0123456789abcdef0123456789abcdef",
    eventDigest: sha256Rfc8785({ audit: 1 }),
    previousDigest: sha256Rfc8785({ audit: 0 }),
    sequence: 1,
  };
  const auditInput = {
    workspaceId: "workspace_test",
    actorKind: "account" as const,
    actorReference: "eip155:8453:0x0000000000000000000000000000000000000001",
    assuranceMethod: "workspace_manager_session",
    action: "dsa_part8_count_contract_committed",
    targetKind: "dsa_part8_count_contract",
    targetId: "dsa8c_0123456789abcdef0123456789abcdef01234567",
    purpose: "dsa_part8_reporting",
    reason: "Commit test census.",
    result: "success" as const,
    occurredAt: new Date("2027-01-02T12:30:00.000Z"),
  };
  const base = {
    client,
    actor: auditInput.actorReference,
    sourceFrozenAt: new Date("2027-01-01T00:03:00.000Z"),
    committedAt: new Date("2027-01-02T12:30:00.000Z"),
    auditInput,
    buildBundle: (witness: DsaPart8CountWitness) => fixture(witness),
  };
  const appendAudit = async () => {
    stagedAudit = true;
    return auditResult;
  };
  const persist = async (_client: PoolClient, _actor: string, bundle: WitnessedDsaPart8CountBundle) => {
    assert.equal(stagedAudit, true);
    stagedBundle = bundle;
  };
  await assert.rejects(
    __testUtils.runRepeatableRead(
      client,
      async () =>
        __testUtils.commitCountPersistenceFacade(base, {
          appendAudit,
          enqueueAttestation: async () => {
            throw new Error("attestation queue unavailable");
          },
          persist,
        }),
      false,
    ),
    /attestation queue unavailable/u,
  );
  assert.equal(committedBundle, null);
  assert.equal(stagedAudit, false);
  assert.equal(commands.at(-1), "ROLLBACK");

  commands.length = 0;
  const written = await __testUtils.runRepeatableRead(
    client,
    async () =>
      __testUtils.commitCountPersistenceFacade(base, {
        appendAudit,
        enqueueAttestation: async () => ({
          jobId: "aat_0123456789abcdef0123456789abcdef01234567",
          replay: false as const,
        }),
        persist,
      }),
    false,
  );
  assert.equal(commands.at(-1), "COMMIT");
  assert.deepEqual(committedBundle, written);
  const reloaded = verifyWitnessedDsaPart8CountBundle(committedBundle!);
  assert.equal(reloaded.countCells.length, 8);
  assert.equal(reloaded.result.cellRoot, written.result.cellRoot);
});
