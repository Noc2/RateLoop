import { canonicalizeRfc8785 } from "@rateloop/node-utils/jcs";
import { createHash } from "node:crypto";
import {
  DSA_AUTOMATED_MEANS_ESTIMATOR_VERSION,
  type DsaAutomatedMeansEstimate,
  type DsaAutomatedMeansEstimateCell,
  type DsaAutomatedMeansEstimateInput,
  type DsaAutomatedMeansMetric,
  type DsaAutomatedMeansScope,
  estimateDsaAutomatedMeansMetrics,
  verifyDsaAutomatedMeansEstimate,
} from "~~/lib/tokenless/dsaAutomatedMeansEstimates";
import {
  DSA_PART8_COUNT_ALGORITHM_VERSION,
  DSA_PART8_MAX_CLASSIFIERS,
  DSA_PART8_PROVIDER_TYPES,
  type DsaPart8ClassifierInventoryEntry,
  type DsaPart8CountCell,
  type DsaPart8CountIndicator,
  type DsaPart8CountResult,
  type DsaPart8CountScope,
  type FrozenDsaPart8CountContract,
  type ImmutableDsaPart8CountDecisionFact,
  type ImmutableDsaPart8CountEvaluationFact,
  type ImmutableDsaPart8NoticeProcessingFact,
  countDsaPart8,
  validateFrozenDsaPart8CountContract,
} from "~~/lib/tokenless/dsaPart8Counts";
import { EU_OFFICIAL_LANGUAGE_CODES } from "~~/lib/tokenless/dsaPart8SourceFacts";

export const DSA_PART8_SECTION_16_EXPORT_SCHEMA_VERSION = "rateloop.dsa-part8-section-1.6-draft.v2" as const;
export const DSA_PART8_SECTION_16_TRANSFORM_VERSION = "rateloop.dsa-part8-section-1.6-csv-transform.v2" as const;
export const DSA_PART8_OFFICIAL_TEMPLATE_URL = "https://ec.europa.eu/newsroom/dae/redirection/document/113338" as const;
export const DSA_PART8_OFFICIAL_TEMPLATE_SHA256 =
  "1a687f468468b25b214f505c4a6cb906d6ee8cc80d20f5a60eca383cc1bea71d" as const;
export const DSA_PART8_OFFICIAL_TEMPLATE_BYTE_LENGTH = 5_345 as const;
export const DSA_PART8_MAX_SECTION_16_ROWS = 5_500 as const;
export const DSA_PART8_SECTION_16_NAME = "Use of automated means for content moderation" as const;
export const DSA_PART8_SECTION_16_CSV_HEADER = [
  "Applicability",
  "Service",
  "Reporting period",
  "Section",
  "Indicator",
  "Scope",
  "Value",
  "Contextual Information",
] as const;

export const DSA_PART8_OFFICIAL_INDICATORS = {
  measures_solely_automated: "Number of measures solely taken by automated means",
  measures_not_automated: "Number of measures not taken by automated means",
  notices_solely_automated: "Number of notices solely processed by automated means",
  notices_not_automated: "Number of notices not processed by automated means",
  accuracy: "Accuracy of the automated means - Accuracy",
  precision: "Accuracy of the automated means - Precision",
  recall: "Accuracy of the automated means - Recall",
} as const;

type ProviderType = (typeof DSA_PART8_PROVIDER_TYPES)[number];
type SystemIdentity = Readonly<{
  systemId: string;
  machineClass: DsaPart8ClassifierInventoryEntry["machineClass"];
  version?: string;
  systemVersion?: string;
}>;
type CountResult = DsaPart8CountCell["result"];
type EstimateResult = DsaAutomatedMeansEstimateCell["result"];
type CsvRow = readonly [string, string, string, string, string, string, string, string];

export type DsaPart8Section16CountEvidence = Readonly<{
  decisionFacts: readonly ImmutableDsaPart8CountDecisionFact[];
  evaluationFacts: readonly ImmutableDsaPart8CountEvaluationFact[];
  noticeFacts: readonly ImmutableDsaPart8NoticeProcessingFact[];
}>;

export type DsaPart8Section16AccuracyEvidence =
  | Readonly<{ status: "verified"; input: DsaAutomatedMeansEstimateInput }>
  | Readonly<{ status: "not_applicable_no_classifiers" }>;

export type DsaPart8Section16ExportBindings = Readonly<{
  countDigest: `sha256:${string}`;
  decisionFactRoot: `sha256:${string}`;
  evaluationFactRoot: `sha256:${string}`;
  noticeFactRoot: `sha256:${string}`;
  censusWitnessDigest: `sha256:${string}`;
  estimateDigest: `sha256:${string}` | null;
  frameRoot: `sha256:${string}` | null;
  sampleRoot: `sha256:${string}` | null;
  referenceLabelRoot: `sha256:${string}` | null;
}>;

export type DsaPart8Section16ExportInput = Readonly<{
  transformVersion: typeof DSA_PART8_SECTION_16_TRANSFORM_VERSION;
  officialTemplate: Readonly<{
    url: typeof DSA_PART8_OFFICIAL_TEMPLATE_URL;
    sha256: typeof DSA_PART8_OFFICIAL_TEMPLATE_SHA256;
    byteLength: typeof DSA_PART8_OFFICIAL_TEMPLATE_BYTE_LENGTH;
  }>;
  serviceName: string;
  countContract: FrozenDsaPart8CountContract;
  countEvidence: DsaPart8Section16CountEvidence;
  accuracyEvidence: DsaPart8Section16AccuracyEvidence;
}>;

export type DsaPart8Section16Draft = Readonly<{
  schemaVersion: typeof DSA_PART8_SECTION_16_EXPORT_SCHEMA_VERSION;
  designation: "section_1_6_draft_only";
  transformVersion: typeof DSA_PART8_SECTION_16_TRANSFORM_VERSION;
  officialTemplate: DsaPart8Section16ExportInput["officialTemplate"];
  service: Readonly<{ serviceId: string; serviceName: string; providerType: ProviderType }>;
  reportingPeriod: Readonly<{ startInclusive: string; endExclusive: string; inclusiveDisplay: string }>;
  bindings: DsaPart8Section16ExportBindings;
  rowCount: number;
  rows: readonly CsvRow[];
  csvBytes: Uint8Array;
  csvDigest: `sha256:${string}`;
  publicationEligible: false;
  methodReviewStatus: "pending_external_method_review";
  publication: Readonly<{
    eligible: false;
    block: "pending_external_method_review";
    completeTransparencyReport: false;
    filingReady: false;
  }>;
}>;

export class DsaPart8ExportError extends Error {
  readonly code = "invalid_dsa_part8_section_1_6_export";
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "DsaPart8ExportError";
  }
}

const FORMULA_PREFIX = /^[=+\-@]/u;
const DECIMAL_0_TO_1 = /^(?:0(?:\.[0-9]{1,8})?|1(?:\.0{1,8})?)$/u;
const UNSIGNED_INTEGER = /^(0|[1-9][0-9]*)$/u;
const PLACEHOLDER = /^(?:\[?\.{2,}\]?|\[…\])$/u;
const EU_LANGUAGE_SET = new Set<string>(EU_OFFICIAL_LANGUAGE_CODES);
const METRICS = ["accuracy", "precision", "recall"] as const;

function invalid(message: string, field?: string): never {
  throw new DsaPart8ExportError(message, field);
}

function portableCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value: unknown, expected: readonly string[], field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${field} must be a typed object.`, field);
  const actual = Object.keys(value as object).sort(portableCompare);
  const normalized = [...expected].sort(portableCompare);
  if (actual.length !== normalized.length || actual.some((key, index) => key !== normalized[index])) {
    invalid(`${field} contains missing or unsupported fields.`, field);
  }
}

function rawBytesDigest(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
}

function systemKey(system: SystemIdentity) {
  return `${system.systemId}\u0000${system.version ?? system.systemVersion}\u0000${system.machineClass}`;
}

function applicableBaseScopes(providerType: ProviderType): DsaPart8CountScope[] {
  const scopes: DsaPart8CountScope[] = ["Total number", "Own-initiative"];
  if (["hosting_service", "online_platform", "vlop"].includes(providerType)) scopes.push("NAM Total");
  if (["online_platform", "vlop"].includes(providerType)) scopes.push("NAM Trusted Flagger");
  return scopes;
}

function countIndicatorsFor(scope: DsaPart8CountScope): readonly DsaPart8CountIndicator[] {
  return scope === "Total number" || scope === "Own-initiative" || EU_LANGUAGE_SET.has(scope)
    ? ["measures_solely_automated", "measures_not_automated"]
    : ["notices_solely_automated", "notices_not_automated"];
}

function applicability(scope: DsaPart8CountScope) {
  if (scope === "NAM Total") return "Only for providers of hosting services, including online platforms";
  if (scope === "NAM Trusted Flagger") return "Only for providers of online platforms";
  if (EU_LANGUAGE_SET.has(scope)) return "Only for VLOPs";
  return "All";
}

function countCellKey(indicator: DsaPart8CountIndicator, scope: DsaPart8CountScope) {
  return `${indicator}\u0000${scope}`;
}

function estimateCellKey(system: SystemIdentity, scope: DsaAutomatedMeansScope, metric: DsaAutomatedMeansMetric) {
  return `${systemKey(system)}\u0000${scope}\u0000${metric}`;
}

export function expectedDsaPart8Section16RowCount(providerType: ProviderType, classifierCount: number) {
  if (!DSA_PART8_PROVIDER_TYPES.includes(providerType)) invalid("providerType is invalid.", "providerType");
  if (!Number.isSafeInteger(classifierCount) || classifierCount < 0 || classifierCount > DSA_PART8_MAX_CLASSIFIERS) {
    invalid(`classifierCount must be between 0 and ${DSA_PART8_MAX_CLASSIFIERS}.`, "classifierCount");
  }
  const [countRows, scopes] =
    providerType === "vlop"
      ? [56, 28]
      : providerType === "online_platform"
        ? [8, 4]
        : providerType === "hosting_service"
          ? [6, 3]
          : [4, 2];
  const total = countRows + scopes * METRICS.length * classifierCount;
  if (total > DSA_PART8_MAX_SECTION_16_ROWS)
    invalid("Section 1.6 export exceeds the bounded row cap.", "classifierCount");
  return total;
}

function inclusiveDisplay(period: FrozenDsaPart8CountContract["reportingPeriod"]) {
  const end = new Date(period.endExclusive);
  return `${period.startInclusive.slice(0, 10)}/${new Date(end.getTime() - 1).toISOString().slice(0, 10)}`;
}

function verifyAccuracyEvidence(
  evidence: DsaPart8Section16AccuracyEvidence,
  contract: FrozenDsaPart8CountContract,
): DsaAutomatedMeansEstimate | null {
  if (contract.classifierInventory.length === 0) {
    exactKeys(evidence, ["status"], "accuracyEvidence");
    if (evidence.status !== "not_applicable_no_classifiers") {
      invalid("Accuracy evidence must be absent when no automated classifier is inventoried.", "accuracyEvidence");
    }
    return null;
  }
  exactKeys(evidence, ["input", "status"], "accuracyEvidence");
  if (evidence.status !== "verified")
    invalid("Every inventoried classifier requires complete verified estimate evidence.", "accuracyEvidence");
  const computed = estimateDsaAutomatedMeansMetrics(evidence.input);
  const estimate = verifyDsaAutomatedMeansEstimate({ ...evidence.input, expected: computed });
  const expectedSystems = contract.classifierInventory.map(systemKey);
  const actualSystems = estimate.cells
    .filter(cell => cell.scope === "Total number" && cell.metric === "accuracy")
    .map(cell => systemKey(cell.system));
  if (
    estimate.providerType !== contract.service.providerType ||
    expectedSystems.length !== actualSystems.length ||
    expectedSystems.some((key, index) => key !== actualSystems[index]) ||
    estimate.frame.source.reportingWindow.startInclusive !== contract.reportingPeriod.startInclusive ||
    estimate.frame.source.reportingWindow.endExclusive !== contract.reportingPeriod.endExclusive ||
    estimate.frame.source.contextAuthority !== "workspace_manager_asserted_context" ||
    estimate.frame.source.populationFrozenAt < contract.reportingPeriod.endExclusive
  ) {
    invalid(
      "Verified estimate evidence does not match the frozen contract, period, or complete inventory.",
      "accuracyEvidence",
    );
  }
  return estimate;
}

function validateInput(input: DsaPart8Section16ExportInput) {
  exactKeys(
    input,
    ["accuracyEvidence", "countContract", "countEvidence", "officialTemplate", "serviceName", "transformVersion"],
    "input",
  );
  exactKeys(input.officialTemplate, ["byteLength", "sha256", "url"], "officialTemplate");
  exactKeys(input.countEvidence, ["decisionFacts", "evaluationFacts", "noticeFacts"], "countEvidence");
  if (
    input.transformVersion !== DSA_PART8_SECTION_16_TRANSFORM_VERSION ||
    input.officialTemplate.url !== DSA_PART8_OFFICIAL_TEMPLATE_URL ||
    input.officialTemplate.sha256 !== DSA_PART8_OFFICIAL_TEMPLATE_SHA256 ||
    input.officialTemplate.byteLength !== DSA_PART8_OFFICIAL_TEMPLATE_BYTE_LENGTH
  ) {
    invalid("The official template and transform pins must be exact.", "officialTemplate");
  }
  if (
    typeof input.serviceName !== "string" ||
    input.serviceName.trim() !== input.serviceName ||
    input.serviceName.length === 0 ||
    input.serviceName.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(input.serviceName) ||
    FORMULA_PREFIX.test(input.serviceName)
  ) {
    invalid("serviceName must be concise, formula-safe display text.", "serviceName");
  }
  const contract = validateFrozenDsaPart8CountContract(input.countContract);
  expectedDsaPart8Section16RowCount(contract.service.providerType, contract.classifierInventory.length);
  const count = countDsaPart8({ contract, ...input.countEvidence });
  const estimate = verifyAccuracyEvidence(input.accuracyEvidence, contract);
  return { contract, count, estimate, displayPeriod: inclusiveDisplay(contract.reportingPeriod) };
}

function countContext(input: DsaPart8Section16ExportInput, count: DsaPart8CountResult, result: CountResult) {
  const context: Record<string, unknown> = {
    evidence: {
      algorithmVersion: DSA_PART8_COUNT_ALGORITHM_VERSION,
      censusWitnessDigest: count.evidence.censusWitnessDigest,
      countDigest: count.resultDigest,
      decisionFactRoot: count.evidence.decisionFactRoot,
      evaluationFactRoot: count.evidence.evaluationFactRoot,
      noticeFactRoot: count.evidence.noticeFactRoot,
      templateSha256: input.officialTemplate.sha256,
    },
    methodology: {
      artifactDesignation: "section_1_6_draft_only",
      inputCriteria:
        "Immutable content-moderation decision census; measure indicators include only decisions with measureTaken=true.",
      methodReviewStatus: "pending_external_method_review",
      partiallyAutomatedMeasureCount: count.inputCoverage.partiallyAutomatedMeasureCount,
      partiallyAutomatedNoticeCount: count.inputCoverage.partiallyAutomatedNoticeCount,
      partialAutomationMapping: "excluded_from_binary_official_indicators_pending_mapping_review",
      transformVersion: input.transformVersion,
      valueKind: "exact_census",
    },
  };
  if (result.status === "coverage_gap")
    context.gap = { affectedNoticeCount: result.affectedNoticeCount, code: result.code };
  return canonicalizeRfc8785(context);
}

function metricFormula(metric: DsaAutomatedMeansMetric) {
  if (metric === "accuracy") return "HT(true_positive + true_negative) / classifier_population_count";
  if (metric === "precision") return "HT(true_positive) / (HT(true_positive) + HT(false_positive))";
  return "HT(true_positive) / (HT(true_positive) + HT(false_negative))";
}

function estimateContext(
  input: DsaPart8Section16ExportInput,
  estimate: DsaAutomatedMeansEstimate,
  system: DsaPart8ClassifierInventoryEntry,
  cell: DsaAutomatedMeansEstimateCell,
) {
  const context: Record<string, unknown> = {
    evidence: {
      estimateDigest: estimate.estimateDigest,
      frameRoot: estimate.frame.frameRoot,
      referenceLabelRoot: estimate.referenceLabelRoot,
      sampleRoot: estimate.sample.manifestRoot,
      templateSha256: input.officialTemplate.sha256,
    },
    methodology: {
      artifactDesignation: "section_1_6_draft_only",
      calculation: {
        estimator: DSA_AUTOMATED_MEANS_ESTIMATOR_VERSION,
        formula: metricFormula(cell.metric),
        metric: cell.metric,
      },
      inputCriteria:
        "Complete verified reference-sampling frame covering automated pass and fail decisions in the reporting window.",
      methodReviewStatus: "pending_external_method_review",
      positiveClass: "automatically_removed_content",
      referenceStandard: {
        acceptedOutcomes: ["pass", "fail"],
        labelSource: "independent_human_reference_labels",
        uncertainHandling: "coverage_gap",
      },
      sampling: {
        completedCount: cell.completedCount,
        limitations: cell.limitations,
        methodVersion: estimate.frame.methodVersion,
        planId: estimate.frame.sampleSizePlan.planId,
        planVersion: estimate.frame.sampleSizePlan.version,
        populationCount: cell.populationCount,
        selectedCount: cell.selectedCount,
      },
      transformVersion: input.transformVersion,
      valueKind: "point_estimate",
    },
    system: { designation: system.publicDesignation, machineClass: system.machineClass },
  };
  if (cell.result.status === "coverage_gap") context.gap = { code: cell.result.code };
  return canonicalizeRfc8785(context);
}

function row(
  input: DsaPart8Section16ExportInput,
  displayPeriod: string,
  indicator: string,
  scope: DsaPart8CountScope,
  value: string,
  context: string,
): CsvRow {
  return [
    applicability(scope),
    input.serviceName,
    displayPeriod,
    DSA_PART8_SECTION_16_NAME,
    indicator,
    scope,
    value,
    context,
  ];
}

function countValue(result: CountResult) {
  return result.status === "count" ? result.value.toString() : "";
}

function estimateValue(result: EstimateResult) {
  return result.status === "internal_point_estimate" ? result.decimal : "";
}

function generateRows(
  input: DsaPart8Section16ExportInput,
  contract: FrozenDsaPart8CountContract,
  count: DsaPart8CountResult,
  estimate: DsaAutomatedMeansEstimate | null,
  displayPeriod: string,
) {
  const countCells = new Map(count.cells.map(cell => [countCellKey(cell.indicator, cell.scope), cell]));
  const estimateCells = new Map(
    (estimate?.cells ?? []).map(cell => [estimateCellKey(cell.system, cell.scope, cell.metric), cell]),
  );
  const rows: CsvRow[] = [];
  const emitCount = (indicator: DsaPart8CountIndicator, scope: DsaPart8CountScope) => {
    const cell = countCells.get(countCellKey(indicator, scope));
    if (!cell) invalid("A required count cell is missing.", "countEvidence");
    rows.push(
      row(
        input,
        displayPeriod,
        DSA_PART8_OFFICIAL_INDICATORS[indicator],
        scope,
        countValue(cell.result),
        countContext(input, count, cell.result),
      ),
    );
  };
  const emitMetric = (
    system: DsaPart8ClassifierInventoryEntry,
    metric: DsaAutomatedMeansMetric,
    scope: DsaPart8CountScope,
  ) => {
    if (!estimate) invalid("Verified estimate evidence is missing.", "accuracyEvidence");
    const cell = estimateCells.get(estimateCellKey(system, scope, metric));
    if (!cell) invalid("A required estimate cell is missing.", "accuracyEvidence");
    rows.push(
      row(
        input,
        displayPeriod,
        DSA_PART8_OFFICIAL_INDICATORS[metric],
        scope,
        estimateValue(cell.result),
        estimateContext(input, estimate, system, cell),
      ),
    );
  };

  // The Commission source orders each non-language scope as two counts followed by accuracy, precision, and recall.
  for (const scope of applicableBaseScopes(contract.service.providerType)) {
    for (const indicator of countIndicatorsFor(scope)) emitCount(indicator, scope);
    for (const system of contract.classifierInventory) for (const metric of METRICS) emitMetric(system, metric, scope);
  }
  // The source expands VLOP language placeholders indicator-first, then metric-first. Systems are the outer expansion.
  if (contract.service.providerType === "vlop") {
    for (const indicator of ["measures_solely_automated", "measures_not_automated"] as const) {
      for (const language of EU_OFFICIAL_LANGUAGE_CODES) emitCount(indicator, language);
    }
    for (const system of contract.classifierInventory) {
      for (const metric of METRICS)
        for (const language of EU_OFFICIAL_LANGUAGE_CODES) emitMetric(system, metric, language);
    }
  }
  const expected = expectedDsaPart8Section16RowCount(
    contract.service.providerType,
    contract.classifierInventory.length,
  );
  if (rows.length !== expected || rows.length > DSA_PART8_MAX_SECTION_16_ROWS) {
    invalid("Generated Section 1.6 rows do not match the bounded official transform.", "rows");
  }
  return rows;
}

function quoteCsv(value: string) {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function encodeCsv(rows: readonly CsvRow[]) {
  const text = [DSA_PART8_SECTION_16_CSV_HEADER, ...rows].map(record => record.map(quoteCsv).join(",")).join("\r\n");
  return new TextEncoder().encode(`${text}\r\n`);
}

export function exportDsaPart8Section16Draft(input: DsaPart8Section16ExportInput): DsaPart8Section16Draft {
  const { contract, count, estimate, displayPeriod } = validateInput(input);
  const rows = generateRows(input, contract, count, estimate, displayPeriod);
  const csvBytes = encodeCsv(rows);
  const bindings: DsaPart8Section16ExportBindings = {
    countDigest: count.resultDigest,
    decisionFactRoot: count.evidence.decisionFactRoot,
    evaluationFactRoot: count.evidence.evaluationFactRoot,
    noticeFactRoot: count.evidence.noticeFactRoot,
    censusWitnessDigest: count.evidence.censusWitnessDigest,
    estimateDigest: estimate?.estimateDigest ?? null,
    frameRoot: estimate?.frame.frameRoot ?? null,
    sampleRoot: estimate?.sample.manifestRoot ?? null,
    referenceLabelRoot: estimate?.referenceLabelRoot ?? null,
  };
  return {
    schemaVersion: DSA_PART8_SECTION_16_EXPORT_SCHEMA_VERSION,
    designation: "section_1_6_draft_only",
    transformVersion: DSA_PART8_SECTION_16_TRANSFORM_VERSION,
    officialTemplate: { ...input.officialTemplate },
    service: {
      serviceId: contract.service.serviceId,
      serviceName: input.serviceName,
      providerType: contract.service.providerType,
    },
    reportingPeriod: { ...contract.reportingPeriod, inclusiveDisplay: displayPeriod },
    bindings,
    rowCount: rows.length,
    rows,
    csvBytes,
    csvDigest: rawBytesDigest(csvBytes),
    publicationEligible: false,
    methodReviewStatus: "pending_external_method_review",
    publication: {
      eligible: false,
      block: "pending_external_method_review",
      completeTransparencyReport: false,
      filingReady: false,
    },
  };
}

function decodeStrictCsv(bytes: Uint8Array) {
  if (!(bytes instanceof Uint8Array)) invalid("candidateBytes must be a Uint8Array.", "candidateBytes");
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    invalid("Section 1.6 CSV must not contain a UTF-8 BOM.", "candidateBytes");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalid("Section 1.6 CSV is not valid UTF-8.", "candidateBytes");
  }
  if (!text.endsWith("\r\n")) invalid("Section 1.6 CSV must end with CRLF.", "candidateBytes");
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\r" && text[index + 1] !== "\n") invalid("CSV contains a bare CR.", "candidateBytes");
    if (text[index] === "\n" && text[index - 1] !== "\r") invalid("CSV contains a bare LF.", "candidateBytes");
  }
  return text;
}

function parseRfc4180(text: string) {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let quoteClosed = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          quoteClosed = true;
        }
      } else field += character;
      continue;
    }
    if (quoteClosed && character !== "," && character !== "\r")
      invalid("CSV contains characters after a closing quote.", "candidateBytes");
    if (character === '"') {
      if (field.length > 0 || quoteClosed) invalid("CSV contains an invalid quote.", "candidateBytes");
      inQuotes = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
      quoteClosed = false;
    } else if (character === "\r") {
      if (text[index + 1] !== "\n") invalid("CSV contains a bare CR.", "candidateBytes");
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      quoteClosed = false;
      index += 1;
    } else if (character === "\n") invalid("CSV contains a bare LF.", "candidateBytes");
    else {
      if (quoteClosed) invalid("CSV contains characters after a closing quote.", "candidateBytes");
      field += character;
    }
  }
  if (inQuotes || record.length > 0 || field.length > 0)
    invalid("CSV terminator or quoted field is incomplete.", "candidateBytes");
  return records;
}

function validateParsedRows(records: readonly string[][]) {
  if (
    records.length === 0 ||
    records[0]!.length !== DSA_PART8_SECTION_16_CSV_HEADER.length ||
    records[0]!.some((field, index) => field !== DSA_PART8_SECTION_16_CSV_HEADER[index])
  ) {
    invalid("CSV header is not the exact Section 1.6 eight-column header.", "candidateBytes");
  }
  const indicators = new Set<string>(Object.values(DSA_PART8_OFFICIAL_INDICATORS));
  for (const [index, record] of records.slice(1).entries()) {
    const field = `candidateRows[${index}]`;
    if (record.length !== 8 || record.some(value => PLACEHOLDER.test(value)))
      invalid(`${field} is not a complete eight-column row.`, field);
    if (record[3] !== DSA_PART8_SECTION_16_NAME || !indicators.has(record[4]!))
      invalid(`${field} is not a Section 1.6 indicator row.`, field);
    const value = record[6]!;
    const countIndicator = record[4]!.startsWith("Number of ");
    if (value !== "" && !(countIndicator ? UNSIGNED_INTEGER : DECIMAL_0_TO_1).test(value))
      invalid(`${field} has a non-canonical value.`, `${field}.Value`);
    let context: unknown;
    try {
      context = JSON.parse(record[7]!);
    } catch {
      invalid(`${field} contextual information is not JSON.`, `${field}.Contextual Information`);
    }
    if (canonicalizeRfc8785(context) !== record[7])
      invalid(`${field} contextual information is not canonical JSON.`, `${field}.Contextual Information`);
    if (value === "" && !(context as { gap?: unknown }).gap)
      invalid(`${field} has a blank value without a typed gap.`, `${field}.Value`);
  }
}

function byteEqual(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function verifyDsaPart8Section16Draft(input: DsaPart8Section16ExportInput, candidateBytes: Uint8Array) {
  const records = parseRfc4180(decodeStrictCsv(candidateBytes));
  validateParsedRows(records);
  const expected = exportDsaPart8Section16Draft(input);
  if (records.length !== expected.rowCount + 1 || !byteEqual(candidateBytes, expected.csvBytes)) {
    invalid("Section 1.6 row universe, order, values, contexts, or evidence bindings do not match.", "candidateBytes");
  }
  if (rawBytesDigest(candidateBytes) !== expected.csvDigest)
    invalid("Section 1.6 CSV digest verification failed.", "candidateBytes");
  return expected;
}

export const __dsaPart8ExportTestUtils = { parseRfc4180 };
