import { canonicalizeRfc8785 } from "@rateloop/node-utils/jcs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { DSA_PART8_OFFICIAL_INDICATORS, DSA_PART8_SECTION_16_NAME } from "~~/lib/tokenless/dsaPart8Export";
import {
  type BuildDsaPart8ReportVersionInput,
  DSA_PART8_EXTERNAL_METHOD_EVIDENCE_SCHEMA_VERSION,
  DSA_PART8_REPORT_VERSION_SCHEMA_VERSION,
  type DsaPart8ReportCalculationBinding,
  type DsaPart8ReportCsvRow,
  type DsaPart8ReportDesignation,
  buildAcceptedDsaPart8ExternalMethodEvidence,
  buildDsaPart8ReportVersion,
  dsaPart8AccuracyRowMatchesAuthoritativeValue,
  verifyDsaPart8ReportVersion,
} from "~~/lib/tokenless/dsaPart8ReportVersions";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const SHA_A = `sha256:${"a".repeat(64)}` as const;
const SHA_B = `sha256:${"b".repeat(64)}` as const;
const SHA_C = `sha256:${"c".repeat(64)}` as const;
const WORKSPACE = "workspace_report";
const CONTRACT = `dsa8c_${"1".repeat(40)}`;
const INVENTORY = `dci_${"2".repeat(40)}`;
const EPOCH = `rse_${"3".repeat(40)}`;
const LABEL_SET = `rsls_${"4".repeat(40)}`;

function context(designation: DsaPart8ReportDesignation, gap?: string) {
  return canonicalizeRfc8785({
    ...(gap ? { gap: { code: gap } } : {}),
    methodology: {
      artifactDesignation: designation,
      methodReviewStatus:
        designation === "section_1_6_draft_only" ? "pending_external_method_review" : "accepted_external_method_review",
      ...(designation === "section_1_6_method_accepted"
        ? { externalMethodEvidenceDigest: methodEvidence.evidenceDigest }
        : {}),
    },
  });
}

function countRow(
  designation: DsaPart8ReportDesignation,
  value = "1",
  gap?: string,
): Readonly<{ columns: DsaPart8ReportCsvRow; calculation: DsaPart8ReportCalculationBinding }> {
  return {
    columns: [
      "All",
      "RateLoop review service",
      "2026-01-01/2026-12-31",
      DSA_PART8_SECTION_16_NAME,
      DSA_PART8_OFFICIAL_INDICATORS.measures_not_automated,
      "Total number",
      value,
      context(designation, gap),
    ],
    calculation: {
      kind: "count",
      indicator: "measures_not_automated",
      scope: "Total number",
      countCellHash: SHA_C,
    },
  };
}

function accuracyRow(
  designation: DsaPart8ReportDesignation,
  value = "0.75",
  gap?: string,
): Readonly<{ columns: DsaPart8ReportCsvRow; calculation: DsaPart8ReportCalculationBinding }> {
  return {
    columns: [
      "All",
      "RateLoop review service",
      "2026-01-01/2026-12-31",
      DSA_PART8_SECTION_16_NAME,
      DSA_PART8_OFFICIAL_INDICATORS.accuracy,
      "Total number",
      value,
      context(designation, gap),
    ],
    calculation: {
      kind: "accuracy",
      systemId: "classifier.primary",
      systemVersion: "2026.1",
      machineClass: "text_classifier",
      metric: "accuracy",
      scope: "Total number",
      estimatorVersion: "horvitz-thompson-system-stratified-point-estimate-v3",
      frameRoot: SHA_B,
      sampleDigest: SHA_C,
      labelSetRoot: SHA_A,
    },
  };
}

const reference = {
  epochId: EPOCH,
  commitmentDigest: SHA_B,
  sampleDigest: SHA_C,
  manifestRoot: SHA_A,
  labelSetId: LABEL_SET,
  labelRoot: SHA_A,
  labelSetHash: SHA_B,
} as const;

const methodEvidence = buildAcceptedDsaPart8ExternalMethodEvidence({
  workspaceId: WORKSPACE,
  methodEvidenceVersion: 1,
  methodVersion: "statistician-review.2026-08",
  reviewerOrganisationDigest: SHA_A,
  acceptanceStatementDigest: SHA_B,
  evidenceBytes: new TextEncoder().encode("signed external method acceptance"),
  acceptedAt: "2026-08-01T08:00:00.000Z",
  recordedBy: "0x1111111111111111111111111111111111111111",
  recordedAt: "2026-08-01T09:00:00.000Z",
});

function buildInput(overrides: Partial<BuildDsaPart8ReportVersionInput> = {}): BuildDsaPart8ReportVersionInput {
  return {
    workspaceId: WORKSPACE,
    reportVersion: 1,
    contractId: CONTRACT,
    countResultDigest: SHA_A,
    inventoryId: INVENTORY,
    inventoryRoot: SHA_B,
    inventoryDigest: SHA_C,
    serviceId: "part8-service",
    reportingPeriodStart: "2026-01-01T00:00:00.000Z",
    reportingPeriodEnd: "2027-01-01T00:00:00.000Z",
    sourceFrozenAt: "2027-01-01T00:00:01.000Z",
    reference: null,
    designation: "section_1_6_draft_only",
    methodEvidence: null,
    previous: null,
    correction: null,
    rows: [countRow("section_1_6_draft_only")],
    createdBy: "0x1111111111111111111111111111111111111111",
    frozenAt: "2027-01-01T00:00:02.000Z",
    ...overrides,
  };
}

function invalidReport(error: unknown) {
  return error instanceof TokenlessServiceError && error.code === "invalid_dsa_part8_report_version";
}

test("reconstructs exact public and confidential bytes for an immutable draft", () => {
  const input = buildInput();
  const evidence = buildDsaPart8ReportVersion(input);
  assert.equal(evidence.report.schemaVersion, DSA_PART8_REPORT_VERSION_SCHEMA_VERSION);
  assert.equal(evidence.report.artifactDesignation, "section_1_6_draft_only");
  assert.equal(evidence.report.publicationEligible, false);
  assert.equal(evidence.report.completeTransparencyReport, false);
  assert.match(evidence.report.reportId, /^dsa8r_[0-9a-f]{40}$/u);
  assert.equal(evidence.cells[0]?.calculation.kind, "count");
  assert.match(evidence.cells[0]!.calculationBindingHash, /^sha256:[0-9a-f]{64}$/u);
  const publicFile = evidence.files[0];
  assert.equal(publicFile.fileKind, "public_csv");
  assert.ok(new TextDecoder().decode(publicFile.bytes).endsWith("\r\n"));
  assert.deepEqual(verifyDsaPart8ReportVersion(input, evidence), evidence);
  const tampered = {
    ...evidence,
    files: [{ ...publicFile, bytes: Uint8Array.from([...publicFile.bytes, 0x20]) }, evidence.files[1]] as const,
  };
  assert.throws(() => verifyDsaPart8ReportVersion(input, tampered), /Stored DSA Part 8 report/u);
});

test("binds accepted method evidence and an exact immediate correction predecessor", () => {
  assert.equal(methodEvidence.schemaVersion, DSA_PART8_EXTERNAL_METHOD_EVIDENCE_SCHEMA_VERSION);
  assert.match(methodEvidence.methodEvidenceId, /^dsa8m_[0-9a-f]{40}$/u);
  const first = buildDsaPart8ReportVersion(buildInput());
  const accepted = buildDsaPart8ReportVersion(
    buildInput({
      reportVersion: 2,
      designation: "section_1_6_method_accepted",
      methodEvidence,
      previous: { reportVersion: 1, reportDigest: first.report.reportDigest },
      correction: { reason: "External method review accepted the calculation.", changes: ["method_acceptance"] },
      rows: [countRow("section_1_6_method_accepted")],
    }),
  );
  assert.equal(accepted.report.supersedesReportVersion, 1);
  assert.equal(accepted.report.supersedesReportDigest, first.report.reportDigest);
  assert.deepEqual(accepted.report.changeSummary, ["method_acceptance"]);
  assert.equal(accepted.report.methodDeclaration, "accepted_external_method_v1");
  assert.equal(accepted.report.publicationEligible, true);
});

test("method acceptance cannot cure count or estimate evidence gaps", () => {
  assert.throws(
    () =>
      buildDsaPart8ReportVersion(
        buildInput({
          designation: "section_1_6_method_accepted",
          methodEvidence,
          rows: [countRow("section_1_6_method_accepted", "", "incomplete_notice_processing")],
        }),
      ),
    invalidReport,
  );
  assert.throws(
    () =>
      buildDsaPart8ReportVersion(
        buildInput({
          reference,
          designation: "section_1_6_method_accepted",
          methodEvidence,
          rows: [accuracyRow("section_1_6_method_accepted", "", "zero_denominator")],
        }),
      ),
    invalidReport,
  );
});

test("accuracy rows require exact sample and label roots while count-only zero-classifier rows do not", () => {
  assert.doesNotThrow(() => buildDsaPart8ReportVersion(buildInput()));
  assert.throws(
    () => buildDsaPart8ReportVersion(buildInput({ rows: [accuracyRow("section_1_6_draft_only")] })),
    invalidReport,
  );
  assert.doesNotThrow(() =>
    buildDsaPart8ReportVersion(buildInput({ reference, rows: [accuracyRow("section_1_6_draft_only")] })),
  );
  assert.throws(
    () =>
      buildDsaPart8ReportVersion(
        buildInput({
          reference,
          rows: [
            {
              ...accuracyRow("section_1_6_draft_only"),
              calculation: { ...accuracyRow("section_1_6_draft_only").calculation, labelSetRoot: SHA_C } as never,
            },
          ],
        }),
      ),
    invalidReport,
  );
});

test("an accepted accuracy value must replay from the authoritative frozen sample", () => {
  const row = accuracyRow("section_1_6_method_accepted", "0.75");
  assert.equal(dsaPart8AccuracyRowMatchesAuthoritativeValue(row, { frameRoot: SHA_B, value: "0.75" }), true);
  assert.equal(dsaPart8AccuracyRowMatchesAuthoritativeValue(row, { frameRoot: SHA_B, value: "0.74" }), false);
  assert.equal(dsaPart8AccuracyRowMatchesAuthoritativeValue(row, { frameRoot: SHA_C, value: "0.75" }), false);
});

test("rejects formula-capable fields, private identifiers, and non-immediate corrections", () => {
  for (const service of ["=cmd", "+cmd", "-cmd", "@cmd", "workspace_id=private"]) {
    const row = countRow("section_1_6_draft_only");
    assert.throws(
      () =>
        buildDsaPart8ReportVersion(
          buildInput({
            rows: [
              {
                ...row,
                columns: [
                  row.columns[0],
                  service,
                  row.columns[2],
                  row.columns[3],
                  row.columns[4],
                  row.columns[5],
                  row.columns[6],
                  row.columns[7],
                ],
              },
            ],
          }),
        ),
      invalidReport,
      service,
    );
  }
  assert.throws(
    () =>
      buildDsaPart8ReportVersion(
        buildInput({
          reportVersion: 3,
          previous: { reportVersion: 1, reportDigest: SHA_A },
          correction: { reason: "skip", changes: ["evidence_correction"] },
        }),
      ),
    invalidReport,
  );
});
