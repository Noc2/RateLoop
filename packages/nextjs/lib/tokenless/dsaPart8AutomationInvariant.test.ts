import { PINNED_DRAND_CHAINS } from "@rateloop/node-utils/drand";
import { sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  type DsaAutomatedMeansReferenceFact,
  estimateDsaAutomatedMeansMetrics,
} from "~~/lib/tokenless/dsaAutomatedMeansEstimates";
import {
  DSA_PART8_CENSUS_WITNESS_SCHEMA_VERSION,
  DSA_PART8_COUNT_CONTRACT_SCHEMA_VERSION,
  DSA_PART8_COUNT_DECISION_FACT_SCHEMA_VERSION,
  DSA_PART8_COUNT_EVALUATION_FACT_SCHEMA_VERSION,
  DSA_PART8_COUNT_INDICATORS,
  DSA_PART8_NOTICE_PROCESSING_FACT_SCHEMA_VERSION,
  countDsaPart8,
  freezeDsaPart8CountContract,
  sealDsaPart8CountDecisionFact,
  sealDsaPart8CountEvaluationFact,
  sealDsaPart8NoticeProcessingFact,
} from "~~/lib/tokenless/dsaPart8Counts";
import { DSA_PART8_OFFICIAL_INDICATORS, expectedDsaPart8Section16RowCount } from "~~/lib/tokenless/dsaPart8Export";
import {
  DSA_PART8_AUTOMATION_PROCESSING,
  DSA_PART8_NOT_AUTOMATED,
  DSA_PART8_PARTIALLY_AUTOMATED,
  DSA_PART8_SOLELY_AUTOMATED,
  type DsaPart8AutomatedMeansEvaluationInput,
  type DsaPart8DecisionFactInput,
  normalizeDsaPart8AutomatedMeansEvaluation,
  normalizeDsaPart8AutomatedMeansEvaluationSet,
  normalizeDsaPart8DecisionFact,
} from "~~/lib/tokenless/dsaPart8SourceFacts";
import {
  type ReferenceFrameSourceBinding,
  type ReferenceFrameUnit,
  createReferenceFrameCommitment,
  deriveReferenceSystemIdentity,
  freezeReferenceSample,
} from "~~/lib/tokenless/referenceSampling";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const migration0169 = readFileSync(new URL("../../drizzle/0169_dsa_part8_source_facts.sql", import.meta.url), "utf8");
const migration0170 = readFileSync(
  new URL("../../drizzle/0170_dsa_reference_sampling_epochs.sql", import.meta.url),
  "utf8",
);
const serviceId = "official_service";
const inventory = {
  systemId: "classifier_official",
  version: "v1",
  machineClass: "text_classifier",
  publicDesignation: "Official text classifier",
} as const;
const secondInventory = {
  systemId: "classifier_rules_official",
  version: "v2",
  machineClass: "rules_engine",
  publicDesignation: "Official policy rules",
} as const;

function evaluation(
  index: number,
  automatedOutcome: "pass" | "fail",
  system: typeof inventory | typeof secondInventory = inventory,
): DsaPart8AutomatedMeansEvaluationInput {
  return {
    evaluationId: `evaluation_official_${String(index).padStart(8, "0")}`,
    systemId: system.systemId,
    systemVersion: system.version,
    machineClass: system.machineClass,
    publicDesignation: system.publicDesignation,
    automatedOutcome,
  };
}

function sourceFact(
  index: number,
  automationProcessing: DsaPart8DecisionFactInput["automationProcessing"],
  evaluations: readonly DsaPart8AutomatedMeansEvaluationInput[],
  measureTaken = true,
): DsaPart8DecisionFactInput {
  const set = normalizeDsaPart8AutomatedMeansEvaluationSet(evaluations);
  return {
    measureTaken,
    moderationMeasureId: measureTaken ? `measure_official_${String(index).padStart(8, "0")}` : null,
    origin: "own_initiative",
    automationProcessing,
    expectedEvaluationCount: set.evaluations.length,
    evaluationSetRoot: set.evaluationSetRoot,
    article16NoticeId: null,
    notifierClass: null,
    languageAttribution: { languageCodes: ["en"], noLanguageReason: null },
  };
}

test("source, evaluation, count, persistence, and export consumers share one three-state automation invariant", () => {
  assert.deepEqual(DSA_PART8_AUTOMATION_PROCESSING, ["solely_automated", "partially_automated", "not_automated"]);
  const solelyEvaluation = evaluation(1, "fail");
  const secondSystemEvaluation = evaluation(2, "pass", secondInventory);
  const partialEvaluation = evaluation(3, "pass");
  const solely = sourceFact(1, DSA_PART8_SOLELY_AUTOMATED, [solelyEvaluation, secondSystemEvaluation]);
  const partial = sourceFact(2, DSA_PART8_PARTIALLY_AUTOMATED, [partialEvaluation], false);
  const notAutomated = sourceFact(3, DSA_PART8_NOT_AUTOMATED, []);
  assert.equal(normalizeDsaPart8DecisionFact(partial).expectedEvaluationCount, 1);
  assert.throws(
    () => normalizeDsaPart8DecisionFact({ ...notAutomated, automationProcessing: "not_solely_automated" } as never),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_dsa_part8_decision_fact",
  );

  const decisions = [solely, partial, notAutomated].map((fact, index) =>
    sealDsaPart8CountDecisionFact({
      schemaVersion: DSA_PART8_COUNT_DECISION_FACT_SCHEMA_VERSION,
      serviceId,
      occurredAt: `2026-06-0${index + 1}T00:00:00.000Z`,
      sourceDecisionBinding: sha256Rfc8785({ decision: index + 1 }),
      sourceFact: fact,
    }),
  );
  const evaluationRows: Array<{
    rawEvaluation: DsaPart8AutomatedMeansEvaluationInput;
    automationProcessing: typeof DSA_PART8_SOLELY_AUTOMATED | typeof DSA_PART8_PARTIALLY_AUTOMATED;
    decisionIndex: number;
    evaluationIndex: number;
  }> = [
    {
      rawEvaluation: solelyEvaluation,
      automationProcessing: DSA_PART8_SOLELY_AUTOMATED,
      decisionIndex: 1,
      evaluationIndex: 1,
    },
    {
      rawEvaluation: secondSystemEvaluation,
      automationProcessing: DSA_PART8_SOLELY_AUTOMATED,
      decisionIndex: 1,
      evaluationIndex: 2,
    },
    {
      rawEvaluation: partialEvaluation,
      automationProcessing: DSA_PART8_PARTIALLY_AUTOMATED,
      decisionIndex: 2,
      evaluationIndex: 3,
    },
  ];
  const evaluationFacts = evaluationRows.map(
    ({ rawEvaluation, automationProcessing, decisionIndex, evaluationIndex }) => {
      const normalized = normalizeDsaPart8AutomatedMeansEvaluation(
        rawEvaluation as DsaPart8AutomatedMeansEvaluationInput,
      );
      return sealDsaPart8CountEvaluationFact({
        schemaVersion: DSA_PART8_COUNT_EVALUATION_FACT_SCHEMA_VERSION,
        serviceId,
        occurredAt: `2026-06-0${decisionIndex}T00:00:00.000Z`,
        sourceDecisionBinding: sha256Rfc8785({ decision: decisionIndex }),
        sourceEvaluationBinding: sha256Rfc8785({ evaluation: evaluationIndex }),
        sourceEvaluationHash: sha256Rfc8785(normalized),
        automationProcessing,
        evaluation: rawEvaluation,
      });
    },
  );
  const noticeFacts = [DSA_PART8_SOLELY_AUTOMATED, DSA_PART8_PARTIALLY_AUTOMATED, DSA_PART8_NOT_AUTOMATED].map(
    (automationProcessing, index) =>
      sealDsaPart8NoticeProcessingFact({
        schemaVersion: DSA_PART8_NOTICE_PROCESSING_FACT_SCHEMA_VERSION,
        serviceId,
        receivedAt: `2026-06-1${index}T00:00:00.000Z`,
        noticeId: `notice_official_${String(index).padStart(8, "0")}`,
        processingStatus: "processed_final",
        automationProcessing,
        notifierClass: "other",
      }),
  );
  const contract = freezeDsaPart8CountContract({
    spec: {
      schemaVersion: DSA_PART8_COUNT_CONTRACT_SCHEMA_VERSION,
      contractId: "dsa8c_official_invariant",
      service: { serviceId, providerType: "hosting_service" },
      reportingPeriod: { startInclusive: "2026-01-01T00:00:00.000Z", endExclusive: "2027-01-01T00:00:00.000Z" },
      classifierInventory: [inventory, secondInventory],
      censusWitness: {
        schemaVersion: DSA_PART8_CENSUS_WITNESS_SCHEMA_VERSION,
        kind: "database_transaction_and_attestation",
        censusId: "census_official_invariant",
        sourcePopulationId: "population_official_invariant",
        sourcePopulationVersion: 1,
        frozenAt: "2027-01-01T00:00:01.000Z",
        auditHeadDigest: sha256Rfc8785({ audit: "official" }),
        attestationJobId: "attestation_official_invariant",
      },
    },
    decisionFacts: decisions,
    evaluationFacts,
    noticeFacts,
  });
  const result = countDsaPart8({ contract, decisionFacts: decisions, evaluationFacts, noticeFacts });
  assert.equal(result.inputCoverage.partiallyAutomatedDecisionCount, 1);
  assert.equal(result.inputCoverage.partiallyAutomatedMeasureCount, 0);
  assert.equal(result.inputCoverage.partiallyAutomatedNoticeCount, 1);
  assert.ok(result.cells.some(cell => cell.indicator === "measures_solely_automated" && cell.result.value === 1));
  assert.ok(result.cells.some(cell => cell.indicator === "measures_not_automated" && cell.result.value === 1));
  assert.equal(evaluationFacts[0]!.sourceDecisionBinding, evaluationFacts[1]!.sourceDecisionBinding);
  assert.notEqual(evaluationFacts[0]!.sourceEvaluationBinding, evaluationFacts[1]!.sourceEvaluationBinding);
  assert.deepEqual(DSA_PART8_COUNT_INDICATORS, [
    "measures_solely_automated",
    "measures_not_automated",
    "notices_solely_automated",
    "notices_not_automated",
  ]);
  assert.equal(DSA_PART8_OFFICIAL_INDICATORS.measures_not_automated, "Number of measures not taken by automated means");
  assert.match(migration0169, /solely_automated.*partially_automated.*not_automated/su);
  assert.match(migration0170, /solely_automated.*partially_automated/su);
  assert.doesNotMatch([migration0169, migration0170].join("\n"), /not_solely_automated/u);
});

test("reference sampling and estimates preserve repeated decision bindings as distinct per-system evaluation units", () => {
  const chain = PINNED_DRAND_CHAINS["quicknet-t"];
  const sharedDecisionBinding = sha256Rfc8785({ decision: "shared" });
  const systems = [inventory, secondInventory].map(system => ({
    systemId: system.systemId,
    systemVersion: system.version,
    machineClass: system.machineClass,
    publicDesignation: system.publicDesignation,
  }));
  const units: ReferenceFrameUnit[] = systems.map((system, index) => ({
    unitId: `rsu_${String.fromCharCode(97 + index).repeat(22)}`,
    sourceDecisionBinding: sharedDecisionBinding,
    sourceEvaluationBinding: sha256Rfc8785({ evaluation: index }),
    sourceEvaluationHash: sha256Rfc8785({ evaluationHash: index }),
    decidedAt: `2023-06-0${index + 1}T00:00:00.000Z`,
    automationProcessing: index === 0 ? "solely_automated" : "partially_automated",
    systemIdentity: deriveReferenceSystemIdentity(system),
    ...system,
    automatedOutcome: index === 0 ? "fail" : "pass",
    referenceLabelState: "unlabeled",
  }));
  const source: ReferenceFrameSourceBinding = {
    workspaceId: "ws_invariant",
    projectId: "project_invariant",
    benchmarkId: "benchmark_invariant",
    activationReference: "activation_invariant",
    deploymentKey: "deployment_invariant",
    contextAuthority: "workspace_manager_asserted_context",
    populationId: "population_invariant",
    populationVersion: 1,
    populationContractHash: sha256Rfc8785({ contract: 1 }),
    populationRoot: sha256Rfc8785({ population: 1 }),
    populationFrozenAt: "2023-07-01T00:00:00.000Z",
    reportingWindow: { startInclusive: "2023-06-01T00:00:00.000Z", endExclusive: "2023-07-01T00:00:00.000Z" },
    populationCount: 2,
    eligibleDrawUnitCount: 2,
    evaluatedDecisionCount: 1,
    notAutomatedDecisionCount: 1,
    excludedDecisionCount: 0,
  };
  const witness = {
    kind: "database_transaction_and_attestation" as const,
    witnessId: "witness_invariant",
    sourceFrozenAt: "2023-07-01T00:00:01.000Z",
    committedAt: "2023-07-01T00:00:01.000Z",
    auditHeadDigest: sha256Rfc8785({ audit: 1 }),
  };
  const commitment = createReferenceFrameCommitment({
    frameId: "frame_invariant",
    purpose: "dsa_invariant",
    source,
    witness,
    units,
    sampleSizes: systems.map((system, index) => ({
      systemId: system.systemId,
      systemVersion: system.systemVersion,
      automatedFail: index === 0 ? 1 : 0,
      automatedPass: index === 0 ? 0 : 1,
    })),
    sampleSizePlanId: "sample_plan_invariant",
    sampleSizePlanVersion: 1,
    beaconNetwork: "quicknet-t",
    beaconRound: 1,
  });
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
  const frozenWitness = {
    kind: "database_transaction_and_attestation" as const,
    witnessId: "witness_sample_invariant",
    frozenAt: "2023-07-14T00:00:00.000Z",
    auditHeadDigest: sha256Rfc8785({ audit: 2 }),
  };
  const sample = freezeReferenceSample({ commitment, units, beacon, frozenWitness });
  const facts: DsaAutomatedMeansReferenceFact[] = units.map((unit, index) => ({
    unitId: unit.unitId,
    sourceDecisionBinding: unit.sourceDecisionBinding,
    sourceEvaluationBinding: unit.sourceEvaluationBinding,
    sourceEvaluationHash: unit.sourceEvaluationHash,
    system: systems[index]!,
    automationProcessing: unit.automationProcessing,
    languageCodes: ["en"],
    origin: "own_initiative",
    notifierClass: null,
    referenceOutcome: unit.automatedOutcome,
    referenceLabelBinding: sha256Rfc8785({ label: index }),
  }));
  const estimate = estimateDsaAutomatedMeansMetrics({
    providerType: "hosting_service",
    systemInventory: systems,
    commitment,
    frameUnits: units,
    sample,
    beacon,
    frozenWitness,
    facts,
  });
  assert.equal(new Set(estimate.cells.map(cell => cell.system.systemId)).size, 2);
  assert.equal(estimate.cells.filter(cell => cell.scope === "Total number" && cell.metric === "accuracy").length, 2);
  assert.equal(sample.manifest[0]!.sourceDecisionBinding, sample.manifest[1]!.sourceDecisionBinding);
  assert.notEqual(sample.manifest[0]!.sourceEvaluationBinding, sample.manifest[1]!.sourceEvaluationBinding);
  assert.equal(expectedDsaPart8Section16RowCount("hosting_service", systems.length), 24);
});
