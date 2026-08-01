import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { enqueueAssuranceAttestationInTransaction } from "~~/lib/tokenless/assuranceAttestationPipeline";
import { dsaEvidenceCommitTimestamp, dsaEvidenceTransactionTimestamp } from "~~/lib/tokenless/dsaEvidenceClock";
import {
  DSA_PART8_CENSUS_WITNESS_SCHEMA_VERSION,
  DSA_PART8_COUNT_ALGORITHM_VERSION,
  DSA_PART8_COUNT_CONTRACT_SCHEMA_VERSION,
  DSA_PART8_COUNT_DECISION_FACT_SCHEMA_VERSION,
  DSA_PART8_COUNT_EVALUATION_FACT_SCHEMA_VERSION,
  DSA_PART8_NOTICE_PROCESSING_FACT_SCHEMA_VERSION as DSA_PART8_COUNT_NOTICE_SCHEMA_VERSION,
  DSA_PART8_PROVIDER_TYPES,
  type DsaPart8CountCell,
  type DsaPart8CountResult,
  type FrozenDsaPart8CountContract,
  assertDsaPart8CountMatchesEvidence,
  countDsaPart8,
  freezeDsaPart8CountContract,
  sealDsaPart8CountDecisionFact,
  sealDsaPart8CountEvaluationFact,
  sealDsaPart8NoticeProcessingFact,
} from "~~/lib/tokenless/dsaPart8Counts";
import {
  DSA_PART8_NOTICE_PROCESSING_FACT_SCHEMA_VERSION,
  type FrozenDsaPart8ClassifierInventory,
  type ImmutableDsaPart8NoticeProcessingFact,
  sealDsaPart8NoticeProcessingFact as sealSourceNoticeFact,
} from "~~/lib/tokenless/dsaPart8InventoryAndNotices";
import {
  DSA_PART8_AUTOMATED_MEANS_EVALUATION_SCHEMA_VERSION,
  DSA_PART8_DECISION_FACT_SCHEMA_VERSION,
  type DsaPart8AutomatedMeansEvaluationInput,
  type DsaPart8DecisionFactInput,
  normalizeDsaPart8AutomatedMeansEvaluation,
  normalizeDsaPart8DecisionFact,
} from "~~/lib/tokenless/dsaPart8SourceFacts";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const DSA_PART8_WITNESSED_COUNT_CONTRACT_SCHEMA_VERSION =
  "rateloop.dsa-part8-witnessed-count-contract.v1" as const;
export const DSA_PART8_WITNESSED_COUNT_RESULT_SCHEMA_VERSION = "rateloop.dsa-part8-witnessed-count-result.v1" as const;
export const DSA_PART8_COUNT_DECISION_PROJECTION_SCHEMA_VERSION =
  "rateloop.dsa-part8-count-decision-projection.v1" as const;
export const DSA_PART8_COUNT_MEASURE_PROJECTION_SCHEMA_VERSION =
  "rateloop.dsa-part8-count-measure-projection.v1" as const;
export const DSA_PART8_COUNT_EVALUATION_PROJECTION_SCHEMA_VERSION =
  "rateloop.dsa-part8-count-evaluation-projection.v1" as const;
export const DSA_PART8_COUNT_NOTICE_PROJECTION_SCHEMA_VERSION =
  "rateloop.dsa-part8-count-notice-projection.v1" as const;
export const DSA_PART8_COUNT_PROJECTION_ROOT_SCHEMA_VERSION = "rateloop.dsa-part8-count-projection-root.v1" as const;
export const DSA_PART8_COUNT_CELL_SCHEMA_VERSION = "rateloop.dsa-part8-count-cell.v1" as const;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SIMPLE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
type Row = Record<string, unknown>;
type ProviderType = (typeof DSA_PART8_PROVIDER_TYPES)[number];
type NormalizedDecision = ReturnType<typeof normalizeDsaPart8DecisionFact>;
type NormalizedEvaluation = ReturnType<typeof normalizeDsaPart8AutomatedMeansEvaluation>;

export type DsaPart8CountPopulationBinding = Readonly<{
  populationId: string;
  populationVersion: number;
  populationRoot: `sha256:${string}`;
  populationFrozenAt: string;
  reconciliationVersion: number;
  reconciliationHash: `sha256:${string}`;
}>;

export type DsaPart8CountWitness = Readonly<{
  kind: "database_transaction_and_attestation";
  sourceFrozenAt: string;
  committedAt: string;
  auditEventId: string;
  auditHeadDigest: `sha256:${string}`;
  attestationJobId: string;
  attestationArtifactKind: "audit_export_head";
  attestationRequirement: "enqueued_audit_export_head";
}>;

export function buildDsaPart8CountWitness(
  input: Readonly<{
    sourceFrozenAt: Date;
    committedAt: Date;
    audit: Pick<Awaited<ReturnType<typeof appendAuditEvent>>, "eventId" | "eventDigest">;
    attestationJobId: string;
  }>,
): DsaPart8CountWitness {
  return {
    kind: "database_transaction_and_attestation",
    sourceFrozenAt: input.sourceFrozenAt.toISOString(),
    committedAt: input.committedAt.toISOString(),
    auditEventId: input.audit.eventId,
    auditHeadDigest: input.audit.eventDigest as `sha256:${string}`,
    attestationJobId: input.attestationJobId,
    attestationArtifactKind: "audit_export_head",
    attestationRequirement: "enqueued_audit_export_head",
  };
}

export type DsaPart8CountDecisionSource = Readonly<{
  providerDecisionId: string;
  decisionVersion: number;
  engagementId: string;
  engagementVersion: number;
  sourceDecisionHash: `sha256:${string}`;
  engagementHash: `sha256:${string}`;
  decisionAt: string;
  part8Fact: NormalizedDecision;
  part8FactHash: `sha256:${string}`;
}>;

export type DsaPart8CountEvaluationSource = Readonly<{
  providerDecisionId: string;
  decisionVersion: number;
  sourceEvaluationHash: `sha256:${string}`;
  evaluation: NormalizedEvaluation;
}>;

export type DsaPart8DecisionProjection = DsaPart8CountDecisionSource &
  Readonly<{
    schemaVersion: typeof DSA_PART8_COUNT_DECISION_PROJECTION_SCHEMA_VERSION;
    contractId: string;
    sourceDecisionBinding: `sha256:${string}`;
    projectionHash: `sha256:${string}`;
  }>;

export type DsaPart8MeasureProjection = Readonly<{
  schemaVersion: typeof DSA_PART8_COUNT_MEASURE_PROJECTION_SCHEMA_VERSION;
  contractId: string;
  sourceDecisionBinding: `sha256:${string}`;
  moderationMeasureId: string;
  decisionProjectionHash: `sha256:${string}`;
  automationProcessing: NormalizedDecision["automationProcessing"];
  origin: NormalizedDecision["origin"];
  languageAttribution: NormalizedDecision["languageAttribution"];
  projectionHash: `sha256:${string}`;
}>;

export type DsaPart8EvaluationProjection = Readonly<{
  schemaVersion: typeof DSA_PART8_COUNT_EVALUATION_PROJECTION_SCHEMA_VERSION;
  contractId: string;
  sourceDecisionBinding: `sha256:${string}`;
  providerDecisionId: string;
  decisionVersion: number;
  sourceEvaluationBinding: `sha256:${string}`;
  sourceEvaluationHash: `sha256:${string}`;
  decisionAt: string;
  automationProcessing: "solely_automated" | "partially_automated";
  evaluation: NormalizedEvaluation;
  projectionHash: `sha256:${string}`;
}>;

export type PersistedDsaPart8CountCell = DsaPart8CountCell &
  Readonly<{
    schemaVersion: typeof DSA_PART8_COUNT_CELL_SCHEMA_VERSION;
    contractId: string;
    cellHash: `sha256:${string}`;
  }>;

export type DsaPart8NoticeProjection = Readonly<{
  schemaVersion: typeof DSA_PART8_COUNT_NOTICE_PROJECTION_SCHEMA_VERSION;
  contractId: string;
  sourceFact: ImmutableDsaPart8NoticeProcessingFact;
  coverageGap: "incomplete_notice_processing" | null;
  projectionHash: `sha256:${string}`;
}>;

export type WitnessedDsaPart8CountContract = Readonly<{
  schemaVersion: typeof DSA_PART8_WITNESSED_COUNT_CONTRACT_SCHEMA_VERSION;
  algorithmVersion: typeof DSA_PART8_COUNT_ALGORITHM_VERSION;
  workspaceId: string;
  contractId: string;
  service: Readonly<{ serviceId: string; providerType: ProviderType }>;
  reportingPeriod: Readonly<{ startInclusive: string; endExclusive: string }>;
  population: DsaPart8CountPopulationBinding;
  classifierInventory: FrozenDsaPart8ClassifierInventory;
  witness: DsaPart8CountWitness;
  expectedDecisionCount: number;
  expectedMeasureCount: number;
  expectedEvaluationCount: number;
  expectedNoticeCount: number;
  decisionProjectionRoot: `sha256:${string}`;
  measureProjectionRoot: `sha256:${string}`;
  evaluationProjectionRoot: `sha256:${string}`;
  noticeProjectionRoot: `sha256:${string}`;
  engineContract: FrozenDsaPart8CountContract;
  engineResultDigest: `sha256:${string}`;
  contractDigest: `sha256:${string}`;
}>;

export type WitnessedDsaPart8CountResult = Readonly<{
  schemaVersion: typeof DSA_PART8_WITNESSED_COUNT_RESULT_SCHEMA_VERSION;
  contractId: string;
  contractDigest: `sha256:${string}`;
  projectionRoots: Readonly<{
    decision: `sha256:${string}`;
    measure: `sha256:${string}`;
    evaluation: `sha256:${string}`;
    notice: `sha256:${string}`;
  }>;
  partiallyAutomatedDecisionCount: number;
  partiallyAutomatedMeasureCount: number;
  partiallyAutomatedNoticeCount: number;
  incompleteNoticeCount: number;
  expectedCellCount: number;
  cellRoot: `sha256:${string}`;
  publicationEligible: false;
  engineResult: DsaPart8CountResult;
  resultDigest: `sha256:${string}`;
}>;

export type WitnessedDsaPart8CountBundle = Readonly<{
  contract: WitnessedDsaPart8CountContract;
  result: WitnessedDsaPart8CountResult;
  decisionProjections: readonly DsaPart8DecisionProjection[];
  measureProjections: readonly DsaPart8MeasureProjection[];
  evaluationProjections: readonly DsaPart8EvaluationProjection[];
  noticeProjections: readonly DsaPart8NoticeProjection[];
  countCells: readonly PersistedDsaPart8CountCell[];
}>;

function invalid(message: string, field?: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_dsa_part8_count_contract", false, field);
}

function storedInvalid(): never {
  throw new TokenlessServiceError(
    "Stored DSA Part 8 count evidence is invalid.",
    500,
    "stored_dsa_part8_count_invalid",
  );
}

function portableCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function text(row: Row | undefined, field: string) {
  const value = row?.[field];
  return value === null || value === undefined ? null : String(value);
}

function positiveInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalid(`${field} must be a positive integer.`, field);
  return Number(value);
}

function canonicalDate(value: unknown, field: string) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) invalid(`${field} must be a valid timestamp.`, field);
  return parsed;
}

function canonicalStoredJson(value: string | null, digest?: string | null) {
  try {
    if (value === null) throw new Error();
    const parsed = JSON.parse(value) as unknown;
    if (canonicalizeRfc8785(parsed) !== value || (digest && sha256Rfc8785(parsed) !== digest)) throw new Error();
    return parsed;
  } catch {
    storedInvalid();
  }
}

function embeddedDigestJson<T extends Record<string, unknown>>(
  value: string | null,
  digest: string | null,
  digestField: keyof T,
) {
  const parsed = canonicalStoredJson(value) as T;
  const embedded = parsed[digestField];
  const payload: Record<string, unknown> = { ...parsed };
  delete payload[String(digestField)];
  if (typeof embedded !== "string" || embedded !== digest || sha256Rfc8785(payload) !== digest) storedInvalid();
  return parsed;
}

function projectionRoot(
  kind: "decision" | "measure" | "evaluation" | "notice" | "cell",
  projections: readonly Readonly<{ projectionHash: `sha256:${string}` }>[],
) {
  const projectionHashes = projections.map(row => row.projectionHash).sort(portableCompare);
  return sha256Rfc8785({
    schemaVersion: DSA_PART8_COUNT_PROJECTION_ROOT_SCHEMA_VERSION,
    kind,
    projectionCount: projectionHashes.length,
    projectionHashes,
  });
}

function sourceDecisionBinding(
  workspaceId: string,
  population: Pick<DsaPart8CountPopulationBinding, "populationId" | "populationVersion">,
  source: DsaPart8CountDecisionSource,
) {
  return sha256Rfc8785({
    workspaceId,
    populationId: population.populationId,
    populationVersion: population.populationVersion,
    providerDecisionId: source.providerDecisionId,
    decisionVersion: source.decisionVersion,
    sourceDecisionHash: source.sourceDecisionHash,
    engagementHash: source.engagementHash,
    measureTaken: source.part8Fact.measureTaken,
    moderationMeasureId: source.part8Fact.moderationMeasureId,
    part8Fact: source.part8Fact,
    part8FactHash: source.part8FactHash,
    origin: source.part8Fact.origin,
    article16NoticeId: source.part8Fact.article16NoticeId,
    notifierClass: source.part8Fact.notifierClass,
  });
}

function decisionInput(fact: NormalizedDecision): DsaPart8DecisionFactInput {
  return {
    measureTaken: fact.measureTaken,
    moderationMeasureId: fact.moderationMeasureId,
    origin: fact.origin,
    automationProcessing: fact.automationProcessing,
    expectedEvaluationCount: fact.expectedEvaluationCount,
    evaluationSetRoot: fact.evaluationSetRoot,
    article16NoticeId: fact.article16NoticeId,
    notifierClass: fact.notifierClass,
    languageAttribution: fact.languageAttribution,
  };
}

function evaluationInput(fact: NormalizedEvaluation): DsaPart8AutomatedMeansEvaluationInput {
  return {
    evaluationId: fact.evaluationId,
    systemId: fact.systemId,
    systemVersion: fact.systemVersion,
    machineClass: fact.machineClass,
    publicDesignation: fact.publicDesignation,
    automatedOutcome: fact.automatedOutcome,
  };
}

function validateInventory(inventory: FrozenDsaPart8ClassifierInventory) {
  const { inventoryDigest, ...payload } = inventory;
  if (
    !SHA256.test(inventoryDigest) ||
    inventoryDigest !== sha256Rfc8785(payload) ||
    inventory.inventoryRoot !==
      sha256Rfc8785({
        schemaVersion: inventory.schemaVersion,
        systems: inventory.systems.map(
          ({ entryHash, gapCode, observationState, observedEvaluationCount, schemaVersion, ...system }) => {
            void entryHash;
            void gapCode;
            void observationState;
            void observedEvaluationCount;
            void schemaVersion;
            return system;
          },
        ),
      })
  ) {
    invalid("classifierInventory does not bind its exact immutable payload.", "classifierInventory");
  }
  return inventory;
}

export function buildWitnessedDsaPart8CountBundle(
  input: Readonly<{
    workspaceId: string;
    contractId: string;
    serviceId: string;
    providerType: ProviderType;
    reportingPeriod: Readonly<{ startInclusive: string; endExclusive: string }>;
    population: DsaPart8CountPopulationBinding;
    classifierInventory: FrozenDsaPart8ClassifierInventory;
    witness: DsaPart8CountWitness;
    decisions: readonly DsaPart8CountDecisionSource[];
    evaluations: readonly DsaPart8CountEvaluationSource[];
    notices: readonly ImmutableDsaPart8NoticeProcessingFact[];
  }>,
): WitnessedDsaPart8CountBundle {
  if (!SIMPLE_IDENTIFIER.test(input.workspaceId) || !IDENTIFIER.test(input.serviceId))
    invalid("Count scope is invalid.");
  if (!DSA_PART8_PROVIDER_TYPES.includes(input.providerType)) invalid("providerType is invalid.", "providerType");
  const inventory = validateInventory(input.classifierInventory);
  if (
    inventory.population.populationId !== input.population.populationId ||
    inventory.population.populationVersion !== input.population.populationVersion ||
    inventory.population.populationRoot !== input.population.populationRoot ||
    inventory.population.populationFrozenAt !== input.population.populationFrozenAt ||
    inventory.serviceId !== input.serviceId
  ) {
    invalid("Classifier inventory does not match the frozen population and service.", "classifierInventory");
  }
  if (
    input.witness.kind !== "database_transaction_and_attestation" ||
    input.witness.attestationArtifactKind !== "audit_export_head" ||
    input.witness.attestationRequirement !== "enqueued_audit_export_head" ||
    !SHA256.test(input.witness.auditHeadDigest) ||
    !/^audit_[0-9a-f]{32}$/u.test(input.witness.auditEventId) ||
    !/^aat_[0-9a-f]{40}$/u.test(input.witness.attestationJobId) ||
    input.witness.sourceFrozenAt > input.witness.committedAt ||
    input.population.populationFrozenAt > input.witness.sourceFrozenAt ||
    input.reportingPeriod.endExclusive > input.witness.sourceFrozenAt
  ) {
    invalid("Census witness is incomplete or has an invalid clock order.", "witness");
  }
  const decisions = input.decisions
    .map(source => {
      const part8Fact = normalizeDsaPart8DecisionFact(decisionInput(source.part8Fact));
      if (source.part8FactHash !== sha256Rfc8785(part8Fact)) invalid("Decision source fact hash is invalid.");
      const payload = {
        schemaVersion: DSA_PART8_COUNT_DECISION_PROJECTION_SCHEMA_VERSION,
        contractId: input.contractId,
        ...source,
        decisionAt: canonicalDate(source.decisionAt, "decisionAt").toISOString(),
        part8Fact,
        sourceDecisionBinding: sourceDecisionBinding(input.workspaceId, input.population, { ...source, part8Fact }),
      };
      return { ...payload, projectionHash: sha256Rfc8785(payload) };
    })
    .sort((left, right) => portableCompare(left.sourceDecisionBinding, right.sourceDecisionBinding));
  if (new Set(decisions.map(row => row.sourceDecisionBinding)).size !== decisions.length)
    invalid("Decision census is not unique.");

  const decisionBySource = new Map(decisions.map(row => [`${row.providerDecisionId}\0${row.decisionVersion}`, row]));
  const measures = decisions
    .filter(row => row.part8Fact.measureTaken)
    .map(row => {
      const payload = {
        schemaVersion: DSA_PART8_COUNT_MEASURE_PROJECTION_SCHEMA_VERSION,
        contractId: input.contractId,
        sourceDecisionBinding: row.sourceDecisionBinding,
        moderationMeasureId: row.part8Fact.moderationMeasureId!,
        decisionProjectionHash: row.projectionHash,
        automationProcessing: row.part8Fact.automationProcessing,
        origin: row.part8Fact.origin,
        languageAttribution: row.part8Fact.languageAttribution,
      };
      return { ...payload, projectionHash: sha256Rfc8785(payload) };
    })
    .sort((left, right) => portableCompare(left.sourceDecisionBinding, right.sourceDecisionBinding));

  const evaluations = input.evaluations
    .map(source => {
      const decision = decisionBySource.get(`${source.providerDecisionId}\0${source.decisionVersion}`);
      if (!decision || decision.part8Fact.automationProcessing === "not_automated") {
        invalid("Evaluation does not bind an automated decision in the exact census.");
      }
      const evaluation = normalizeDsaPart8AutomatedMeansEvaluation(evaluationInput(source.evaluation));
      if (source.sourceEvaluationHash !== sha256Rfc8785(evaluation)) invalid("Evaluation source hash is invalid.");
      const payload = {
        schemaVersion: DSA_PART8_COUNT_EVALUATION_PROJECTION_SCHEMA_VERSION,
        contractId: input.contractId,
        sourceDecisionBinding: decision.sourceDecisionBinding,
        providerDecisionId: source.providerDecisionId,
        decisionVersion: source.decisionVersion,
        sourceEvaluationBinding: sha256Rfc8785({
          sourceDecisionBinding: decision.sourceDecisionBinding,
          evaluation,
          sourceEvaluationHash: source.sourceEvaluationHash,
        }),
        sourceEvaluationHash: source.sourceEvaluationHash,
        decisionAt: decision.decisionAt,
        automationProcessing: decision.part8Fact.automationProcessing,
        evaluation,
      } as const;
      return { ...payload, projectionHash: sha256Rfc8785(payload) };
    })
    .sort((left, right) => portableCompare(left.sourceEvaluationBinding, right.sourceEvaluationBinding));
  if (new Set(evaluations.map(row => row.sourceEvaluationBinding)).size !== evaluations.length) {
    invalid("Evaluation census is not unique.");
  }

  const notices = input.notices
    .map(sourceFact => {
      const sealed = sealSourceNoticeFact({
        noticeId: sourceFact.noticeId,
        factVersion: sourceFact.factVersion,
        serviceId: sourceFact.serviceId,
        receivedAt: new Date(sourceFact.receivedAt),
        sourceNoticeBinding: sourceFact.sourceNoticeBinding,
        processingStatus: sourceFact.processingStatus,
        automationProcessing: sourceFact.automationProcessing,
        notifierClass: sourceFact.notifierClass,
        supersedesFactVersion: sourceFact.supersedesFactVersion,
        correctionReason: sourceFact.correctionReason,
      });
      if (canonicalizeRfc8785(sealed) !== canonicalizeRfc8785(sourceFact)) invalid("Notice source fact is invalid.");
      const payload = {
        schemaVersion: DSA_PART8_COUNT_NOTICE_PROJECTION_SCHEMA_VERSION,
        contractId: input.contractId,
        sourceFact: sealed,
        coverageGap:
          sealed.processingStatus === "processing_incomplete" ? ("incomplete_notice_processing" as const) : null,
      };
      return { ...payload, projectionHash: sha256Rfc8785(payload) };
    })
    .sort((left, right) => portableCompare(left.sourceFact.noticeId, right.sourceFact.noticeId));
  if (new Set(notices.map(row => row.sourceFact.noticeId)).size !== notices.length)
    invalid("Notice census is not unique.");

  const decisionFacts = decisions.map(row =>
    sealDsaPart8CountDecisionFact({
      schemaVersion: DSA_PART8_COUNT_DECISION_FACT_SCHEMA_VERSION,
      serviceId: input.serviceId,
      occurredAt: row.decisionAt,
      sourceDecisionBinding: row.sourceDecisionBinding,
      sourceFact: decisionInput(row.part8Fact),
    }),
  );
  const evaluationFacts = evaluations.map(row =>
    sealDsaPart8CountEvaluationFact({
      schemaVersion: DSA_PART8_COUNT_EVALUATION_FACT_SCHEMA_VERSION,
      serviceId: input.serviceId,
      occurredAt: row.decisionAt,
      sourceDecisionBinding: row.sourceDecisionBinding,
      sourceEvaluationBinding: row.sourceEvaluationBinding,
      sourceEvaluationHash: row.sourceEvaluationHash,
      automationProcessing: row.automationProcessing,
      evaluation: evaluationInput(row.evaluation),
    }),
  );
  const noticeFacts = notices.map(row =>
    sealDsaPart8NoticeProcessingFact({
      schemaVersion: DSA_PART8_COUNT_NOTICE_SCHEMA_VERSION,
      serviceId: row.sourceFact.serviceId,
      receivedAt: row.sourceFact.receivedAt,
      noticeId: row.sourceFact.noticeId,
      processingStatus: row.sourceFact.processingStatus,
      automationProcessing: row.sourceFact.automationProcessing,
      notifierClass: row.sourceFact.notifierClass,
    }),
  );
  const engineContract = freezeDsaPart8CountContract({
    spec: {
      schemaVersion: DSA_PART8_COUNT_CONTRACT_SCHEMA_VERSION,
      contractId: input.contractId,
      service: { serviceId: input.serviceId, providerType: input.providerType },
      reportingPeriod: input.reportingPeriod,
      classifierInventory: inventory.systems.map(system => ({
        systemId: system.systemId,
        version: system.systemVersion,
        machineClass: system.machineClass,
        publicDesignation: system.publicDesignation,
      })),
      censusWitness: {
        schemaVersion: DSA_PART8_CENSUS_WITNESS_SCHEMA_VERSION,
        kind: "database_transaction_and_attestation",
        censusId: input.contractId,
        sourcePopulationId: input.population.populationId,
        sourcePopulationVersion: input.population.populationVersion,
        frozenAt: input.witness.committedAt,
        auditHeadDigest: input.witness.auditHeadDigest,
        attestationJobId: input.witness.attestationJobId,
      },
    },
    decisionFacts,
    evaluationFacts,
    noticeFacts,
  });
  const engineResult = countDsaPart8({ contract: engineContract, decisionFacts, evaluationFacts, noticeFacts });
  const countCells = engineResult.cells
    .map(cell => {
      const payload = {
        schemaVersion: DSA_PART8_COUNT_CELL_SCHEMA_VERSION,
        contractId: input.contractId,
        indicator: cell.indicator,
        scope: cell.scope,
        result: cell.result,
      };
      return { ...payload, cellHash: sha256Rfc8785(payload) };
    })
    .sort((left, right) => portableCompare(`${left.indicator}\0${left.scope}`, `${right.indicator}\0${right.scope}`));
  const contractPayload = {
    schemaVersion: DSA_PART8_WITNESSED_COUNT_CONTRACT_SCHEMA_VERSION,
    algorithmVersion: DSA_PART8_COUNT_ALGORITHM_VERSION,
    workspaceId: input.workspaceId,
    contractId: input.contractId,
    service: { serviceId: input.serviceId, providerType: input.providerType },
    reportingPeriod: input.reportingPeriod,
    population: input.population,
    classifierInventory: inventory,
    witness: input.witness,
    expectedDecisionCount: decisions.length,
    expectedMeasureCount: measures.length,
    expectedEvaluationCount: evaluations.length,
    expectedNoticeCount: notices.length,
    decisionProjectionRoot: projectionRoot("decision", decisions),
    measureProjectionRoot: projectionRoot("measure", measures),
    evaluationProjectionRoot: projectionRoot("evaluation", evaluations),
    noticeProjectionRoot: projectionRoot("notice", notices),
    engineContract,
    engineResultDigest: engineResult.resultDigest,
  } as const;
  const contract = { ...contractPayload, contractDigest: sha256Rfc8785(contractPayload) };
  const resultPayload = {
    schemaVersion: DSA_PART8_WITNESSED_COUNT_RESULT_SCHEMA_VERSION,
    contractId: input.contractId,
    contractDigest: contract.contractDigest,
    projectionRoots: {
      decision: contract.decisionProjectionRoot,
      measure: contract.measureProjectionRoot,
      evaluation: contract.evaluationProjectionRoot,
      notice: contract.noticeProjectionRoot,
    },
    partiallyAutomatedDecisionCount: engineResult.inputCoverage.partiallyAutomatedDecisionCount,
    partiallyAutomatedMeasureCount: engineResult.inputCoverage.partiallyAutomatedMeasureCount,
    partiallyAutomatedNoticeCount: engineResult.inputCoverage.partiallyAutomatedNoticeCount,
    incompleteNoticeCount: notices.filter(row => row.coverageGap === "incomplete_notice_processing").length,
    expectedCellCount: countCells.length,
    cellRoot: projectionRoot(
      "cell",
      countCells.map(cell => ({ projectionHash: cell.cellHash })),
    ),
    publicationEligible: false as const,
    engineResult,
  };
  const result = { ...resultPayload, resultDigest: sha256Rfc8785(resultPayload) };
  return {
    contract,
    result,
    decisionProjections: decisions,
    measureProjections: measures,
    evaluationProjections: evaluations,
    noticeProjections: notices,
    countCells,
  };
}

export function verifyWitnessedDsaPart8CountBundle(input: WitnessedDsaPart8CountBundle) {
  const rebuilt = buildWitnessedDsaPart8CountBundle({
    workspaceId: input.contract.workspaceId,
    contractId: input.contract.contractId,
    serviceId: input.contract.service.serviceId,
    providerType: input.contract.service.providerType,
    reportingPeriod: input.contract.reportingPeriod,
    population: input.contract.population,
    classifierInventory: input.contract.classifierInventory,
    witness: input.contract.witness,
    decisions: input.decisionProjections.map(row => {
      return {
        providerDecisionId: row.providerDecisionId,
        decisionVersion: row.decisionVersion,
        engagementId: row.engagementId,
        engagementVersion: row.engagementVersion,
        sourceDecisionHash: row.sourceDecisionHash,
        engagementHash: row.engagementHash,
        decisionAt: row.decisionAt,
        part8Fact: row.part8Fact,
        part8FactHash: row.part8FactHash,
      };
    }),
    evaluations: input.evaluationProjections.map(row => ({
      providerDecisionId:
        input.decisionProjections.find(decision => decision.sourceDecisionBinding === row.sourceDecisionBinding)
          ?.providerDecisionId ?? "",
      decisionVersion:
        input.decisionProjections.find(decision => decision.sourceDecisionBinding === row.sourceDecisionBinding)
          ?.decisionVersion ?? 0,
      sourceEvaluationHash: row.sourceEvaluationHash,
      evaluation: row.evaluation,
    })),
    notices: input.noticeProjections.map(row => row.sourceFact),
  });
  if (canonicalizeRfc8785(rebuilt) !== canonicalizeRfc8785(input)) {
    invalid("Offline verification failed: the bundle is not the exact immutable census result.", "bundle");
  }
  const decisionFacts = rebuilt.decisionProjections.map(row =>
    sealDsaPart8CountDecisionFact({
      schemaVersion: DSA_PART8_COUNT_DECISION_FACT_SCHEMA_VERSION,
      serviceId: rebuilt.contract.service.serviceId,
      occurredAt: row.decisionAt,
      sourceDecisionBinding: row.sourceDecisionBinding,
      sourceFact: decisionInput(row.part8Fact),
    }),
  );
  const evaluationFacts = rebuilt.evaluationProjections.map(row =>
    sealDsaPart8CountEvaluationFact({
      schemaVersion: DSA_PART8_COUNT_EVALUATION_FACT_SCHEMA_VERSION,
      serviceId: rebuilt.contract.service.serviceId,
      occurredAt: row.decisionAt,
      sourceDecisionBinding: row.sourceDecisionBinding,
      sourceEvaluationBinding: row.sourceEvaluationBinding,
      sourceEvaluationHash: row.sourceEvaluationHash,
      automationProcessing: row.automationProcessing,
      evaluation: evaluationInput(row.evaluation),
    }),
  );
  const noticeFacts = rebuilt.noticeProjections.map(row =>
    sealDsaPart8NoticeProcessingFact({
      schemaVersion: DSA_PART8_COUNT_NOTICE_SCHEMA_VERSION,
      serviceId: row.sourceFact.serviceId,
      receivedAt: row.sourceFact.receivedAt,
      noticeId: row.sourceFact.noticeId,
      processingStatus: row.sourceFact.processingStatus,
      automationProcessing: row.sourceFact.automationProcessing,
      notifierClass: row.sourceFact.notifierClass,
    }),
  );
  assertDsaPart8CountMatchesEvidence({
    expected: rebuilt.result.engineResult,
    contract: rebuilt.contract.engineContract,
    decisionFacts,
    evaluationFacts,
    noticeFacts,
  });
  return rebuilt;
}

function parseInventory(value: string | null, digest: string | null) {
  const inventory = canonicalStoredJson(value) as FrozenDsaPart8ClassifierInventory;
  if (inventory.inventoryDigest !== digest) storedInvalid();
  return validateInventory(inventory);
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
  const result = await client.query(
    `SELECT m.role FROM tokenless_workspace_members m
     JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id AND w.status='active'
     WHERE m.workspace_id=$1 AND m.account_address=$2 AND m.role IN ('owner','admin') LIMIT 1`,
    [workspaceId, actor],
  );
  if (result.rowCount !== 1) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return actor;
}

async function runRepeatableRead<T>(client: PoolClient, work: (client: PoolClient) => Promise<T>, release: boolean) {
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await client.query(
      `SELECT set_config('lock_timeout','2s',true),set_config('statement_timeout','60s',true),
              set_config('idle_in_transaction_session_timeout','60s',true)`,
    );
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    if (release) client.release();
  }
}

async function inRepeatableRead<T>(work: (client: PoolClient) => Promise<T>) {
  return runRepeatableRead(await dbPool.connect(), work, true);
}

type CountPersistenceDependencies = Readonly<{
  appendAudit: typeof appendAuditEvent;
  enqueueAttestation: typeof enqueueAssuranceAttestationInTransaction;
  persist: typeof persistBundle;
}>;

async function commitCountPersistenceFacade(
  input: Readonly<{
    client: PoolClient;
    actor: string;
    sourceFrozenAt: Date;
    committedAt: Date;
    auditInput: Parameters<typeof appendAuditEvent>[0];
    buildBundle: (witness: DsaPart8CountWitness) => WitnessedDsaPart8CountBundle;
  }>,
  dependencies: CountPersistenceDependencies = {
    appendAudit: appendAuditEvent,
    enqueueAttestation: enqueueAssuranceAttestationInTransaction,
    persist: persistBundle,
  },
) {
  const audit = await dependencies.appendAudit(input.auditInput, input.client);
  const attestation = await dependencies.enqueueAttestation(
    {
      workspaceId: input.auditInput.workspaceId,
      kind: "audit_export_head",
      artifactDigest: audit.eventDigest,
      artifactSchemaVersion: "rateloop-audit-v1",
      boundaryAt: input.committedAt,
      now: input.committedAt,
    },
    input.client,
  );
  const bundle = input.buildBundle(
    buildDsaPart8CountWitness({
      sourceFrozenAt: input.sourceFrozenAt,
      committedAt: input.committedAt,
      audit,
      attestationJobId: attestation.jobId,
    }),
  );
  await dependencies.persist(input.client, input.actor, bundle);
  return bundle;
}

async function insertBatches<T>(
  client: PoolClient,
  rows: readonly T[],
  width: number,
  sql: (tuples: string) => string,
  values: (row: T) => readonly unknown[],
) {
  for (let start = 0; start < rows.length; start += 200) {
    const batch = rows.slice(start, start + 200);
    const bound: unknown[] = [];
    const tuples = batch.map((row, rowIndex) => {
      bound.push(...values(row));
      return `(${Array.from({ length: width }, (_, column) => `$${rowIndex * width + column + 1}`).join(",")})`;
    });
    await client.query(sql(tuples.join(",")), bound);
  }
}

async function persistBundle(client: PoolClient, actor: string, bundle: WitnessedDsaPart8CountBundle) {
  const { contract, result } = bundle;
  await client.query(
    `INSERT INTO tokenless_dsa_part8_count_contracts
     (workspace_id,contract_id,population_id,population_version,population_root,population_frozen_at,
      reconciliation_version,reconciliation_hash,inventory_id,inventory_root,inventory_digest,service_id,provider_type,
      reporting_period_start,reporting_period_end,schema_version,algorithm_version,expected_decision_count,
      expected_measure_count,expected_evaluation_count,expected_notice_count,decision_projection_root,
      measure_projection_root,evaluation_projection_root,notice_projection_root,source_frozen_at,committed_at,
      audit_event_id,audit_head_digest,attestation_job_id,attestation_artifact_kind,attestation_requirement,engine_contract_json,
      engine_contract_digest,contract_json,contract_digest,created_by)
     VALUES (${Array.from({ length: 37 }, (_, index) => `$${index + 1}`).join(",")})`,
    [
      contract.workspaceId,
      contract.contractId,
      contract.population.populationId,
      contract.population.populationVersion,
      contract.population.populationRoot,
      contract.population.populationFrozenAt,
      contract.population.reconciliationVersion,
      contract.population.reconciliationHash,
      contract.classifierInventory.inventoryId,
      contract.classifierInventory.inventoryRoot,
      contract.classifierInventory.inventoryDigest,
      contract.service.serviceId,
      contract.service.providerType,
      contract.reportingPeriod.startInclusive,
      contract.reportingPeriod.endExclusive,
      contract.schemaVersion,
      contract.algorithmVersion,
      contract.expectedDecisionCount,
      contract.expectedMeasureCount,
      contract.expectedEvaluationCount,
      contract.expectedNoticeCount,
      contract.decisionProjectionRoot,
      contract.measureProjectionRoot,
      contract.evaluationProjectionRoot,
      contract.noticeProjectionRoot,
      contract.witness.sourceFrozenAt,
      contract.witness.committedAt,
      contract.witness.auditEventId,
      contract.witness.auditHeadDigest,
      contract.witness.attestationJobId,
      contract.witness.attestationArtifactKind,
      contract.witness.attestationRequirement,
      canonicalizeRfc8785(contract.engineContract),
      contract.engineContract.contractDigest,
      canonicalizeRfc8785(contract),
      contract.contractDigest,
      actor,
    ],
  );
  await insertBatches(
    client,
    bundle.decisionProjections,
    19,
    tuples =>
      `INSERT INTO tokenless_dsa_part8_count_decision_projections
     (workspace_id,contract_id,population_id,population_version,source_decision_binding,provider_decision_id,
      decision_version,engagement_id,
      engagement_version,source_decision_hash,engagement_hash,part8_fact_hash,decision_at,measure_taken,
      moderation_measure_id,automation_processing,expected_evaluation_count,projection_json,projection_hash) VALUES ${tuples}`,
    row => [
      contract.workspaceId,
      contract.contractId,
      contract.population.populationId,
      contract.population.populationVersion,
      row.sourceDecisionBinding,
      row.providerDecisionId,
      row.decisionVersion,
      row.engagementId,
      row.engagementVersion,
      row.sourceDecisionHash,
      row.engagementHash,
      row.part8FactHash,
      row.decisionAt,
      row.part8Fact.measureTaken,
      row.part8Fact.moderationMeasureId,
      row.part8Fact.automationProcessing,
      row.part8Fact.expectedEvaluationCount,
      canonicalizeRfc8785(row),
      row.projectionHash,
    ],
  );
  await insertBatches(
    client,
    bundle.measureProjections,
    9,
    tuples =>
      `INSERT INTO tokenless_dsa_part8_count_measure_projections
     (workspace_id,contract_id,source_decision_binding,moderation_measure_id,decision_projection_hash,
      automation_processing,origin,projection_json,projection_hash) VALUES ${tuples}`,
    row => [
      contract.workspaceId,
      contract.contractId,
      row.sourceDecisionBinding,
      row.moderationMeasureId,
      row.decisionProjectionHash,
      row.automationProcessing,
      row.origin,
      canonicalizeRfc8785(row),
      row.projectionHash,
    ],
  );
  await insertBatches(
    client,
    bundle.evaluationProjections,
    17,
    tuples =>
      `INSERT INTO tokenless_dsa_part8_count_evaluation_projections
     (workspace_id,contract_id,source_evaluation_binding,source_decision_binding,provider_decision_id,decision_version,
      evaluation_id,source_evaluation_hash,
      decision_at,automation_processing,inventory_id,system_id,system_version,machine_class,public_designation,
      projection_json,projection_hash) VALUES ${tuples}`,
    row => [
      contract.workspaceId,
      contract.contractId,
      row.sourceEvaluationBinding,
      row.sourceDecisionBinding,
      row.providerDecisionId,
      row.decisionVersion,
      row.evaluation.evaluationId,
      row.sourceEvaluationHash,
      row.decisionAt,
      row.automationProcessing,
      contract.classifierInventory.inventoryId,
      row.evaluation.systemId,
      row.evaluation.systemVersion,
      row.evaluation.machineClass,
      row.evaluation.publicDesignation,
      canonicalizeRfc8785(row),
      row.projectionHash,
    ],
  );
  await insertBatches(
    client,
    bundle.noticeProjections,
    13,
    tuples =>
      `INSERT INTO tokenless_dsa_part8_count_notice_projections
     (workspace_id,contract_id,notice_id,fact_version,source_notice_binding,source_fact_hash,received_at,
      processing_status,automation_processing,notifier_class,coverage_gap,projection_json,projection_hash) VALUES ${tuples}`,
    row => [
      contract.workspaceId,
      contract.contractId,
      row.sourceFact.noticeId,
      row.sourceFact.factVersion,
      row.sourceFact.sourceNoticeBinding,
      row.sourceFact.factHash,
      row.sourceFact.receivedAt,
      row.sourceFact.processingStatus,
      row.sourceFact.automationProcessing,
      row.sourceFact.notifierClass,
      row.coverageGap,
      canonicalizeRfc8785(row),
      row.projectionHash,
    ],
  );
  await client.query(
    `INSERT INTO tokenless_dsa_part8_count_results
     (workspace_id,contract_id,schema_version,contract_digest,decision_projection_root,measure_projection_root,
      evaluation_projection_root,notice_projection_root,expected_cell_count,cell_root,
      partially_automated_decision_count,
      partially_automated_measure_count,partially_automated_notice_count,incomplete_notice_count,
      publication_eligible,engine_result_json,engine_result_digest,result_json,result_digest,created_at)
     VALUES (${Array.from({ length: 20 }, (_, index) => `$${index + 1}`).join(",")})`,
    [
      contract.workspaceId,
      contract.contractId,
      result.schemaVersion,
      contract.contractDigest,
      contract.decisionProjectionRoot,
      contract.measureProjectionRoot,
      contract.evaluationProjectionRoot,
      contract.noticeProjectionRoot,
      result.expectedCellCount,
      result.cellRoot,
      result.partiallyAutomatedDecisionCount,
      result.partiallyAutomatedMeasureCount,
      result.partiallyAutomatedNoticeCount,
      result.incompleteNoticeCount,
      false,
      canonicalizeRfc8785(result.engineResult),
      result.engineResult.resultDigest,
      canonicalizeRfc8785(result),
      result.resultDigest,
      new Date(contract.witness.committedAt),
    ],
  );
  await insertBatches(
    client,
    bundle.countCells,
    12,
    tuples =>
      `INSERT INTO tokenless_dsa_part8_count_cells
     (workspace_id,contract_id,result_digest,indicator,scope,result_kind,count_value,gap_code,
      affected_notice_count,publication_eligible,cell_json,cell_hash) VALUES ${tuples}`,
    cell => [
      contract.workspaceId,
      contract.contractId,
      result.resultDigest,
      cell.indicator,
      cell.scope,
      cell.result.status,
      cell.result.status === "count" ? cell.result.value : null,
      cell.result.status === "coverage_gap" ? cell.result.code : null,
      cell.result.status === "coverage_gap" ? cell.result.affectedNoticeCount : null,
      false,
      canonicalizeRfc8785(cell),
      cell.cellHash,
    ],
  );
}

async function loadStoredBundle(client: PoolClient, workspaceId: string, contractId: string) {
  const rows = await client.query(
    `SELECT contract_json,contract_digest FROM tokenless_dsa_part8_count_contracts
     WHERE workspace_id=$1 AND contract_id=$2`,
    [workspaceId, contractId],
  );
  const resultRows = await client.query(
    `SELECT result_json,result_digest FROM tokenless_dsa_part8_count_results
     WHERE workspace_id=$1 AND contract_id=$2`,
    [workspaceId, contractId],
  );
  if (rows.rowCount !== 1 || resultRows.rowCount !== 1) storedInvalid();
  const projections = await Promise.all([
    client.query(
      `SELECT projection_json,projection_hash FROM tokenless_dsa_part8_count_decision_projections WHERE workspace_id=$1 AND contract_id=$2 ORDER BY source_decision_binding`,
      [workspaceId, contractId],
    ),
    client.query(
      `SELECT projection_json,projection_hash FROM tokenless_dsa_part8_count_measure_projections WHERE workspace_id=$1 AND contract_id=$2 ORDER BY source_decision_binding`,
      [workspaceId, contractId],
    ),
    client.query(
      `SELECT projection_json,projection_hash FROM tokenless_dsa_part8_count_evaluation_projections WHERE workspace_id=$1 AND contract_id=$2 ORDER BY source_evaluation_binding`,
      [workspaceId, contractId],
    ),
    client.query(
      `SELECT projection_json,projection_hash FROM tokenless_dsa_part8_count_notice_projections WHERE workspace_id=$1 AND contract_id=$2 ORDER BY notice_id`,
      [workspaceId, contractId],
    ),
    client.query(
      `SELECT cell_json,cell_hash FROM tokenless_dsa_part8_count_cells WHERE workspace_id=$1 AND contract_id=$2 ORDER BY indicator,scope`,
      [workspaceId, contractId],
    ),
  ]);
  const parseRows = <T extends Record<string, unknown>>(result: { rows: Row[] }) =>
    result.rows.map(row =>
      embeddedDigestJson<T>(text(row, "projection_json"), text(row, "projection_hash"), "projectionHash"),
    );
  return verifyWitnessedDsaPart8CountBundle({
    contract: embeddedDigestJson<WitnessedDsaPart8CountContract & Record<string, unknown>>(
      text(rows.rows[0] as Row, "contract_json"),
      text(rows.rows[0] as Row, "contract_digest"),
      "contractDigest",
    ),
    result: embeddedDigestJson<WitnessedDsaPart8CountResult & Record<string, unknown>>(
      text(resultRows.rows[0] as Row, "result_json"),
      text(resultRows.rows[0] as Row, "result_digest"),
      "resultDigest",
    ),
    decisionProjections: parseRows<DsaPart8DecisionProjection>(projections[0]),
    measureProjections: parseRows<DsaPart8MeasureProjection>(projections[1]),
    evaluationProjections: parseRows<DsaPart8EvaluationProjection>(projections[2]),
    noticeProjections: parseRows<DsaPart8NoticeProjection>(projections[3]),
    countCells: projections[4].rows.map(row =>
      embeddedDigestJson<PersistedDsaPart8CountCell & Record<string, unknown>>(
        text(row as Row, "cell_json"),
        text(row as Row, "cell_hash"),
        "cellHash",
      ),
    ),
  });
}

export async function freezeWitnessedDsaPart8CountContract(
  input: Readonly<{
    accountAddress: string;
    workspaceId: string;
    populationId: string;
    populationVersion: number;
    serviceId: string;
    providerType: ProviderType;
    inventoryId: string;
  }>,
) {
  if (
    !SIMPLE_IDENTIFIER.test(input.workspaceId) ||
    !SIMPLE_IDENTIFIER.test(input.populationId) ||
    !IDENTIFIER.test(input.serviceId)
  ) {
    invalid("Count scope is invalid.");
  }
  const populationVersion = positiveInteger(input.populationVersion, "populationVersion");
  if (!DSA_PART8_PROVIDER_TYPES.includes(input.providerType)) invalid("providerType is invalid.", "providerType");
  const contractId = `dsa8c_${sha256Rfc8785({ workspaceId: input.workspaceId, populationId: input.populationId, populationVersion, serviceId: input.serviceId }).slice(7, 47)}`;
  return inRepeatableRead(async client => {
    const sourceFrozenAt = await dsaEvidenceTransactionTimestamp(client);
    const actor = await requireManager(client, input.accountAddress, input.workspaceId);
    const existing = await client.query(
      `SELECT contract_id FROM tokenless_dsa_part8_count_contracts
       WHERE workspace_id=$1 AND population_id=$2 AND population_version=$3 AND service_id=$4 FOR UPDATE`,
      [input.workspaceId, input.populationId, populationVersion, input.serviceId],
    );
    if (existing.rowCount === 1) {
      if (text(existing.rows[0] as Row, "contract_id") !== contractId) storedInvalid();
      return { bundle: await loadStoredBundle(client, input.workspaceId, contractId), idempotent: true };
    }
    const populationResult = await client.query(
      `SELECT population.frozen_root,population.frozen_at,population.period_start,population.period_end,
              population.frozen_reconciliation_version,reconciliation.reconciliation_hash
       FROM tokenless_dsa_population_versions population
       JOIN tokenless_dsa_population_reconciliation_versions reconciliation
         ON reconciliation.workspace_id=population.workspace_id AND reconciliation.population_id=population.population_id
        AND reconciliation.population_version=population.version
        AND reconciliation.reconciliation_version=population.frozen_reconciliation_version
       WHERE population.workspace_id=$1 AND population.population_id=$2 AND population.version=$3
         AND population.status='frozen' AND reconciliation.status='reconciled' FOR SHARE`,
      [input.workspaceId, input.populationId, populationVersion],
    );
    if (populationResult.rowCount !== 1)
      throw new TokenlessServiceError("Frozen population not found.", 404, "dsa_frozen_population_not_found");
    const populationRow = populationResult.rows[0] as Row;
    const populationFrozenAt = canonicalDate(populationRow.frozen_at, "population.frozenAt");
    const periodStart = canonicalDate(populationRow.period_start, "population.periodStart");
    const periodEnd = canonicalDate(populationRow.period_end, "population.periodEnd");
    const populationRoot = text(populationRow, "frozen_root");
    const reconciliationHash = text(populationRow, "reconciliation_hash");
    if (!SHA256.test(populationRoot ?? "") || !SHA256.test(reconciliationHash ?? "")) storedInvalid();
    const inventoryResult = await client.query(
      `SELECT inventory_json,inventory_digest,inventory_root,frozen_at,source_frozen_at
       FROM tokenless_dsa_classifier_inventories
       WHERE workspace_id=$1 AND inventory_id=$2 AND population_id=$3 AND population_version=$4 AND service_id=$5
       FOR SHARE`,
      [input.workspaceId, input.inventoryId, input.populationId, populationVersion, input.serviceId],
    );
    if (inventoryResult.rowCount !== 1)
      throw new TokenlessServiceError(
        "Frozen classifier inventory not found.",
        404,
        "dsa_classifier_inventory_not_found",
      );
    const inventoryRow = inventoryResult.rows[0] as Row;
    const inventory = parseInventory(text(inventoryRow, "inventory_json"), text(inventoryRow, "inventory_digest"));
    if (
      populationFrozenAt > sourceFrozenAt ||
      periodEnd > sourceFrozenAt ||
      canonicalDate(inventoryRow.frozen_at, "inventory.frozenAt") > sourceFrozenAt ||
      canonicalDate(inventoryRow.source_frozen_at, "inventory.sourceFrozenAt") > sourceFrozenAt ||
      inventory.inventoryRoot !== text(inventoryRow, "inventory_root")
    ) {
      throw new TokenlessServiceError(
        "Count sources are not completely frozen.",
        409,
        "dsa_part8_count_sources_not_frozen",
      );
    }
    const decisionRows = await client.query(
      `SELECT engagement.provider_decision_id,engagement.decision_version,engagement.engagement_id,
              engagement.engagement_version,source_decision.source_decision_hash,source_decision.decision_at,
              source_engagement.engagement_hash,fact.fact_json,fact.fact_hash
       FROM tokenless_dsa_engagement_versions engagement
       JOIN tokenless_dsa_source_decision_versions source_decision
         ON source_decision.workspace_id=engagement.workspace_id
        AND source_decision.provider_decision_id=engagement.provider_decision_id
        AND source_decision.decision_version=engagement.decision_version
       JOIN tokenless_dsa_source_engagement_versions source_engagement
         ON source_engagement.workspace_id=engagement.workspace_id
        AND source_engagement.engagement_id=engagement.engagement_id
        AND source_engagement.engagement_version=engagement.engagement_version
       LEFT JOIN tokenless_dsa_content_moderation_decision_facts fact
         ON fact.workspace_id=engagement.workspace_id
        AND fact.provider_decision_id=engagement.provider_decision_id AND fact.decision_version=engagement.decision_version
        AND fact.created_at <= $5
       WHERE engagement.workspace_id=$1 AND engagement.population_id=$2 AND engagement.population_version=$3
         AND source_engagement.engagement_json::jsonb ->> 'service'=$4
         AND source_engagement.created_at <= $5 AND source_decision.created_at <= $5
       ORDER BY encode(convert_to(engagement.provider_decision_id,'UTF8'),'hex'),engagement.decision_version`,
      [input.workspaceId, input.populationId, populationVersion, input.serviceId, sourceFrozenAt],
    );
    const decisions = (decisionRows.rows as Row[]).map(row => {
      const factJson = text(row, "fact_json");
      const factHash = text(row, "fact_hash");
      if (!factJson || !SHA256.test(factHash ?? ""))
        throw new TokenlessServiceError(
          "A census decision lacks immutable Part 8 facts.",
          409,
          "dsa_part8_count_fact_missing",
        );
      const parsed = canonicalStoredJson(factJson, factHash) as NormalizedDecision;
      const { schemaVersion, ...raw } = parsed;
      if (schemaVersion !== DSA_PART8_DECISION_FACT_SCHEMA_VERSION) storedInvalid();
      const normalized = normalizeDsaPart8DecisionFact(raw);
      if (canonicalizeRfc8785(normalized) !== factJson) storedInvalid();
      return {
        providerDecisionId: text(row, "provider_decision_id")!,
        decisionVersion: Number(row.decision_version),
        engagementId: text(row, "engagement_id")!,
        engagementVersion: Number(row.engagement_version),
        sourceDecisionHash: text(row, "source_decision_hash") as `sha256:${string}`,
        engagementHash: text(row, "engagement_hash") as `sha256:${string}`,
        decisionAt: canonicalDate(row.decision_at, "decisionAt").toISOString(),
        part8Fact: normalized,
        part8FactHash: factHash as `sha256:${string}`,
      };
    });
    const evaluationRows = await client.query(
      `SELECT evaluation.provider_decision_id,evaluation.decision_version,evaluation.evaluation_json,
              evaluation.evaluation_hash
       FROM tokenless_dsa_engagement_versions engagement
       JOIN tokenless_dsa_source_engagement_versions source_engagement
         ON source_engagement.workspace_id=engagement.workspace_id
        AND source_engagement.engagement_id=engagement.engagement_id
        AND source_engagement.engagement_version=engagement.engagement_version
       JOIN tokenless_dsa_automated_means_evaluations evaluation
         ON evaluation.workspace_id=engagement.workspace_id
        AND evaluation.provider_decision_id=engagement.provider_decision_id
        AND evaluation.decision_version=engagement.decision_version
       WHERE engagement.workspace_id=$1 AND engagement.population_id=$2 AND engagement.population_version=$3
         AND source_engagement.engagement_json::jsonb ->> 'service'=$4
         AND source_engagement.created_at <= $5 AND evaluation.created_at <= $5
       ORDER BY encode(convert_to(evaluation.evaluation_id,'UTF8'),'hex')`,
      [input.workspaceId, input.populationId, populationVersion, input.serviceId, sourceFrozenAt],
    );
    const evaluations = (evaluationRows.rows as Row[]).map(row => {
      const rawJson = text(row, "evaluation_json");
      const hash = text(row, "evaluation_hash");
      const parsed = canonicalStoredJson(rawJson, hash) as NormalizedEvaluation;
      const { schemaVersion, ...raw } = parsed;
      if (schemaVersion !== DSA_PART8_AUTOMATED_MEANS_EVALUATION_SCHEMA_VERSION) storedInvalid();
      const normalized = normalizeDsaPart8AutomatedMeansEvaluation(raw);
      if (canonicalizeRfc8785(normalized) !== rawJson) storedInvalid();
      return {
        providerDecisionId: text(row, "provider_decision_id")!,
        decisionVersion: Number(row.decision_version),
        sourceEvaluationHash: hash as `sha256:${string}`,
        evaluation: normalized,
      };
    });
    const noticeRows = await client.query(
      `SELECT DISTINCT ON (notice_id) fact_json,fact_hash
       FROM tokenless_dsa_notice_processing_fact_versions
       WHERE workspace_id=$1 AND service_id=$2 AND received_at >= $3 AND received_at < $4 AND created_at <= $5
       ORDER BY notice_id,fact_version DESC`,
      [input.workspaceId, input.serviceId, periodStart, periodEnd, sourceFrozenAt],
    );
    const notices = (noticeRows.rows as Row[]).map(row => {
      const factHash = text(row, "fact_hash");
      const payload = canonicalStoredJson(text(row, "fact_json"), factHash) as Omit<
        ImmutableDsaPart8NoticeProcessingFact,
        "factHash"
      >;
      if (payload.schemaVersion !== DSA_PART8_NOTICE_PROCESSING_FACT_SCHEMA_VERSION) storedInvalid();
      return { ...payload, factHash: factHash as `sha256:${string}` };
    });
    const committedAt = await dsaEvidenceCommitTimestamp(client);
    if (committedAt < sourceFrozenAt || committedAt < populationFrozenAt || committedAt < periodEnd) {
      throw new TokenlessServiceError(
        "The commitment clock predates its complete census projection.",
        409,
        "dsa_part8_count_sources_not_frozen",
      );
    }
    const bundle = await commitCountPersistenceFacade({
      client,
      actor,
      sourceFrozenAt,
      committedAt,
      auditInput: {
        workspaceId: input.workspaceId,
        actorKind: "account",
        actorReference: actor,
        assuranceMethod: "workspace_manager_session",
        action: "dsa_part8_count_contract_committed",
        targetKind: "dsa_part8_count_contract",
        targetId: contractId,
        purpose: "dsa_part8_reporting",
        reason: "Commit an immutable witnessed DSA Part 8 census count contract.",
        result: "success",
        occurredAt: committedAt,
        idempotencyKey: `dsa-part8-count:${contractId}`,
        metadata: {
          populationId: input.populationId,
          populationVersion,
          serviceId: input.serviceId,
          inventoryId: input.inventoryId,
          sourceFrozenAt: sourceFrozenAt.toISOString(),
        },
      },
      buildBundle: witness =>
        buildWitnessedDsaPart8CountBundle({
          workspaceId: input.workspaceId,
          contractId,
          serviceId: input.serviceId,
          providerType: input.providerType,
          reportingPeriod: { startInclusive: periodStart.toISOString(), endExclusive: periodEnd.toISOString() },
          population: {
            populationId: input.populationId,
            populationVersion,
            populationRoot: populationRoot as `sha256:${string}`,
            populationFrozenAt: populationFrozenAt.toISOString(),
            reconciliationVersion: Number(populationRow.frozen_reconciliation_version),
            reconciliationHash: reconciliationHash as `sha256:${string}`,
          },
          classifierInventory: inventory,
          witness,
          decisions,
          evaluations,
          notices,
        }),
    });
    return { bundle, idempotent: false };
  });
}

export async function loadWitnessedDsaPart8CountContract(
  input: Readonly<{
    accountAddress: string;
    workspaceId: string;
    contractId: string;
  }>,
) {
  return inRepeatableRead(async client => {
    await requireManager(client, input.accountAddress, input.workspaceId);
    return loadStoredBundle(client, input.workspaceId, input.contractId);
  });
}

export const __testUtils = {
  commitCountPersistenceFacade,
  projectionRoot,
  runRepeatableRead,
  sourceDecisionBinding,
};
