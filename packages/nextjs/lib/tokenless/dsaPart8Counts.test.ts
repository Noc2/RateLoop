import { sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import assert from "node:assert/strict";
import test from "node:test";
import {
  DSA_PART8_CENSUS_WITNESS_SCHEMA_VERSION,
  DSA_PART8_COUNT_ALGORITHM_VERSION,
  DSA_PART8_COUNT_CONTRACT_SCHEMA_VERSION,
  DSA_PART8_COUNT_DECISION_FACT_SCHEMA_VERSION,
  DSA_PART8_COUNT_EVALUATION_FACT_SCHEMA_VERSION,
  DSA_PART8_COUNT_PILOT_FACT_CAP,
  DSA_PART8_MAX_CLASSIFIERS,
  DSA_PART8_NOTICE_PROCESSING_FACT_SCHEMA_VERSION,
  DSA_PART8_PROVIDER_TYPES,
  type DsaPart8CountContractSpec,
  type DsaPart8CountDecisionFactPayload,
  type DsaPart8CountEvaluationFactPayload,
  type DsaPart8NoticeProcessingFactPayload,
  countDsaPart8,
  freezeDsaPart8CountContract,
  sealDsaPart8CountDecisionFact,
  sealDsaPart8CountEvaluationFact,
  sealDsaPart8NoticeProcessingFact,
} from "~~/lib/tokenless/dsaPart8Counts";
import {
  DSA_PART8_EMPTY_AUTOMATED_MEANS_EVALUATION_SET_ROOT,
  type DsaPart8AutomatedMeansEvaluationInput,
  type DsaPart8DecisionFactInput,
  normalizeDsaPart8AutomatedMeansEvaluation,
  normalizeDsaPart8AutomatedMeansEvaluationSet,
} from "~~/lib/tokenless/dsaPart8SourceFacts";

type ProviderType = (typeof DSA_PART8_PROVIDER_TYPES)[number];
const SERVICE_ID = "service.part8-pilot";
const CLASSIFIER = {
  systemId: "classifier_primary",
  version: "2026.1",
  machineClass: "text_classifier",
  publicDesignation: "Safety text classifier",
} as const;
const SECOND_CLASSIFIER = {
  systemId: "classifier_secondary",
  version: "2026.1",
  machineClass: "multimodal_classifier",
  publicDesignation: "Safety media classifier",
} as const;

function period(providerType: ProviderType) {
  return providerType === "vlop" || providerType === "vlose"
    ? { startInclusive: "2026-01-01T00:00:00.000Z", endExclusive: "2026-07-01T00:00:00.000Z" }
    : { startInclusive: "2026-01-01T00:00:00.000Z", endExclusive: "2027-01-01T00:00:00.000Z" };
}

function sourceFact(index: number, overrides: Partial<DsaPart8DecisionFactInput> = {}): DsaPart8DecisionFactInput {
  return {
    measureTaken: true,
    moderationMeasureId: `measure_${String(index).padStart(8, "0")}`,
    origin: "own_initiative",
    automationProcessing: "not_automated",
    expectedEvaluationCount: 0,
    evaluationSetRoot: DSA_PART8_EMPTY_AUTOMATED_MEANS_EVALUATION_SET_ROOT,
    article16NoticeId: null,
    notifierClass: null,
    languageAttribution: { languageCodes: ["en"], noLanguageReason: null },
    ...overrides,
  };
}

function decision(
  index: number,
  overrides: Partial<DsaPart8DecisionFactInput> = {},
  envelope: Partial<Pick<DsaPart8CountDecisionFactPayload, "serviceId" | "occurredAt" | "sourceDecisionBinding">> = {},
  evaluations: readonly DsaPart8AutomatedMeansEvaluationInput[] = [],
) {
  const evaluationSet = normalizeDsaPart8AutomatedMeansEvaluationSet(evaluations);
  return sealDsaPart8CountDecisionFact({
    schemaVersion: DSA_PART8_COUNT_DECISION_FACT_SCHEMA_VERSION,
    serviceId: envelope.serviceId ?? SERVICE_ID,
    occurredAt: envelope.occurredAt ?? "2026-03-01T12:00:00.000Z",
    sourceDecisionBinding: envelope.sourceDecisionBinding ?? sha256Rfc8785({ decision: index }),
    sourceFact: sourceFact(index, {
      expectedEvaluationCount: evaluationSet.evaluations.length,
      evaluationSetRoot: evaluationSet.evaluationSetRoot,
      ...overrides,
    }),
  });
}

function evaluationInput(
  index: number,
  system: typeof CLASSIFIER | typeof SECOND_CLASSIFIER = CLASSIFIER,
  automatedOutcome: "pass" | "fail" = "pass",
): DsaPart8AutomatedMeansEvaluationInput {
  return {
    evaluationId: `evaluation_${String(index).padStart(8, "0")}`,
    systemId: system.systemId,
    systemVersion: system.version,
    machineClass: system.machineClass,
    publicDesignation: system.publicDesignation,
    automatedOutcome,
  };
}

function evaluation(
  index: number,
  decisionIndex: number,
  input: DsaPart8AutomatedMeansEvaluationInput,
  automationProcessing: "solely_automated" | "partially_automated",
  envelope: Partial<Pick<DsaPart8CountEvaluationFactPayload, "sourceEvaluationBinding">> = {},
) {
  return sealDsaPart8CountEvaluationFact({
    schemaVersion: DSA_PART8_COUNT_EVALUATION_FACT_SCHEMA_VERSION,
    serviceId: SERVICE_ID,
    occurredAt: "2026-03-01T12:00:00.000Z",
    sourceDecisionBinding: sha256Rfc8785({ decision: decisionIndex }),
    sourceEvaluationBinding: envelope.sourceEvaluationBinding ?? sha256Rfc8785({ evaluation: index }),
    sourceEvaluationHash: sha256Rfc8785(normalizeDsaPart8AutomatedMeansEvaluation(input)),
    automationProcessing,
    evaluation: input,
  });
}

function notice(index: number, overrides: Partial<DsaPart8NoticeProcessingFactPayload> = {}) {
  return sealDsaPart8NoticeProcessingFact({
    schemaVersion: DSA_PART8_NOTICE_PROCESSING_FACT_SCHEMA_VERSION,
    serviceId: SERVICE_ID,
    receivedAt: "2026-03-01T10:00:00.000Z",
    noticeId: `notice_${String(index).padStart(8, "0")}`,
    processingStatus: "processed_final",
    automationProcessing: "not_automated",
    notifierClass: "other",
    ...overrides,
  });
}

function spec(
  providerType: ProviderType,
  classifierInventory: DsaPart8CountContractSpec["classifierInventory"] = [],
): DsaPart8CountContractSpec {
  return {
    schemaVersion: DSA_PART8_COUNT_CONTRACT_SCHEMA_VERSION,
    contractId: "dsa8c_2026_pilot",
    service: { serviceId: SERVICE_ID, providerType },
    reportingPeriod: period(providerType),
    classifierInventory,
    censusWitness: {
      schemaVersion: DSA_PART8_CENSUS_WITNESS_SCHEMA_VERSION,
      kind: "database_transaction_and_attestation",
      censusId: "census_2026_h1",
      sourcePopulationId: "population_2026_h1",
      sourcePopulationVersion: 1,
      frozenAt:
        providerType === "vlop" || providerType === "vlose" ? "2026-07-01T00:00:01.000Z" : "2027-01-01T00:00:01.000Z",
      auditHeadDigest: sha256Rfc8785({ audit: providerType }),
      attestationJobId: "attestation_2026_h1",
    },
  };
}

function census(input: {
  providerType?: ProviderType;
  classifierInventory?: DsaPart8CountContractSpec["classifierInventory"];
  decisionFacts?: readonly ReturnType<typeof decision>[];
  evaluationFacts?: readonly ReturnType<typeof evaluation>[];
  noticeFacts?: readonly ReturnType<typeof notice>[];
}) {
  const providerType = input.providerType ?? "vlop";
  const decisionFacts = input.decisionFacts ?? [];
  const evaluationFacts = input.evaluationFacts ?? [];
  const noticeFacts = input.noticeFacts ?? [];
  const contract = freezeDsaPart8CountContract({
    spec: spec(providerType, input.classifierInventory),
    decisionFacts,
    evaluationFacts,
    noticeFacts,
  });
  return { contract, decisionFacts, evaluationFacts, noticeFacts };
}

function cell(
  result: ReturnType<typeof countDsaPart8>,
  indicator: (typeof result.cells)[number]["indicator"],
  scope: (typeof result.cells)[number]["scope"],
) {
  const found = result.cells.find(candidate => candidate.indicator === indicator && candidate.scope === scope);
  assert.ok(found, `missing ${indicator}/${scope}`);
  return found;
}

test("binds the exact decision census, counts only taken measures, and preserves partial/no-action coverage", () => {
  const notices = [
    notice(1, { notifierClass: "trusted_flagger", automationProcessing: "partially_automated" }),
    notice(2, { automationProcessing: "solely_automated" }),
  ];
  const firstEvaluation = evaluationInput(1, CLASSIFIER, "fail");
  const secondEvaluation = evaluationInput(2, CLASSIFIER, "pass");
  const thirdEvaluation = evaluationInput(3, SECOND_CLASSIFIER, "pass");
  const decisions = [
    decision(
      1,
      {
        origin: "article16_notice",
        article16NoticeId: notices[0]!.noticeId,
        notifierClass: "trusted_flagger",
        automationProcessing: "solely_automated",
        languageAttribution: { languageCodes: ["de", "en"], noLanguageReason: null },
      },
      {},
      [firstEvaluation],
    ),
    decision(
      2,
      {
        measureTaken: false,
        moderationMeasureId: null,
        automationProcessing: "solely_automated",
        languageAttribution: { languageCodes: [], noLanguageReason: "not_applicable" },
      },
      {},
      [secondEvaluation],
    ),
    decision(
      3,
      {
        automationProcessing: "partially_automated",
        languageAttribution: { languageCodes: [], noLanguageReason: "no_linguistic_content" },
      },
      {},
      [thirdEvaluation],
    ),
    decision(4, { origin: "authority_order", languageAttribution: { languageCodes: ["fr"], noLanguageReason: null } }),
  ];
  const frozen = census({
    classifierInventory: [CLASSIFIER, SECOND_CLASSIFIER],
    decisionFacts: decisions,
    evaluationFacts: [
      evaluation(1, 1, firstEvaluation, "solely_automated"),
      evaluation(2, 2, secondEvaluation, "solely_automated"),
      evaluation(3, 3, thirdEvaluation, "partially_automated"),
    ],
    noticeFacts: notices,
  });
  const result = countDsaPart8(frozen);

  assert.equal(frozen.contract.algorithmVersion, DSA_PART8_COUNT_ALGORITHM_VERSION);
  assert.equal(frozen.contract.expectedDecisionCount, 4);
  assert.equal(frozen.contract.expectedMeasureCount, 3);
  assert.equal(cell(result, "measures_solely_automated", "Total number").result.value, 1);
  assert.equal(cell(result, "measures_not_automated", "Total number").result.value, 1);
  assert.equal(cell(result, "measures_solely_automated", "de").result.value, 1);
  assert.equal(cell(result, "measures_not_automated", "fr").result.value, 1);
  assert.equal(cell(result, "notices_solely_automated", "NAM Total").result.value, 1);
  assert.equal(cell(result, "notices_not_automated", "NAM Total").result.value, 0);
  assert.deepEqual(result.inputCoverage, {
    decisionCount: 4,
    measureCount: 3,
    evaluationCount: 3,
    noticeCount: 2,
    classifierInventoryCount: 2,
    observedClassifierCount: 2,
    unobservedClassifierCount: 0,
    solelyAutomatedDecisionCount: 2,
    partiallyAutomatedDecisionCount: 1,
    notAutomatedDecisionCount: 1,
    partiallyAutomatedMeasureCount: 1,
    partiallyAutomatedNoticeCount: 1,
  });
  assert.deepEqual(result.languageCoverage, {
    measureCountWithLanguage: 2,
    languageAttributionCount: 3,
    noLanguageCounts: { no_linguistic_content: 1, language_undetermined: 0, not_applicable: 0 },
  });
  assert.equal(result.cells.length, 56);
  assert.equal(result.evidence.decisionFactRoot, frozen.contract.decisionFactRoot);
  assert.equal(result.evidence.evaluationFactRoot, frozen.contract.evaluationFactRoot);
  assert.equal(result.publicationEligible, false);
});

test("accepts a complete classifier inventory with an unobserved system and reports the gap", () => {
  const observedEvaluation = evaluationInput(10, CLASSIFIER);
  const facts = [
    decision(
      10,
      {
        measureTaken: false,
        moderationMeasureId: null,
        automationProcessing: "partially_automated",
      },
      {},
      [observedEvaluation],
    ),
  ];
  const frozen = census({
    classifierInventory: [CLASSIFIER, SECOND_CLASSIFIER],
    decisionFacts: facts,
    evaluationFacts: [evaluation(10, 10, observedEvaluation, "partially_automated")],
  });
  const result = countDsaPart8(frozen);
  assert.equal(result.inputCoverage.observedClassifierCount, 1);
  assert.equal(result.inputCoverage.unobservedClassifierCount, 1);
  assert.equal(result.inputCoverage.measureCount, 0);
});

test("emits the exact applicable official count universe for every provider type", () => {
  const expected = {
    intermediary_service: 4,
    hosting_service: 6,
    online_platform: 8,
    vlop: 56,
    vlose: 4,
  } satisfies Record<ProviderType, number>;
  for (const providerType of DSA_PART8_PROVIDER_TYPES) {
    const frozen = census({ providerType });
    const result = countDsaPart8(frozen);
    assert.equal(result.cells.length, expected[providerType]);
    assert.ok(result.cells.every(entry => entry.result.status === "count" && entry.result.value === 0));
  }
});

test("rejects evidence that does not match the frozen canonical roots, including reordered-tampered facts", () => {
  const first = decision(20);
  const second = decision(21);
  const frozen = census({ decisionFacts: [first, second] });
  const reordered = countDsaPart8({ ...frozen, decisionFacts: [second, first] });
  assert.equal(reordered.resultDigest, countDsaPart8(frozen).resultDigest);
  assert.throws(() =>
    countDsaPart8({ ...frozen, decisionFacts: [{ ...first, occurredAt: "2026-04-01T00:00:00.000Z" }, second] }),
  );
  assert.throws(() => countDsaPart8({ ...frozen, decisionFacts: [first] }));
  assert.throws(() => countDsaPart8({ ...frozen, decisionFacts: [first, first] }));
});

test("fails on duplicate measures, unknown classifiers, invalid notice reconciliation, and incomplete notice scopes", () => {
  const first = decision(30);
  const duplicateMeasure = decision(31, { moderationMeasureId: first.sourceFact.moderationMeasureId });
  assert.throws(() => census({ decisionFacts: [first, duplicateMeasure] }));

  const automatedEvaluation = evaluationInput(32, CLASSIFIER);
  const automated = decision(32, { automationProcessing: "solely_automated" }, {}, [automatedEvaluation]);
  assert.throws(() =>
    census({
      decisionFacts: [automated],
      evaluationFacts: [evaluation(32, 32, automatedEvaluation, "solely_automated")],
    }),
  );

  const incomplete = notice(33, { processingStatus: "processing_incomplete", automationProcessing: null });
  const result = countDsaPart8(census({ providerType: "hosting_service", noticeFacts: [incomplete] }));
  assert.deepEqual(cell(result, "notices_solely_automated", "NAM Total").result, {
    status: "coverage_gap",
    code: "incomplete_notice_processing",
    value: null,
    affectedNoticeCount: 1,
    publicationEligible: false,
  });

  const linked = decision(34, {
    origin: "article16_notice",
    article16NoticeId: "notice_00000999",
    notifierClass: "other",
  });
  assert.throws(() => countDsaPart8(census({ providerType: "hosting_service", decisionFacts: [linked] })));
});

test("enforces the explicit 2026+ regime, census witness, formula safety, classifier cap, and total fact cap", () => {
  const base = spec("intermediary_service");
  assert.throws(() =>
    freezeDsaPart8CountContract({
      spec: {
        ...base,
        reportingPeriod: { startInclusive: "2025-01-01T00:00:00.000Z", endExclusive: "2026-01-01T00:00:00.000Z" },
      },
      decisionFacts: [],
      evaluationFacts: [],
      noticeFacts: [],
    }),
  );
  assert.throws(() =>
    freezeDsaPart8CountContract({
      spec: { ...base, censusWitness: { ...base.censusWitness, frozenAt: "2026-12-31T23:59:59.000Z" } },
      decisionFacts: [],
      evaluationFacts: [],
      noticeFacts: [],
    }),
  );
  assert.throws(() =>
    freezeDsaPart8CountContract({
      spec: { ...base, classifierInventory: [{ ...CLASSIFIER, publicDesignation: "=HYPERLINK(evil)" }] },
      decisionFacts: [],
      evaluationFacts: [],
      noticeFacts: [],
    }),
  );
  assert.throws(() =>
    freezeDsaPart8CountContract({
      spec: {
        ...base,
        classifierInventory: Array.from({ length: DSA_PART8_MAX_CLASSIFIERS + 1 }, (_, index) => ({
          systemId: `classifier_${String(index).padStart(3, "0")}`,
          version: "1",
          machineClass: "text_classifier" as const,
          publicDesignation: `Classifier ${index}`,
        })),
      },
      decisionFacts: [],
      evaluationFacts: [],
      noticeFacts: [],
    }),
  );
  const decisions = Array.from({ length: DSA_PART8_COUNT_PILOT_FACT_CAP }, (_, index) => decision(10_000 + index));
  assert.throws(() =>
    freezeDsaPart8CountContract({
      spec: base,
      decisionFacts: decisions,
      evaluationFacts: [],
      noticeFacts: [notice(99)],
    }),
  );
});
