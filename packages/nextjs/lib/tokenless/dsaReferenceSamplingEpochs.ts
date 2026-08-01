import { PINNED_DRAND_CHAINS } from "@rateloop/node-utils/drand";
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
  DSA_PART8_AUTOMATED_MEANS_EVALUATION_SCHEMA_VERSION,
  DSA_PART8_DECISION_FACT_SCHEMA_VERSION,
  DSA_PART8_NOT_AUTOMATED,
  type DsaPart8AutomatedMeansEvaluationInput,
  type DsaPart8DecisionFactInput,
  normalizeDsaPart8AutomatedMeansEvaluation,
  normalizeDsaPart8AutomatedMeansEvaluationSet,
  normalizeDsaPart8DecisionFact,
} from "~~/lib/tokenless/dsaPart8SourceFacts";
import {
  type FrozenReferenceSample,
  REFERENCE_FRAME_SCHEMA_VERSION,
  REFERENCE_SAMPLE_SCHEMA_VERSION,
  REFERENCE_SAMPLING_METHOD_VERSION,
  type ReferenceFrameCommitment,
  type ReferenceFrameUnit,
  type ReferenceSystemSampleSizePlan,
  createReferenceFrameCommitment,
  deriveReferenceSystemIdentity,
  freezeReferenceSample,
  verifyFrozenReferenceSample,
} from "~~/lib/tokenless/referenceSampling";
import type { TokenlessReferenceSampleBeacon } from "~~/lib/tokenless/referenceSamplingBeacon";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const TRANSITION_SCHEMA_VERSION = "rateloop.reference-sampling-transition.v1" as const;
const DECISION_PROJECTION_SCHEMA_VERSION = "rateloop.reference-frame-decision-projection.v2" as const;
const EVALUATION_PROJECTION_SCHEMA_VERSION = "rateloop.reference-frame-evaluation-projection.v1" as const;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const SIMPLE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u;
const LOWER_IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_KEYS = [
  "accountAddress",
  "activationReference",
  "beaconNetwork",
  "beaconRound",
  "benchmarkId",
  "deploymentKey",
  "populationId",
  "populationVersion",
  "projectId",
  "purpose",
  "sampleSizePlanId",
  "sampleSizePlanVersion",
  "sampleSizes",
  "workspaceId",
] as const;
const SAMPLE_SIZE_KEYS = ["automatedFail", "automatedPass", "systemId", "systemVersion"] as const;
const FREEZE_KEYS = ["accountAddress", "beacon", "epochId", "workspaceId"] as const;
const LOAD_KEYS = ["accountAddress", "epochId", "workspaceId"] as const;

type Row = Record<string, unknown>;
type CommitInput = {
  accountAddress: string;
  workspaceId: string;
  projectId: string;
  benchmarkId: string;
  activationReference: string;
  deploymentKey: string;
  populationId: string;
  populationVersion: number;
  purpose: string;
  sampleSizePlanId: string;
  sampleSizePlanVersion: number;
  sampleSizes: readonly ReferenceSystemSampleSizePlan[];
  beaconNetwork: "quicknet" | "quicknet-t";
  beaconRound: number;
};

type DecisionProjection = {
  populationId: string;
  populationVersion: number;
  providerDecisionId: string;
  decisionVersion: number;
  engagementId: string;
  engagementVersion: number;
  sourceDecisionBinding: `sha256:${string}`;
  sourceDecisionHash: `sha256:${string}`;
  engagementHash: `sha256:${string}`;
  measureTaken: boolean;
  moderationMeasureId: string | null;
  part8FactJson: string;
  part8FactHash: `sha256:${string}`;
  origin: "authority_order" | "article16_notice" | "own_initiative";
  article16NoticeId: string | null;
  notifierClass: "trusted_flagger" | "other" | null;
  decisionAt: string;
  sourceEligibilityStatus: "eligible" | "excluded";
  sourceExclusionReason: string | null;
  automationProcessing: DsaPart8DecisionFactInput["automationProcessing"];
  expectedEvaluationCount: number;
  evaluationSetRoot: `sha256:${string}`;
  languageCodesJson: string;
  noLanguageReason: "no_linguistic_content" | "language_undetermined" | "not_applicable" | null;
  disposition: "evaluated" | "not_automated" | "excluded";
  projectionJson: string;
  projectionHash: `sha256:${string}`;
};

type EvaluationProjection = {
  populationId: string;
  populationVersion: number;
  providerDecisionId: string;
  decisionVersion: number;
  evaluationId: string;
  unitId: string | null;
  sourceDecisionBinding: `sha256:${string}`;
  sourceEvaluationBinding: `sha256:${string}`;
  sourceEvaluationHash: `sha256:${string}`;
  evaluationJson: string;
  evaluationHash: `sha256:${string}`;
  decisionAt: string;
  sourceEligibilityStatus: "eligible" | "excluded";
  sourceExclusionReason: string | null;
  automationProcessing: "solely_automated" | "partially_automated";
  systemIdentity: `sha256:${string}`;
  systemId: string;
  systemVersion: string;
  machineClass: DsaPart8AutomatedMeansEvaluationInput["machineClass"];
  publicDesignation: string;
  automatedOutcome: "pass" | "fail";
  disposition: "eligible_draw" | "excluded";
  referenceLabelState: "unlabeled";
  projectionJson: string;
  projectionHash: `sha256:${string}`;
};

function invalid(message: string, field?: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_dsa_reference_sampling_epoch", false, field);
}

function portableCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value: unknown, expected: readonly string[], field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${field} must be a typed object.`, field);
  const keys = Object.keys(value as Record<string, unknown>).sort(portableCompare);
  const expectedKeys = [...expected].sort(portableCompare);
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    invalid(`${field} contains missing or unsupported fields.`, field);
  }
}

function positiveInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalid(`${field} must be a positive integer.`, field);
  return Number(value);
}

function text(row: Row | undefined, field: string) {
  const value = row?.[field];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row | undefined, field: string, minimum = 0) {
  const value = Number(row?.[field]);
  if (!Number.isSafeInteger(value) || value < minimum) storedInvalid();
  return value;
}

function storedInvalid(): never {
  throw new TokenlessServiceError(
    "Stored DSA reference-sampling evidence is invalid.",
    500,
    "stored_dsa_reference_sampling_invalid",
  );
}

function normalizedActor(value: string) {
  try {
    return normalizeAccountSubject(value);
  } catch {
    throw new TokenlessServiceError("A valid signed-in account is required.", 401, "invalid_account");
  }
}

function canonicalStoredJson(value: string | null, expectedHash?: string | null) {
  try {
    if (value === null) throw new Error();
    const parsed = JSON.parse(value) as unknown;
    if (canonicalizeRfc8785(parsed) !== value || (expectedHash && sha256Rfc8785(parsed) !== expectedHash)) {
      throw new Error();
    }
    return parsed;
  } catch {
    storedInvalid();
  }
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) storedInvalid();
  return value as Row;
}

function canonicalDate(value: unknown) {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) storedInvalid();
  return parsed;
}

function deterministicHexId(prefix: string, value: unknown) {
  return `${prefix}_${sha256Rfc8785(value).slice("sha256:".length, "sha256:".length + 40)}`;
}

function unitId(value: unknown) {
  return `rsu_${createHash("sha256").update(canonicalizeRfc8785(value)).digest("base64url").slice(0, 22)}`;
}

function roundAvailableAt(network: "quicknet" | "quicknet-t", round: number) {
  const normalizedRound = positiveInteger(round, "beaconRound");
  const chain = PINNED_DRAND_CHAINS[network];
  const milliseconds = (BigInt(chain.genesisTime) + (BigInt(normalizedRound) - 1n) * BigInt(chain.period)) * 1_000n;
  if (milliseconds > BigInt(8_640_000_000_000_000)) invalid("beaconRound is outside the supported date range.");
  return new Date(Number(milliseconds));
}

async function requireManagerAndProject(
  client: PoolClient,
  accountAddress: string,
  workspaceId: string,
  projectId?: string,
) {
  const actor = normalizedActor(accountAddress);
  const access = await client.query(
    `SELECT m.role FROM tokenless_workspace_members m
     JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id AND w.status='active'
     WHERE m.workspace_id=$1 AND m.account_address=$2 AND m.role IN ('owner','admin') LIMIT 1`,
    [workspaceId, actor],
  );
  if (access.rowCount !== 1) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  if (projectId) {
    const project = await client.query(
      `SELECT 1 FROM tokenless_assurance_projects
       WHERE workspace_id=$1 AND project_id=$2 AND status='active' LIMIT 1`,
      [workspaceId, projectId],
    );
    if (project.rowCount !== 1) {
      throw new TokenlessServiceError("Assurance project not found.", 404, "assurance_project_not_found");
    }
  }
  return actor;
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(
      `SELECT set_config('lock_timeout','2s',true),
              set_config('statement_timeout','30s',true),
              set_config('idle_in_transaction_session_timeout','30s',true)`,
    );
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function normalizeCommitInput(input: CommitInput) {
  exactKeys(input, COMMIT_KEYS, "epoch");
  if (!Array.isArray(input.sampleSizes) || input.sampleSizes.length === 0) {
    invalid("At least one system sample-size plan is required.", "sampleSizes");
  }
  if (
    !SIMPLE_IDENTIFIER.test(input.workspaceId) ||
    !IDENTIFIER.test(input.projectId) ||
    !IDENTIFIER.test(input.benchmarkId) ||
    !IDENTIFIER.test(input.activationReference) ||
    !IDENTIFIER.test(input.deploymentKey) ||
    !SIMPLE_IDENTIFIER.test(input.populationId) ||
    !LOWER_IDENTIFIER.test(input.purpose) ||
    !IDENTIFIER.test(input.sampleSizePlanId) ||
    (input.beaconNetwork !== "quicknet" && input.beaconNetwork !== "quicknet-t")
  ) {
    invalid("Reference-sampling context is invalid.");
  }
  const populationVersion = positiveInteger(input.populationVersion, "populationVersion");
  const sampleSizePlanVersion = positiveInteger(input.sampleSizePlanVersion, "sampleSizePlanVersion");
  const beaconRound = positiveInteger(input.beaconRound, "beaconRound");
  const sampleSizes = input.sampleSizes.map(plan => {
    exactKeys(plan, SAMPLE_SIZE_KEYS, "sampleSizes");
    if (
      !IDENTIFIER.test(plan.systemId) ||
      !IDENTIFIER.test(plan.systemVersion) ||
      !Number.isSafeInteger(plan.automatedFail) ||
      plan.automatedFail < 0 ||
      !Number.isSafeInteger(plan.automatedPass) ||
      plan.automatedPass < 0
    ) {
      invalid("System sample-size plan is invalid.", "sampleSizes");
    }
    return { ...plan };
  });
  sampleSizes.sort((left, right) =>
    portableCompare(deriveReferenceSystemIdentity(left), deriveReferenceSystemIdentity(right)),
  );
  if (new Set(sampleSizes.map(deriveReferenceSystemIdentity)).size !== sampleSizes.length) {
    invalid("A system sample-size plan may appear only once.", "sampleSizes");
  }
  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    benchmarkId: input.benchmarkId,
    activationReference: input.activationReference,
    deploymentKey: input.deploymentKey,
    contextAuthority: "workspace_manager_asserted_context" as const,
    populationId: input.populationId,
    populationVersion,
    purpose: input.purpose,
    sampleSizePlanId: input.sampleSizePlanId,
    sampleSizePlanVersion,
    sampleSizes,
    beaconNetwork: input.beaconNetwork,
    beaconRound,
  } as const;
}

function validatePart8Fact(row: Row) {
  const raw = text(row, "fact_json");
  const parsed = asRecord(canonicalStoredJson(raw, text(row, "fact_hash")));
  const { schemaVersion, ...input } = parsed;
  if (schemaVersion !== DSA_PART8_DECISION_FACT_SCHEMA_VERSION) storedInvalid();
  let normalized;
  try {
    normalized = normalizeDsaPart8DecisionFact(input as DsaPart8DecisionFactInput);
  } catch {
    storedInvalid();
  }
  if (
    canonicalizeRfc8785(normalized) !== raw ||
    normalized.measureTaken !== Boolean(row.measure_taken) ||
    normalized.moderationMeasureId !== text(row, "moderation_measure_id") ||
    normalized.origin !== text(row, "origin") ||
    normalized.article16NoticeId !== text(row, "article16_notice_id") ||
    normalized.notifierClass !== text(row, "notifier_class") ||
    normalized.automationProcessing !== text(row, "automation_processing") ||
    normalized.expectedEvaluationCount !== integer(row, "expected_evaluation_count", 0) ||
    normalized.evaluationSetRoot !== text(row, "evaluation_set_root") ||
    canonicalizeRfc8785(normalized.languageAttribution.languageCodes) !== text(row, "language_codes_json") ||
    normalized.languageAttribution.noLanguageReason !== text(row, "no_language_reason")
  ) {
    storedInvalid();
  }
  return normalized;
}

function validateEvaluationFact(row: Row) {
  const raw = text(row, "evaluation_json");
  const hash = text(row, "evaluation_hash");
  const parsed = asRecord(canonicalStoredJson(raw, hash));
  const { schemaVersion, ...input } = parsed;
  if (schemaVersion !== DSA_PART8_AUTOMATED_MEANS_EVALUATION_SCHEMA_VERSION) storedInvalid();
  let normalized;
  try {
    normalized = normalizeDsaPart8AutomatedMeansEvaluation(input as DsaPart8AutomatedMeansEvaluationInput);
  } catch {
    storedInvalid();
  }
  if (
    canonicalizeRfc8785(normalized) !== raw ||
    normalized.evaluationId !== text(row, "evaluation_id") ||
    normalized.systemId !== text(row, "system_id") ||
    normalized.systemVersion !== text(row, "system_version") ||
    normalized.machineClass !== text(row, "machine_class") ||
    normalized.publicDesignation !== text(row, "public_designation") ||
    normalized.automatedOutcome !== text(row, "automated_outcome")
  ) {
    storedInvalid();
  }
  return normalized;
}

function deriveDecisionProjection(
  row: Row,
  context: { workspaceId: string; populationId: string; populationVersion: number },
) {
  const providerDecisionId = text(row, "provider_decision_id");
  const decisionVersion = integer(row, "decision_version", 1);
  const engagementId = text(row, "engagement_id");
  const engagementVersion = integer(row, "engagement_version", 1);
  const sourceDecisionHash = text(row, "source_decision_hash");
  const engagementHash = text(row, "engagement_hash");
  const part8FactHash = text(row, "fact_hash");
  if (
    !providerDecisionId ||
    !engagementId ||
    !SHA256.test(sourceDecisionHash ?? "") ||
    !SHA256.test(engagementHash ?? "") ||
    !SHA256.test(part8FactHash ?? "")
  ) {
    storedInvalid();
  }
  const source = asRecord(canonicalStoredJson(text(row, "source_decision_json"), sourceDecisionHash));
  const engagement = asRecord(canonicalStoredJson(text(row, "engagement_json"), engagementHash));
  const fact = validatePart8Fact(row);
  const part8FactJson = text(row, "fact_json")!;
  const decisionAt = canonicalDate(row.decision_at).toISOString();
  if (
    source.providerDecisionId !== providerDecisionId ||
    Number(source.decisionVersion) !== decisionVersion ||
    source.decisionAt !== decisionAt ||
    engagement.engagementId !== engagementId ||
    Number(engagement.engagementVersion) !== engagementVersion ||
    (engagement.eligibilityStatus !== "eligible" && engagement.eligibilityStatus !== "excluded") ||
    fact.measureTaken !== Boolean(row.measure_taken) ||
    fact.moderationMeasureId !== text(row, "moderation_measure_id")
  ) {
    storedInvalid();
  }
  const sourceEligibilityStatus = engagement.eligibilityStatus;
  const sourceExclusionReason = engagement.exclusionReason === null ? null : String(engagement.exclusionReason);
  if (
    (sourceEligibilityStatus === "eligible" && sourceExclusionReason !== null) ||
    (sourceEligibilityStatus === "excluded" && !/^[a-z][a-z0-9_]{2,79}$/u.test(sourceExclusionReason ?? ""))
  ) {
    storedInvalid();
  }
  const sourceDecisionBinding = sha256Rfc8785({
    workspaceId: context.workspaceId,
    populationId: context.populationId,
    populationVersion: context.populationVersion,
    providerDecisionId,
    decisionVersion,
    sourceDecisionHash,
    engagementHash,
    measureTaken: fact.measureTaken,
    moderationMeasureId: fact.moderationMeasureId,
    part8Fact: fact,
    part8FactHash,
    origin: fact.origin,
    article16NoticeId: fact.article16NoticeId,
    notifierClass: fact.notifierClass,
  });
  const disposition: DecisionProjection["disposition"] =
    sourceEligibilityStatus === "excluded"
      ? "excluded"
      : fact.automationProcessing === DSA_PART8_NOT_AUTOMATED
        ? "not_automated"
        : "evaluated";
  const payload = {
    schemaVersion: DECISION_PROJECTION_SCHEMA_VERSION,
    populationId: context.populationId,
    populationVersion: context.populationVersion,
    providerDecisionId,
    decisionVersion,
    engagementId,
    engagementVersion,
    sourceDecisionBinding,
    sourceDecisionHash,
    engagementHash,
    measureTaken: fact.measureTaken,
    moderationMeasureId: fact.moderationMeasureId,
    part8Fact: fact,
    part8FactHash,
    origin: fact.origin,
    article16NoticeId: fact.article16NoticeId,
    notifierClass: fact.notifierClass,
    decisionAt,
    sourceEligibilityStatus,
    sourceExclusionReason,
    automationProcessing: fact.automationProcessing,
    expectedEvaluationCount: fact.expectedEvaluationCount,
    evaluationSetRoot: fact.evaluationSetRoot,
    languageAttribution: fact.languageAttribution,
    disposition,
  };
  return {
    ...payload,
    part8FactJson,
    languageCodesJson: canonicalizeRfc8785(fact.languageAttribution.languageCodes),
    noLanguageReason: fact.languageAttribution.noLanguageReason,
    projectionJson: canonicalizeRfc8785(payload),
    projectionHash: sha256Rfc8785(payload),
  } as DecisionProjection;
}

function deriveEvaluationProjection(row: Row, decision: DecisionProjection) {
  const evaluation = validateEvaluationFact(row);
  const sourceEvaluationHash = text(row, "evaluation_hash");
  if (!SHA256.test(sourceEvaluationHash ?? "")) storedInvalid();
  if (
    text(row, "provider_decision_id") !== decision.providerDecisionId ||
    integer(row, "decision_version", 1) !== decision.decisionVersion ||
    decision.automationProcessing === DSA_PART8_NOT_AUTOMATED
  ) {
    storedInvalid();
  }
  const sourceEvaluationBinding = sha256Rfc8785({
    sourceDecisionBinding: decision.sourceDecisionBinding,
    evaluation,
    sourceEvaluationHash,
  });
  const systemIdentity = deriveReferenceSystemIdentity(evaluation);
  const disposition: EvaluationProjection["disposition"] =
    decision.sourceEligibilityStatus === "eligible" ? "eligible_draw" : "excluded";
  const derivedUnitId = disposition === "eligible_draw" ? unitId({ sourceEvaluationBinding }) : null;
  const payload = {
    schemaVersion: EVALUATION_PROJECTION_SCHEMA_VERSION,
    populationId: decision.populationId,
    populationVersion: decision.populationVersion,
    providerDecisionId: decision.providerDecisionId,
    decisionVersion: decision.decisionVersion,
    evaluationId: evaluation.evaluationId,
    unitId: derivedUnitId,
    sourceDecisionBinding: decision.sourceDecisionBinding,
    sourceEvaluationBinding,
    sourceEvaluationHash,
    evaluation,
    decisionAt: decision.decisionAt,
    sourceEligibilityStatus: decision.sourceEligibilityStatus,
    sourceExclusionReason: decision.sourceExclusionReason,
    automationProcessing: decision.automationProcessing,
    systemIdentity,
    systemId: evaluation.systemId,
    systemVersion: evaluation.systemVersion,
    machineClass: evaluation.machineClass,
    publicDesignation: evaluation.publicDesignation,
    automatedOutcome: evaluation.automatedOutcome,
    disposition,
    referenceLabelState: "unlabeled" as const,
  };
  return {
    ...payload,
    evaluationJson: canonicalizeRfc8785(evaluation),
    evaluationHash: sourceEvaluationHash as `sha256:${string}`,
    projectionJson: canonicalizeRfc8785(payload),
    projectionHash: sha256Rfc8785(payload),
  } as EvaluationProjection;
}

function frameUnit(projection: EvaluationProjection): ReferenceFrameUnit | null {
  return projection.disposition === "eligible_draw"
    ? {
        unitId: projection.unitId!,
        sourceDecisionBinding: projection.sourceDecisionBinding,
        sourceEvaluationBinding: projection.sourceEvaluationBinding,
        sourceEvaluationHash: projection.sourceEvaluationHash,
        decidedAt: projection.decisionAt,
        automationProcessing: projection.automationProcessing,
        systemIdentity: projection.systemIdentity,
        systemId: projection.systemId,
        systemVersion: projection.systemVersion,
        machineClass: projection.machineClass,
        publicDesignation: projection.publicDesignation,
        automatedOutcome: projection.automatedOutcome,
        referenceLabelState: "unlabeled",
      }
    : null;
}

function parseCommitment(value: string | null, digest: string | null) {
  const parsed = asRecord(canonicalStoredJson(value));
  const { commitmentDigest, ...payload } = parsed;
  if (commitmentDigest !== digest || sha256Rfc8785(payload) !== digest) storedInvalid();
  return parsed as ReferenceFrameCommitment;
}

async function verifyStoredCommitment(client: PoolClient, epoch: Row, units: readonly ReferenceFrameUnit[]) {
  const expected = parseCommitment(text(epoch, "commitment_json"), text(epoch, "commitment_digest"));
  try {
    const eventResult = await client.query(
      `SELECT witness_id,audit_head_digest FROM tokenless_dsa_reference_sampling_events
       WHERE workspace_id=$1 AND epoch_id=$2 AND sequence=1 AND event_type='committed'`,
      [text(epoch, "workspace_id"), text(epoch, "epoch_id")],
    );
    const event = eventResult.rows[0] as Row | undefined;
    if (!event) storedInvalid();
    const storedRequest = asRecord(canonicalStoredJson(text(epoch, "request_json"), text(epoch, "request_hash")));
    if (!Array.isArray(storedRequest.sampleSizes)) storedInvalid();
    const request = {
      workspaceId: text(epoch, "workspace_id"),
      projectId: text(epoch, "project_id"),
      benchmarkId: text(epoch, "benchmark_id"),
      activationReference: text(epoch, "activation_reference"),
      deploymentKey: text(epoch, "deployment_key"),
      contextAuthority: text(epoch, "context_authority"),
      populationId: text(epoch, "population_id"),
      populationVersion: integer(epoch, "population_version", 1),
      purpose: text(epoch, "purpose"),
      sampleSizePlanId: text(epoch, "sample_size_plan_id"),
      sampleSizePlanVersion: integer(epoch, "sample_size_plan_version", 1),
      sampleSizes: storedRequest.sampleSizes as ReferenceSystemSampleSizePlan[],
      beaconNetwork: text(epoch, "beacon_network"),
      beaconRound: integer(epoch, "beacon_round", 1),
    };
    if (canonicalizeRfc8785(request) !== canonicalizeRfc8785(storedRequest)) {
      storedInvalid();
    }
    const recomputed = createReferenceFrameCommitment({
      frameId: text(epoch, "frame_id")!,
      purpose: text(epoch, "purpose")!,
      source: {
        workspaceId: text(epoch, "workspace_id")!,
        projectId: text(epoch, "project_id")!,
        benchmarkId: text(epoch, "benchmark_id")!,
        activationReference: text(epoch, "activation_reference")!,
        deploymentKey: text(epoch, "deployment_key")!,
        contextAuthority: text(epoch, "context_authority") as "workspace_manager_asserted_context",
        populationId: text(epoch, "population_id")!,
        populationVersion: integer(epoch, "population_version", 1),
        populationContractHash: text(epoch, "population_contract_hash") as `sha256:${string}`,
        populationRoot: text(epoch, "population_root") as `sha256:${string}`,
        populationFrozenAt: canonicalDate(epoch.population_frozen_at).toISOString(),
        reportingWindow: {
          startInclusive: canonicalDate(epoch.reporting_window_start).toISOString(),
          endExclusive: canonicalDate(epoch.reporting_window_end).toISOString(),
        },
        populationCount: integer(epoch, "population_count", 1),
        eligibleDrawUnitCount: integer(epoch, "eligible_draw_unit_count", 1),
        evaluatedDecisionCount: integer(epoch, "evaluated_decision_count", 0),
        notAutomatedDecisionCount: integer(epoch, "not_automated_decision_count", 0),
        excludedDecisionCount: integer(epoch, "excluded_decision_count", 0),
      },
      witness: {
        kind: "database_transaction_and_attestation",
        witnessId: text(event, "witness_id")!,
        sourceFrozenAt: canonicalDate(epoch.source_frozen_at).toISOString(),
        committedAt: canonicalDate(epoch.committed_at).toISOString(),
        auditHeadDigest: text(event, "audit_head_digest") as `sha256:${string}`,
      },
      units,
      sampleSizes: request.sampleSizes,
      sampleSizePlanId: request.sampleSizePlanId!,
      sampleSizePlanVersion: request.sampleSizePlanVersion,
      beaconNetwork: request.beaconNetwork as "quicknet" | "quicknet-t",
      beaconRound: request.beaconRound,
    });
    if (
      recomputed.frameRoot !== text(epoch, "frame_root") ||
      canonicalizeRfc8785(recomputed.strata) !==
        canonicalizeRfc8785(canonicalStoredJson(text(epoch, "strata_json"), text(epoch, "strata_hash"))) ||
      canonicalizeRfc8785(recomputed) !== canonicalizeRfc8785(expected)
    ) {
      storedInvalid();
    }
    return recomputed;
  } catch {
    storedInvalid();
  }
}

function parseSample(value: string | null, digest: string | null) {
  const parsed = canonicalStoredJson(value);
  if (!parsed || typeof parsed !== "object" || text(asRecord(parsed), "sampleDigest") !== digest) storedInvalid();
  return parsed as FrozenReferenceSample;
}

function verifyStoredSample(input: {
  expected: FrozenReferenceSample;
  commitment: ReferenceFrameCommitment;
  units: readonly ReferenceFrameUnit[];
  beacon: TokenlessReferenceSampleBeacon;
}) {
  try {
    return verifyFrozenReferenceSample({
      ...input,
      frozenWitness: input.expected.frozenWitness,
    });
  } catch {
    storedInvalid();
  }
}

async function loadEligibleUnits(client: PoolClient, workspaceId: string, epochId: string) {
  const result = await client.query(
    `SELECT unit_id,source_decision_binding,source_evaluation_binding,source_evaluation_hash,
            decision_at,automation_processing,system_identity,system_id,system_version,machine_class,
            public_designation,automated_outcome
     FROM tokenless_dsa_reference_evaluation_projections
     WHERE workspace_id=$1 AND epoch_id=$2 AND disposition='eligible_draw'
     ORDER BY unit_id`,
    [workspaceId, epochId],
  );
  return (result.rows as Row[]).map(row => ({
    unitId: text(row, "unit_id")!,
    sourceDecisionBinding: text(row, "source_decision_binding") as `sha256:${string}`,
    sourceEvaluationBinding: text(row, "source_evaluation_binding") as `sha256:${string}`,
    sourceEvaluationHash: text(row, "source_evaluation_hash") as `sha256:${string}`,
    decidedAt: canonicalDate(row.decision_at).toISOString(),
    automationProcessing: text(row, "automation_processing") as "solely_automated" | "partially_automated",
    systemIdentity: text(row, "system_identity") as `sha256:${string}`,
    systemId: text(row, "system_id")!,
    systemVersion: text(row, "system_version")!,
    machineClass: text(row, "machine_class") as ReferenceFrameUnit["machineClass"],
    publicDesignation: text(row, "public_designation")!,
    automatedOutcome: text(row, "automated_outcome") as "pass" | "fail",
    referenceLabelState: "unlabeled" as const,
  }));
}

function validateStoredDecisionProjection(
  row: Row,
  part8Fact: ReturnType<typeof normalizeDsaPart8DecisionFact>,
  workspaceId: string,
) {
  const projection = asRecord(canonicalStoredJson(text(row, "projection_json"), text(row, "projection_hash")));
  const expected = {
    schemaVersion: DECISION_PROJECTION_SCHEMA_VERSION,
    populationId: text(row, "population_id"),
    populationVersion: integer(row, "population_version", 1),
    providerDecisionId: text(row, "provider_decision_id"),
    decisionVersion: integer(row, "decision_version", 1),
    engagementId: text(row, "engagement_id"),
    engagementVersion: integer(row, "engagement_version", 1),
    sourceDecisionBinding: text(row, "source_decision_binding"),
    sourceDecisionHash: text(row, "source_decision_hash"),
    engagementHash: text(row, "engagement_hash"),
    measureTaken: Boolean(row.measure_taken),
    moderationMeasureId: text(row, "moderation_measure_id"),
    part8Fact,
    part8FactHash: text(row, "fact_hash"),
    origin: text(row, "origin"),
    article16NoticeId: text(row, "article16_notice_id"),
    notifierClass: text(row, "notifier_class"),
    decisionAt: canonicalDate(row.decision_at).toISOString(),
    sourceEligibilityStatus: text(row, "source_eligibility_status"),
    sourceExclusionReason: text(row, "source_exclusion_reason"),
    automationProcessing: text(row, "automation_processing"),
    expectedEvaluationCount: integer(row, "expected_evaluation_count", 0),
    evaluationSetRoot: text(row, "evaluation_set_root"),
    languageAttribution: part8Fact.languageAttribution,
    disposition: text(row, "disposition"),
  };
  const expectedSourceDecisionBinding = sha256Rfc8785({
    workspaceId,
    populationId: expected.populationId,
    populationVersion: expected.populationVersion,
    providerDecisionId: expected.providerDecisionId,
    decisionVersion: expected.decisionVersion,
    sourceDecisionHash: expected.sourceDecisionHash,
    engagementHash: expected.engagementHash,
    measureTaken: expected.measureTaken,
    moderationMeasureId: expected.moderationMeasureId,
    part8Fact,
    part8FactHash: expected.part8FactHash,
    origin: expected.origin,
    article16NoticeId: expected.article16NoticeId,
    notifierClass: expected.notifierClass,
  });
  if (
    expected.sourceDecisionBinding !== expectedSourceDecisionBinding ||
    canonicalizeRfc8785(projection) !== canonicalizeRfc8785(expected)
  )
    storedInvalid();
  return projection as DecisionProjection;
}

function validateStoredEvaluationProjection(row: Row) {
  const evaluation = validateEvaluationFact(row);
  const projection = asRecord(canonicalStoredJson(text(row, "projection_json"), text(row, "projection_hash")));
  const expected = {
    schemaVersion: EVALUATION_PROJECTION_SCHEMA_VERSION,
    populationId: text(row, "population_id"),
    populationVersion: integer(row, "population_version", 1),
    providerDecisionId: text(row, "provider_decision_id"),
    decisionVersion: integer(row, "decision_version", 1),
    evaluationId: text(row, "evaluation_id"),
    unitId: text(row, "unit_id"),
    sourceDecisionBinding: text(row, "source_decision_binding"),
    sourceEvaluationBinding: text(row, "source_evaluation_binding"),
    sourceEvaluationHash: text(row, "source_evaluation_hash"),
    evaluation,
    decisionAt: canonicalDate(row.decision_at).toISOString(),
    sourceEligibilityStatus: text(row, "source_eligibility_status"),
    sourceExclusionReason: text(row, "source_exclusion_reason"),
    automationProcessing: text(row, "automation_processing"),
    systemIdentity: text(row, "system_identity"),
    systemId: text(row, "system_id"),
    systemVersion: text(row, "system_version"),
    machineClass: text(row, "machine_class"),
    publicDesignation: text(row, "public_designation"),
    automatedOutcome: text(row, "automated_outcome"),
    disposition: text(row, "disposition"),
    referenceLabelState: "unlabeled" as const,
  };
  if (
    text(row, "evaluation_hash") !== expected.sourceEvaluationHash ||
    expected.systemIdentity !== deriveReferenceSystemIdentity(evaluation) ||
    expected.sourceEvaluationBinding !==
      sha256Rfc8785({
        sourceDecisionBinding: expected.sourceDecisionBinding,
        evaluation,
        sourceEvaluationHash: expected.sourceEvaluationHash,
      }) ||
    canonicalizeRfc8785(projection) !== canonicalizeRfc8785(expected)
  )
    storedInvalid();
  return projection as EvaluationProjection;
}

async function insertDecisionProjectionBatches(
  client: PoolClient,
  workspaceId: string,
  epochId: string,
  projections: readonly DecisionProjection[],
) {
  for (let start = 0; start < projections.length; start += 250) {
    const batch = projections.slice(start, start + 250);
    const values: unknown[] = [];
    const tuples = batch.map((row, index) => {
      const offset = index * 29;
      values.push(
        workspaceId,
        epochId,
        row.populationId,
        row.populationVersion,
        row.providerDecisionId,
        row.decisionVersion,
        row.engagementId,
        row.engagementVersion,
        row.sourceDecisionBinding,
        row.sourceDecisionHash,
        row.engagementHash,
        row.measureTaken,
        row.moderationMeasureId,
        row.part8FactJson,
        row.part8FactHash,
        row.origin,
        row.article16NoticeId,
        row.notifierClass,
        row.decisionAt,
        row.sourceEligibilityStatus,
        row.sourceExclusionReason,
        row.automationProcessing,
        row.expectedEvaluationCount,
        row.evaluationSetRoot,
        row.languageCodesJson,
        row.noLanguageReason,
        row.disposition,
        row.projectionJson,
        row.projectionHash,
      );
      return `(${Array.from({ length: 29 }, (_, column) => `$${offset + column + 1}`).join(",")})`;
    });
    await client.query(
      `INSERT INTO tokenless_dsa_reference_decision_projections
       (workspace_id,epoch_id,population_id,population_version,provider_decision_id,decision_version,
        engagement_id,engagement_version,source_decision_binding,source_decision_hash,engagement_hash,
        measure_taken,moderation_measure_id,
        part8_fact_json,part8_fact_hash,origin,article16_notice_id,notifier_class,decision_at,
        source_eligibility_status,source_exclusion_reason,automation_processing,expected_evaluation_count,
        evaluation_set_root,language_codes_json,no_language_reason,
        disposition,projection_json,projection_hash)
       VALUES ${tuples.join(",")}`,
      values,
    );
  }
}

async function insertEvaluationProjectionBatches(
  client: PoolClient,
  workspaceId: string,
  epochId: string,
  projections: readonly EvaluationProjection[],
) {
  for (let start = 0; start < projections.length; start += 250) {
    const batch = projections.slice(start, start + 250);
    const values: unknown[] = [];
    const tuples = batch.map((row, index) => {
      const offset = index * 27;
      values.push(
        workspaceId,
        epochId,
        row.populationId,
        row.populationVersion,
        row.providerDecisionId,
        row.decisionVersion,
        row.evaluationId,
        row.unitId,
        row.sourceDecisionBinding,
        row.sourceEvaluationBinding,
        row.sourceEvaluationHash,
        row.evaluationJson,
        row.evaluationHash,
        row.decisionAt,
        row.sourceEligibilityStatus,
        row.sourceExclusionReason,
        row.automationProcessing,
        row.systemIdentity,
        row.systemId,
        row.systemVersion,
        row.machineClass,
        row.publicDesignation,
        row.automatedOutcome,
        row.disposition,
        row.referenceLabelState,
        row.projectionJson,
        row.projectionHash,
      );
      return `(${Array.from({ length: 27 }, (_, column) => `$${offset + column + 1}`).join(",")})`;
    });
    await client.query(
      `INSERT INTO tokenless_dsa_reference_evaluation_projections
       (workspace_id,epoch_id,population_id,population_version,provider_decision_id,decision_version,evaluation_id,
        unit_id,source_decision_binding,source_evaluation_binding,source_evaluation_hash,evaluation_json,evaluation_hash,
        decision_at,source_eligibility_status,source_exclusion_reason,automation_processing,system_identity,system_id,
        system_version,machine_class,public_designation,automated_outcome,disposition,reference_label_state,
        projection_json,projection_hash)
       VALUES ${tuples.join(",")}`,
      values,
    );
  }
}

async function insertManifestBatches(
  client: PoolClient,
  workspaceId: string,
  epochId: string,
  manifest: FrozenReferenceSample["manifest"],
) {
  for (let start = 0; start < manifest.length; start += 300) {
    const batch = manifest.slice(start, start + 300);
    const values: unknown[] = [];
    const tuples = batch.map((row, index) => {
      const rowJson = canonicalizeRfc8785(row);
      const offset = index * 20;
      values.push(
        workspaceId,
        epochId,
        row.unitId,
        row.sourceDecisionBinding,
        row.sourceEvaluationBinding,
        row.sourceEvaluationHash,
        row.decidedAt,
        row.automationProcessing,
        row.systemIdentity,
        row.systemId,
        row.systemVersion,
        row.machineClass,
        row.publicDesignation,
        row.automatedOutcome,
        row.selected,
        row.selectionRank,
        row.inclusionProbability.numerator,
        row.inclusionProbability.denominator,
        rowJson,
        sha256Rfc8785(row),
      );
      return `(${Array.from({ length: 20 }, (_, column) => `$${offset + column + 1}`).join(",")})`;
    });
    await client.query(
      `INSERT INTO tokenless_dsa_reference_sample_manifest
       (workspace_id,epoch_id,unit_id,source_decision_binding,source_evaluation_binding,source_evaluation_hash,
        decision_at,automation_processing,system_identity,system_id,system_version,machine_class,public_designation,
        automated_outcome,
        selected,selection_rank,probability_numerator,probability_denominator,manifest_row_json,manifest_row_hash)
       VALUES ${tuples.join(",")}`,
      values,
    );
  }
}

async function appendTransition(input: {
  client: PoolClient;
  workspaceId: string;
  epochId: string;
  sequence: 1 | 2;
  eventType: "committed" | "frozen";
  witnessId: string;
  auditHeadDigest: string;
  attestationJobId: string;
  recordedAt: Date;
  evidence: Record<string, unknown>;
}) {
  const transition = {
    schemaVersion: TRANSITION_SCHEMA_VERSION,
    epochId: input.epochId,
    sequence: input.sequence,
    eventType: input.eventType,
    witnessId: input.witnessId,
    auditHeadDigest: input.auditHeadDigest,
    attestationJobId: input.attestationJobId,
    attestationArtifactKind: "audit_export_head" as const,
    attestationRequirement: "enqueued_audit_export_head" as const,
    recordedAt: input.recordedAt.toISOString(),
    evidence: input.evidence,
  };
  await input.client.query(
    `INSERT INTO tokenless_dsa_reference_sampling_events
     (workspace_id,epoch_id,sequence,event_type,schema_version,witness_id,transition_json,transition_hash,
      audit_head_digest,attestation_job_id,attestation_artifact_kind,attestation_requirement,recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'audit_export_head','enqueued_audit_export_head',$11)`,
    [
      input.workspaceId,
      input.epochId,
      input.sequence,
      input.eventType,
      TRANSITION_SCHEMA_VERSION,
      input.witnessId,
      canonicalizeRfc8785(transition),
      sha256Rfc8785(transition),
      input.auditHeadDigest,
      input.attestationJobId,
      input.recordedAt,
    ],
  );
}

export async function commitDsaReferenceSamplingEpoch(input: CommitInput) {
  const request = normalizeCommitInput(input);
  const requestJson = canonicalizeRfc8785(request);
  const requestHash = sha256Rfc8785(request);
  const epochId = deterministicHexId("rse", {
    workspaceId: request.workspaceId,
    populationId: request.populationId,
    populationVersion: request.populationVersion,
    purpose: request.purpose,
    sampleSizePlanId: request.sampleSizePlanId,
    sampleSizePlanVersion: request.sampleSizePlanVersion,
  });
  const frameId = deterministicHexId("rsf", { epochId });
  return inTransaction(async client => {
    const sourceFrozenAt = await dsaEvidenceTransactionTimestamp(client);
    const actor = await requireManagerAndProject(client, input.accountAddress, request.workspaceId, request.projectId);
    const existing = await client.query(
      `SELECT *
       FROM tokenless_dsa_reference_sampling_epochs
       WHERE workspace_id=$1 AND population_id=$2 AND population_version=$3 AND purpose=$4 FOR UPDATE`,
      [request.workspaceId, request.populationId, request.populationVersion, request.purpose],
    );
    const replay = existing.rows[0] as Row | undefined;
    if (replay) {
      if (text(replay, "epoch_id") !== epochId || text(replay, "request_hash") !== requestHash) {
        throw new TokenlessServiceError(
          "This population and purpose already have a different controlling epoch.",
          409,
          "dsa_reference_sampling_epoch_conflict",
        );
      }
      const replayUnits = await loadEligibleUnits(client, request.workspaceId, epochId);
      return {
        epochId,
        commitment: await verifyStoredCommitment(client, replay, replayUnits),
        idempotent: true,
      };
    }
    const populationResult = await client.query(
      `SELECT declared_contract_hash,frozen_root,frozen_row_count,period_start,period_end,frozen_at,status
       FROM tokenless_dsa_population_versions
       WHERE workspace_id=$1 AND population_id=$2 AND version=$3 FOR SHARE`,
      [request.workspaceId, request.populationId, request.populationVersion],
    );
    const population = populationResult.rows[0] as Row | undefined;
    if (!population || text(population, "status") !== "frozen") {
      throw new TokenlessServiceError("Frozen DSA population not found.", 404, "frozen_dsa_population_not_found");
    }
    const populationContractHash = text(population, "declared_contract_hash");
    const populationRoot = text(population, "frozen_root");
    const populationCount = integer(population, "frozen_row_count", 1);
    if (!SHA256.test(populationContractHash ?? "") || !SHA256.test(populationRoot ?? "")) storedInvalid();
    const reportingStart = canonicalDate(population.period_start);
    const reportingEnd = canonicalDate(population.period_end);
    const populationFrozenAt = canonicalDate(population.frozen_at);
    if (sourceFrozenAt < reportingEnd || sourceFrozenAt < populationFrozenAt) {
      throw new TokenlessServiceError(
        "The database transaction predates the complete frozen population.",
        409,
        "dsa_reference_sampling_source_not_yet_frozen",
      );
    }
    const rowsResult = await client.query(
      `SELECT e.provider_decision_id,e.decision_version,e.engagement_id,e.engagement_version,
              d.source_decision_json,d.source_decision_hash,d.decision_at,
              se.engagement_json,se.engagement_hash,
              f.measure_taken,f.moderation_measure_id,f.origin,f.article16_notice_id,f.notifier_class,
              f.automation_processing,f.expected_evaluation_count,f.evaluation_set_root,
              f.language_codes_json,f.no_language_reason,f.fact_json,f.fact_hash
       FROM tokenless_dsa_engagement_versions e
       JOIN tokenless_dsa_source_decision_versions d
         ON d.workspace_id=e.workspace_id AND d.provider_decision_id=e.provider_decision_id
        AND d.decision_version=e.decision_version
       JOIN tokenless_dsa_source_engagement_versions se
         ON se.workspace_id=e.workspace_id AND se.engagement_id=e.engagement_id
        AND se.engagement_version=e.engagement_version
       LEFT JOIN tokenless_dsa_content_moderation_decision_facts f
         ON f.workspace_id=e.workspace_id AND f.provider_decision_id=e.provider_decision_id
        AND f.decision_version=e.decision_version
       WHERE e.workspace_id=$1 AND e.population_id=$2 AND e.population_version=$3
       ORDER BY encode(convert_to(e.provider_decision_id,'UTF8'),'hex'),e.decision_version`,
      [request.workspaceId, request.populationId, request.populationVersion],
    );
    if (rowsResult.rowCount !== populationCount) storedInvalid();
    const missingPart8 = (rowsResult.rows as Row[]).filter(row => !text(row, "fact_hash")).length;
    if (missingPart8 > 0) {
      throw new TokenlessServiceError(
        `${missingPart8} population decisions lack immutable Part 8 source facts.`,
        409,
        "dsa_reference_sampling_part8_facts_missing",
      );
    }
    const decisionProjections = (rowsResult.rows as Row[]).map(row => deriveDecisionProjection(row, request));
    const decisionByKey = new Map(
      decisionProjections.map(row => [`${row.providerDecisionId}\0${row.decisionVersion}`, row]),
    );
    const evaluationRows = await client.query(
      `SELECT ev.provider_decision_id,ev.decision_version,ev.evaluation_id,ev.system_id,ev.system_version,
              ev.machine_class,ev.public_designation,ev.automated_outcome,ev.evaluation_json,ev.evaluation_hash
       FROM tokenless_dsa_engagement_versions e
       JOIN tokenless_dsa_automated_means_evaluations ev
         ON ev.workspace_id=e.workspace_id AND ev.provider_decision_id=e.provider_decision_id
        AND ev.decision_version=e.decision_version
       WHERE e.workspace_id=$1 AND e.population_id=$2 AND e.population_version=$3
       ORDER BY encode(convert_to(ev.provider_decision_id,'UTF8'),'hex'),ev.decision_version,
                encode(convert_to(ev.evaluation_id,'UTF8'),'hex')`,
      [request.workspaceId, request.populationId, request.populationVersion],
    );
    const evaluationProjections = (evaluationRows.rows as Row[]).map(row => {
      const decision = decisionByKey.get(
        `${text(row, "provider_decision_id")}\0${integer(row, "decision_version", 1)}`,
      );
      if (!decision) storedInvalid();
      return deriveEvaluationProjection(row, decision);
    });
    const evaluationsByDecision = new Map<string, DsaPart8AutomatedMeansEvaluationInput[]>();
    evaluationProjections.forEach(row => {
      const key = `${row.providerDecisionId}\0${row.decisionVersion}`;
      const inputs = evaluationsByDecision.get(key) ?? [];
      inputs.push({
        evaluationId: row.evaluationId,
        systemId: row.systemId,
        systemVersion: row.systemVersion,
        machineClass: row.machineClass,
        publicDesignation: row.publicDesignation,
        automatedOutcome: row.automatedOutcome,
      });
      evaluationsByDecision.set(key, inputs);
    });
    if (
      decisionProjections.some(row => {
        const evaluationSet = normalizeDsaPart8AutomatedMeansEvaluationSet(
          evaluationsByDecision.get(`${row.providerDecisionId}\0${row.decisionVersion}`) ?? [],
        );
        return (
          evaluationSet.evaluations.length !== row.expectedEvaluationCount ||
          evaluationSet.evaluationSetRoot !== row.evaluationSetRoot
        );
      })
    ) {
      throw new TokenlessServiceError(
        "Every automated decision must bind its complete evaluation set before epoch commitment.",
        409,
        "dsa_reference_sampling_evaluation_set_incomplete",
      );
    }
    const units = evaluationProjections.map(frameUnit).filter((unit): unit is ReferenceFrameUnit => unit !== null);
    if (units.length === 0) {
      throw new TokenlessServiceError(
        "The frozen population has no automated-means evaluation draw units.",
        409,
        "dsa_reference_sampling_frame_empty",
      );
    }
    if (new Set(units.map(unit => unit.unitId)).size !== units.length) storedInvalid();
    const evaluatedDecisionCount = decisionProjections.filter(row => row.disposition === "evaluated").length;
    const notAutomatedDecisionCount = decisionProjections.filter(row => row.disposition === "not_automated").length;
    const excludedDecisionCount = decisionProjections.filter(row => row.disposition === "excluded").length;
    const availableAt = roundAvailableAt(request.beaconNetwork, request.beaconRound);
    // Obtain a wall-clock timestamp only after the complete immutable source
    // projection exists. transaction_timestamp() would remain fixed at BEGIN.
    const committedAt = await dsaEvidenceCommitTimestamp(client);
    if (committedAt < sourceFrozenAt || committedAt < reportingEnd || committedAt < populationFrozenAt) {
      throw new TokenlessServiceError(
        "The commitment clock predates its complete frozen source projection.",
        409,
        "dsa_reference_sampling_source_not_yet_frozen",
      );
    }
    if (availableAt.getTime() - committedAt.getTime() < 5 * 60_000) {
      throw new TokenlessServiceError(
        "The witnessed commitment must precede beacon availability by at least five minutes.",
        400,
        "invalid_reference_sampling_frame",
        false,
        "beaconRound",
      );
    }
    const audit = await appendAuditEvent(
      {
        workspaceId: request.workspaceId,
        actorKind: "account",
        actorReference: actor,
        assuranceMethod: "workspace_manager_session",
        action: "dsa_reference_sampling_epoch_committed",
        targetKind: "dsa_reference_sampling_epoch",
        targetId: epochId,
        purpose: "reference_sampling",
        reason: "Commit an immutable pre-label DSA reference-sampling frame.",
        result: "success",
        occurredAt: committedAt,
        idempotencyKey: `dsa-reference-commit:${epochId}`,
        metadata: {
          requestHash,
          populationId: request.populationId,
          populationVersion: request.populationVersion,
          projectId: request.projectId,
          benchmarkId: request.benchmarkId,
          beaconNetwork: request.beaconNetwork,
          beaconRound: request.beaconRound,
        },
      },
      client,
    );
    const attestation = await enqueueAssuranceAttestationInTransaction(
      {
        workspaceId: request.workspaceId,
        kind: "audit_export_head",
        artifactDigest: audit.eventDigest,
        artifactSchemaVersion: "rateloop-audit-v1",
        boundaryAt: committedAt,
        now: committedAt,
      },
      client,
    );
    const witnessId = deterministicHexId("rsw", { epochId, eventType: "committed" });
    const commitment = createReferenceFrameCommitment({
      frameId,
      purpose: request.purpose,
      source: {
        workspaceId: request.workspaceId,
        projectId: request.projectId,
        benchmarkId: request.benchmarkId,
        activationReference: request.activationReference,
        deploymentKey: request.deploymentKey,
        contextAuthority: request.contextAuthority,
        populationId: request.populationId,
        populationVersion: request.populationVersion,
        populationContractHash: populationContractHash as `sha256:${string}`,
        populationRoot: populationRoot as `sha256:${string}`,
        populationFrozenAt: populationFrozenAt.toISOString(),
        reportingWindow: {
          startInclusive: reportingStart.toISOString(),
          endExclusive: reportingEnd.toISOString(),
        },
        populationCount,
        eligibleDrawUnitCount: units.length,
        evaluatedDecisionCount,
        notAutomatedDecisionCount,
        excludedDecisionCount,
      },
      witness: {
        kind: "database_transaction_and_attestation",
        witnessId,
        sourceFrozenAt: sourceFrozenAt.toISOString(),
        committedAt: committedAt.toISOString(),
        auditHeadDigest: audit.eventDigest as `sha256:${string}`,
      },
      units,
      sampleSizes: request.sampleSizes,
      sampleSizePlanId: request.sampleSizePlanId,
      sampleSizePlanVersion: request.sampleSizePlanVersion,
      beaconNetwork: request.beaconNetwork,
      beaconRound: request.beaconRound,
    });
    await client.query(
      `INSERT INTO tokenless_dsa_reference_sampling_epochs
       (epoch_id,workspace_id,project_id,benchmark_id,activation_reference,deployment_key,
        context_authority,population_id,population_version,purpose,sample_size_plan_id,sample_size_plan_version,
        schema_version,frame_id,method_version,request_json,request_hash,population_contract_hash,
        population_root,population_frozen_at,reporting_window_start,reporting_window_end,population_count,eligible_draw_unit_count,
        evaluated_decision_count,not_automated_decision_count,excluded_decision_count,strata_json,strata_hash,
        beacon_network,beacon_round,beacon_available_at,source_frozen_at,
        committed_at,frame_root,commitment_digest,commitment_json,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
               $24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38)`,
      [
        epochId,
        request.workspaceId,
        request.projectId,
        request.benchmarkId,
        request.activationReference,
        request.deploymentKey,
        request.contextAuthority,
        request.populationId,
        request.populationVersion,
        request.purpose,
        request.sampleSizePlanId,
        request.sampleSizePlanVersion,
        REFERENCE_FRAME_SCHEMA_VERSION,
        frameId,
        REFERENCE_SAMPLING_METHOD_VERSION,
        requestJson,
        requestHash,
        populationContractHash,
        populationRoot,
        populationFrozenAt,
        reportingStart,
        reportingEnd,
        populationCount,
        units.length,
        evaluatedDecisionCount,
        notAutomatedDecisionCount,
        excludedDecisionCount,
        canonicalizeRfc8785(commitment.strata),
        sha256Rfc8785(commitment.strata),
        request.beaconNetwork,
        request.beaconRound,
        availableAt,
        sourceFrozenAt,
        committedAt,
        commitment.frameRoot,
        commitment.commitmentDigest,
        canonicalizeRfc8785(commitment),
        actor,
      ],
    );
    await insertDecisionProjectionBatches(client, request.workspaceId, epochId, decisionProjections);
    await insertEvaluationProjectionBatches(client, request.workspaceId, epochId, evaluationProjections);
    await appendTransition({
      client,
      workspaceId: request.workspaceId,
      epochId,
      sequence: 1,
      eventType: "committed",
      witnessId,
      auditHeadDigest: audit.eventDigest,
      attestationJobId: attestation.jobId,
      recordedAt: committedAt,
      evidence: {
        requestHash,
        commitmentDigest: commitment.commitmentDigest,
        frameRoot: commitment.frameRoot,
        decisionProjectionCount: decisionProjections.length,
        evaluationProjectionCount: evaluationProjections.length,
      },
    });
    return { epochId, commitment, idempotent: false };
  });
}

export async function freezeDsaReferenceSamplingEpoch(input: {
  accountAddress: string;
  workspaceId: string;
  epochId: string;
  beacon: TokenlessReferenceSampleBeacon;
}) {
  exactKeys(input, FREEZE_KEYS, "freeze");
  if (!SIMPLE_IDENTIFIER.test(input.workspaceId) || !/^rse_[0-9a-f]{40}$/u.test(input.epochId)) {
    invalid("Reference-sampling epoch identity is invalid.");
  }
  const beaconJson = canonicalizeRfc8785(input.beacon);
  const beaconHash = sha256Rfc8785(input.beacon);
  return inTransaction(async client => {
    const dbNow = await dsaEvidenceTransactionTimestamp(client);
    const actor = await requireManagerAndProject(client, input.accountAddress, input.workspaceId);
    const epochResult = await client.query(
      `SELECT *
       FROM tokenless_dsa_reference_sampling_epochs
       WHERE workspace_id=$1 AND epoch_id=$2 FOR SHARE`,
      [input.workspaceId, input.epochId],
    );
    const epoch = epochResult.rows[0] as Row | undefined;
    if (!epoch) {
      throw new TokenlessServiceError(
        "Reference-sampling epoch not found.",
        404,
        "dsa_reference_sampling_epoch_not_found",
      );
    }
    const existingResult = await client.query(
      `SELECT beacon_evidence_hash,sample_digest,sample_json
       FROM tokenless_dsa_reference_samples WHERE workspace_id=$1 AND epoch_id=$2 FOR UPDATE`,
      [input.workspaceId, input.epochId],
    );
    const existing = existingResult.rows[0] as Row | undefined;
    if (existing) {
      if (text(existing, "beacon_evidence_hash") !== beaconHash) {
        throw new TokenlessServiceError(
          "This epoch is already frozen with different beacon evidence.",
          409,
          "dsa_reference_sample_conflict",
        );
      }
      const replayUnits = await loadEligibleUnits(client, input.workspaceId, input.epochId);
      const replayCommitment = await verifyStoredCommitment(client, epoch, replayUnits);
      const expected = parseSample(text(existing, "sample_json"), text(existing, "sample_digest"));
      return {
        epochId: input.epochId,
        sample: verifyStoredSample({
          expected,
          commitment: replayCommitment,
          units: replayUnits,
          beacon: input.beacon,
        }),
        idempotent: true,
      };
    }
    const units = await loadEligibleUnits(client, input.workspaceId, input.epochId);
    const commitment = await verifyStoredCommitment(client, epoch, units);
    const audit = await appendAuditEvent(
      {
        workspaceId: input.workspaceId,
        actorKind: "account",
        actorReference: actor,
        assuranceMethod: "workspace_manager_session",
        action: "dsa_reference_sample_frozen",
        targetKind: "dsa_reference_sampling_epoch",
        targetId: input.epochId,
        purpose: "reference_sampling",
        reason: "Freeze the verified beacon-derived DSA reference sample.",
        result: "success",
        occurredAt: dbNow,
        idempotencyKey: `dsa-reference-freeze:${input.epochId}`,
        metadata: {
          commitmentDigest: commitment.commitmentDigest,
          beaconEvidenceHash: beaconHash,
          beaconNetwork: input.beacon.network,
          beaconRound: input.beacon.expectedRound,
        },
      },
      client,
    );
    const attestation = await enqueueAssuranceAttestationInTransaction(
      {
        workspaceId: input.workspaceId,
        kind: "audit_export_head",
        artifactDigest: audit.eventDigest,
        artifactSchemaVersion: "rateloop-audit-v1",
        boundaryAt: dbNow,
        now: dbNow,
      },
      client,
    );
    const witnessId = deterministicHexId("rsw", { epochId: input.epochId, eventType: "frozen" });
    const sample = freezeReferenceSample({
      commitment,
      units,
      beacon: input.beacon,
      frozenWitness: {
        kind: "database_transaction_and_attestation",
        witnessId,
        frozenAt: dbNow.toISOString(),
        auditHeadDigest: audit.eventDigest as `sha256:${string}`,
      },
    });
    await client.query(
      `INSERT INTO tokenless_dsa_reference_samples
       (workspace_id,epoch_id,schema_version,commitment_digest,beacon_network,beacon_chain_hash,beacon_round,
        beacon_randomness,beacon_signature,beacon_evidence_json,beacon_evidence_hash,seed_digest,
        manifest_root,sample_digest,sample_json,frozen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        input.workspaceId,
        input.epochId,
        REFERENCE_SAMPLE_SCHEMA_VERSION,
        commitment.commitmentDigest,
        sample.beacon.network,
        sample.beacon.chainHash,
        sample.beacon.round,
        sample.beacon.randomness,
        sample.beacon.signature,
        beaconJson,
        beaconHash,
        sample.seedDigest,
        sample.manifestRoot,
        sample.sampleDigest,
        canonicalizeRfc8785(sample),
        dbNow,
      ],
    );
    await insertManifestBatches(client, input.workspaceId, input.epochId, sample.manifest);
    await appendTransition({
      client,
      workspaceId: input.workspaceId,
      epochId: input.epochId,
      sequence: 2,
      eventType: "frozen",
      witnessId,
      auditHeadDigest: audit.eventDigest,
      attestationJobId: attestation.jobId,
      recordedAt: dbNow,
      evidence: {
        beaconEvidenceHash: beaconHash,
        seedDigest: sample.seedDigest,
        manifestRoot: sample.manifestRoot,
        sampleDigest: sample.sampleDigest,
      },
    });
    return { epochId: input.epochId, sample, idempotent: false };
  });
}

export async function loadDsaReferenceSamplingEpochSources(input: {
  accountAddress: string;
  workspaceId: string;
  epochId: string;
}) {
  exactKeys(input, LOAD_KEYS, "source load");
  if (!SIMPLE_IDENTIFIER.test(input.workspaceId) || !/^rse_[0-9a-f]{40}$/u.test(input.epochId)) {
    invalid("Reference-sampling epoch identity is invalid.");
  }
  return inTransaction(async client => {
    await requireManagerAndProject(client, input.accountAddress, input.workspaceId);
    const epochResult = await client.query(
      `SELECT * FROM tokenless_dsa_reference_sampling_epochs
       WHERE workspace_id=$1 AND epoch_id=$2 FOR SHARE`,
      [input.workspaceId, input.epochId],
    );
    const epoch = epochResult.rows[0] as Row | undefined;
    if (!epoch) {
      throw new TokenlessServiceError(
        "Reference-sampling epoch not found.",
        404,
        "dsa_reference_sampling_epoch_not_found",
      );
    }
    const result = await client.query(
      `SELECT population_id,population_version,provider_decision_id,decision_version,engagement_id,engagement_version,
              source_decision_binding,source_decision_hash,engagement_hash,measure_taken,moderation_measure_id,
              part8_fact_json AS fact_json,part8_fact_hash AS fact_hash,origin,article16_notice_id,
              notifier_class,decision_at,source_eligibility_status,source_exclusion_reason,
              automation_processing,expected_evaluation_count,evaluation_set_root,language_codes_json,
              no_language_reason,disposition,projection_json,projection_hash
       FROM tokenless_dsa_reference_decision_projections
       WHERE workspace_id=$1 AND epoch_id=$2
       ORDER BY encode(convert_to(provider_decision_id,'UTF8'),'hex'),decision_version`,
      [input.workspaceId, input.epochId],
    );
    const sources = (result.rows as Row[]).map(row => {
      const part8Fact = validatePart8Fact(row);
      const projection = validateStoredDecisionProjection(row, part8Fact, input.workspaceId);
      return { projection, part8Fact };
    });
    const evaluationResult = await client.query(
      `SELECT population_id,population_version,provider_decision_id,decision_version,evaluation_id,unit_id,
              source_decision_binding,source_evaluation_binding,source_evaluation_hash,
              evaluation_json,evaluation_hash,decision_at,source_eligibility_status,source_exclusion_reason,
              automation_processing,system_identity,system_id,system_version,machine_class,public_designation,
              automated_outcome,disposition,reference_label_state,projection_json,projection_hash
       FROM tokenless_dsa_reference_evaluation_projections
       WHERE workspace_id=$1 AND epoch_id=$2
       ORDER BY encode(convert_to(provider_decision_id,'UTF8'),'hex'),decision_version,
                encode(convert_to(evaluation_id,'UTF8'),'hex')`,
      [input.workspaceId, input.epochId],
    );
    const evaluations = (evaluationResult.rows as Row[]).map(row => ({
      projection: validateStoredEvaluationProjection(row),
      evaluationFact: validateEvaluationFact(row),
    }));
    const replayEvaluationsByDecision = new Map<string, DsaPart8AutomatedMeansEvaluationInput[]>();
    evaluations.forEach(({ projection, evaluationFact }) => {
      const key = `${projection.providerDecisionId}\0${projection.decisionVersion}`;
      const entries = replayEvaluationsByDecision.get(key) ?? [];
      const evaluationInput: DsaPart8AutomatedMeansEvaluationInput = {
        evaluationId: evaluationFact.evaluationId,
        systemId: evaluationFact.systemId,
        systemVersion: evaluationFact.systemVersion,
        machineClass: evaluationFact.machineClass,
        publicDesignation: evaluationFact.publicDesignation,
        automatedOutcome: evaluationFact.automatedOutcome,
      };
      entries.push(evaluationInput);
      replayEvaluationsByDecision.set(key, entries);
    });
    sources.forEach(({ projection }) => {
      const evaluationSet = normalizeDsaPart8AutomatedMeansEvaluationSet(
        replayEvaluationsByDecision.get(`${projection.providerDecisionId}\0${projection.decisionVersion}`) ?? [],
      );
      if (
        evaluationSet.evaluations.length !== projection.expectedEvaluationCount ||
        evaluationSet.evaluationSetRoot !== projection.evaluationSetRoot
      )
        storedInvalid();
    });
    const units = evaluations
      .map(source => frameUnit(source.projection))
      .filter((unit): unit is ReferenceFrameUnit => unit !== null);
    const commitment = await verifyStoredCommitment(client, epoch, units);
    const sampleResult = await client.query(
      `SELECT sample_json,sample_digest,beacon_evidence_json,beacon_evidence_hash
       FROM tokenless_dsa_reference_samples WHERE workspace_id=$1 AND epoch_id=$2`,
      [input.workspaceId, input.epochId],
    );
    const storedSample = sampleResult.rows[0] as Row | undefined;
    let sample: FrozenReferenceSample | null = null;
    if (storedSample) {
      const expected = parseSample(text(storedSample, "sample_json"), text(storedSample, "sample_digest"));
      const storedBeacon = canonicalStoredJson(
        text(storedSample, "beacon_evidence_json"),
        text(storedSample, "beacon_evidence_hash"),
      ) as TokenlessReferenceSampleBeacon;
      sample = verifyStoredSample({ expected, commitment, units, beacon: storedBeacon });
    }
    return {
      epochId: input.epochId,
      commitment,
      sample,
      sources,
      evaluations,
    };
  });
}
