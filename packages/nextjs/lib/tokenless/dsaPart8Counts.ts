import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import {
  DSA_PART8_AUTOMATION_PROCESSING,
  DSA_PART8_CLASSIFIER_MACHINE_CLASSES,
  DSA_PART8_NOTIFIER_CLASSES,
  DSA_PART8_NOT_AUTOMATED,
  DSA_PART8_NO_LANGUAGE_REASONS,
  DSA_PART8_PARTIALLY_AUTOMATED,
  DSA_PART8_SOLELY_AUTOMATED,
  type DsaPart8AutomatedMeansEvaluationInput,
  type DsaPart8DecisionFactInput,
  EU_OFFICIAL_LANGUAGE_CODES,
  normalizeDsaPart8AutomatedMeansEvaluation,
  normalizeDsaPart8AutomatedMeansEvaluationSet,
  normalizeDsaPart8DecisionFact,
} from "~~/lib/tokenless/dsaPart8SourceFacts";

export const DSA_PART8_COUNT_ALGORITHM_VERSION = "rateloop.dsa-part8-exact-census.v2" as const;
export const DSA_PART8_COUNT_CONTRACT_SCHEMA_VERSION = "rateloop.dsa-part8-count-contract.v3" as const;
export const DSA_PART8_COUNT_DECISION_FACT_SCHEMA_VERSION = "rateloop.dsa-part8-count-decision-fact.v3" as const;
export const DSA_PART8_COUNT_EVALUATION_FACT_SCHEMA_VERSION = "rateloop.dsa-part8-count-evaluation-fact.v1" as const;
export const DSA_PART8_NOTICE_PROCESSING_FACT_SCHEMA_VERSION = "rateloop.dsa-part8-notice-processing-fact.v2" as const;
export const DSA_PART8_CENSUS_WITNESS_SCHEMA_VERSION = "rateloop.dsa-part8-census-witness.v1" as const;
export const DSA_PART8_FACT_SET_ROOT_SCHEMA_VERSION = "rateloop.dsa-part8-canonical-fact-set-root.v1" as const;
export const DSA_PART8_COUNT_RESULT_SCHEMA_VERSION = "rateloop.dsa-part8-count-result.v2" as const;
export const DSA_PART8_COUNT_PILOT_FACT_CAP = 50_000 as const;
export const DSA_PART8_MAX_CLASSIFIERS = 64 as const;

export const DSA_PART8_PROVIDER_TYPES = [
  "intermediary_service",
  "hosting_service",
  "online_platform",
  "vlop",
  "vlose",
] as const;
export const DSA_PART8_NOTICE_PROCESSING_STATUSES = ["processed_final", "processing_incomplete"] as const;
export const DSA_PART8_COUNT_INDICATORS = [
  "measures_solely_automated",
  "measures_not_automated",
  "notices_solely_automated",
  "notices_not_automated",
] as const;

type ProviderType = (typeof DSA_PART8_PROVIDER_TYPES)[number];
type AutomationProcessing = (typeof DSA_PART8_AUTOMATION_PROCESSING)[number];
type NotifierClass = (typeof DSA_PART8_NOTIFIER_CLASSES)[number];
type MachineClass = (typeof DSA_PART8_CLASSIFIER_MACHINE_CLASSES)[number];
type NoLanguageReason = (typeof DSA_PART8_NO_LANGUAGE_REASONS)[number];
type EuLanguage = (typeof EU_OFFICIAL_LANGUAGE_CODES)[number];
export type DsaPart8CountIndicator = (typeof DSA_PART8_COUNT_INDICATORS)[number];
export type DsaPart8CountScope = "Total number" | "Own-initiative" | "NAM Total" | "NAM Trusted Flagger" | EuLanguage;

export type DsaPart8ClassifierInventoryEntry = Readonly<{
  systemId: string;
  version: string;
  machineClass: MachineClass;
  publicDesignation: string;
}>;

type ClassifierIdentity = Readonly<{ systemId: string; version: string; machineClass: MachineClass }>;

export type DsaPart8CensusWitness = Readonly<{
  schemaVersion: typeof DSA_PART8_CENSUS_WITNESS_SCHEMA_VERSION;
  kind: "database_transaction_and_attestation";
  censusId: string;
  sourcePopulationId: string;
  sourcePopulationVersion: number;
  frozenAt: string;
  auditHeadDigest: `sha256:${string}`;
  attestationJobId: string;
}>;

export type DsaPart8CountContractSpec = Readonly<{
  schemaVersion: typeof DSA_PART8_COUNT_CONTRACT_SCHEMA_VERSION;
  contractId: string;
  service: Readonly<{ serviceId: string; providerType: ProviderType }>;
  reportingPeriod: Readonly<{ startInclusive: string; endExclusive: string }>;
  classifierInventory: readonly DsaPart8ClassifierInventoryEntry[];
  censusWitness: DsaPart8CensusWitness;
}>;

export type DsaPart8CountContractPayload = DsaPart8CountContractSpec &
  Readonly<{
    algorithmVersion: typeof DSA_PART8_COUNT_ALGORITHM_VERSION;
    expectedDecisionCount: number;
    expectedMeasureCount: number;
    expectedEvaluationCount: number;
    expectedNoticeCount: number;
    decisionFactRoot: `sha256:${string}`;
    evaluationFactRoot: `sha256:${string}`;
    noticeFactRoot: `sha256:${string}`;
    censusWitnessDigest: `sha256:${string}`;
  }>;

export type FrozenDsaPart8CountContract = DsaPart8CountContractPayload &
  Readonly<{ contractDigest: `sha256:${string}` }>;

export type DsaPart8CountDecisionFactPayload = Readonly<{
  schemaVersion: typeof DSA_PART8_COUNT_DECISION_FACT_SCHEMA_VERSION;
  serviceId: string;
  occurredAt: string;
  sourceDecisionBinding: `sha256:${string}`;
  sourceFact: DsaPart8DecisionFactInput;
}>;

export type ImmutableDsaPart8CountDecisionFact = DsaPart8CountDecisionFactPayload &
  Readonly<{ factDigest: `sha256:${string}` }>;

export type DsaPart8CountEvaluationFactPayload = Readonly<{
  schemaVersion: typeof DSA_PART8_COUNT_EVALUATION_FACT_SCHEMA_VERSION;
  serviceId: string;
  occurredAt: string;
  sourceDecisionBinding: `sha256:${string}`;
  sourceEvaluationBinding: `sha256:${string}`;
  sourceEvaluationHash: `sha256:${string}`;
  automationProcessing: typeof DSA_PART8_SOLELY_AUTOMATED | typeof DSA_PART8_PARTIALLY_AUTOMATED;
  evaluation: DsaPart8AutomatedMeansEvaluationInput;
}>;

export type ImmutableDsaPart8CountEvaluationFact = DsaPart8CountEvaluationFactPayload &
  Readonly<{ factDigest: `sha256:${string}` }>;

export type DsaPart8NoticeProcessingFactPayload = Readonly<{
  schemaVersion: typeof DSA_PART8_NOTICE_PROCESSING_FACT_SCHEMA_VERSION;
  serviceId: string;
  receivedAt: string;
  noticeId: string;
  processingStatus: (typeof DSA_PART8_NOTICE_PROCESSING_STATUSES)[number];
  automationProcessing: AutomationProcessing | null;
  notifierClass: NotifierClass;
}>;

export type ImmutableDsaPart8NoticeProcessingFact = DsaPart8NoticeProcessingFactPayload &
  Readonly<{ factDigest: `sha256:${string}` }>;

export type DsaPart8CountCell = Readonly<{
  indicator: DsaPart8CountIndicator;
  scope: DsaPart8CountScope;
  result:
    | Readonly<{ status: "count"; value: number; publicationEligible: false }>
    | Readonly<{
        status: "coverage_gap";
        code: "incomplete_notice_processing";
        value: null;
        affectedNoticeCount: number;
        publicationEligible: false;
      }>;
}>;

export type DsaPart8CountResult = Readonly<{
  schemaVersion: typeof DSA_PART8_COUNT_RESULT_SCHEMA_VERSION;
  algorithmVersion: typeof DSA_PART8_COUNT_ALGORITHM_VERSION;
  contract: Readonly<{
    contractId: string;
    contractDigest: `sha256:${string}`;
    service: FrozenDsaPart8CountContract["service"];
    reportingPeriod: FrozenDsaPart8CountContract["reportingPeriod"];
  }>;
  evidence: Readonly<{
    decisionFactRoot: `sha256:${string}`;
    evaluationFactRoot: `sha256:${string}`;
    noticeFactRoot: `sha256:${string}`;
    censusWitnessDigest: `sha256:${string}`;
  }>;
  inputCoverage: Readonly<{
    decisionCount: number;
    measureCount: number;
    evaluationCount: number;
    noticeCount: number;
    classifierInventoryCount: number;
    observedClassifierCount: number;
    unobservedClassifierCount: number;
    solelyAutomatedDecisionCount: number;
    partiallyAutomatedDecisionCount: number;
    notAutomatedDecisionCount: number;
    partiallyAutomatedMeasureCount: number;
    partiallyAutomatedNoticeCount: number;
  }>;
  languageCoverage: Readonly<{
    measureCountWithLanguage: number;
    languageAttributionCount: number;
    noLanguageCounts: Readonly<Record<NoLanguageReason, number>>;
  }>;
  cells: readonly DsaPart8CountCell[];
  publicationEligible: false;
  resultDigest: `sha256:${string}`;
}>;

export class DsaPart8CountError extends Error {
  readonly code = "invalid_dsa_part8_count_input";
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "DsaPart8CountError";
  }
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const CONTRACT_IDENTIFIER = /^dsa8c_[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/u;
const NOTICE_IDENTIFIER = /^notice_[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/u;
const CLASSIFIER_IDENTIFIER = /^classifier_[A-Za-z0-9][A-Za-z0-9_.:-]{2,159}$/u;
const PUBLIC_DESIGNATION = /^[A-Za-z0-9][A-Za-z0-9 .,_():/\-]{0,119}$/u;
const FORMULA_PREFIX = /^[=+\-@]/u;
const SPEC_KEYS = [
  "censusWitness",
  "classifierInventory",
  "contractId",
  "reportingPeriod",
  "schemaVersion",
  "service",
] as const;
const CONTRACT_PAYLOAD_KEYS = [
  "algorithmVersion",
  "censusWitness",
  "censusWitnessDigest",
  "classifierInventory",
  "contractId",
  "decisionFactRoot",
  "expectedDecisionCount",
  "expectedEvaluationCount",
  "expectedMeasureCount",
  "expectedNoticeCount",
  "evaluationFactRoot",
  "noticeFactRoot",
  "reportingPeriod",
  "schemaVersion",
  "service",
] as const;
const CONTRACT_KEYS = [...CONTRACT_PAYLOAD_KEYS, "contractDigest"] as const;
const SERVICE_KEYS = ["providerType", "serviceId"] as const;
const PERIOD_KEYS = ["endExclusive", "startInclusive"] as const;
const CLASSIFIER_KEYS = ["machineClass", "publicDesignation", "systemId", "version"] as const;
const WITNESS_KEYS = [
  "attestationJobId",
  "auditHeadDigest",
  "censusId",
  "frozenAt",
  "kind",
  "schemaVersion",
  "sourcePopulationId",
  "sourcePopulationVersion",
] as const;
const DECISION_FACT_KEYS = [
  "factDigest",
  "occurredAt",
  "schemaVersion",
  "serviceId",
  "sourceDecisionBinding",
  "sourceFact",
] as const;
const DECISION_PAYLOAD_KEYS = DECISION_FACT_KEYS.filter(key => key !== "factDigest");
const EVALUATION_FACT_KEYS = [
  "automationProcessing",
  "evaluation",
  "factDigest",
  "occurredAt",
  "schemaVersion",
  "serviceId",
  "sourceDecisionBinding",
  "sourceEvaluationBinding",
  "sourceEvaluationHash",
] as const;
const EVALUATION_PAYLOAD_KEYS = EVALUATION_FACT_KEYS.filter(key => key !== "factDigest");
const NOTICE_FACT_KEYS = [
  "automationProcessing",
  "factDigest",
  "noticeId",
  "notifierClass",
  "processingStatus",
  "receivedAt",
  "schemaVersion",
  "serviceId",
] as const;
const NOTICE_PAYLOAD_KEYS = NOTICE_FACT_KEYS.filter(key => key !== "factDigest");

function invalid(message: string, field?: string): never {
  throw new DsaPart8CountError(message, field);
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

function nonNegativeInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(`${field} must be a non-negative integer.`, field);
  return Number(value);
}

function positiveInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalid(`${field} must be a positive integer.`, field);
  return Number(value);
}

function requireSha256(value: unknown, field: string): asserts value is `sha256:${string}` {
  if (typeof value !== "string" || !SHA256.test(value)) invalid(`${field} must be a lower-case SHA-256 digest.`, field);
}

function canonicalUtc(value: unknown, field: string) {
  if (typeof value !== "string") invalid(`${field} must be a canonical UTC timestamp.`, field);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    invalid(`${field} must be a canonical UTC timestamp.`, field);
  }
  return value;
}

function classifierKey(classifier: ClassifierIdentity) {
  return `${classifier.systemId}\u0000${classifier.version}\u0000${classifier.machineClass}`;
}

function classifierIdentity(classifier: ClassifierIdentity) {
  return `${classifier.systemId}\u0000${classifier.version}`;
}

function normalizeClassifier(value: unknown, field: string): DsaPart8ClassifierInventoryEntry {
  exactKeys(value, CLASSIFIER_KEYS, field);
  const classifier = value as unknown as DsaPart8ClassifierInventoryEntry;
  if (
    typeof classifier.systemId !== "string" ||
    !CLASSIFIER_IDENTIFIER.test(classifier.systemId) ||
    typeof classifier.version !== "string" ||
    !IDENTIFIER.test(classifier.version) ||
    !DSA_PART8_CLASSIFIER_MACHINE_CLASSES.includes(classifier.machineClass) ||
    typeof classifier.publicDesignation !== "string" ||
    classifier.publicDesignation.trim() !== classifier.publicDesignation ||
    !PUBLIC_DESIGNATION.test(classifier.publicDesignation) ||
    FORMULA_PREFIX.test(classifier.publicDesignation)
  ) {
    invalid(`${field} is invalid.`, field);
  }
  return { ...classifier };
}

function validatePeriod(providerType: ProviderType, startInclusive: string, endExclusive: string) {
  const start = new Date(startInclusive);
  const end = new Date(endExclusive);
  const startYear = start.getUTCFullYear();
  const startMonth = start.getUTCMonth();
  const utcMidnight = (date: Date) =>
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0 &&
    date.getUTCDate() === 1;
  if (!utcMidnight(start) || !utcMidnight(end) || startYear < 2026) {
    invalid("reportingPeriod must use 2026-or-later UTC calendar boundaries.", "reportingPeriod");
  }
  const largeService = providerType === "vlop" || providerType === "vlose";
  const validAnnual = startMonth === 0 && end.getUTCFullYear() === startYear + 1 && end.getUTCMonth() === 0;
  const validHalfYear =
    (startMonth === 0 && end.getUTCFullYear() === startYear && end.getUTCMonth() === 6) ||
    (startMonth === 6 && end.getUTCFullYear() === startYear + 1 && end.getUTCMonth() === 0);
  if ((largeService && !validHalfYear) || (!largeService && !validAnnual)) {
    invalid(
      largeService
        ? "VLOP and VLOSE reporting periods must be a January-June or July-December UTC half-year."
        : "Intermediary, hosting, and online-platform reporting periods must be a UTC calendar year.",
      "reportingPeriod",
    );
  }
}

function normalizeWitness(input: DsaPart8CensusWitness, endExclusive: string) {
  exactKeys(input, WITNESS_KEYS, "contract.censusWitness");
  if (
    input.schemaVersion !== DSA_PART8_CENSUS_WITNESS_SCHEMA_VERSION ||
    input.kind !== "database_transaction_and_attestation" ||
    !IDENTIFIER.test(input.censusId) ||
    !IDENTIFIER.test(input.sourcePopulationId) ||
    !IDENTIFIER.test(input.attestationJobId)
  ) {
    invalid("censusWitness is invalid.", "contract.censusWitness");
  }
  const sourcePopulationVersion = positiveInteger(
    input.sourcePopulationVersion,
    "contract.censusWitness.sourcePopulationVersion",
  );
  const frozenAt = canonicalUtc(input.frozenAt, "contract.censusWitness.frozenAt");
  if (frozenAt < endExclusive)
    invalid("censusWitness must be frozen after the reporting period closes.", "contract.censusWitness.frozenAt");
  requireSha256(input.auditHeadDigest, "contract.censusWitness.auditHeadDigest");
  return { ...input, sourcePopulationVersion, frozenAt } as const;
}

function normalizeSpec(input: DsaPart8CountContractSpec) {
  exactKeys(input, SPEC_KEYS, "contract");
  if (input.schemaVersion !== DSA_PART8_COUNT_CONTRACT_SCHEMA_VERSION) {
    invalid("contract.schemaVersion is unsupported.", "contract.schemaVersion");
  }
  if (!CONTRACT_IDENTIFIER.test(input.contractId)) invalid("contractId is invalid.", "contract.contractId");
  exactKeys(input.service, SERVICE_KEYS, "contract.service");
  if (!IDENTIFIER.test(input.service.serviceId) || !DSA_PART8_PROVIDER_TYPES.includes(input.service.providerType)) {
    invalid("contract.service is invalid.", "contract.service");
  }
  exactKeys(input.reportingPeriod, PERIOD_KEYS, "contract.reportingPeriod");
  const startInclusive = canonicalUtc(input.reportingPeriod.startInclusive, "contract.reportingPeriod.startInclusive");
  const endExclusive = canonicalUtc(input.reportingPeriod.endExclusive, "contract.reportingPeriod.endExclusive");
  validatePeriod(input.service.providerType, startInclusive, endExclusive);
  if (!Array.isArray(input.classifierInventory) || input.classifierInventory.length > DSA_PART8_MAX_CLASSIFIERS) {
    invalid(
      `classifierInventory may contain at most ${DSA_PART8_MAX_CLASSIFIERS} systems.`,
      "contract.classifierInventory",
    );
  }
  const classifierInventory = input.classifierInventory.map((entry, index) =>
    normalizeClassifier(entry, `contract.classifierInventory[${index}]`),
  );
  const keys = classifierInventory.map(classifierKey);
  const identities = classifierInventory.map(classifierIdentity);
  const designations = classifierInventory.map(system => system.publicDesignation.toLocaleLowerCase("en-US"));
  if (
    new Set(keys).size !== keys.length ||
    new Set(identities).size !== identities.length ||
    new Set(designations).size !== designations.length ||
    keys.some((key, index) => index > 0 && portableCompare(keys[index - 1]!, key) >= 0)
  ) {
    invalid(
      "classifierInventory must be canonical and have unique identities and public designations.",
      "contract.classifierInventory",
    );
  }
  const reportingPeriod = { startInclusive, endExclusive } as const;
  return {
    schemaVersion: DSA_PART8_COUNT_CONTRACT_SCHEMA_VERSION,
    contractId: input.contractId,
    service: { ...input.service },
    reportingPeriod,
    classifierInventory,
    censusWitness: normalizeWitness(input.censusWitness, endExclusive),
  } as const;
}

function normalizeDecisionPayload(input: DsaPart8CountDecisionFactPayload) {
  exactKeys(input, DECISION_PAYLOAD_KEYS, "decisionFact");
  if (input.schemaVersion !== DSA_PART8_COUNT_DECISION_FACT_SCHEMA_VERSION) {
    invalid("decisionFact.schemaVersion is unsupported.", "decisionFact.schemaVersion");
  }
  if (!IDENTIFIER.test(input.serviceId)) invalid("decisionFact.serviceId is invalid.", "decisionFact.serviceId");
  const occurredAt = canonicalUtc(input.occurredAt, "decisionFact.occurredAt");
  requireSha256(input.sourceDecisionBinding, "decisionFact.sourceDecisionBinding");
  const normalized = normalizeDsaPart8DecisionFact(input.sourceFact);
  const sourceFact: DsaPart8DecisionFactInput = {
    measureTaken: normalized.measureTaken,
    moderationMeasureId: normalized.moderationMeasureId,
    origin: normalized.origin,
    automationProcessing: normalized.automationProcessing,
    expectedEvaluationCount: normalized.expectedEvaluationCount,
    evaluationSetRoot: normalized.evaluationSetRoot,
    article16NoticeId: normalized.article16NoticeId,
    notifierClass: normalized.notifierClass,
    languageAttribution: normalized.languageAttribution,
  };
  return {
    schemaVersion: DSA_PART8_COUNT_DECISION_FACT_SCHEMA_VERSION,
    serviceId: input.serviceId,
    occurredAt,
    sourceDecisionBinding: input.sourceDecisionBinding,
    sourceFact,
  } as const;
}

function normalizeEvaluationPayload(input: DsaPart8CountEvaluationFactPayload) {
  exactKeys(input, EVALUATION_PAYLOAD_KEYS, "evaluationFact");
  if (input.schemaVersion !== DSA_PART8_COUNT_EVALUATION_FACT_SCHEMA_VERSION) {
    invalid("evaluationFact.schemaVersion is unsupported.", "evaluationFact.schemaVersion");
  }
  if (!IDENTIFIER.test(input.serviceId)) invalid("evaluationFact.serviceId is invalid.", "evaluationFact.serviceId");
  const occurredAt = canonicalUtc(input.occurredAt, "evaluationFact.occurredAt");
  requireSha256(input.sourceDecisionBinding, "evaluationFact.sourceDecisionBinding");
  requireSha256(input.sourceEvaluationBinding, "evaluationFact.sourceEvaluationBinding");
  requireSha256(input.sourceEvaluationHash, "evaluationFact.sourceEvaluationHash");
  if (
    input.automationProcessing !== DSA_PART8_SOLELY_AUTOMATED &&
    input.automationProcessing !== DSA_PART8_PARTIALLY_AUTOMATED
  ) {
    invalid("evaluationFact.automationProcessing is invalid.", "evaluationFact.automationProcessing");
  }
  const normalized = normalizeDsaPart8AutomatedMeansEvaluation(input.evaluation);
  const evaluation: DsaPart8AutomatedMeansEvaluationInput = {
    evaluationId: normalized.evaluationId,
    systemId: normalized.systemId,
    systemVersion: normalized.systemVersion,
    machineClass: normalized.machineClass,
    publicDesignation: normalized.publicDesignation,
    automatedOutcome: normalized.automatedOutcome,
  };
  if (input.sourceEvaluationHash !== sha256Rfc8785(normalized)) {
    invalid("sourceEvaluationHash does not bind the normalized evaluation.", "evaluationFact.sourceEvaluationHash");
  }
  return {
    schemaVersion: DSA_PART8_COUNT_EVALUATION_FACT_SCHEMA_VERSION,
    serviceId: input.serviceId,
    occurredAt,
    sourceDecisionBinding: input.sourceDecisionBinding,
    sourceEvaluationBinding: input.sourceEvaluationBinding,
    sourceEvaluationHash: input.sourceEvaluationHash,
    automationProcessing: input.automationProcessing,
    evaluation,
  } as const;
}

export function sealDsaPart8CountEvaluationFact(
  input: DsaPart8CountEvaluationFactPayload,
): ImmutableDsaPart8CountEvaluationFact {
  const payload = normalizeEvaluationPayload(input);
  return { ...payload, factDigest: sha256Rfc8785(payload) };
}

export function sealDsaPart8CountDecisionFact(
  input: DsaPart8CountDecisionFactPayload,
): ImmutableDsaPart8CountDecisionFact {
  const payload = normalizeDecisionPayload(input);
  return { ...payload, factDigest: sha256Rfc8785(payload) };
}

function normalizeNoticePayload(input: DsaPart8NoticeProcessingFactPayload) {
  exactKeys(input, NOTICE_PAYLOAD_KEYS, "noticeFact");
  if (input.schemaVersion !== DSA_PART8_NOTICE_PROCESSING_FACT_SCHEMA_VERSION) {
    invalid("noticeFact.schemaVersion is unsupported.", "noticeFact.schemaVersion");
  }
  if (!IDENTIFIER.test(input.serviceId)) invalid("noticeFact.serviceId is invalid.", "noticeFact.serviceId");
  const receivedAt = canonicalUtc(input.receivedAt, "noticeFact.receivedAt");
  if (!NOTICE_IDENTIFIER.test(input.noticeId)) invalid("noticeFact.noticeId is invalid.", "noticeFact.noticeId");
  if (!DSA_PART8_NOTICE_PROCESSING_STATUSES.includes(input.processingStatus)) {
    invalid("noticeFact.processingStatus is invalid.", "noticeFact.processingStatus");
  }
  if (!DSA_PART8_NOTIFIER_CLASSES.includes(input.notifierClass))
    invalid("noticeFact.notifierClass is invalid.", "noticeFact.notifierClass");
  if (
    (input.processingStatus === "processed_final" &&
      (input.automationProcessing === null || !DSA_PART8_AUTOMATION_PROCESSING.includes(input.automationProcessing))) ||
    (input.processingStatus === "processing_incomplete" && input.automationProcessing !== null)
  ) {
    invalid(
      "Final notices require an automation classification; incomplete notices must leave it null.",
      "noticeFact.automationProcessing",
    );
  }
  return {
    schemaVersion: DSA_PART8_NOTICE_PROCESSING_FACT_SCHEMA_VERSION,
    serviceId: input.serviceId,
    receivedAt,
    noticeId: input.noticeId,
    processingStatus: input.processingStatus,
    automationProcessing: input.automationProcessing,
    notifierClass: input.notifierClass,
  } as const;
}

export function sealDsaPart8NoticeProcessingFact(
  input: DsaPart8NoticeProcessingFactPayload,
): ImmutableDsaPart8NoticeProcessingFact {
  const payload = normalizeNoticePayload(input);
  return { ...payload, factDigest: sha256Rfc8785(payload) };
}

function factSetRoot(
  kind: "decision" | "evaluation" | "notice",
  facts: readonly Readonly<{ factDigest: `sha256:${string}` }>[],
) {
  const factDigests = facts.map(fact => fact.factDigest).sort(portableCompare);
  factDigests.forEach((digest, index) => requireSha256(digest, `${kind}Facts[${index}].factDigest`));
  return sha256Rfc8785({
    schemaVersion: DSA_PART8_FACT_SET_ROOT_SCHEMA_VERSION,
    kind,
    factCount: factDigests.length,
    factDigests,
  });
}

export function computeDsaPart8DecisionFactRoot(facts: readonly ImmutableDsaPart8CountDecisionFact[]) {
  return factSetRoot("decision", facts);
}

export function computeDsaPart8EvaluationFactRoot(facts: readonly ImmutableDsaPart8CountEvaluationFact[]) {
  return factSetRoot("evaluation", facts);
}

export function computeDsaPart8NoticeFactRoot(facts: readonly ImmutableDsaPart8NoticeProcessingFact[]) {
  return factSetRoot("notice", facts);
}

function validateFactEnvelope(
  serviceId: string,
  occurredAt: string,
  contract: Pick<FrozenDsaPart8CountContract, "service" | "reportingPeriod">,
  field: string,
) {
  if (serviceId !== contract.service.serviceId)
    invalid(`${field} belongs to a different service.`, `${field}.serviceId`);
  if (occurredAt < contract.reportingPeriod.startInclusive || occurredAt >= contract.reportingPeriod.endExclusive) {
    invalid(`${field} is outside the frozen reporting period.`, `${field}.occurredAt`);
  }
}

function normalizeDecisionFacts(
  facts: readonly ImmutableDsaPart8CountDecisionFact[],
  contract: Pick<FrozenDsaPart8CountContract, "service" | "reportingPeriod">,
) {
  if (!Array.isArray(facts) || facts.length > DSA_PART8_COUNT_PILOT_FACT_CAP)
    invalid("decisionFacts exceed the pilot cap.", "decisionFacts");
  const normalized = facts.map((fact, index) => {
    const field = `decisionFacts[${index}]`;
    exactKeys(fact, DECISION_FACT_KEYS, field);
    const payload = normalizeDecisionPayload({
      schemaVersion: fact.schemaVersion,
      serviceId: fact.serviceId,
      occurredAt: fact.occurredAt,
      sourceDecisionBinding: fact.sourceDecisionBinding,
      sourceFact: fact.sourceFact,
    });
    validateFactEnvelope(payload.serviceId, payload.occurredAt, contract, field);
    requireSha256(fact.factDigest, `${field}.factDigest`);
    if (fact.factDigest !== sha256Rfc8785(payload))
      invalid(`${field} digest does not bind its payload.`, `${field}.factDigest`);
    return { ...payload, factDigest: fact.factDigest };
  });
  normalized.sort((left, right) => portableCompare(left.sourceDecisionBinding, right.sourceDecisionBinding));
  if (new Set(normalized.map(fact => fact.sourceDecisionBinding)).size !== normalized.length) {
    invalid("sourceDecisionBinding must be unique within the census.", "decisionFacts");
  }
  const measureIds = normalized.flatMap(fact =>
    fact.sourceFact.measureTaken ? [fact.sourceFact.moderationMeasureId!] : [],
  );
  if (new Set(measureIds).size !== measureIds.length)
    invalid("moderationMeasureId must be unique within the census.", "decisionFacts");
  return normalized;
}

function normalizeNoticeFacts(
  facts: readonly ImmutableDsaPart8NoticeProcessingFact[],
  contract: Pick<FrozenDsaPart8CountContract, "service" | "reportingPeriod">,
) {
  if (!Array.isArray(facts) || facts.length > DSA_PART8_COUNT_PILOT_FACT_CAP)
    invalid("noticeFacts exceed the pilot cap.", "noticeFacts");
  const normalized = facts.map((fact, index) => {
    const field = `noticeFacts[${index}]`;
    exactKeys(fact, NOTICE_FACT_KEYS, field);
    const payload = normalizeNoticePayload({
      schemaVersion: fact.schemaVersion,
      serviceId: fact.serviceId,
      receivedAt: fact.receivedAt,
      noticeId: fact.noticeId,
      processingStatus: fact.processingStatus,
      automationProcessing: fact.automationProcessing,
      notifierClass: fact.notifierClass,
    });
    validateFactEnvelope(payload.serviceId, payload.receivedAt, contract, field);
    requireSha256(fact.factDigest, `${field}.factDigest`);
    if (fact.factDigest !== sha256Rfc8785(payload))
      invalid(`${field} digest does not bind its payload.`, `${field}.factDigest`);
    return { ...payload, factDigest: fact.factDigest };
  });
  normalized.sort((left, right) => portableCompare(left.noticeId, right.noticeId));
  if (new Set(normalized.map(fact => fact.noticeId)).size !== normalized.length) {
    invalid("noticeId must be unique within the census.", "noticeFacts");
  }
  return normalized;
}

function normalizeEvaluationFacts(
  facts: readonly ImmutableDsaPart8CountEvaluationFact[],
  contract: Pick<FrozenDsaPart8CountContract, "service" | "reportingPeriod">,
) {
  if (!Array.isArray(facts) || facts.length > DSA_PART8_COUNT_PILOT_FACT_CAP) {
    invalid("evaluationFacts exceed the pilot cap.", "evaluationFacts");
  }
  const normalized = facts.map((fact, index) => {
    const field = `evaluationFacts[${index}]`;
    exactKeys(fact, EVALUATION_FACT_KEYS, field);
    const payload = normalizeEvaluationPayload({
      schemaVersion: fact.schemaVersion,
      serviceId: fact.serviceId,
      occurredAt: fact.occurredAt,
      sourceDecisionBinding: fact.sourceDecisionBinding,
      sourceEvaluationBinding: fact.sourceEvaluationBinding,
      sourceEvaluationHash: fact.sourceEvaluationHash,
      automationProcessing: fact.automationProcessing,
      evaluation: fact.evaluation,
    });
    validateFactEnvelope(payload.serviceId, payload.occurredAt, contract, field);
    requireSha256(fact.factDigest, `${field}.factDigest`);
    if (fact.factDigest !== sha256Rfc8785(payload)) {
      invalid(`${field} digest does not bind its payload.`, `${field}.factDigest`);
    }
    return { ...payload, factDigest: fact.factDigest };
  });
  normalized.sort((left, right) => portableCompare(left.sourceEvaluationBinding, right.sourceEvaluationBinding));
  if (new Set(normalized.map(fact => fact.sourceEvaluationBinding)).size !== normalized.length) {
    invalid("sourceEvaluationBinding must be unique within the census.", "evaluationFacts");
  }
  return normalized;
}

export function freezeDsaPart8CountContract(
  input: Readonly<{
    spec: DsaPart8CountContractSpec;
    decisionFacts: readonly ImmutableDsaPart8CountDecisionFact[];
    evaluationFacts: readonly ImmutableDsaPart8CountEvaluationFact[];
    noticeFacts: readonly ImmutableDsaPart8NoticeProcessingFact[];
  }>,
): FrozenDsaPart8CountContract {
  exactKeys(input, ["decisionFacts", "evaluationFacts", "noticeFacts", "spec"], "input");
  const spec = normalizeSpec(input.spec);
  const decisions = normalizeDecisionFacts(input.decisionFacts, spec);
  const evaluations = normalizeEvaluationFacts(input.evaluationFacts, spec);
  const notices = normalizeNoticeFacts(input.noticeFacts, spec);
  if (decisions.length + evaluations.length + notices.length > DSA_PART8_COUNT_PILOT_FACT_CAP) {
    invalid(`The combined census exceeds the ${DSA_PART8_COUNT_PILOT_FACT_CAP}-fact pilot cap.`, "input");
  }
  const payload = {
    ...spec,
    algorithmVersion: DSA_PART8_COUNT_ALGORITHM_VERSION,
    expectedDecisionCount: decisions.length,
    expectedMeasureCount: decisions.filter(fact => fact.sourceFact.measureTaken).length,
    expectedEvaluationCount: evaluations.length,
    expectedNoticeCount: notices.length,
    decisionFactRoot: computeDsaPart8DecisionFactRoot(decisions),
    evaluationFactRoot: computeDsaPart8EvaluationFactRoot(evaluations),
    noticeFactRoot: computeDsaPart8NoticeFactRoot(notices),
    censusWitnessDigest: sha256Rfc8785(spec.censusWitness),
  } as const;
  const frozen = { ...payload, contractDigest: sha256Rfc8785(payload) };
  reconcileFacts(frozen, decisions, evaluations, notices);
  return frozen;
}

function normalizeContractPayload(input: DsaPart8CountContractPayload) {
  exactKeys(input, CONTRACT_PAYLOAD_KEYS, "contract");
  const spec = normalizeSpec({
    schemaVersion: input.schemaVersion,
    contractId: input.contractId,
    service: input.service,
    reportingPeriod: input.reportingPeriod,
    classifierInventory: input.classifierInventory,
    censusWitness: input.censusWitness,
  });
  if (input.algorithmVersion !== DSA_PART8_COUNT_ALGORITHM_VERSION)
    invalid("count algorithm is unsupported.", "contract.algorithmVersion");
  const expectedDecisionCount = nonNegativeInteger(input.expectedDecisionCount, "contract.expectedDecisionCount");
  const expectedMeasureCount = nonNegativeInteger(input.expectedMeasureCount, "contract.expectedMeasureCount");
  const expectedEvaluationCount = nonNegativeInteger(input.expectedEvaluationCount, "contract.expectedEvaluationCount");
  const expectedNoticeCount = nonNegativeInteger(input.expectedNoticeCount, "contract.expectedNoticeCount");
  if (
    expectedMeasureCount > expectedDecisionCount ||
    expectedDecisionCount + expectedEvaluationCount + expectedNoticeCount > DSA_PART8_COUNT_PILOT_FACT_CAP
  ) {
    invalid("contract census counts are impossible or exceed the pilot cap.", "contract");
  }
  requireSha256(input.decisionFactRoot, "contract.decisionFactRoot");
  requireSha256(input.evaluationFactRoot, "contract.evaluationFactRoot");
  requireSha256(input.noticeFactRoot, "contract.noticeFactRoot");
  requireSha256(input.censusWitnessDigest, "contract.censusWitnessDigest");
  if (input.censusWitnessDigest !== sha256Rfc8785(spec.censusWitness)) {
    invalid("censusWitnessDigest does not bind the witness.", "contract.censusWitnessDigest");
  }
  return {
    ...spec,
    algorithmVersion: DSA_PART8_COUNT_ALGORITHM_VERSION,
    expectedDecisionCount,
    expectedMeasureCount,
    expectedEvaluationCount,
    expectedNoticeCount,
    decisionFactRoot: input.decisionFactRoot,
    evaluationFactRoot: input.evaluationFactRoot,
    noticeFactRoot: input.noticeFactRoot,
    censusWitnessDigest: input.censusWitnessDigest,
  } as const;
}

export function validateFrozenDsaPart8CountContract(input: FrozenDsaPart8CountContract) {
  exactKeys(input, CONTRACT_KEYS, "contract");
  requireSha256(input.contractDigest, "contract.contractDigest");
  const { contractDigest, ...untrustedPayload } = input;
  const payload = normalizeContractPayload(untrustedPayload);
  if (contractDigest !== sha256Rfc8785(payload))
    invalid("contractDigest does not bind the exact frozen contract.", "contract.contractDigest");
  return { ...payload, contractDigest } as const;
}

function countResult(value: number): DsaPart8CountCell["result"] {
  return { status: "count", value, publicationEligible: false };
}

function noticeResult(
  notices: readonly ReturnType<typeof normalizeNoticeFacts>[number][],
  automationProcessing: typeof DSA_PART8_SOLELY_AUTOMATED | typeof DSA_PART8_NOT_AUTOMATED,
): DsaPart8CountCell["result"] {
  const affectedNoticeCount = notices.filter(fact => fact.processingStatus === "processing_incomplete").length;
  if (affectedNoticeCount > 0) {
    return {
      status: "coverage_gap",
      code: "incomplete_notice_processing",
      value: null,
      affectedNoticeCount,
      publicationEligible: false,
    };
  }
  return countResult(notices.filter(fact => fact.automationProcessing === automationProcessing).length);
}

function reconcileFacts(
  contract: FrozenDsaPart8CountContract,
  decisions: readonly ReturnType<typeof normalizeDecisionFacts>[number][],
  evaluations: readonly ReturnType<typeof normalizeEvaluationFacts>[number][],
  notices: readonly ReturnType<typeof normalizeNoticeFacts>[number][],
) {
  const noticeById = new Map(notices.map(notice => [notice.noticeId, notice]));
  const hosting = ["hosting_service", "online_platform", "vlop"].includes(contract.service.providerType);
  const onlinePlatform = ["online_platform", "vlop"].includes(contract.service.providerType);
  if (!hosting && notices.length > 0) invalid("Notice-and-action facts apply only to hosting services.", "noticeFacts");
  if (!hosting && decisions.some(decision => decision.sourceFact.origin === "article16_notice")) {
    invalid("Article 16 decisions apply only to hosting services.", "decisionFacts");
  }
  if (!onlinePlatform && notices.some(notice => notice.notifierClass === "trusted_flagger")) {
    invalid("Trusted Flagger scope applies only to online platforms.", "noticeFacts");
  }
  for (const [index, decision] of decisions.entries()) {
    if (decision.sourceFact.origin !== "article16_notice") continue;
    const notice = noticeById.get(decision.sourceFact.article16NoticeId!);
    if (!notice)
      invalid(
        "Every Article 16 decision must reconcile to a notice-level fact.",
        `decisionFacts[${index}].sourceFact.article16NoticeId`,
      );
    if (notice.notifierClass !== decision.sourceFact.notifierClass) {
      invalid(
        "The decision and notice notifier classifications conflict.",
        `decisionFacts[${index}].sourceFact.notifierClass`,
      );
    }
  }
  const decisionByBinding = new Map(decisions.map(decision => [decision.sourceDecisionBinding, decision]));
  const evaluationsByDecision = new Map<string, Array<(typeof evaluations)[number]>>();
  for (const evaluation of evaluations) {
    const decision = decisionByBinding.get(evaluation.sourceDecisionBinding);
    if (!decision) invalid("An evaluation references a decision absent from the census.", "evaluationFacts");
    if (decision.sourceFact.automationProcessing !== evaluation.automationProcessing) {
      invalid("Evaluation automation processing conflicts with its decision.", "evaluationFacts");
    }
    const group = evaluationsByDecision.get(evaluation.sourceDecisionBinding);
    if (group) group.push(evaluation);
    else evaluationsByDecision.set(evaluation.sourceDecisionBinding, [evaluation]);
  }
  for (const decision of decisions) {
    const group = evaluationsByDecision.get(decision.sourceDecisionBinding) ?? [];
    const set = normalizeDsaPart8AutomatedMeansEvaluationSet(group.map(row => row.evaluation));
    if (
      group.length !== decision.sourceFact.expectedEvaluationCount ||
      set.evaluationSetRoot !== decision.sourceFact.evaluationSetRoot
    ) {
      invalid("A decision does not bind its complete normalized evaluation set.", "evaluationFacts");
    }
  }
  const inventory = new Map(contract.classifierInventory.map(system => [classifierKey(system), system]));
  const observed = new Set<string>();
  for (const evaluation of evaluations) {
    const key = classifierKey({
      systemId: evaluation.evaluation.systemId,
      version: evaluation.evaluation.systemVersion,
      machineClass: evaluation.evaluation.machineClass,
    });
    const inventoried = inventory.get(key);
    if (!inventoried || inventoried.publicDesignation !== evaluation.evaluation.publicDesignation) {
      invalid("An evaluation references a system absent from the complete inventory.", "contract.classifierInventory");
    }
    observed.add(key);
  }
  return observed.size;
}

export function countDsaPart8(
  input: Readonly<{
    contract: FrozenDsaPart8CountContract;
    decisionFacts: readonly ImmutableDsaPart8CountDecisionFact[];
    evaluationFacts: readonly ImmutableDsaPart8CountEvaluationFact[];
    noticeFacts: readonly ImmutableDsaPart8NoticeProcessingFact[];
  }>,
): DsaPart8CountResult {
  exactKeys(input, ["contract", "decisionFacts", "evaluationFacts", "noticeFacts"], "input");
  const contract = validateFrozenDsaPart8CountContract(input.contract);
  const decisions = normalizeDecisionFacts(input.decisionFacts, contract);
  const evaluations = normalizeEvaluationFacts(input.evaluationFacts, contract);
  const notices = normalizeNoticeFacts(input.noticeFacts, contract);
  const measures = decisions.filter(decision => decision.sourceFact.measureTaken);
  if (
    decisions.length !== contract.expectedDecisionCount ||
    measures.length !== contract.expectedMeasureCount ||
    evaluations.length !== contract.expectedEvaluationCount ||
    notices.length !== contract.expectedNoticeCount ||
    computeDsaPart8DecisionFactRoot(decisions) !== contract.decisionFactRoot ||
    computeDsaPart8EvaluationFactRoot(evaluations) !== contract.evaluationFactRoot ||
    computeDsaPart8NoticeFactRoot(notices) !== contract.noticeFactRoot
  ) {
    invalid("Census evidence does not match the frozen counts and canonical roots.", "input");
  }
  const observedClassifierCount = reconcileFacts(contract, decisions, evaluations, notices);
  const measureCount = (
    automation: typeof DSA_PART8_SOLELY_AUTOMATED | typeof DSA_PART8_NOT_AUTOMATED,
    origin?: "own_initiative",
    language?: EuLanguage,
  ) =>
    measures.filter(
      decision =>
        decision.sourceFact.automationProcessing === automation &&
        (!origin || decision.sourceFact.origin === origin) &&
        (!language || decision.sourceFact.languageAttribution.languageCodes.includes(language)),
    ).length;
  const cells: DsaPart8CountCell[] = [];
  for (const [indicator, automation] of [
    ["measures_solely_automated", DSA_PART8_SOLELY_AUTOMATED],
    ["measures_not_automated", DSA_PART8_NOT_AUTOMATED],
  ] as const) {
    cells.push({ indicator, scope: "Total number", result: countResult(measureCount(automation)) });
    cells.push({ indicator, scope: "Own-initiative", result: countResult(measureCount(automation, "own_initiative")) });
    if (contract.service.providerType === "vlop") {
      for (const language of EU_OFFICIAL_LANGUAGE_CODES) {
        cells.push({ indicator, scope: language, result: countResult(measureCount(automation, undefined, language)) });
      }
    }
  }
  const hosting = ["hosting_service", "online_platform", "vlop"].includes(contract.service.providerType);
  const onlinePlatform = ["online_platform", "vlop"].includes(contract.service.providerType);
  if (hosting) {
    for (const [indicator, automation] of [
      ["notices_solely_automated", DSA_PART8_SOLELY_AUTOMATED],
      ["notices_not_automated", DSA_PART8_NOT_AUTOMATED],
    ] as const) {
      cells.push({ indicator, scope: "NAM Total", result: noticeResult(notices, automation) });
      if (onlinePlatform) {
        cells.push({
          indicator,
          scope: "NAM Trusted Flagger",
          result: noticeResult(
            notices.filter(notice => notice.notifierClass === "trusted_flagger"),
            automation,
          ),
        });
      }
    }
  }
  const noLanguageCounts = Object.fromEntries(DSA_PART8_NO_LANGUAGE_REASONS.map(reason => [reason, 0])) as Record<
    NoLanguageReason,
    number
  >;
  let measureCountWithLanguage = 0;
  let languageAttributionCount = 0;
  for (const decision of measures) {
    const attribution = decision.sourceFact.languageAttribution;
    if (attribution.languageCodes.length > 0) {
      measureCountWithLanguage += 1;
      languageAttributionCount += attribution.languageCodes.length;
    } else {
      noLanguageCounts[attribution.noLanguageReason!] += 1;
    }
  }
  const countAutomation = (automation: AutomationProcessing) =>
    decisions.filter(decision => decision.sourceFact.automationProcessing === automation).length;
  const payload = {
    schemaVersion: DSA_PART8_COUNT_RESULT_SCHEMA_VERSION,
    algorithmVersion: DSA_PART8_COUNT_ALGORITHM_VERSION,
    contract: {
      contractId: contract.contractId,
      contractDigest: contract.contractDigest,
      service: contract.service,
      reportingPeriod: contract.reportingPeriod,
    },
    evidence: {
      decisionFactRoot: contract.decisionFactRoot,
      evaluationFactRoot: contract.evaluationFactRoot,
      noticeFactRoot: contract.noticeFactRoot,
      censusWitnessDigest: contract.censusWitnessDigest,
    },
    inputCoverage: {
      decisionCount: decisions.length,
      measureCount: measures.length,
      evaluationCount: evaluations.length,
      noticeCount: notices.length,
      classifierInventoryCount: contract.classifierInventory.length,
      observedClassifierCount,
      unobservedClassifierCount: contract.classifierInventory.length - observedClassifierCount,
      solelyAutomatedDecisionCount: countAutomation(DSA_PART8_SOLELY_AUTOMATED),
      partiallyAutomatedDecisionCount: countAutomation(DSA_PART8_PARTIALLY_AUTOMATED),
      notAutomatedDecisionCount: countAutomation(DSA_PART8_NOT_AUTOMATED),
      partiallyAutomatedMeasureCount: measures.filter(
        decision => decision.sourceFact.automationProcessing === DSA_PART8_PARTIALLY_AUTOMATED,
      ).length,
      partiallyAutomatedNoticeCount: notices.filter(
        notice => notice.automationProcessing === DSA_PART8_PARTIALLY_AUTOMATED,
      ).length,
    },
    languageCoverage: { measureCountWithLanguage, languageAttributionCount, noLanguageCounts },
    cells,
    publicationEligible: false,
  } as const;
  return { ...payload, resultDigest: sha256Rfc8785(payload) };
}

export function assertDsaPart8CountMatchesEvidence(
  input: Readonly<{
    expected: DsaPart8CountResult;
    contract: FrozenDsaPart8CountContract;
    decisionFacts: readonly ImmutableDsaPart8CountDecisionFact[];
    evaluationFacts: readonly ImmutableDsaPart8CountEvaluationFact[];
    noticeFacts: readonly ImmutableDsaPart8NoticeProcessingFact[];
  }>,
) {
  const actual = countDsaPart8({
    contract: input.contract,
    decisionFacts: input.decisionFacts,
    evaluationFacts: input.evaluationFacts,
    noticeFacts: input.noticeFacts,
  });
  if (canonicalizeRfc8785(actual) !== canonicalizeRfc8785(input.expected)) {
    invalid("Count result does not match the complete census evidence.", "expected");
  }
  return actual;
}
