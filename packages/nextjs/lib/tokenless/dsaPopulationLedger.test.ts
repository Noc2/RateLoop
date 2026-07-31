import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  type DsaPopulationRowInput,
  computeDsaSourceManifestRoot,
  createDsaPopulationVersion,
  getFrozenDsaPopulationContract,
  ingestDsaPopulationPage,
  reconcileAndFreezeDsaPopulation,
  recordDsaTransparencyDeliveryResult,
} from "~~/lib/tokenless/dsaPopulationLedger";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const SECOND_OWNER = "0x2222222222222222222222222222222222222222";
const OUTSIDER = "0x3333333333333333333333333333333333333333";
const NOW = new Date("2026-07-31T12:00:00.000Z");
const PERIOD_START = new Date("2026-01-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-07-01T00:00:00.000Z");

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function workspace(ownerAddress = OWNER, name = "DSA population") {
  return (await createWorkspace({ name, ownerAddress })).workspaceId;
}

function populationRow(index: number, overrides: Partial<DsaPopulationRowInput> = {}): DsaPopulationRowInput {
  return {
    engagementId: `engagement-${String(index).padStart(8, "0")}`,
    engagementVersion: 1,
    providerDecisionId: `provider-decision-${String(index).padStart(8, "0")}`,
    decisionVersion: 1,
    service: "pilot-service",
    sourceSystem: "moderation-api",
    decisionAt: new Date("2026-03-01T12:00:00.000Z"),
    language: index % 2 === 0 ? "de" : "en",
    contentFormat: "text/plain",
    harmonisedCategory: "KEYWORD_OTHER",
    triggerSource: "automated_detection",
    policyVersion: "policy-2026-03",
    automatedSystemVersion: "classifier-2026-03",
    originalAutomatedLabel: "restricted",
    originalRestriction: "content_disabled",
    eligibilityStatus: "eligible",
    exclusionReason: null,
    contentHash: `sha256:${index.toString(16).padStart(64, "0")}`,
    contentLocator: `dsaobj_${String(index).padStart(16, "0")}`,
    partitionValues: { language: index % 2 === 0 ? "de" : "en" },
    sorApplicability: "restriction_outside_article_17",
    nonRequiredBasis: "restriction_outside_article_17",
    ...overrides,
  };
}

async function declarePopulation(input: {
  workspaceId: string;
  populationId: string;
  expectedRowCount: number;
  expectedPageCount: number;
  de?: number;
  en?: number;
  version?: number;
  manifestIndexes?: readonly number[];
}) {
  return createDsaPopulationVersion({
    accountAddress: OWNER,
    workspaceId: input.workspaceId,
    populationId: input.populationId,
    version: input.version ?? 1,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    sourceSystems: ["moderation-api"],
    partitionDimensions: ["language"],
    declaredSourceTotals: { "moderation-api": input.expectedRowCount },
    declaredPartitionTotals: [
      { values: { language: "de" }, total: input.de ?? Math.ceil(input.expectedRowCount / 2) },
      { values: { language: "en" }, total: input.en ?? Math.floor(input.expectedRowCount / 2) },
    ],
    expectedSourceManifest: (
      input.manifestIndexes ?? Array.from({ length: input.expectedRowCount }, (_unused, index) => index)
    ).map(index => ({ providerDecisionId: populationRow(index).providerDecisionId, decisionVersion: 1 })),
    expectedRowCount: input.expectedRowCount,
    expectedPageCount: input.expectedPageCount,
    now: NOW,
  });
}

test("ingests and freezes more than 5k rows in idempotent pages independent of the coverage export", async () => {
  const workspaceId = await workspace();
  const populationId = "population-2026-h1";
  const rowCount = 5_250;
  await declarePopulation({ workspaceId, populationId, expectedRowCount: rowCount, expectedPageCount: 6 });

  for (let pageNumber = 1; pageNumber <= 6; pageNumber += 1) {
    const first = (pageNumber - 1) * 1_000;
    const rows = Array.from({ length: Math.min(1_000, rowCount - first) }, (_unused, offset) =>
      populationRow(first + offset),
    );
    const ingested = await ingestDsaPopulationPage({
      accountAddress: OWNER,
      workspaceId,
      populationId,
      populationVersion: 1,
      pageNumber,
      idempotencyKey: `population-page-${String(pageNumber).padStart(3, "0")}`,
      rows,
      now: NOW,
    });
    assert.equal(ingested.rowCount, rows.length);
    assert.equal(ingested.idempotent, false);
    if (pageNumber === 1) {
      const retry = await ingestDsaPopulationPage({
        accountAddress: OWNER,
        workspaceId,
        populationId,
        populationVersion: 1,
        pageNumber,
        idempotencyKey: "population-page-001",
        rows: [...rows].reverse(),
        now: NOW,
      });
      assert.equal(retry.idempotent, true);
      assert.equal(retry.pageRoot, ingested.pageRoot);
    }
  }

  const frozen = await reconcileAndFreezeDsaPopulation({
    accountAddress: OWNER,
    workspaceId,
    populationId,
    populationVersion: 1,
    now: NOW,
  });
  assert.equal(frozen.status, "frozen");
  assert.equal(frozen.computedRowCount, rowCount);
  assert.deepEqual(frozen.blockers, []);
  const replay = await reconcileAndFreezeDsaPopulation({
    accountAddress: OWNER,
    workspaceId,
    populationId,
    populationVersion: 1,
    now: NOW,
  });
  assert.equal(replay.idempotent, true);
  assert.equal(replay.computedRoot, frozen.computedRoot);
  const contract = await getFrozenDsaPopulationContract({
    accountAddress: OWNER,
    workspaceId,
    populationId,
    populationVersion: 1,
  });
  assert.equal(contract.root, frozen.computedRoot);
  assert.equal(contract.rowCount, rowCount);
  assert.deepEqual(contract.sourceTotals, { "moderation-api": rowCount });
  assert.equal(JSON.stringify(contract).includes("coverage-export"), false);
});

test("rejects conflicting provider decision IDs unless the caller creates an explicit new version", async () => {
  assert.throws(
    () =>
      computeDsaSourceManifestRoot([
        { providerDecisionId: "provider-duplicate", decisionVersion: 1 },
        { providerDecisionId: "provider-duplicate", decisionVersion: 2 },
      ]),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_dsa_population",
  );
  const workspaceId = await workspace();
  await declarePopulation({ workspaceId, populationId: "source-one", expectedRowCount: 1, expectedPageCount: 1 });
  const original = populationRow(1, { partitionValues: { language: "de" } });
  await ingestDsaPopulationPage({
    accountAddress: OWNER,
    workspaceId,
    populationId: "source-one",
    populationVersion: 1,
    pageNumber: 1,
    idempotencyKey: "source-one-page",
    rows: [original],
    now: NOW,
  });

  await declarePopulation({ workspaceId, populationId: "source-two", expectedRowCount: 1, expectedPageCount: 1 });
  await assert.rejects(
    () =>
      ingestDsaPopulationPage({
        accountAddress: OWNER,
        workspaceId,
        populationId: "source-two",
        populationVersion: 1,
        pageNumber: 1,
        idempotencyKey: "source-two-conflict",
        rows: [populationRow(1, { engagementId: "engagement-new", automatedSystemVersion: "classifier-changed" })],
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "dsa_source_decision_version_conflict",
  );
  const versioned = await ingestDsaPopulationPage({
    accountAddress: OWNER,
    workspaceId,
    populationId: "source-two",
    populationVersion: 1,
    pageNumber: 1,
    idempotencyKey: "source-two-versioned",
    rows: [
      populationRow(1, {
        engagementId: "engagement-new",
        decisionVersion: 2,
        automatedSystemVersion: "classifier-changed",
      }),
    ],
    now: NOW,
  });
  assert.equal(versioned.idempotent, false);

  await assert.rejects(
    () =>
      createDsaPopulationVersion({
        accountAddress: OWNER,
        workspaceId,
        populationId: "source-two",
        version: 1,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        sourceSystems: ["moderation-api"],
        partitionDimensions: ["language"],
        declaredSourceTotals: { "moderation-api": 2 },
        declaredPartitionTotals: [{ values: { language: "de" }, total: 2 }],
        expectedSourceManifest: [
          { providerDecisionId: populationRow(1).providerDecisionId, decisionVersion: 1 },
          { providerDecisionId: populationRow(2).providerDecisionId, decisionVersion: 1 },
        ],
        expectedRowCount: 2,
        expectedPageCount: 1,
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "dsa_population_version_conflict",
  );
});

test("rejects one engagement ID under multiple versions within and across ingest pages", async () => {
  const workspaceId = await workspace();
  await declarePopulation({
    workspaceId,
    populationId: "engagement-page-duplicate",
    expectedRowCount: 2,
    expectedPageCount: 1,
    de: 1,
    en: 1,
    manifestIndexes: [30, 31],
  });
  await assert.rejects(
    () =>
      ingestDsaPopulationPage({
        accountAddress: OWNER,
        workspaceId,
        populationId: "engagement-page-duplicate",
        populationVersion: 1,
        pageNumber: 1,
        idempotencyKey: "engagement-same-page",
        rows: [
          populationRow(30, { engagementId: "shared-engagement", engagementVersion: 1 }),
          populationRow(31, { engagementId: "shared-engagement", engagementVersion: 2 }),
        ],
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "dsa_population_duplicate_row",
  );

  await declarePopulation({
    workspaceId,
    populationId: "engagement-cross-page-duplicate",
    expectedRowCount: 2,
    expectedPageCount: 2,
    de: 1,
    en: 1,
    manifestIndexes: [30, 31],
  });
  await ingestDsaPopulationPage({
    accountAddress: OWNER,
    workspaceId,
    populationId: "engagement-cross-page-duplicate",
    populationVersion: 1,
    pageNumber: 1,
    idempotencyKey: "engagement-cross-page-one",
    rows: [populationRow(30, { engagementId: "shared-engagement", engagementVersion: 1 })],
    now: NOW,
  });
  await assert.rejects(
    () =>
      ingestDsaPopulationPage({
        accountAddress: OWNER,
        workspaceId,
        populationId: "engagement-cross-page-duplicate",
        populationVersion: 1,
        pageNumber: 2,
        idempotencyKey: "engagement-cross-page-two",
        rows: [populationRow(31, { engagementId: "shared-engagement", engagementVersion: 2 })],
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "dsa_population_duplicate_row",
  );
});

test("rejects conflicting global engagement versions across populations", async () => {
  const workspaceId = await workspace();
  await declarePopulation({
    workspaceId,
    populationId: "global-engagement-one",
    expectedRowCount: 1,
    expectedPageCount: 1,
    de: 1,
    en: 0,
    manifestIndexes: [40],
  });
  await ingestDsaPopulationPage({
    accountAddress: OWNER,
    workspaceId,
    populationId: "global-engagement-one",
    populationVersion: 1,
    pageNumber: 1,
    idempotencyKey: "global-engagement-one",
    rows: [populationRow(40, { engagementId: "global-engagement" })],
    now: NOW,
  });
  await declarePopulation({
    workspaceId,
    populationId: "global-engagement-two",
    expectedRowCount: 1,
    expectedPageCount: 1,
    de: 0,
    en: 1,
    manifestIndexes: [41],
  });
  await assert.rejects(
    () =>
      ingestDsaPopulationPage({
        accountAddress: OWNER,
        workspaceId,
        populationId: "global-engagement-two",
        populationVersion: 1,
        pageNumber: 1,
        idempotencyKey: "global-engagement-two",
        rows: [populationRow(41, { engagementId: "global-engagement" })],
        now: NOW,
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "dsa_source_engagement_version_conflict",
  );
});

test("freezes against the payload version bound to the population instead of a later cross-population payload", async () => {
  const workspaceId = await workspace();
  const required = populationRow(50, {
    sorApplicability: "required",
    nonRequiredBasis: undefined,
    transparency: {
      payloadVersion: 1,
      statement: {
        category: "STATEMENT_CATEGORY_ILLEGAL_CONTENT",
        categorySpecification: "KEYWORD_OTHER",
        contentId: "4006381333931",
        decisionVisibility: "DECISION_VISIBILITY_CONTENT_DISABLED",
        reasonCode: "ILLEGAL_POLICY_MATCH",
      },
    },
  });
  await declarePopulation({
    workspaceId,
    populationId: "payload-binding-one",
    expectedRowCount: 1,
    expectedPageCount: 1,
    de: 1,
    en: 0,
    manifestIndexes: [50],
  });
  await ingestDsaPopulationPage({
    accountAddress: OWNER,
    workspaceId,
    populationId: "payload-binding-one",
    populationVersion: 1,
    pageNumber: 1,
    idempotencyKey: "payload-binding-one",
    rows: [required],
    now: NOW,
  });
  await recordDsaTransparencyDeliveryResult({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: required.providerDecisionId,
    decisionVersion: 1,
    payloadVersion: 1,
    operation: "submit",
    idempotencyKey: "payload-binding-receipt",
    httpStatus: 201,
    resultBody: {
      uuid: "commission-payload-binding",
      id: 50,
      created_at: NOW.toISOString(),
      permalink: "https://transparency.dsa.ec.europa.eu/statement/50",
      self: "https://transparency.dsa.ec.europa.eu/api/v1/statement/50",
    },
    startedAt: NOW,
    completedAt: NOW,
  });

  await declarePopulation({
    workspaceId,
    populationId: "payload-binding-two",
    expectedRowCount: 1,
    expectedPageCount: 1,
    de: 1,
    en: 0,
    manifestIndexes: [50],
  });
  await ingestDsaPopulationPage({
    accountAddress: OWNER,
    workspaceId,
    populationId: "payload-binding-two",
    populationVersion: 1,
    pageNumber: 1,
    idempotencyKey: "payload-binding-two",
    rows: [{ ...required, transparency: { ...required.transparency!, payloadVersion: 2 } }],
    now: NOW,
  });
  const frozen = await reconcileAndFreezeDsaPopulation({
    accountAddress: OWNER,
    workspaceId,
    populationId: "payload-binding-one",
    populationVersion: 1,
    now: NOW,
  });
  assert.equal(frozen.status, "frozen");
  assert.deepEqual(frozen.blockers, []);
});

test("blocks personal data outbound and requires a complete 201 receipt before freezing required records", async () => {
  const workspaceId = await workspace();
  const populationId = "required-sor";
  await declarePopulation({
    workspaceId,
    populationId,
    expectedRowCount: 1,
    expectedPageCount: 1,
    manifestIndexes: [20],
  });
  const required = populationRow(20, {
    partitionValues: { language: "de" },
    sorApplicability: "required",
    nonRequiredBasis: undefined,
    transparency: {
      payloadVersion: 1,
      statement: {
        category: "STATEMENT_CATEGORY_ILLEGAL_CONTENT",
        categorySpecification: "KEYWORD_OTHER",
        contentId: "4006381333931",
        decisionVisibility: "DECISION_VISIBILITY_CONTENT_DISABLED",
        reasonCode: "ILLEGAL_POLICY_MATCH",
        decision_facts: "Contact person@example.com",
      } as never,
    },
  });
  await assert.rejects(
    () =>
      ingestDsaPopulationPage({
        accountAddress: OWNER,
        workspaceId,
        populationId,
        populationVersion: 1,
        pageNumber: 1,
        idempotencyKey: "required-page-private",
        rows: [required],
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "dsa_transparency_preflight_failed",
  );
  required.transparency = {
    payloadVersion: 1,
    statement: {
      category: "STATEMENT_CATEGORY_ILLEGAL_CONTENT",
      categorySpecification: "KEYWORD_OTHER",
      contentId: "4006381333931",
      decisionVisibility: "DECISION_VISIBILITY_CONTENT_DISABLED",
      reasonCode: "ILLEGAL_POLICY_MATCH",
    },
  };
  await ingestDsaPopulationPage({
    accountAddress: OWNER,
    workspaceId,
    populationId,
    populationVersion: 1,
    pageNumber: 1,
    idempotencyKey: "required-page-valid",
    rows: [required],
    now: NOW,
  });
  const blocked = await reconcileAndFreezeDsaPopulation({
    accountAddress: OWNER,
    workspaceId,
    populationId,
    populationVersion: 1,
    now: NOW,
  });
  assert.equal(blocked.status, "blocked");
  assert.deepEqual(blocked.blockers, [{ code: "missing_transparency_receipt", count: 1 }]);

  const ambiguous = await recordDsaTransparencyDeliveryResult({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: required.providerDecisionId,
    decisionVersion: 1,
    payloadVersion: 1,
    operation: "submit",
    idempotencyKey: "submit-ambiguous-001",
    httpStatus: 503,
    resultBody: { error: "upstream unavailable" },
    startedAt: NOW,
    completedAt: NOW,
  });
  assert.equal(ambiguous.outcome, "unknown_pending_puid_lookup");
  await assert.rejects(
    () =>
      recordDsaTransparencyDeliveryResult({
        accountAddress: OWNER,
        workspaceId,
        providerDecisionId: required.providerDecisionId,
        decisionVersion: 1,
        payloadVersion: 1,
        operation: "submit",
        idempotencyKey: "submit-before-lookup",
        httpStatus: 201,
        resultBody: {},
        startedAt: NOW,
        completedAt: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "dsa_puid_lookup_required",
  );
  const transientLookup = await recordDsaTransparencyDeliveryResult({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: required.providerDecisionId,
    decisionVersion: 1,
    payloadVersion: 1,
    operation: "puid_lookup",
    idempotencyKey: "lookup-transient-001",
    httpStatus: 503,
    resultBody: { error: "lookup unavailable" },
    startedAt: NOW,
    completedAt: NOW,
  });
  assert.equal(transientLookup.outcome, "puid_lookup_unknown");
  const absent = await recordDsaTransparencyDeliveryResult({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: required.providerDecisionId,
    decisionVersion: 1,
    payloadVersion: 1,
    operation: "puid_lookup",
    idempotencyKey: "lookup-required-001",
    httpStatus: 404,
    resultBody: { found: false },
    startedAt: NOW,
    completedAt: NOW,
  });
  assert.equal(absent.outcome, "puid_absent_retry_allowed");
  const receipt = {
    uuid: "commission-uuid-0001",
    id: 42,
    created_at: NOW.toISOString(),
    permalink: "https://transparency.dsa.ec.europa.eu/statement/42",
    self: "https://transparency.dsa.ec.europa.eu/api/v1/statement/42",
  };
  const created = await recordDsaTransparencyDeliveryResult({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: required.providerDecisionId,
    decisionVersion: 1,
    payloadVersion: 1,
    operation: "submit",
    idempotencyKey: "submit-created-001",
    httpStatus: 201,
    resultBody: receipt,
    startedAt: NOW,
    completedAt: NOW,
  });
  assert.equal(created.outcome, "created");
  const frozen = await reconcileAndFreezeDsaPopulation({
    accountAddress: OWNER,
    workspaceId,
    populationId,
    populationVersion: 1,
    now: NOW,
  });
  assert.equal(frozen.status, "frozen");
  const ledger = await dbClient.execute(
    `SELECT p.puid,p.payload_json,p.request_hash,a.operation,a.http_status,a.outcome,a.result_json,
            r.receipt_json,r.receipt_hash,x.internal_reference_hash
     FROM tokenless_dsa_transparency_payload_versions p
     JOIN tokenless_dsa_transparency_delivery_attempts a
       ON a.workspace_id=p.workspace_id AND a.provider_decision_id=p.provider_decision_id
      AND a.decision_version=p.decision_version AND a.payload_version=p.payload_version
     LEFT JOIN tokenless_dsa_transparency_receipt_versions r ON r.attempt_id=a.attempt_id
     JOIN tokenless_dsa_transparency_private_crosswalks x
       ON x.workspace_id=p.workspace_id AND x.provider_decision_id=p.provider_decision_id
      AND x.decision_version=p.decision_version AND x.payload_version=p.payload_version
     ORDER BY a.attempt_version`,
  );
  assert.equal(ledger.rows.length, 4);
  assert.equal(ledger.rows[0]?.outcome, "unknown_pending_puid_lookup");
  assert.equal(ledger.rows[1]?.outcome, "puid_lookup_unknown");
  assert.equal(ledger.rows[2]?.outcome, "puid_absent_retry_allowed");
  assert.deepEqual(JSON.parse(String(ledger.rows[3]?.receipt_json)), receipt);
  assert.match(String(ledger.rows[3]?.receipt_hash), /^sha256:[0-9a-f]{64}$/u);
  assert.match(String(ledger.rows[3]?.internal_reference_hash), /^sha256:[0-9a-f]{64}$/u);
});

test("recovers an ambiguous submission from an official 302 PUID lookup without inventing Commission fields", async () => {
  const workspaceId = await workspace();
  const row = populationRow(21, {
    partitionValues: { language: "en" },
    sorApplicability: "required",
    nonRequiredBasis: undefined,
    transparency: {
      payloadVersion: 1,
      statement: {
        category: "STATEMENT_CATEGORY_INCOMPATIBLE_CONTENT",
        categorySpecification: "KEYWORD_OTHER",
        contentId: "4006381333931",
        decisionVisibility: "DECISION_VISIBILITY_CONTENT_DISABLED",
        reasonCode: "TERMS_POLICY_MATCH",
      },
    },
  });
  await declarePopulation({
    workspaceId,
    populationId: "lookup-recovery",
    expectedRowCount: 1,
    expectedPageCount: 1,
    de: 0,
    en: 1,
    manifestIndexes: [21],
  });
  const ingest = await ingestDsaPopulationPage({
    accountAddress: OWNER,
    workspaceId,
    populationId: "lookup-recovery",
    populationVersion: 1,
    pageNumber: 1,
    idempotencyKey: "lookup-recovery-page",
    rows: [row],
    now: NOW,
  });
  assert.ok(ingest.transparencyPayloads);
  const puid = ingest.transparencyPayloads[0]?.puid;
  assert.match(puid ?? "", /^rls_[0-9a-f]{32}$/u);
  await recordDsaTransparencyDeliveryResult({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: row.providerDecisionId,
    decisionVersion: 1,
    payloadVersion: 1,
    operation: "submit",
    idempotencyKey: "lookup-recovery-submit",
    httpStatus: 503,
    resultBody: { error: "timeout" },
    startedAt: NOW,
    completedAt: NOW,
  });
  const found = await recordDsaTransparencyDeliveryResult({
    accountAddress: OWNER,
    workspaceId,
    providerDecisionId: row.providerDecisionId,
    decisionVersion: 1,
    payloadVersion: 1,
    operation: "puid_lookup",
    idempotencyKey: "lookup-recovery-found",
    httpStatus: 302,
    resultBody: { message: "Statement found", puid },
    startedAt: NOW,
    completedAt: NOW,
  });
  assert.equal(found.outcome, "puid_exists_verified");
  const frozen = await reconcileAndFreezeDsaPopulation({
    accountAddress: OWNER,
    workspaceId,
    populationId: "lookup-recovery",
    populationVersion: 1,
    now: NOW,
  });
  assert.equal(frozen.status, "frozen");
  const receipt = await dbClient.execute({
    sql: `SELECT receipt_source,commission_uuid,receipt_json
          FROM tokenless_dsa_transparency_receipt_versions WHERE workspace_id=?`,
    args: [workspaceId],
  });
  assert.equal(receipt.rows[0]?.receipt_source, "verified_puid_lookup_302");
  assert.equal(receipt.rows[0]?.commission_uuid, null);
  const lookupEvidence = JSON.parse(String(receipt.rows[0]?.receipt_json)) as Record<string, unknown>;
  assert.equal(lookupEvidence.httpStatus, 302);
  assert.equal(lookupEvidence.puid, puid);
  assert.match(String(lookupEvidence.resultHash), /^sha256:[0-9a-f]{64}$/u);
});

test("blocks freeze on missing pages and totals, and tenant authorization never reveals another workspace", async () => {
  const workspaceId = await workspace();
  const secondWorkspaceId = await workspace(SECOND_OWNER, "Second DSA workspace");
  await declarePopulation({ workspaceId, populationId: "incomplete", expectedRowCount: 2, expectedPageCount: 2 });
  await ingestDsaPopulationPage({
    accountAddress: OWNER,
    workspaceId,
    populationId: "incomplete",
    populationVersion: 1,
    pageNumber: 1,
    idempotencyKey: "incomplete-page-001",
    rows: [populationRow(100, { partitionValues: { language: "de" } })],
    now: NOW,
  });
  const blocked = await reconcileAndFreezeDsaPopulation({
    accountAddress: OWNER,
    workspaceId,
    populationId: "incomplete",
    populationVersion: 1,
    now: NOW,
  });
  assert.equal(blocked.status, "blocked");
  assert.ok(blocked.blockers.some(item => item.code === "missing_pages"));
  assert.ok(blocked.blockers.some(item => item.code === "row_count_mismatch"));
  assert.ok(blocked.blockers.some(item => item.code === "source_totals_mismatch"));

  await Promise.all([
    assert.rejects(
      () =>
        getFrozenDsaPopulationContract({
          accountAddress: OUTSIDER,
          workspaceId,
          populationId: "incomplete",
          populationVersion: 1,
        }),
      (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
    ),
    assert.rejects(
      () =>
        getFrozenDsaPopulationContract({
          accountAddress: SECOND_OWNER,
          workspaceId: secondWorkspaceId,
          populationId: "incomplete",
          populationVersion: 1,
        }),
      (error: unknown) => error instanceof TokenlessServiceError && error.code === "dsa_population_not_found",
    ),
  ]);
});
