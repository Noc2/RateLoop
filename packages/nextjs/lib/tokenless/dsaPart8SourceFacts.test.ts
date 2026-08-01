import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  DSA_PART8_EMPTY_AUTOMATED_MEANS_EVALUATION_SET_ROOT,
  type DsaPart8AutomatedMeansEvaluationInput,
  type DsaPart8DecisionFactInput,
  normalizeDsaPart8AutomatedMeansEvaluation,
  normalizeDsaPart8AutomatedMeansEvaluationSet,
  normalizeDsaPart8DecisionFact,
  recordDsaPart8DecisionFact,
} from "~~/lib/tokenless/dsaPart8SourceFacts";
import {
  type DsaPopulationRowInput,
  createDsaPopulationVersion,
  ingestDsaPopulationPage,
} from "~~/lib/tokenless/dsaPopulationLedger";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const SECOND_OWNER = "0x2222222222222222222222222222222222222222";
const OUTSIDER = "0x3333333333333333333333333333333333333333";
const NOW = new Date("2026-08-01T10:00:00.000Z");

beforeEach(() =>
  __setDatabaseResourcesForTests(createMemoryDatabaseResources({ transactionTimestamp: () => new Date(NOW) })),
);
afterEach(() => __setDatabaseResourcesForTests(null));

function decisionRow(index: number, overrides: Partial<DsaPopulationRowInput> = {}): DsaPopulationRowInput {
  return {
    engagementId: `part8-engagement-${index}`,
    engagementVersion: 1,
    providerDecisionId: `part8.decision:${index}`,
    decisionVersion: 1,
    service: "part8-pilot",
    sourceSystem: "moderation-api",
    decisionAt: new Date("2026-05-01T10:00:00.000Z"),
    language: "en",
    contentFormat: "text/plain",
    harmonisedCategory: "KEYWORD_OTHER",
    triggerSource: "automated_detection",
    policyVersion: "policy-2026-05",
    automatedSystemVersion: "classifier-2026-05",
    originalAutomatedLabel: "restricted",
    originalRestriction: "content_disabled",
    eligibilityStatus: "eligible",
    exclusionReason: null,
    contentHash: `sha256:${index.toString(16).padStart(64, "0")}`,
    contentLocator: `dsaobj_part8_${String(index).padStart(16, "0")}`,
    partitionValues: { language: "en" },
    sorApplicability: "restriction_outside_article_17",
    nonRequiredBasis: "restriction_outside_article_17",
    ...overrides,
  };
}

async function workspace(ownerAddress = OWNER, name = "Part 8 facts") {
  return (await createWorkspace({ name, ownerAddress })).workspaceId;
}

async function seedDecisions(input: {
  workspaceId: string;
  ownerAddress?: string;
  indexes: readonly number[];
  rowOverrides?: Readonly<Record<number, Partial<DsaPopulationRowInput>>>;
}) {
  const rows = input.indexes.map(index => decisionRow(index, input.rowOverrides?.[index]));
  const populationId = `part8-${input.indexes.join("-")}`;
  await createDsaPopulationVersion({
    accountAddress: input.ownerAddress ?? OWNER,
    workspaceId: input.workspaceId,
    populationId,
    version: 1,
    periodStart: new Date("2026-01-01T00:00:00.000Z"),
    periodEnd: new Date("2026-07-01T00:00:00.000Z"),
    sourceSystems: ["moderation-api"],
    partitionDimensions: ["language"],
    declaredSourceTotals: { "moderation-api": rows.length },
    declaredPartitionTotals: [{ values: { language: "en" }, total: rows.length }],
    expectedSourceManifest: rows.map(row => ({
      providerDecisionId: row.providerDecisionId,
      decisionVersion: row.decisionVersion,
    })),
    expectedRowCount: rows.length,
    expectedPageCount: 1,
  });
  await ingestDsaPopulationPage({
    accountAddress: input.ownerAddress ?? OWNER,
    workspaceId: input.workspaceId,
    populationId,
    populationVersion: 1,
    pageNumber: 1,
    idempotencyKey: `part8-page-${input.indexes.join("-")}`,
    rows,
  });
  return rows;
}

function fact(
  index: number,
  overrides: Partial<DsaPart8DecisionFactInput> = {},
  evaluations?: readonly DsaPart8AutomatedMeansEvaluationInput[],
): DsaPart8DecisionFactInput {
  const automationProcessing = overrides.automationProcessing ?? "solely_automated";
  const boundEvaluations = evaluations ?? (automationProcessing === "not_automated" ? [] : [evaluation(index)]);
  const evaluationSet = normalizeDsaPart8AutomatedMeansEvaluationSet(boundEvaluations);
  return {
    measureTaken: true,
    moderationMeasureId: `measure_${String(index).padStart(8, "0")}`,
    origin: "article16_notice",
    automationProcessing,
    expectedEvaluationCount: evaluationSet.evaluations.length,
    evaluationSetRoot: evaluationSet.evaluationSetRoot,
    article16NoticeId: `notice_${String(index).padStart(8, "0")}`,
    notifierClass: "trusted_flagger",
    languageAttribution: { languageCodes: ["en", "de"], noLanguageReason: null },
    ...overrides,
  };
}

function evaluation(
  index: number,
  overrides: Partial<DsaPart8AutomatedMeansEvaluationInput> = {},
): DsaPart8AutomatedMeansEvaluationInput {
  return {
    evaluationId: `evaluation_${String(index).padStart(8, "0")}`,
    systemId: `classifier_system-${index}`,
    systemVersion: "2026.05",
    machineClass: "text_classifier",
    publicDesignation: `Text moderation system ${index}`,
    automatedOutcome: "pass",
    ...overrides,
  };
}

test("records canonical zero, one, and multiple-language facts and retries idempotently", async () => {
  const workspaceId = await workspace();
  const rows = await seedDecisions({ workspaceId, indexes: [1, 2, 3] });
  const multiple = await recordDsaPart8DecisionFact({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: rows[0]!.providerDecisionId,
    decisionVersion: 1,
    fact: fact(1),
    evaluations: [evaluation(1)],
  });
  assert.deepEqual(multiple.languageAttribution, { languageCodes: ["de", "en"], noLanguageReason: null });
  const retry = await recordDsaPart8DecisionFact({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: rows[0]!.providerDecisionId,
    decisionVersion: 1,
    fact: fact(1),
    evaluations: [evaluation(1)],
  });
  assert.equal(retry.idempotent, true);
  assert.equal(retry.factHash, multiple.factHash);

  await recordDsaPart8DecisionFact({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: rows[1]!.providerDecisionId,
    decisionVersion: 1,
    fact: fact(2, {
      origin: "authority_order",
      automationProcessing: "not_automated",
      article16NoticeId: null,
      notifierClass: null,
      languageAttribution: { languageCodes: ["fr"], noLanguageReason: null },
    }),
    evaluations: [],
  });
  await recordDsaPart8DecisionFact({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: rows[2]!.providerDecisionId,
    decisionVersion: 1,
    fact: fact(3, {
      origin: "own_initiative",
      automationProcessing: "not_automated",
      article16NoticeId: null,
      notifierClass: null,
      languageAttribution: { languageCodes: [], noLanguageReason: "no_linguistic_content" },
    }),
    evaluations: [],
  });
  const persisted = await dbClient.execute({
    sql: `SELECT moderation_measure_id,language_codes_json,no_language_reason,fact_json,fact_hash
          FROM tokenless_dsa_content_moderation_decision_facts WHERE workspace_id=? ORDER BY moderation_measure_id`,
    args: [workspaceId],
  });
  assert.equal(persisted.rows.length, 3);
  assert.deepEqual(
    persisted.rows.map(row => JSON.parse(String(row.language_codes_json))),
    [["de", "en"], ["fr"], []],
  );
  assert.equal(persisted.rows[2]?.no_language_reason, "no_linguistic_content");
  assert.ok(persisted.rows.every(row => /^sha256:[0-9a-f]{64}$/u.test(String(row.fact_hash))));
  assert.equal(String(persisted.rows[0]?.fact_json).includes("freeText"), false);
});

test("rejects immutable decision conflicts and moderation measure reuse", async () => {
  const workspaceId = await workspace();
  const rows = await seedDecisions({ workspaceId, indexes: [10, 11] });
  await recordDsaPart8DecisionFact({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: rows[0]!.providerDecisionId,
    decisionVersion: 1,
    fact: fact(10),
    evaluations: [evaluation(10)],
  });
  await assert.rejects(
    () =>
      recordDsaPart8DecisionFact({
        accountAddress: OWNER,
        workspaceId,
        providerDecisionId: rows[0]!.providerDecisionId,
        decisionVersion: 1,
        fact: fact(10, { languageAttribution: { languageCodes: ["fr"], noLanguageReason: null } }),
        evaluations: [evaluation(10)],
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "dsa_part8_decision_fact_conflict",
  );
  await assert.rejects(
    () =>
      recordDsaPart8DecisionFact({
        accountAddress: OWNER,
        workspaceId,
        providerDecisionId: rows[1]!.providerDecisionId,
        decisionVersion: 1,
        fact: fact(10),
        evaluations: [evaluation(10)],
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "dsa_moderation_measure_id_conflict",
  );
});

test("rejects free-form or structurally inconsistent source facts", () => {
  const invalidFacts: unknown[] = [
    { ...fact(20), freeText: "caller prose" },
    { ...fact(20), article16NoticeId: null },
    { ...fact(20), origin: "authority_order", article16NoticeId: "notice_00000020", notifierClass: "other" },
    { ...fact(20), automaticRemoval: true },
    { ...fact(20), classifier: { systemId: "classifier_legacy", version: "1", machineClass: "text_classifier" } },
    { ...fact(20), measureTaken: false },
    { ...fact(20), languageAttribution: { languageCodes: ["EN"], noLanguageReason: null } },
    { ...fact(20), languageAttribution: { languageCodes: ["en", "en"], noLanguageReason: null } },
    { ...fact(20), languageAttribution: { languageCodes: [], noLanguageReason: null } },
    {
      ...fact(20),
      languageAttribution: { languageCodes: ["en"], noLanguageReason: "language_undetermined" },
    },
  ];
  for (const invalidFact of invalidFacts) {
    assert.throws(
      () => normalizeDsaPart8DecisionFact(invalidFact as DsaPart8DecisionFactInput),
      (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_dsa_part8_decision_fact",
    );
  }
});

test("database constraint rejects noncanonical and free-form language arrays", async () => {
  const workspaceId = await workspace();
  const rows = await seedDecisions({ workspaceId, indexes: [21, 22, 23, 24] });
  for (const [index, languageCodesJson] of [
    [0, '["en","free-form"]'],
    [1, '["EN"]'],
    [2, '["en","en"]'],
    [3, '["en", "fr"]'],
  ] as const) {
    await assert.rejects(() =>
      dbClient.execute({
        sql: `INSERT INTO tokenless_dsa_content_moderation_decision_facts
              (workspace_id,provider_decision_id,decision_version,schema_version,measure_taken,moderation_measure_id,origin,
               automation_processing,expected_evaluation_count,evaluation_set_root,article16_notice_id,notifier_class,
               language_codes_json,no_language_reason,fact_json,fact_hash,created_by,created_at)
              VALUES (?,?,?,'rateloop.dsa-part8-content-moderation-decision.v3',true,?,'own_initiative',
                      'not_automated',0,?,NULL,NULL,?,NULL,'{}',?, ?, ?)`,
        args: [
          workspaceId,
          rows[index]!.providerDecisionId,
          1,
          `measure_${String(21 + index).padStart(8, "0")}`,
          DSA_PART8_EMPTY_AUTOMATED_MEANS_EVALUATION_SET_ROOT,
          languageCodesJson,
          `sha256:${String(index).padStart(64, "0")}`,
          OWNER,
          NOW,
        ],
      }),
    );
  }
});

test("preserves a true no-action evaluation only with a coded non-required SoR basis", async () => {
  const workspaceId = await workspace();
  const rows = await seedDecisions({ workspaceId, indexes: [40, 41] });
  await dbClient.execute({
    sql: `UPDATE tokenless_dsa_source_decision_versions
          SET sor_applicability='required',non_required_basis=NULL
          WHERE workspace_id=? AND provider_decision_id=? AND decision_version=1`,
    args: [workspaceId, rows[1]!.providerDecisionId],
  });
  const noAction = fact(40, {
    measureTaken: false,
    moderationMeasureId: null,
  });
  const recorded = await recordDsaPart8DecisionFact({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: rows[0]!.providerDecisionId,
    decisionVersion: 1,
    fact: noAction,
    evaluations: [evaluation(40)],
  });
  assert.equal(recorded.measureTaken, false);
  assert.equal(recorded.moderationMeasureId, null);
  await assert.rejects(
    () =>
      recordDsaPart8DecisionFact({
        accountAddress: OWNER,
        workspaceId,
        providerDecisionId: rows[1]!.providerDecisionId,
        decisionVersion: 1,
        fact: fact(41, {
          measureTaken: false,
          moderationMeasureId: null,
        }),
        evaluations: [evaluation(41)],
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "dsa_no_measure_requires_non_required_basis",
  );
});

test("atomically records a sorted complete evaluation set and verifies exact retries", async () => {
  const workspaceId = await workspace();
  const [row] = await seedDecisions({ workspaceId, indexes: [50] });
  const secondary = evaluation(51, {
    systemId: "rules_engine_secondary",
    systemVersion: "2026.05.1",
    machineClass: "rules_engine",
    publicDesignation: "Secondary policy rules",
    automatedOutcome: "fail",
  });
  const evaluations = [secondary, evaluation(50)];
  const decisionFact = fact(50, {}, evaluations);
  const recorded = await recordDsaPart8DecisionFact({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: row!.providerDecisionId,
    decisionVersion: 1,
    fact: decisionFact,
    evaluations,
  });
  assert.deepEqual(
    recorded.evaluations.map(item => item.evaluationId),
    ["evaluation_00000050", "evaluation_00000051"],
  );
  const retry = await recordDsaPart8DecisionFact({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: row!.providerDecisionId,
    decisionVersion: 1,
    fact: decisionFact,
    evaluations: [...evaluations].reverse(),
  });
  assert.equal(retry.idempotent, true);
  assert.equal(retry.factHash, recorded.factHash);

  const persisted = await dbClient.execute({
    sql: `SELECT evaluation_id,automated_outcome,evaluation_json,evaluation_hash
          FROM tokenless_dsa_automated_means_evaluations
          WHERE workspace_id=? ORDER BY evaluation_id`,
    args: [workspaceId],
  });
  assert.equal(persisted.rows.length, 2);
  assert.deepEqual(
    persisted.rows.map(item => item.automated_outcome),
    ["pass", "fail"],
  );
  const decisions = await dbClient.execute({
    sql: `SELECT expected_evaluation_count,evaluation_set_root
          FROM tokenless_dsa_content_moderation_decision_facts WHERE workspace_id=?`,
    args: [workspaceId],
  });
  assert.equal(decisions.rows[0]?.expected_evaluation_count, 2);
  assert.equal(decisions.rows[0]?.evaluation_set_root, decisionFact.evaluationSetRoot);
});

test("evaluation-set binding changes with evidence and rejects incomplete or duplicate sets", async () => {
  const original = [evaluation(60)];
  const changed = [evaluation(60, { automatedOutcome: "fail" })];
  assert.notEqual(
    normalizeDsaPart8AutomatedMeansEvaluationSet(original).evaluationSetRoot,
    normalizeDsaPart8AutomatedMeansEvaluationSet(changed).evaluationSetRoot,
  );
  assert.throws(() => normalizeDsaPart8AutomatedMeansEvaluationSet([evaluation(60), evaluation(60)]));
  assert.throws(() =>
    normalizeDsaPart8AutomatedMeansEvaluationSet([
      evaluation(60),
      evaluation(61, { systemId: "classifier_system-60", systemVersion: "2026.05" }),
    ]),
  );

  const workspaceId = await workspace();
  const [row] = await seedDecisions({ workspaceId, indexes: [60] });
  await assert.rejects(
    () =>
      recordDsaPart8DecisionFact({
        accountAddress: OWNER,
        workspaceId,
        providerDecisionId: row!.providerDecisionId,
        decisionVersion: 1,
        fact: fact(60),
        evaluations: changed,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_dsa_part8_decision_fact",
  );
  const stored = await dbClient.execute({
    sql: "SELECT COUNT(*) AS count FROM tokenless_dsa_content_moderation_decision_facts WHERE workspace_id=?",
    args: [workspaceId],
  });
  assert.equal(Number(stored.rows[0]?.count), 0);
});

test("not-automated decisions bind exactly the canonical empty evaluation set", async () => {
  const workspaceId = await workspace();
  const [row] = await seedDecisions({ workspaceId, indexes: [70] });
  const decisionFact = fact(70, {
    automationProcessing: "not_automated",
    origin: "own_initiative",
    article16NoticeId: null,
    notifierClass: null,
  });
  assert.equal(decisionFact.expectedEvaluationCount, 0);
  assert.equal(decisionFact.evaluationSetRoot, DSA_PART8_EMPTY_AUTOMATED_MEANS_EVALUATION_SET_ROOT);
  await recordDsaPart8DecisionFact({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: row!.providerDecisionId,
    decisionVersion: 1,
    fact: decisionFact,
    evaluations: [],
  });
  assert.throws(() =>
    normalizeDsaPart8DecisionFact({
      ...decisionFact,
      expectedEvaluationCount: 1,
      evaluationSetRoot: normalizeDsaPart8AutomatedMeansEvaluationSet([evaluation(70)]).evaluationSetRoot,
    }),
  );
});

test("rejects unsupported and noncanonical automated-means evaluation shapes", () => {
  const invalidEvaluations: unknown[] = [
    { ...evaluation(80), freeText: "unsupported" },
    { ...evaluation(80), evaluationId: "evaluation_short" },
    { ...evaluation(80), systemId: "" },
    { ...evaluation(80), systemVersion: "version with spaces" },
    { ...evaluation(80), machineClass: "human" },
    { ...evaluation(80), publicDesignation: " padded" },
    { ...evaluation(80), publicDesignation: "bad\nlabel" },
    { ...evaluation(80), publicDesignation: "=FORMULA()" },
    { ...evaluation(80), publicDesignation: "+formula" },
    { ...evaluation(80), publicDesignation: "-formula" },
    { ...evaluation(80), publicDesignation: "@formula" },
    { ...evaluation(80), automatedOutcome: "unknown" },
  ];
  for (const invalidEvaluation of invalidEvaluations) {
    assert.throws(
      () => normalizeDsaPart8AutomatedMeansEvaluation(invalidEvaluation as DsaPart8AutomatedMeansEvaluationInput),
      (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_dsa_part8_decision_fact",
    );
  }
});

test("rejects cross-tenant and decision-version substitution before recording", async () => {
  const workspaceId = await workspace();
  const secondWorkspaceId = await workspace(SECOND_OWNER, "Second Part 8 workspace");
  const [row] = await seedDecisions({ workspaceId, indexes: [30] });
  await assert.rejects(
    () =>
      recordDsaPart8DecisionFact({
        accountAddress: SECOND_OWNER,
        workspaceId: secondWorkspaceId,
        providerDecisionId: row!.providerDecisionId,
        decisionVersion: 1,
        fact: fact(30),
        evaluations: [evaluation(30)],
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "dsa_source_decision_not_found",
  );
  await assert.rejects(
    () =>
      recordDsaPart8DecisionFact({
        accountAddress: OWNER,
        workspaceId,
        providerDecisionId: row!.providerDecisionId,
        decisionVersion: 2,
        fact: fact(30),
        evaluations: [evaluation(30)],
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "dsa_source_decision_not_found",
  );
  await assert.rejects(
    () =>
      recordDsaPart8DecisionFact({
        accountAddress: OUTSIDER,
        workspaceId,
        providerDecisionId: row!.providerDecisionId,
        decisionVersion: 1,
        fact: fact(30),
        evaluations: [evaluation(30)],
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
  );
  const stored = await dbClient.execute({
    sql: "SELECT COUNT(*) AS count FROM tokenless_dsa_content_moderation_decision_facts",
    args: [],
  });
  assert.equal(Number(stored.rows[0]?.count), 0);
});
