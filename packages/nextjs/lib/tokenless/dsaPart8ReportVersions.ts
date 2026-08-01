import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { enqueueAssuranceAttestationInTransaction } from "~~/lib/tokenless/assuranceAttestationPipeline";
import { dsaEvidenceCommitTimestamp, dsaEvidenceTransactionTimestamp } from "~~/lib/tokenless/dsaEvidenceClock";
import {
  DSA_PART8_MAX_SECTION_16_ROWS,
  DSA_PART8_OFFICIAL_INDICATORS,
  DSA_PART8_OFFICIAL_TEMPLATE_SHA256,
  DSA_PART8_SECTION_16_CSV_HEADER,
  DSA_PART8_SECTION_16_NAME,
  DSA_PART8_SECTION_16_TRANSFORM_VERSION,
  expectedDsaPart8Section16RowCount,
} from "~~/lib/tokenless/dsaPart8Export";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const DSA_PART8_REPORT_VERSION_SCHEMA_VERSION = "rateloop.dsa-part8-report-version.v1" as const;
export const DSA_PART8_REPORT_PUBLICATION_SCHEMA_VERSION = "rateloop.dsa-part8-report-publication.v1" as const;
export const DSA_PART8_EXTERNAL_METHOD_EVIDENCE_SCHEMA_VERSION =
  "rateloop.dsa-part8-external-method-evidence.v1" as const;
export const DSA_PART8_CONFIDENTIAL_FILE_SCHEMA_VERSION = "rateloop.dsa-part8-confidential-evidence.v1" as const;

const SIMPLE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const CONTRACT_ID = /^dsa8c_[0-9a-f]{40}$/u;
const INVENTORY_ID = /^dci_[0-9a-f]{40}$/u;
const EPOCH_ID = /^rse_[0-9a-f]{40}$/u;
const LABEL_SET_ID = /^rsls_[0-9a-f]{40}$/u;
const METHOD_EVIDENCE_ID = /^dsa8m_[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const FORMULA_PREFIX = /^[\s]*[=+@-]/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const PRIVATE_IDENTIFIER =
  /(provider[_ ]?decision|evaluation_[A-Za-z0-9]|dsaobj_|workspace[_ ]?id|reviewer[_ ]?id|account[_ ]?address|0x[0-9a-f]{40})/iu;
const VALUE = /^(?:|0|[1-9][0-9]*|0\.[0-9]{1,8}|1\.0{1,8})$/u;
const CHANGE_CODES = [
  "evidence_correction",
  "calculation_correction",
  "presentation_correction",
  "method_acceptance",
] as const;

type Row = Record<string, unknown>;
export type DsaPart8ReportDesignation = "section_1_6_draft_only" | "section_1_6_method_accepted";
export type DsaPart8ReportChangeCode = (typeof CHANGE_CODES)[number];
export type DsaPart8ReportCsvRow = readonly [string, string, string, string, string, string, string, string];
export type DsaPart8ReportCalculationBinding =
  | Readonly<{
      kind: "count";
      indicator:
        | "measures_solely_automated"
        | "measures_not_automated"
        | "notices_solely_automated"
        | "notices_not_automated";
      scope: string;
      countCellHash: `sha256:${string}`;
    }>
  | Readonly<{
      kind: "accuracy";
      systemId: string;
      systemVersion: string;
      machineClass: string;
      metric: "accuracy" | "precision" | "recall";
      scope: string;
      estimatorVersion: "horvitz-thompson-system-stratified-point-estimate-v3";
      frameRoot: `sha256:${string}`;
      sampleDigest: `sha256:${string}`;
      labelSetRoot: `sha256:${string}`;
    }>;
export type DsaPart8ReportRowInput = Readonly<{
  columns: DsaPart8ReportCsvRow;
  calculation: DsaPart8ReportCalculationBinding;
}>;

export type DsaPart8ReportReferenceBinding = Readonly<{
  epochId: string;
  commitmentDigest: `sha256:${string}`;
  sampleDigest: `sha256:${string}`;
  manifestRoot: `sha256:${string}`;
  labelSetId: string;
  labelRoot: `sha256:${string}`;
  labelSetHash: `sha256:${string}`;
}> | null;

export type AcceptedDsaPart8ExternalMethodEvidence = Readonly<{
  workspaceId: string;
  methodEvidenceId: string;
  methodEvidenceVersion: number;
  schemaVersion: typeof DSA_PART8_EXTERNAL_METHOD_EVIDENCE_SCHEMA_VERSION;
  methodVersion: string;
  reviewOutcome: "accepted";
  reviewerOrganisationDigest: `sha256:${string}`;
  independenceDeclaration: "external_independent_method_reviewer";
  acceptanceStatementDigest: `sha256:${string}`;
  evidenceBytes: Uint8Array;
  evidenceByteLength: number;
  evidenceDigest: `sha256:${string}`;
  acceptedAt: string;
  recordedBy: string;
  recordedAt: string;
}>;

export type BuildAcceptedDsaPart8ExternalMethodEvidenceInput = Readonly<{
  workspaceId: string;
  methodEvidenceVersion: number;
  methodVersion: string;
  reviewerOrganisationDigest: `sha256:${string}`;
  acceptanceStatementDigest: `sha256:${string}`;
  evidenceBytes: Uint8Array;
  acceptedAt: string;
  recordedBy: string;
  recordedAt: string;
}>;

export type DsaPart8ReportCell = Readonly<{
  rowNumber: number;
  columns: DsaPart8ReportCsvRow;
  calculation: DsaPart8ReportCalculationBinding;
  calculationBindingJson: string;
  calculationBindingHash: `sha256:${string}`;
  cellJson: string;
  cellHash: `sha256:${string}`;
}>;

export type DsaPart8ReportVersion = Readonly<{
  workspaceId: string;
  reportId: string;
  reportVersion: number;
  schemaVersion: typeof DSA_PART8_REPORT_VERSION_SCHEMA_VERSION;
  contractId: string;
  countResultDigest: `sha256:${string}`;
  inventoryId: string;
  inventoryRoot: `sha256:${string}`;
  inventoryDigest: `sha256:${string}`;
  serviceId: string;
  reportingPeriodStart: string;
  reportingPeriodEnd: string;
  sourceFrozenAt: string;
  reference: DsaPart8ReportReferenceBinding;
  artifactDesignation: DsaPart8ReportDesignation;
  methodReviewStatus: "pending_external_method_review" | "accepted_external_method_review";
  methodEvidence: null | Readonly<{ methodEvidenceId: string; methodEvidenceVersion: number; evidenceDigest: string }>;
  transformVersion: typeof DSA_PART8_SECTION_16_TRANSFORM_VERSION;
  officialTemplateSha256: `sha256:${string}`;
  expectedCellCount: number;
  cellRoot: `sha256:${string}`;
  publicFileDigest: `sha256:${string}`;
  confidentialFileDigest: `sha256:${string}`;
  supersedesReportVersion: number | null;
  supersedesReportDigest: `sha256:${string}` | null;
  correctionReason: string | null;
  changeSummary: readonly DsaPart8ReportChangeCode[] | null;
  methodDeclaration: "pending_external_method_review" | "accepted_external_method_v1";
  completeTransparencyReport: false;
  publicationEligible: boolean;
  createdBy: string;
  frozenAt: string;
  reportJson: string;
  reportDigest: `sha256:${string}`;
}>;

export type DsaPart8ReportFile = Readonly<{
  fileKind: "public_csv" | "confidential_evidence_json";
  mediaType: "text/csv; charset=utf-8" | "application/json";
  bytes: Uint8Array;
  byteLength: number;
  fileDigest: `sha256:${string}`;
}>;

export type DsaPart8ReportEvidence = Readonly<{
  report: DsaPart8ReportVersion;
  cells: readonly DsaPart8ReportCell[];
  files: readonly [DsaPart8ReportFile, DsaPart8ReportFile];
}>;

export type BuildDsaPart8ReportVersionInput = Readonly<{
  workspaceId: string;
  reportVersion: number;
  contractId: string;
  countResultDigest: `sha256:${string}`;
  inventoryId: string;
  inventoryRoot: `sha256:${string}`;
  inventoryDigest: `sha256:${string}`;
  serviceId: string;
  reportingPeriodStart: string;
  reportingPeriodEnd: string;
  sourceFrozenAt: string;
  reference: DsaPart8ReportReferenceBinding;
  designation: DsaPart8ReportDesignation;
  methodEvidence: AcceptedDsaPart8ExternalMethodEvidence | null;
  previous: null | Readonly<{ reportVersion: number; reportDigest: `sha256:${string}` }>;
  correction: null | Readonly<{ reason: string; changes: readonly DsaPart8ReportChangeCode[] }>;
  rows: readonly DsaPart8ReportRowInput[];
  createdBy: string;
  frozenAt: string;
}>;

const BUILD_KEYS = [
  "contractId",
  "correction",
  "countResultDigest",
  "createdBy",
  "designation",
  "frozenAt",
  "inventoryDigest",
  "inventoryId",
  "inventoryRoot",
  "methodEvidence",
  "previous",
  "reference",
  "reportVersion",
  "reportingPeriodEnd",
  "reportingPeriodStart",
  "rows",
  "serviceId",
  "sourceFrozenAt",
  "workspaceId",
] as const;

function invalid(message: string, field?: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_dsa_part8_report_version", false, field);
}

function storedInvalid(): never {
  throw new TokenlessServiceError(
    "Stored DSA Part 8 report evidence is invalid.",
    500,
    "stored_dsa_part8_report_invalid",
  );
}

function portableCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value: unknown, expected: readonly string[], field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${field} must be a typed object.`, field);
  const actual = Object.keys(value as Record<string, unknown>).sort(portableCompare);
  const wanted = [...expected].sort(portableCompare);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    invalid(`${field} contains missing or unsupported fields.`, field);
  }
}

function positiveInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalid(`${field} must be a positive integer.`, field);
  return Number(value);
}

function canonicalTimestamp(value: string, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    invalid(`${field} must be a canonical UTC timestamp.`, field);
  }
  return value;
}

function rawDigest(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
}

export function dsaPart8AccuracyRowMatchesAuthoritativeValue(
  row: DsaPart8ReportRowInput,
  authoritative: Readonly<{ frameRoot: string; value: string | null }>,
) {
  if (row.calculation.kind !== "accuracy") return true;
  return row.calculation.frameRoot === authoritative.frameRoot && row.columns[6] === (authoritative.value ?? "");
}

function digestRows(domain: string, rows: readonly unknown[]) {
  const digest = createHash("sha256");
  digest.update(`${domain}\0`, "utf8");
  rows.forEach(row => digest.update(`${canonicalizeRfc8785(row)}\n`, "utf8"));
  return `sha256:${digest.digest("hex")}` as const;
}

function deterministicId(prefix: "dsa8r" | "dsa8m" | "dsa8p", value: unknown) {
  return `${prefix}_${sha256Rfc8785(value).slice("sha256:".length, "sha256:".length + 40)}`;
}

export function buildAcceptedDsaPart8ExternalMethodEvidence(
  input: BuildAcceptedDsaPart8ExternalMethodEvidenceInput,
): AcceptedDsaPart8ExternalMethodEvidence {
  exactKeys(
    input,
    [
      "acceptanceStatementDigest",
      "acceptedAt",
      "evidenceBytes",
      "methodEvidenceVersion",
      "methodVersion",
      "recordedAt",
      "recordedBy",
      "reviewerOrganisationDigest",
      "workspaceId",
    ],
    "method evidence",
  );
  const methodEvidenceVersion = positiveInteger(input.methodEvidenceVersion, "methodEvidenceVersion");
  const acceptedAt = canonicalTimestamp(input.acceptedAt, "acceptedAt");
  const recordedAt = canonicalTimestamp(input.recordedAt, "recordedAt");
  if (
    !SIMPLE_IDENTIFIER.test(input.workspaceId) ||
    !IDENTIFIER.test(input.methodVersion) ||
    !SHA256.test(input.reviewerOrganisationDigest) ||
    !SHA256.test(input.acceptanceStatementDigest) ||
    !(input.evidenceBytes instanceof Uint8Array) ||
    input.evidenceBytes.byteLength < 1 ||
    input.evidenceBytes.byteLength > 10 * 1024 * 1024 ||
    typeof input.recordedBy !== "string" ||
    input.recordedBy.length === 0 ||
    input.recordedBy.length > 200 ||
    acceptedAt > recordedAt
  ) {
    invalid("Accepted external method evidence is invalid.", "methodEvidence");
  }
  const evidenceDigest = rawDigest(input.evidenceBytes);
  return {
    workspaceId: input.workspaceId,
    methodEvidenceId: deterministicId("dsa8m", {
      workspaceId: input.workspaceId,
      methodVersion: input.methodVersion,
      reviewerOrganisationDigest: input.reviewerOrganisationDigest,
      acceptanceStatementDigest: input.acceptanceStatementDigest,
    }),
    methodEvidenceVersion,
    schemaVersion: DSA_PART8_EXTERNAL_METHOD_EVIDENCE_SCHEMA_VERSION,
    methodVersion: input.methodVersion,
    reviewOutcome: "accepted",
    reviewerOrganisationDigest: input.reviewerOrganisationDigest,
    independenceDeclaration: "external_independent_method_reviewer",
    acceptanceStatementDigest: input.acceptanceStatementDigest,
    evidenceBytes: Uint8Array.from(input.evidenceBytes),
    evidenceByteLength: input.evidenceBytes.byteLength,
    evidenceDigest,
    acceptedAt,
    recordedBy: input.recordedBy,
    recordedAt,
  };
}

function quoteCsv(value: string) {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function publicCsvBytes(cells: readonly DsaPart8ReportCell[]) {
  const records = [DSA_PART8_SECTION_16_CSV_HEADER, ...cells.map(cell => cell.columns)];
  return new TextEncoder().encode(`${records.map(record => record.map(quoteCsv).join(",")).join("\r\n")}\r\n`);
}

function validatePublicRows(
  rows: readonly DsaPart8ReportRowInput[],
  designation: DsaPart8ReportDesignation,
  reference: DsaPart8ReportReferenceBinding,
  methodEvidence: AcceptedDsaPart8ExternalMethodEvidence | null,
) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > DSA_PART8_MAX_SECTION_16_ROWS) {
    invalid(`rows must contain between 1 and ${DSA_PART8_MAX_SECTION_16_ROWS} entries.`, "rows");
  }
  return rows.map((raw, index) => {
    exactKeys(raw, ["calculation", "columns"], `rows[${index}]`);
    if (
      !Array.isArray(raw.columns) ||
      raw.columns.length !== 8 ||
      raw.columns.some((value: unknown) => typeof value !== "string")
    ) {
      invalid(`rows[${index}] must be an exact eight-column string tuple.`, `rows[${index}]`);
    }
    const columns = [...raw.columns] as unknown as DsaPart8ReportCsvRow;
    const [applicability, service, reportingPeriod, section, indicator, scope, value, contextJson] = columns;
    if (
      section !== DSA_PART8_SECTION_16_NAME ||
      !applicability ||
      !service ||
      !reportingPeriod ||
      !indicator ||
      !scope ||
      !VALUE.test(value) ||
      columns.some(field => CONTROL_CHARACTER.test(field) || FORMULA_PREFIX.test(field)) ||
      PRIVATE_IDENTIFIER.test(columns.join("\n"))
    ) {
      invalid(`rows[${index}] is invalid, formula-capable, or leaks a private identifier.`, `rows[${index}]`);
    }
    let context: unknown;
    try {
      context = JSON.parse(contextJson);
    } catch {
      invalid(`rows[${index}] context must be JSON.`, `rows[${index}].context`);
    }
    if (canonicalizeRfc8785(context) !== contextJson) {
      invalid(`rows[${index}] context must be canonical JSON.`, `rows[${index}].context`);
    }
    const methodology = (context as { methodology?: Record<string, unknown> }).methodology;
    const expectedStatus =
      designation === "section_1_6_draft_only" ? "pending_external_method_review" : "accepted_external_method_review";
    if (
      methodology?.artifactDesignation !== designation ||
      methodology.methodReviewStatus !== expectedStatus ||
      (designation === "section_1_6_method_accepted" &&
        methodology.externalMethodEvidenceDigest !== methodEvidence?.evidenceDigest) ||
      (designation === "section_1_6_draft_only" && "externalMethodEvidenceDigest" in (methodology ?? {}))
    ) {
      invalid(`rows[${index}] context does not match the report method designation.`, `rows[${index}].context`);
    }
    if (designation === "section_1_6_method_accepted" && (value === "" || Object.hasOwn(context as object, "gap"))) {
      invalid("Method acceptance cannot make an evidence-gap row publishable.", `rows[${index}]`);
    }
    const calculation = raw.calculation;
    if (calculation.kind === "count") {
      exactKeys(calculation, ["countCellHash", "indicator", "kind", "scope"], `rows[${index}].calculation`);
      if (
        ![
          "measures_solely_automated",
          "measures_not_automated",
          "notices_solely_automated",
          "notices_not_automated",
        ].includes(calculation.indicator) ||
        calculation.scope !== scope ||
        DSA_PART8_OFFICIAL_INDICATORS[calculation.indicator as keyof typeof DSA_PART8_OFFICIAL_INDICATORS] !==
          indicator ||
        !SHA256.test(calculation.countCellHash)
      ) {
        invalid(`rows[${index}] count binding is invalid.`, `rows[${index}].calculation`);
      }
    } else if (calculation.kind === "accuracy") {
      exactKeys(
        calculation,
        [
          "estimatorVersion",
          "frameRoot",
          "kind",
          "labelSetRoot",
          "machineClass",
          "metric",
          "sampleDigest",
          "scope",
          "systemId",
          "systemVersion",
        ],
        `rows[${index}].calculation`,
      );
      if (
        reference === null ||
        !IDENTIFIER.test(calculation.systemId) ||
        !IDENTIFIER.test(calculation.systemVersion) ||
        ![
          "text_classifier",
          "image_classifier",
          "audio_classifier",
          "video_classifier",
          "multimodal_classifier",
          "rules_engine",
          "other_machine_class",
        ].includes(calculation.machineClass) ||
        !["accuracy", "precision", "recall"].includes(calculation.metric) ||
        calculation.scope !== scope ||
        DSA_PART8_OFFICIAL_INDICATORS[calculation.metric as keyof typeof DSA_PART8_OFFICIAL_INDICATORS] !== indicator ||
        calculation.estimatorVersion !== "horvitz-thompson-system-stratified-point-estimate-v3" ||
        !SHA256.test(calculation.frameRoot) ||
        calculation.sampleDigest !== reference.sampleDigest ||
        calculation.labelSetRoot !== reference.labelRoot
      ) {
        invalid(`rows[${index}] accuracy binding is invalid.`, `rows[${index}].calculation`);
      }
    } else {
      invalid(`rows[${index}] calculation kind is invalid.`, `rows[${index}].calculation`);
    }
    const calculationBindingJson = canonicalizeRfc8785(calculation);
    const calculationBindingHash = sha256Rfc8785(calculation);
    const payload = { rowNumber: index + 1, columns, calculationBindingHash };
    return {
      ...payload,
      calculation: { ...calculation },
      calculationBindingJson,
      calculationBindingHash,
      cellJson: canonicalizeRfc8785(payload),
      cellHash: sha256Rfc8785(payload),
    };
  });
}

function normalizeReference(reference: DsaPart8ReportReferenceBinding) {
  if (reference === null) return null;
  exactKeys(
    reference,
    ["commitmentDigest", "epochId", "labelRoot", "labelSetHash", "labelSetId", "manifestRoot", "sampleDigest"],
    "reference",
  );
  if (
    !EPOCH_ID.test(reference.epochId) ||
    !LABEL_SET_ID.test(reference.labelSetId) ||
    !SHA256.test(reference.commitmentDigest) ||
    !SHA256.test(reference.sampleDigest) ||
    !SHA256.test(reference.manifestRoot) ||
    !SHA256.test(reference.labelRoot) ||
    !SHA256.test(reference.labelSetHash)
  ) {
    invalid("reference must exactly bind a sample and label set.", "reference");
  }
  return { ...reference };
}

function normalizeMethodEvidence(evidence: AcceptedDsaPart8ExternalMethodEvidence | null, workspaceId: string) {
  if (evidence === null) return null;
  exactKeys(
    evidence,
    [
      "acceptanceStatementDigest",
      "acceptedAt",
      "evidenceByteLength",
      "evidenceBytes",
      "evidenceDigest",
      "independenceDeclaration",
      "methodEvidenceId",
      "methodEvidenceVersion",
      "methodVersion",
      "recordedAt",
      "recordedBy",
      "reviewOutcome",
      "reviewerOrganisationDigest",
      "schemaVersion",
      "workspaceId",
    ],
    "methodEvidence",
  );
  if (
    evidence.workspaceId !== workspaceId ||
    !METHOD_EVIDENCE_ID.test(evidence.methodEvidenceId) ||
    positiveInteger(evidence.methodEvidenceVersion, "methodEvidence.methodEvidenceVersion") < 1 ||
    evidence.schemaVersion !== DSA_PART8_EXTERNAL_METHOD_EVIDENCE_SCHEMA_VERSION ||
    !IDENTIFIER.test(evidence.methodVersion) ||
    evidence.reviewOutcome !== "accepted" ||
    evidence.independenceDeclaration !== "external_independent_method_reviewer" ||
    !SHA256.test(evidence.reviewerOrganisationDigest) ||
    !SHA256.test(evidence.acceptanceStatementDigest) ||
    !(evidence.evidenceBytes instanceof Uint8Array) ||
    evidence.evidenceBytes.byteLength !== evidence.evidenceByteLength ||
    evidence.evidenceByteLength < 1 ||
    evidence.evidenceByteLength > 10 * 1024 * 1024 ||
    rawDigest(evidence.evidenceBytes) !== evidence.evidenceDigest ||
    canonicalTimestamp(evidence.acceptedAt, "methodEvidence.acceptedAt") >
      canonicalTimestamp(evidence.recordedAt, "methodEvidence.recordedAt")
  ) {
    invalid("methodEvidence must be an exact accepted external review artifact.", "methodEvidence");
  }
  return evidence;
}

export function buildDsaPart8ReportVersion(input: BuildDsaPart8ReportVersionInput): DsaPart8ReportEvidence {
  exactKeys(input, BUILD_KEYS, "report input");
  const reportVersion = positiveInteger(input.reportVersion, "reportVersion");
  if (
    !SIMPLE_IDENTIFIER.test(input.workspaceId) ||
    !CONTRACT_ID.test(input.contractId) ||
    !SHA256.test(input.countResultDigest) ||
    !INVENTORY_ID.test(input.inventoryId) ||
    !SHA256.test(input.inventoryRoot) ||
    !SHA256.test(input.inventoryDigest) ||
    !IDENTIFIER.test(input.serviceId) ||
    typeof input.createdBy !== "string" ||
    input.createdBy.length === 0 ||
    input.createdBy.length > 200
  ) {
    invalid("Report identity or evidence binding is invalid.");
  }
  const reportingPeriodStart = canonicalTimestamp(input.reportingPeriodStart, "reportingPeriodStart");
  const reportingPeriodEnd = canonicalTimestamp(input.reportingPeriodEnd, "reportingPeriodEnd");
  const sourceFrozenAt = canonicalTimestamp(input.sourceFrozenAt, "sourceFrozenAt");
  const frozenAt = canonicalTimestamp(input.frozenAt, "frozenAt");
  if (
    !(reportingPeriodStart < reportingPeriodEnd && reportingPeriodEnd <= sourceFrozenAt && sourceFrozenAt <= frozenAt)
  ) {
    invalid("Report period and evidence clocks are not monotonic.");
  }
  const reference = normalizeReference(input.reference);
  const methodEvidence = normalizeMethodEvidence(input.methodEvidence, input.workspaceId);
  if (
    (input.designation === "section_1_6_draft_only" && methodEvidence !== null) ||
    (input.designation === "section_1_6_method_accepted" && methodEvidence === null) ||
    (input.designation !== "section_1_6_draft_only" && input.designation !== "section_1_6_method_accepted")
  ) {
    invalid("Report designation must exactly match external method evidence.", "designation");
  }
  let correctionReason: string | null = null;
  let changeSummary: readonly DsaPart8ReportChangeCode[] | null = null;
  if (reportVersion === 1) {
    if (input.previous !== null || input.correction !== null)
      invalid("Version 1 cannot have a predecessor or correction.");
  } else {
    if (
      input.previous?.reportVersion !== reportVersion - 1 ||
      !SHA256.test(input.previous.reportDigest) ||
      input.correction === null
    ) {
      invalid("A correction must bind the exact immediate predecessor.", "previous");
    }
    correctionReason = input.correction.reason.trim();
    changeSummary = [...input.correction.changes].sort(portableCompare);
    if (
      correctionReason.length === 0 ||
      correctionReason.length > 500 ||
      changeSummary.length === 0 ||
      new Set(changeSummary).size !== changeSummary.length ||
      changeSummary.some(change => !CHANGE_CODES.includes(change))
    ) {
      invalid("Correction reason and change summary are invalid.", "correction");
    }
  }
  const cells = validatePublicRows(input.rows, input.designation, reference, methodEvidence);
  const cellRoot = digestRows(
    "rateloop.dsa-part8-report-cells.v1",
    cells.map(cell => JSON.parse(cell.cellJson) as unknown),
  );
  const publicBytes = publicCsvBytes(cells);
  const reportId = deterministicId("dsa8r", {
    workspaceId: input.workspaceId,
    contractId: input.contractId,
    serviceId: input.serviceId,
  });
  const confidentialPayload = {
    schemaVersion: DSA_PART8_CONFIDENTIAL_FILE_SCHEMA_VERSION,
    reportId,
    reportVersion,
    bindings: {
      contractId: input.contractId,
      countResultDigest: input.countResultDigest,
      inventoryId: input.inventoryId,
      inventoryRoot: input.inventoryRoot,
      inventoryDigest: input.inventoryDigest,
      reference,
    },
    cellRoot,
    cells: cells.map(cell => ({
      rowNumber: cell.rowNumber,
      columns: cell.columns,
      calculation: cell.calculation,
      calculationBindingHash: cell.calculationBindingHash,
      cellHash: cell.cellHash,
    })),
  };
  const confidentialBytes = new TextEncoder().encode(canonicalizeRfc8785(confidentialPayload));
  const publicFileDigest = rawDigest(publicBytes);
  const confidentialFileDigest = rawDigest(confidentialBytes);
  const methodReviewStatus =
    input.designation === "section_1_6_draft_only"
      ? ("pending_external_method_review" as const)
      : ("accepted_external_method_review" as const);
  const methodDeclaration =
    input.designation === "section_1_6_draft_only"
      ? ("pending_external_method_review" as const)
      : ("accepted_external_method_v1" as const);
  const payload = {
    workspaceId: input.workspaceId,
    reportId,
    reportVersion,
    schemaVersion: DSA_PART8_REPORT_VERSION_SCHEMA_VERSION,
    contractId: input.contractId,
    countResultDigest: input.countResultDigest,
    inventoryId: input.inventoryId,
    inventoryRoot: input.inventoryRoot,
    inventoryDigest: input.inventoryDigest,
    serviceId: input.serviceId,
    reportingPeriodStart,
    reportingPeriodEnd,
    sourceFrozenAt,
    reference,
    artifactDesignation: input.designation,
    methodReviewStatus,
    methodEvidence:
      methodEvidence === null
        ? null
        : {
            methodEvidenceId: methodEvidence.methodEvidenceId,
            methodEvidenceVersion: methodEvidence.methodEvidenceVersion,
            evidenceDigest: methodEvidence.evidenceDigest,
          },
    transformVersion: DSA_PART8_SECTION_16_TRANSFORM_VERSION,
    officialTemplateSha256: `sha256:${DSA_PART8_OFFICIAL_TEMPLATE_SHA256}` as const,
    expectedCellCount: cells.length,
    cellRoot,
    publicFileDigest,
    confidentialFileDigest,
    supersedesReportVersion: input.previous?.reportVersion ?? null,
    supersedesReportDigest: input.previous?.reportDigest ?? null,
    correctionReason,
    changeSummary,
    methodDeclaration,
    completeTransparencyReport: false as const,
    publicationEligible: input.designation === "section_1_6_method_accepted",
    createdBy: input.createdBy,
    frozenAt,
  };
  const reportJson = canonicalizeRfc8785(payload);
  const report = { ...payload, reportJson, reportDigest: sha256Rfc8785(payload) };
  return {
    report,
    cells,
    files: [
      {
        fileKind: "public_csv",
        mediaType: "text/csv; charset=utf-8",
        bytes: publicBytes,
        byteLength: publicBytes.byteLength,
        fileDigest: publicFileDigest,
      },
      {
        fileKind: "confidential_evidence_json",
        mediaType: "application/json",
        bytes: confidentialBytes,
        byteLength: confidentialBytes.byteLength,
        fileDigest: confidentialFileDigest,
      },
    ],
  };
}

export function verifyDsaPart8ReportVersion(input: BuildDsaPart8ReportVersionInput, evidence: DsaPart8ReportEvidence) {
  try {
    const rebuilt = buildDsaPart8ReportVersion(input);
    if (
      canonicalizeRfc8785(rebuilt.report) !== canonicalizeRfc8785(evidence.report) ||
      canonicalizeRfc8785(rebuilt.cells) !== canonicalizeRfc8785(evidence.cells) ||
      rebuilt.files.some((file, index) => {
        const candidate = evidence.files[index];
        return (
          !candidate ||
          file.fileKind !== candidate.fileKind ||
          file.mediaType !== candidate.mediaType ||
          file.fileDigest !== candidate.fileDigest ||
          !Buffer.from(file.bytes).equals(Buffer.from(candidate.bytes))
        );
      })
    ) {
      storedInvalid();
    }
    return rebuilt;
  } catch (error) {
    if (error instanceof TokenlessServiceError && error.code === "stored_dsa_part8_report_invalid") throw error;
    storedInvalid();
  }
}

function normalizeActor(value: string) {
  try {
    return normalizeAccountSubject(value);
  } catch {
    throw new TokenlessServiceError("A valid signed-in account is required.", 401, "invalid_account");
  }
}

async function requireManager(client: PoolClient, accountAddress: string, workspaceId: string) {
  const actor = normalizeActor(accountAddress);
  const membership = await client.query(
    `SELECT m.role FROM tokenless_workspace_members m
     JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id AND w.status='active'
     WHERE m.workspace_id=$1 AND m.account_address=$2 AND m.role IN ('owner','admin') LIMIT 1`,
    [workspaceId, actor],
  );
  if (membership.rowCount !== 1) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return actor;
}

async function inRepeatableRead<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function text(row: Row | undefined, field: string) {
  const value = row?.[field];
  return value === null || value === undefined ? null : String(value);
}

export async function recordAcceptedDsaPart8ExternalMethodEvidence(input: {
  accountAddress: string;
  evidence: Omit<BuildAcceptedDsaPart8ExternalMethodEvidenceInput, "recordedBy" | "recordedAt">;
}) {
  return inRepeatableRead(async client => {
    const recordedAt = await dsaEvidenceTransactionTimestamp(client);
    const actor = await requireManager(client, input.accountAddress, input.evidence.workspaceId);
    const evidence = buildAcceptedDsaPart8ExternalMethodEvidence({
      ...input.evidence,
      recordedBy: actor,
      recordedAt: recordedAt.toISOString(),
    });
    const existing = await client.query(
      `SELECT evidence_digest FROM tokenless_dsa_part8_external_method_evidence
       WHERE workspace_id=$1 AND method_evidence_id=$2 AND method_evidence_version=$3 FOR UPDATE`,
      [evidence.workspaceId, evidence.methodEvidenceId, evidence.methodEvidenceVersion],
    );
    if (existing.rowCount === 1) {
      if (text(existing.rows[0] as Row, "evidence_digest") !== evidence.evidenceDigest) {
        throw new TokenlessServiceError(
          "This method-evidence version already contains different immutable bytes.",
          409,
          "dsa_method_evidence_conflict",
        );
      }
      return { evidence, idempotent: true };
    }
    await client.query(
      `INSERT INTO tokenless_dsa_part8_external_method_evidence
       (workspace_id,method_evidence_id,method_evidence_version,schema_version,method_version,review_outcome,
        reviewer_organisation_digest,independence_declaration,acceptance_statement_digest,evidence_bytes,
        evidence_byte_length,evidence_digest,accepted_at,recorded_by,recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        evidence.workspaceId,
        evidence.methodEvidenceId,
        evidence.methodEvidenceVersion,
        evidence.schemaVersion,
        evidence.methodVersion,
        evidence.reviewOutcome,
        evidence.reviewerOrganisationDigest,
        evidence.independenceDeclaration,
        evidence.acceptanceStatementDigest,
        Buffer.from(evidence.evidenceBytes),
        evidence.evidenceByteLength,
        evidence.evidenceDigest,
        new Date(evidence.acceptedAt),
        actor,
        recordedAt,
      ],
    );
    return { evidence, idempotent: false };
  });
}

export async function createDsaPart8ReportVersion(input: {
  accountAddress: string;
  build: Omit<BuildDsaPart8ReportVersionInput, "createdBy" | "frozenAt">;
}) {
  return inRepeatableRead(async client => {
    await dsaEvidenceTransactionTimestamp(client);
    const actor = await requireManager(client, input.accountAddress, input.build.workspaceId);
    const dependency = await client.query(
      `SELECT contract.service_id,contract.provider_type,contract.reporting_period_start,contract.reporting_period_end,
              contract.source_frozen_at,contract.inventory_id,contract.inventory_root,contract.inventory_digest,
              inventory.expected_system_count
       FROM tokenless_dsa_part8_count_contracts contract
       JOIN tokenless_dsa_part8_count_results result
         ON result.workspace_id=contract.workspace_id AND result.contract_id=contract.contract_id
       JOIN tokenless_dsa_classifier_inventories inventory
         ON inventory.workspace_id=contract.workspace_id AND inventory.inventory_id=contract.inventory_id
        AND inventory.inventory_root=contract.inventory_root AND inventory.inventory_digest=contract.inventory_digest
       WHERE contract.workspace_id=$1 AND contract.contract_id=$2 AND result.result_digest=$3 FOR SHARE`,
      [input.build.workspaceId, input.build.contractId, input.build.countResultDigest],
    );
    const bound = dependency.rows[0] as Row | undefined;
    if (
      dependency.rowCount !== 1 ||
      text(bound, "service_id") !== input.build.serviceId ||
      text(bound, "inventory_id") !== input.build.inventoryId ||
      text(bound, "inventory_root") !== input.build.inventoryRoot ||
      text(bound, "inventory_digest") !== input.build.inventoryDigest ||
      new Date(String(bound?.reporting_period_start)).toISOString() !== input.build.reportingPeriodStart ||
      new Date(String(bound?.reporting_period_end)).toISOString() !== input.build.reportingPeriodEnd ||
      new Date(String(bound?.source_frozen_at)).toISOString() !== input.build.sourceFrozenAt
    ) {
      throw new TokenlessServiceError(
        "Exact Part 8 count dependencies were not found.",
        409,
        "dsa_part8_report_binding_missing",
      );
    }
    const providerType = text(bound, "provider_type");
    const expectedSystemCount = Number(bound?.expected_system_count);
    if (
      providerType === null ||
      !Number.isInteger(expectedSystemCount) ||
      expectedSystemCount < 0 ||
      (expectedSystemCount === 0) !== (input.build.reference === null) ||
      !Array.isArray(input.build.rows) ||
      input.build.rows.length !==
        expectedDsaPart8Section16RowCount(
          providerType as Parameters<typeof expectedDsaPart8Section16RowCount>[0],
          expectedSystemCount,
        )
    ) {
      throw new TokenlessServiceError(
        "The report does not exactly cover the frozen classifier inventory and Section 1.6 template.",
        409,
        "dsa_part8_report_cell_set_incomplete",
      );
    }
    if (input.build.reference !== null) {
      const reference = await client.query(
        `SELECT 1 FROM tokenless_dsa_reference_samples sample
         JOIN tokenless_dsa_reference_label_sets labels
           ON labels.workspace_id=sample.workspace_id AND labels.epoch_id=sample.epoch_id
         JOIN tokenless_dsa_named_panel_label_set_bridges bridge
           ON bridge.workspace_id=labels.workspace_id AND bridge.label_set_id=labels.label_set_id
          AND bridge.epoch_id=labels.epoch_id AND bridge.label_root=labels.label_root
          AND bridge.label_set_hash=labels.set_hash
         LEFT JOIN tokenless_dsa_reference_label_set_quarantines quarantine
           ON quarantine.workspace_id=labels.workspace_id AND quarantine.label_set_id=labels.label_set_id
         WHERE sample.workspace_id=$1 AND sample.epoch_id=$2 AND sample.commitment_digest=$3
           AND sample.sample_digest=$4 AND sample.manifest_root=$5 AND labels.label_set_id=$6
           AND labels.label_root=$7 AND labels.set_hash=$8
           AND labels.derivation_source='independent_reference_panel'
           AND quarantine.label_set_id IS NULL FOR SHARE OF sample,labels,bridge`,
        [
          input.build.workspaceId,
          input.build.reference.epochId,
          input.build.reference.commitmentDigest,
          input.build.reference.sampleDigest,
          input.build.reference.manifestRoot,
          input.build.reference.labelSetId,
          input.build.reference.labelRoot,
          input.build.reference.labelSetHash,
        ],
      );
      if (reference.rowCount !== 1) {
        throw new TokenlessServiceError(
          "Exact reference evidence was not found.",
          409,
          "dsa_part8_report_binding_missing",
        );
      }
      for (const row of input.build.rows) {
        if (row.calculation.kind !== "accuracy") continue;
        const authoritative = await client.query(
          `SELECT epoch.frame_root,
                  tokenless_dsa_part8_authoritative_accuracy_value(
                    $1,$2,$3,$4,$5,$6,$7,$8
                  ) AS authoritative_value
           FROM tokenless_dsa_reference_sampling_epochs epoch
           WHERE epoch.workspace_id=$1 AND epoch.epoch_id=$2
           FOR SHARE OF epoch`,
          [
            input.build.workspaceId,
            input.build.reference.epochId,
            input.build.reference.labelSetId,
            row.calculation.systemId,
            row.calculation.systemVersion,
            row.calculation.machineClass,
            row.calculation.scope,
            row.calculation.metric,
          ],
        );
        if (
          authoritative.rowCount !== 1 ||
          !dsaPart8AccuracyRowMatchesAuthoritativeValue(row, {
            frameRoot: text(authoritative.rows[0] as Row | undefined, "frame_root") ?? "",
            value: text(authoritative.rows[0] as Row | undefined, "authoritative_value"),
          })
        ) {
          throw new TokenlessServiceError(
            "The accuracy value does not replay from the exact frozen sample and reference labels.",
            409,
            "dsa_part8_accuracy_binding_invalid",
          );
        }
      }
    }
    if (input.build.methodEvidence !== null) {
      const method = await client.query(
        `SELECT 1 FROM tokenless_dsa_part8_external_method_evidence
         WHERE workspace_id=$1 AND method_evidence_id=$2 AND method_evidence_version=$3
           AND evidence_digest=$4 AND review_outcome='accepted' FOR SHARE`,
        [
          input.build.workspaceId,
          input.build.methodEvidence.methodEvidenceId,
          input.build.methodEvidence.methodEvidenceVersion,
          input.build.methodEvidence.evidenceDigest,
        ],
      );
      if (method.rowCount !== 1) {
        throw new TokenlessServiceError(
          "Accepted external method evidence was not found.",
          409,
          "dsa_method_evidence_missing",
        );
      }
    }
    if (input.build.previous !== null) {
      const previous = await client.query(
        `SELECT 1 FROM tokenless_dsa_part8_report_versions
         WHERE workspace_id=$1 AND report_id=$2 AND report_version=$3 AND report_digest=$4 FOR SHARE`,
        [
          input.build.workspaceId,
          deterministicId("dsa8r", {
            workspaceId: input.build.workspaceId,
            contractId: input.build.contractId,
            serviceId: input.build.serviceId,
          }),
          input.build.previous.reportVersion,
          input.build.previous.reportDigest,
        ],
      );
      if (previous.rowCount !== 1) {
        throw new TokenlessServiceError(
          "Exact immediate report predecessor was not found.",
          409,
          "dsa_report_predecessor_missing",
        );
      }
    }
    const frozenAt = await dsaEvidenceCommitTimestamp(client);
    const evidence = buildDsaPart8ReportVersion({ ...input.build, createdBy: actor, frozenAt: frozenAt.toISOString() });
    const report = evidence.report;
    await client.query(
      `INSERT INTO tokenless_dsa_part8_report_versions
       (workspace_id,report_id,report_version,schema_version,contract_id,count_result_digest,
        inventory_id,inventory_root,inventory_digest,service_id,reporting_period_start,reporting_period_end,
        source_frozen_at,epoch_id,commitment_digest,sample_digest,manifest_root,label_set_id,label_root,label_set_hash,
        artifact_designation,method_review_status,method_evidence_id,method_evidence_version,method_evidence_digest,
        transform_version,official_template_sha256,expected_cell_count,cell_root,public_file_digest,
        confidential_file_digest,supersedes_report_version,supersedes_report_digest,correction_reason,
        change_summary_json,method_declaration,complete_transparency_report,publication_eligible,report_json,
        report_digest,created_by,frozen_at)
       VALUES (${Array.from({ length: 42 }, (_value, index) => `$${index + 1}`).join(",")})`,
      [
        report.workspaceId,
        report.reportId,
        report.reportVersion,
        report.schemaVersion,
        report.contractId,
        report.countResultDigest,
        report.inventoryId,
        report.inventoryRoot,
        report.inventoryDigest,
        report.serviceId,
        new Date(report.reportingPeriodStart),
        new Date(report.reportingPeriodEnd),
        new Date(report.sourceFrozenAt),
        report.reference?.epochId ?? null,
        report.reference?.commitmentDigest ?? null,
        report.reference?.sampleDigest ?? null,
        report.reference?.manifestRoot ?? null,
        report.reference?.labelSetId ?? null,
        report.reference?.labelRoot ?? null,
        report.reference?.labelSetHash ?? null,
        report.artifactDesignation,
        report.methodReviewStatus,
        report.methodEvidence?.methodEvidenceId ?? null,
        report.methodEvidence?.methodEvidenceVersion ?? null,
        report.methodEvidence?.evidenceDigest ?? null,
        report.transformVersion,
        report.officialTemplateSha256,
        report.expectedCellCount,
        report.cellRoot,
        report.publicFileDigest,
        report.confidentialFileDigest,
        report.supersedesReportVersion,
        report.supersedesReportDigest,
        report.correctionReason,
        report.changeSummary === null ? null : canonicalizeRfc8785(report.changeSummary),
        report.methodDeclaration,
        report.completeTransparencyReport,
        report.publicationEligible,
        report.reportJson,
        report.reportDigest,
        actor,
        frozenAt,
      ],
    );
    for (const cell of evidence.cells) {
      await client.query(
        `INSERT INTO tokenless_dsa_part8_report_cells
         (workspace_id,report_id,report_version,contract_id,row_number,applicability,service,reporting_period,section,
          indicator,scope,value,context_json,calculation_kind,count_indicator,count_scope,count_cell_hash,
          calculation_binding_json,calculation_binding_hash,cell_json,cell_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [
          report.workspaceId,
          report.reportId,
          report.reportVersion,
          report.contractId,
          cell.rowNumber,
          ...cell.columns,
          cell.calculation.kind,
          cell.calculation.kind === "count" ? cell.calculation.indicator : null,
          cell.calculation.kind === "count" ? cell.calculation.scope : null,
          cell.calculation.kind === "count" ? cell.calculation.countCellHash : null,
          cell.calculationBindingJson,
          cell.calculationBindingHash,
          cell.cellJson,
          cell.cellHash,
        ],
      );
    }
    for (const file of evidence.files) {
      await client.query(
        `INSERT INTO tokenless_dsa_part8_report_files
         (workspace_id,report_id,report_version,file_kind,media_type,file_bytes,byte_length,file_digest)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          report.workspaceId,
          report.reportId,
          report.reportVersion,
          file.fileKind,
          file.mediaType,
          Buffer.from(file.bytes),
          file.byteLength,
          file.fileDigest,
        ],
      );
    }
    return evidence;
  });
}

export async function publishDsaPart8ReportVersion(input: {
  accountAddress: string;
  workspaceId: string;
  reportId: string;
  reportVersion: number;
  reportDigest: `sha256:${string}`;
}) {
  return inRepeatableRead(async client => {
    await dsaEvidenceTransactionTimestamp(client);
    const actor = await requireManager(client, input.accountAddress, input.workspaceId);
    const reportVersion = positiveInteger(input.reportVersion, "reportVersion");
    const report = await client.query(
      `SELECT report.public_file_digest,report.artifact_designation,report.publication_eligible,
              report.complete_transparency_report
       FROM tokenless_dsa_part8_report_versions report
       WHERE report.workspace_id=$1 AND report.report_id=$2 AND report.report_version=$3
         AND report.report_digest=$4 FOR SHARE OF report`,
      [input.workspaceId, input.reportId, reportVersion, input.reportDigest],
    );
    const bound = report.rows[0] as Row | undefined;
    if (
      report.rowCount !== 1 ||
      text(bound, "artifact_designation") !== "section_1_6_method_accepted" ||
      bound?.publication_eligible !== true ||
      bound?.complete_transparency_report !== false
    ) {
      throw new TokenlessServiceError(
        "This exact Section 1.6 version is not eligible for publication.",
        409,
        "dsa_report_not_publication_eligible",
      );
    }
    const clock = await client.query(
      `WITH evidence_clock AS (SELECT tokenless_dsa_evidence_commit_timestamp() AS published_at)
       SELECT published_at,published_at + interval '5 years' AS retain_until FROM evidence_clock`,
    );
    const publishedAt = new Date(String(clock.rows[0]?.published_at));
    const retainUntil = new Date(String(clock.rows[0]?.retain_until));
    const publicationId = deterministicId("dsa8p", {
      workspaceId: input.workspaceId,
      reportId: input.reportId,
      reportVersion,
      reportDigest: input.reportDigest,
    });
    const publicPath = `/rate/dsa/part8/reports/${input.reportId}/versions/${reportVersion}/section-1-6.csv`;
    const audit = await appendAuditEvent(
      {
        workspaceId: input.workspaceId,
        actorKind: "account",
        actorReference: actor,
        assuranceMethod: "workspace_manager_session",
        action: "dsa_part8_report_publication_enqueued",
        targetKind: "dsa_part8_report_version",
        targetId: `${input.reportId}:${reportVersion}`,
        purpose: "dsa_part8_reporting",
        reason: "Publish one immutable, externally accepted Section 1.6 report version.",
        result: "success",
        occurredAt: publishedAt,
        idempotencyKey: `dsa-part8-publication:${publicationId}`,
        metadata: { reportId: input.reportId, reportVersion, reportDigest: input.reportDigest, publicPath },
      },
      client,
    );
    const attestation = await enqueueAssuranceAttestationInTransaction(
      {
        workspaceId: input.workspaceId,
        kind: "audit_export_head",
        artifactDigest: audit.eventDigest,
        artifactSchemaVersion: "rateloop-audit-v1",
        boundaryAt: publishedAt,
        now: publishedAt,
      },
      client,
    );
    const payload = {
      schemaVersion: DSA_PART8_REPORT_PUBLICATION_SCHEMA_VERSION,
      publicationId,
      reportId: input.reportId,
      reportVersion,
      reportDigest: input.reportDigest,
      publicFileDigest: text(bound, "public_file_digest"),
      auditEventId: audit.eventId,
      auditHeadDigest: audit.eventDigest,
      attestationJobId: attestation.jobId,
      publicPath,
      completeTransparencyReport: false as const,
      publishedAt: publishedAt.toISOString(),
      retainUntil: retainUntil.toISOString(),
    };
    const publicationDigest = sha256Rfc8785(payload);
    await client.query(
      `INSERT INTO tokenless_dsa_part8_report_publications
       (workspace_id,publication_id,schema_version,report_id,report_version,report_digest,public_file_kind,
        public_file_digest,audit_head_digest,audit_event_id,attestation_job_id,attestation_artifact_kind,public_path,
        complete_transparency_report,published_at,retain_until,publication_json,publication_digest,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'public_csv',$7,$8,$9,$10,'audit_export_head',$11,false,$12,$13,$14,$15,$16)`,
      [
        input.workspaceId,
        publicationId,
        DSA_PART8_REPORT_PUBLICATION_SCHEMA_VERSION,
        input.reportId,
        reportVersion,
        input.reportDigest,
        text(bound, "public_file_digest"),
        audit.eventDigest,
        audit.eventId,
        attestation.jobId,
        publicPath,
        publishedAt,
        retainUntil,
        canonicalizeRfc8785(payload),
        publicationDigest,
        actor,
      ],
    );
    return { ...payload, publicationDigest };
  });
}

export async function downloadDsaPart8ReportVersion(input: {
  accountAddress: string;
  workspaceId: string;
  reportId: string;
  reportVersion: number;
  fileKind: "public_csv" | "confidential_evidence_json";
}) {
  return inRepeatableRead(async client => {
    await requireManager(client, input.accountAddress, input.workspaceId);
    const reportVersion = positiveInteger(input.reportVersion, "reportVersion");
    if (!IDENTIFIER.test(input.reportId) || !["public_csv", "confidential_evidence_json"].includes(input.fileKind)) {
      throw new TokenlessServiceError("Part 8 report file not found.", 404, "dsa_part8_report_file_not_found");
    }
    const result = await client.query(
      `SELECT f.media_type,f.file_bytes,f.byte_length,f.file_digest,r.report_digest,
              r.public_file_digest,r.confidential_file_digest
       FROM tokenless_dsa_part8_report_versions r
       JOIN tokenless_dsa_part8_report_files f
         ON f.workspace_id=r.workspace_id AND f.report_id=r.report_id AND f.report_version=r.report_version
       WHERE r.workspace_id=$1 AND r.report_id=$2 AND r.report_version=$3 AND f.file_kind=$4
       FOR SHARE OF r,f`,
      [input.workspaceId, input.reportId, reportVersion, input.fileKind],
    );
    const row = result.rows[0] as Row | undefined;
    const bytes = row?.file_bytes;
    if (!row || !(bytes instanceof Uint8Array) || Number(row.byte_length) !== bytes.byteLength) {
      throw new TokenlessServiceError("Part 8 report file not found.", 404, "dsa_part8_report_file_not_found");
    }
    const digest = rawDigest(bytes);
    const expectedDigest =
      input.fileKind === "public_csv" ? text(row, "public_file_digest") : text(row, "confidential_file_digest");
    if (digest !== text(row, "file_digest") || digest !== expectedDigest) storedInvalid();
    return {
      reportId: input.reportId,
      reportVersion,
      reportDigest: text(row, "report_digest") as `sha256:${string}`,
      fileKind: input.fileKind,
      mediaType: text(row, "media_type")!,
      fileDigest: digest,
      bytes: new Uint8Array(bytes),
    } as const;
  });
}

export async function downloadPublishedDsaPart8ReportVersion(input: { reportId: string; reportVersion: number }) {
  const reportVersion = positiveInteger(input.reportVersion, "reportVersion");
  if (!IDENTIFIER.test(input.reportId)) {
    throw new TokenlessServiceError("Published Part 8 report not found.", 404, "published_dsa_part8_report_not_found");
  }
  return inRepeatableRead(async client => {
    const result = await client.query(
      `SELECT f.media_type,f.file_bytes,f.byte_length,f.file_digest,p.report_digest,p.publication_digest
       FROM tokenless_dsa_part8_report_publications p
       JOIN tokenless_dsa_part8_report_files f
         ON f.workspace_id=p.workspace_id AND f.report_id=p.report_id AND f.report_version=p.report_version
        AND f.file_kind='public_csv' AND f.file_digest=p.public_file_digest
       WHERE p.report_id=$1 AND p.report_version=$2
       FOR SHARE OF p,f`,
      [input.reportId, reportVersion],
    );
    const row = result.rows[0] as Row | undefined;
    const bytes = row?.file_bytes;
    if (!row || !(bytes instanceof Uint8Array) || Number(row.byte_length) !== bytes.byteLength) {
      throw new TokenlessServiceError(
        "Published Part 8 report not found.",
        404,
        "published_dsa_part8_report_not_found",
      );
    }
    const digest = rawDigest(bytes);
    if (digest !== text(row, "file_digest")) storedInvalid();
    return {
      reportId: input.reportId,
      reportVersion,
      reportDigest: text(row, "report_digest") as `sha256:${string}`,
      publicationDigest: text(row, "publication_digest") as `sha256:${string}`,
      mediaType: text(row, "media_type")!,
      fileDigest: digest,
      bytes: new Uint8Array(bytes),
    } as const;
  });
}

export const __dsaPart8ReportVersionsTestUtils = {
  deterministicId,
  publicCsvBytes,
  rawDigest,
};
