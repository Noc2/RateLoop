import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  type DsaPart8SourceFactInput,
  normalizeDsaPart8SourceFact,
  recordDsaPart8SourceFact,
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

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

function decisionRow(index: number): DsaPopulationRowInput {
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
  };
}

async function workspace(ownerAddress = OWNER, name = "Part 8 facts") {
  return (await createWorkspace({ name, ownerAddress })).workspaceId;
}

async function seedDecisions(input: { workspaceId: string; ownerAddress?: string; indexes: readonly number[] }) {
  const rows = input.indexes.map(decisionRow);
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
    now: NOW,
  });
  await ingestDsaPopulationPage({
    accountAddress: input.ownerAddress ?? OWNER,
    workspaceId: input.workspaceId,
    populationId,
    populationVersion: 1,
    pageNumber: 1,
    idempotencyKey: `part8-page-${input.indexes.join("-")}`,
    rows,
    now: NOW,
  });
  return rows;
}

function fact(index: number, overrides: Partial<DsaPart8SourceFactInput> = {}): DsaPart8SourceFactInput {
  return {
    moderationMeasureId: `measure_${String(index).padStart(8, "0")}`,
    origin: "article16_notice",
    automationProcessing: "solely_automated",
    article16NoticeId: `notice_${String(index).padStart(8, "0")}`,
    notifierClass: "trusted_flagger",
    automaticRemoval: true,
    classifier: {
      systemId: `classifier_system-${index}`,
      version: "2026.05",
      machineClass: "text_classifier",
    },
    languageAttribution: { languageCodes: ["en", "de"], noLanguageReason: null },
    ...overrides,
  };
}

test("records canonical zero, one, and multiple-language facts and retries idempotently", async () => {
  const workspaceId = await workspace();
  const rows = await seedDecisions({ workspaceId, indexes: [1, 2, 3] });
  const multiple = await recordDsaPart8SourceFact({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: rows[0]!.providerDecisionId,
    decisionVersion: 1,
    fact: fact(1),
    now: NOW,
  });
  assert.deepEqual(multiple.languageAttribution, { languageCodes: ["de", "en"], noLanguageReason: null });
  const retry = await recordDsaPart8SourceFact({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: rows[0]!.providerDecisionId,
    decisionVersion: 1,
    fact: fact(1),
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.equal(retry.idempotent, true);
  assert.equal(retry.factHash, multiple.factHash);

  await recordDsaPart8SourceFact({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: rows[1]!.providerDecisionId,
    decisionVersion: 1,
    fact: fact(2, {
      origin: "authority_order",
      automationProcessing: "not_solely_automated",
      article16NoticeId: null,
      notifierClass: null,
      classifier: null,
      languageAttribution: { languageCodes: ["fr"], noLanguageReason: null },
    }),
    now: NOW,
  });
  await recordDsaPart8SourceFact({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: rows[2]!.providerDecisionId,
    decisionVersion: 1,
    fact: fact(3, {
      origin: "own_initiative",
      automationProcessing: "not_solely_automated",
      article16NoticeId: null,
      notifierClass: null,
      classifier: null,
      languageAttribution: { languageCodes: [], noLanguageReason: "no_linguistic_content" },
    }),
    now: NOW,
  });
  const persisted = await dbClient.execute({
    sql: `SELECT moderation_measure_id,language_codes_json,no_language_reason,fact_json,fact_hash
          FROM tokenless_dsa_moderation_measure_facts WHERE workspace_id=? ORDER BY moderation_measure_id`,
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
  await recordDsaPart8SourceFact({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: rows[0]!.providerDecisionId,
    decisionVersion: 1,
    fact: fact(10),
    now: NOW,
  });
  await assert.rejects(
    () =>
      recordDsaPart8SourceFact({
        accountAddress: OWNER,
        workspaceId,
        providerDecisionId: rows[0]!.providerDecisionId,
        decisionVersion: 1,
        fact: fact(10, { automaticRemoval: false }),
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "dsa_part8_source_fact_conflict",
  );
  await assert.rejects(
    () =>
      recordDsaPart8SourceFact({
        accountAddress: OWNER,
        workspaceId,
        providerDecisionId: rows[1]!.providerDecisionId,
        decisionVersion: 1,
        fact: fact(10),
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "dsa_moderation_measure_id_conflict",
  );
});

test("rejects free-form or structurally inconsistent source facts", () => {
  const invalidFacts: unknown[] = [
    { ...fact(20), freeText: "caller prose" },
    { ...fact(20), article16NoticeId: null },
    { ...fact(20), origin: "authority_order", article16NoticeId: "notice_00000020", notifierClass: "other" },
    { ...fact(20), classifier: null },
    { ...fact(20), automationProcessing: "not_solely_automated" },
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
      () => normalizeDsaPart8SourceFact(invalidFact as DsaPart8SourceFactInput),
      (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_dsa_part8_source_fact",
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
        sql: `INSERT INTO tokenless_dsa_moderation_measure_facts
              (workspace_id,provider_decision_id,decision_version,schema_version,moderation_measure_id,origin,
               automation_processing,article16_notice_id,notifier_class,automatic_removal,classifier_system_id,
               classifier_version,classifier_machine_class,language_codes_json,no_language_reason,fact_json,fact_hash,
               created_by,created_at)
              VALUES (?,?,?,'rateloop.dsa-part8-moderation-measure.v1',?,'own_initiative',
                      'not_solely_automated',NULL,NULL,false,NULL,NULL,NULL,?,NULL,'{}',?, ?, ?)`,
        args: [
          workspaceId,
          rows[index]!.providerDecisionId,
          1,
          `measure_${String(21 + index).padStart(8, "0")}`,
          languageCodesJson,
          `sha256:${String(index).padStart(64, "0")}`,
          OWNER,
          NOW,
        ],
      }),
    );
  }
});

test("rejects cross-tenant and decision-version substitution before recording", async () => {
  const workspaceId = await workspace();
  const secondWorkspaceId = await workspace(SECOND_OWNER, "Second Part 8 workspace");
  const [row] = await seedDecisions({ workspaceId, indexes: [30] });
  await assert.rejects(
    () =>
      recordDsaPart8SourceFact({
        accountAddress: SECOND_OWNER,
        workspaceId: secondWorkspaceId,
        providerDecisionId: row!.providerDecisionId,
        decisionVersion: 1,
        fact: fact(30),
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "dsa_source_decision_not_found",
  );
  await assert.rejects(
    () =>
      recordDsaPart8SourceFact({
        accountAddress: OWNER,
        workspaceId,
        providerDecisionId: row!.providerDecisionId,
        decisionVersion: 2,
        fact: fact(30),
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "dsa_source_decision_not_found",
  );
  await assert.rejects(
    () =>
      recordDsaPart8SourceFact({
        accountAddress: OUTSIDER,
        workspaceId,
        providerDecisionId: row!.providerDecisionId,
        decisionVersion: 1,
        fact: fact(30),
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
  );
  const stored = await dbClient.execute({
    sql: "SELECT COUNT(*) AS count FROM tokenless_dsa_moderation_measure_facts",
    args: [],
  });
  assert.equal(Number(stored.rows[0]?.count), 0);
});
