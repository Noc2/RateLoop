import { sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DSA_PART8_CENSUS_WITNESS_SCHEMA_VERSION,
  DSA_PART8_COUNT_CONTRACT_SCHEMA_VERSION,
  DSA_PART8_COUNT_DECISION_FACT_SCHEMA_VERSION,
  DSA_PART8_MAX_CLASSIFIERS,
  DSA_PART8_PROVIDER_TYPES,
  type DsaPart8CountContractSpec,
  type DsaPart8CountDecisionFactPayload,
  type FrozenDsaPart8CountContract,
  freezeDsaPart8CountContract,
  sealDsaPart8CountDecisionFact,
} from "~~/lib/tokenless/dsaPart8Counts";
import {
  DSA_PART8_MAX_SECTION_16_ROWS,
  DSA_PART8_OFFICIAL_TEMPLATE_BYTE_LENGTH,
  DSA_PART8_OFFICIAL_TEMPLATE_SHA256,
  DSA_PART8_OFFICIAL_TEMPLATE_URL,
  DSA_PART8_SECTION_16_CSV_HEADER,
  DSA_PART8_SECTION_16_TRANSFORM_VERSION,
  type DsaPart8Section16ExportInput,
  __dsaPart8ExportTestUtils,
  expectedDsaPart8Section16RowCount,
  exportDsaPart8Section16Draft,
  verifyDsaPart8Section16Draft,
} from "~~/lib/tokenless/dsaPart8Export";
import {
  DSA_PART8_EMPTY_AUTOMATED_MEANS_EVALUATION_SET_ROOT,
  type DsaPart8DecisionFactInput,
} from "~~/lib/tokenless/dsaPart8SourceFacts";

type ProviderType = (typeof DSA_PART8_PROVIDER_TYPES)[number];
const SERVICE_ID = "service.part8-export";
const OFFICIAL_TEMPLATE = {
  url: DSA_PART8_OFFICIAL_TEMPLATE_URL,
  sha256: DSA_PART8_OFFICIAL_TEMPLATE_SHA256,
  byteLength: DSA_PART8_OFFICIAL_TEMPLATE_BYTE_LENGTH,
} as const;
const INVENTORY_ENTRY = {
  systemId: "classifier_primary",
  version: "2026.1",
  machineClass: "text_classifier",
  publicDesignation: "Safety text classifier",
} as const;

function period(providerType: ProviderType) {
  return providerType === "vlop" || providerType === "vlose"
    ? { startInclusive: "2026-01-01T00:00:00.000Z", endExclusive: "2026-07-01T00:00:00.000Z" }
    : { startInclusive: "2026-01-01T00:00:00.000Z", endExclusive: "2027-01-01T00:00:00.000Z" };
}

function decision(index: number, overrides: Partial<DsaPart8DecisionFactInput> = {}) {
  const sourceFact: DsaPart8DecisionFactInput = {
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
  const payload: DsaPart8CountDecisionFactPayload = {
    schemaVersion: DSA_PART8_COUNT_DECISION_FACT_SCHEMA_VERSION,
    serviceId: SERVICE_ID,
    occurredAt: "2026-03-01T00:00:00.000Z",
    sourceDecisionBinding: sha256Rfc8785({ decision: index }),
    sourceFact,
  };
  return sealDsaPart8CountDecisionFact(payload);
}

function contract(
  providerType: ProviderType,
  decisionFacts: readonly ReturnType<typeof decision>[] = [],
  classifierInventory: DsaPart8CountContractSpec["classifierInventory"] = [],
) {
  const spec: DsaPart8CountContractSpec = {
    schemaVersion: DSA_PART8_COUNT_CONTRACT_SCHEMA_VERSION,
    contractId: "dsa8c_export_2026",
    service: { serviceId: SERVICE_ID, providerType },
    reportingPeriod: period(providerType),
    classifierInventory,
    censusWitness: {
      schemaVersion: DSA_PART8_CENSUS_WITNESS_SCHEMA_VERSION,
      kind: "database_transaction_and_attestation",
      censusId: "census_export_2026",
      sourcePopulationId: "population_export_2026",
      sourcePopulationVersion: 1,
      frozenAt:
        providerType === "vlop" || providerType === "vlose" ? "2026-07-01T00:00:01.000Z" : "2027-01-01T00:00:01.000Z",
      auditHeadDigest: sha256Rfc8785({ audit: providerType }),
      attestationJobId: "attestation_export_2026",
    },
  };
  return freezeDsaPart8CountContract({ spec, decisionFacts, evaluationFacts: [], noticeFacts: [] });
}

function input(overrides: Partial<DsaPart8Section16ExportInput> = {}): DsaPart8Section16ExportInput {
  return {
    transformVersion: DSA_PART8_SECTION_16_TRANSFORM_VERSION,
    officialTemplate: OFFICIAL_TEMPLATE,
    serviceName: "RateLoop review service",
    countContract: contract("vlop"),
    countEvidence: { decisionFacts: [], evaluationFacts: [], noticeFacts: [] },
    accuracyEvidence: { status: "not_applicable_no_classifiers" },
    ...overrides,
  };
}

test("pins the exact official 5,345-byte Part 8 CSV source artifact", () => {
  const bytes = readFileSync(new URL("./fixtures/dsa-part8-official-113338.csv", import.meta.url));
  assert.equal(bytes.byteLength, DSA_PART8_OFFICIAL_TEMPLATE_BYTE_LENGTH);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), DSA_PART8_OFFICIAL_TEMPLATE_SHA256);
  assert.equal(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false);
  const text = bytes.toString("utf8");
  assert.equal(text.includes("\r"), false);
  assert.equal(text.split("\n").length, 37);
  assert.equal(text.split("\n")[0], DSA_PART8_SECTION_16_CSV_HEADER.join(","));
  assert.match(text.split("\n")[21]!, /solely taken by automated means ,bg,,$/u);
  assert.match(text.split("\n")[24]!, /not taken by automated means,bg,,$/u);
  assert.match(text.split("\n")[27]!, /Accuracy of the automated means - Accuracy,bg,,$/u);
});

test("derives a canonical draft only from complete count evidence and preserves Commission source order", () => {
  const decisions = [decision(1), decision(2, { origin: "authority_order" })];
  const countContract = contract("vlop", decisions);
  const draft = exportDsaPart8Section16Draft(
    input({ countContract, countEvidence: { decisionFacts: decisions, evaluationFacts: [], noticeFacts: [] } }),
  );
  assert.equal(draft.rowCount, 56);
  assert.equal(draft.rows[0]?.[4], "Number of measures solely taken by automated means");
  assert.equal(draft.rows[1]?.[4], "Number of measures not taken by automated means");
  assert.equal(draft.rows[2]?.[5], "Own-initiative");
  assert.equal(draft.rows[8]?.[5], "bg");
  assert.equal(draft.rows[31]?.[5], "sv");
  assert.equal(draft.rows[32]?.[5], "bg");
  assert.equal(draft.rows[55]?.[5], "sv");
  assert.equal(draft.rows[0]?.[6], "0");
  assert.equal(draft.rows[1]?.[6], "2");
  assert.equal(draft.publicationEligible, false);
  assert.equal(draft.publication.filingReady, false);
  assert.equal(draft.bindings.decisionFactRoot, countContract.decisionFactRoot);
  assert.equal(draft.bindings.evaluationFactRoot, countContract.evaluationFactRoot);
  assert.equal(draft.bindings.estimateDigest, null);
  assert.deepEqual(
    verifyDsaPart8Section16Draft(
      input({ countContract, countEvidence: { decisionFacts: decisions, evaluationFacts: [], noticeFacts: [] } }),
      draft.csvBytes,
    ),
    draft,
  );
});

test("uses exact bounded row formulas for all provider types and classifier inventories", () => {
  const expected = {
    intermediary_service: [4, 6],
    hosting_service: [6, 9],
    online_platform: [8, 12],
    vlop: [56, 84],
    vlose: [4, 6],
  } satisfies Record<ProviderType, readonly [number, number]>;
  for (const providerType of DSA_PART8_PROVIDER_TYPES) {
    const [base, perSystem] = expected[providerType];
    assert.equal(expectedDsaPart8Section16RowCount(providerType, 0), base);
    assert.equal(expectedDsaPart8Section16RowCount(providerType, 3), base + perSystem * 3);
  }
  assert.equal(expectedDsaPart8Section16RowCount("vlop", DSA_PART8_MAX_CLASSIFIERS), 5_432);
  assert.ok(5_432 <= DSA_PART8_MAX_SECTION_16_ROWS);
  assert.throws(() => expectedDsaPart8Section16RowCount("vlop", DSA_PART8_MAX_CLASSIFIERS + 1));
});

test("recomputes counts from evidence and rejects missing, substituted, or tampered facts", () => {
  const facts = [decision(10)];
  const countContract = contract("vlop", facts);
  assert.throws(() => exportDsaPart8Section16Draft(input({ countContract })));
  assert.throws(() =>
    exportDsaPart8Section16Draft(
      input({
        countContract,
        countEvidence: {
          decisionFacts: [{ ...facts[0]!, occurredAt: "2026-04-01T00:00:00.000Z" }],
          evaluationFacts: [],
          noticeFacts: [],
        },
      }),
    ),
  );
  assert.throws(() =>
    exportDsaPart8Section16Draft(
      input({ countContract: { ...countContract, expectedDecisionCount: 2 } as FrozenDsaPart8CountContract }),
    ),
  );
});

test("requires full verified estimate input whenever the complete inventory is nonempty", () => {
  const countContract = contract("vlop", [], [INVENTORY_ENTRY]);
  assert.throws(() => exportDsaPart8Section16Draft(input({ countContract })), /estimate|accuracy|classifier/u);
  assert.throws(() =>
    exportDsaPart8Section16Draft(
      input({ countContract, accuracyEvidence: { status: "verified", input: {} as never } }),
    ),
  );
});

test("rejects spreadsheet-formula service names and non-exact template pins", () => {
  for (const serviceName of ["=HYPERLINK(evil)", "+cmd", "-cmd", "@cmd"]) {
    assert.throws(() => exportDsaPart8Section16Draft(input({ serviceName })));
  }
  assert.throws(() =>
    exportDsaPart8Section16Draft(input({ officialTemplate: { ...OFFICIAL_TEMPLATE, byteLength: 5_344 } as never })),
  );
});

test("strict CSV verification rejects altered values, LF output, BOMs, and noncanonical contexts", () => {
  const exportInput = input();
  const draft = exportDsaPart8Section16Draft(exportInput);
  const text = new TextDecoder().decode(draft.csvBytes);
  const mutations = [
    new TextEncoder().encode(text.replace(",0,", ",1,")),
    new TextEncoder().encode(text.replaceAll("\r\n", "\n")),
    Uint8Array.from([0xef, 0xbb, 0xbf, ...draft.csvBytes]),
    new TextEncoder().encode(
      text.replace(
        '""artifactDesignation"":""section_1_6_draft_only""',
        '""z"":1,""artifactDesignation"":""section_1_6_draft_only""',
      ),
    ),
  ];
  for (const candidate of mutations) assert.throws(() => verifyDsaPart8Section16Draft(exportInput, candidate));
  const records = __dsaPart8ExportTestUtils.parseRfc4180(text);
  assert.equal(records.length, draft.rowCount + 1);
});
