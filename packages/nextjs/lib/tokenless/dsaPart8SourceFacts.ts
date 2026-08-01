import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { dsaEvidenceTransactionTimestamp } from "~~/lib/tokenless/dsaEvidenceClock";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const DSA_PART8_DECISION_FACT_SCHEMA_VERSION = "rateloop.dsa-part8-content-moderation-decision.v3" as const;
export const DSA_PART8_AUTOMATED_MEANS_EVALUATION_SCHEMA_VERSION =
  "rateloop.dsa-part8-automated-means-evaluation.v1" as const;
export const DSA_PART8_AUTOMATED_MEANS_EVALUATION_SET_SCHEMA_VERSION =
  "rateloop.dsa-part8-automated-means-evaluation-set.v1" as const;
export const DSA_PART8_EMPTY_AUTOMATED_MEANS_EVALUATION_SET_ROOT = sha256Rfc8785({
  schemaVersion: DSA_PART8_AUTOMATED_MEANS_EVALUATION_SET_SCHEMA_VERSION,
  evaluations: [],
});

export const DSA_PART8_ORIGINS = ["authority_order", "article16_notice", "own_initiative"] as const;
export const DSA_PART8_SOLELY_AUTOMATED = "solely_automated" as const;
export const DSA_PART8_PARTIALLY_AUTOMATED = "partially_automated" as const;
export const DSA_PART8_NOT_AUTOMATED = "not_automated" as const;
export const DSA_PART8_AUTOMATION_PROCESSING = [
  DSA_PART8_SOLELY_AUTOMATED,
  DSA_PART8_PARTIALLY_AUTOMATED,
  DSA_PART8_NOT_AUTOMATED,
] as const;
export const DSA_PART8_NOTIFIER_CLASSES = ["trusted_flagger", "other"] as const;
export const DSA_PART8_CLASSIFIER_MACHINE_CLASSES = [
  "text_classifier",
  "image_classifier",
  "audio_classifier",
  "video_classifier",
  "multimodal_classifier",
  "rules_engine",
  "other_machine_class",
] as const;
export const DSA_PART8_NO_LANGUAGE_REASONS = [
  "no_linguistic_content",
  "language_undetermined",
  "not_applicable",
] as const;
export const EU_OFFICIAL_LANGUAGE_CODES = [
  "bg",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "fi",
  "fr",
  "ga",
  "hr",
  "hu",
  "it",
  "lt",
  "lv",
  "mt",
  "nl",
  "pl",
  "pt",
  "ro",
  "sk",
  "sl",
  "sv",
] as const;

type DsaPart8Origin = (typeof DSA_PART8_ORIGINS)[number];
type DsaPart8AutomationProcessing = (typeof DSA_PART8_AUTOMATION_PROCESSING)[number];
type DsaPart8NotifierClass = (typeof DSA_PART8_NOTIFIER_CLASSES)[number];
type DsaPart8ClassifierMachineClass = (typeof DSA_PART8_CLASSIFIER_MACHINE_CLASSES)[number];
type DsaPart8NoLanguageReason = (typeof DSA_PART8_NO_LANGUAGE_REASONS)[number];
type EuOfficialLanguageCode = (typeof EU_OFFICIAL_LANGUAGE_CODES)[number];
type Row = Record<string, unknown>;

export type DsaPart8DecisionFactInput = {
  measureTaken: boolean;
  moderationMeasureId: string | null;
  origin: DsaPart8Origin;
  automationProcessing: DsaPart8AutomationProcessing;
  expectedEvaluationCount: number;
  evaluationSetRoot: `sha256:${string}`;
  article16NoticeId: string | null;
  notifierClass: DsaPart8NotifierClass | null;
  languageAttribution: {
    languageCodes: readonly EuOfficialLanguageCode[];
    noLanguageReason: DsaPart8NoLanguageReason | null;
  };
};

export type DsaPart8AutomatedMeansEvaluationInput = {
  evaluationId: string;
  systemId: string;
  systemVersion: string;
  machineClass: DsaPart8ClassifierMachineClass;
  publicDesignation: string;
  automatedOutcome: "pass" | "fail";
};

const EXACT_FACT_KEYS = [
  "article16NoticeId",
  "automationProcessing",
  "evaluationSetRoot",
  "expectedEvaluationCount",
  "languageAttribution",
  "measureTaken",
  "moderationMeasureId",
  "notifierClass",
  "origin",
] as const;
const EXACT_EVALUATION_KEYS = [
  "automatedOutcome",
  "evaluationId",
  "machineClass",
  "publicDesignation",
  "systemId",
  "systemVersion",
] as const;
const EXACT_LANGUAGE_KEYS = ["languageCodes", "noLanguageReason"] as const;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const WORKSPACE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u;
const MEASURE_IDENTIFIER = /^measure_[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/u;
const NOTICE_IDENTIFIER = /^notice_[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/u;
const EVALUATION_IDENTIFIER = /^evaluation_[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/u;
const PUBLIC_DESIGNATION = /^[^\u0000-\u001f\u007f]{1,160}$/u;
const FORMULA_PREFIX = /^[=+@-]/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

function invalid(message: string, field?: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_dsa_part8_decision_fact", false, field);
}

function exactKeys(value: unknown, expected: readonly string[], field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${field} must be a typed object.`, field);
  const keys = Object.keys(value as Record<string, unknown>).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    invalid(`${field} contains missing or unsupported fields.`, field);
  }
}

function text(row: Row | undefined, field: string) {
  const value = row?.[field];
  return value === null || value === undefined ? null : String(value);
}

function positiveInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalid(`${field} must be a positive integer.`, field);
  return Number(value);
}

function normalizedActor(value: string) {
  try {
    return normalizeAccountSubject(value);
  } catch {
    throw new TokenlessServiceError("A valid signed-in account is required.", 401, "invalid_account");
  }
}

function portableCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function normalizeDsaPart8DecisionFact(input: DsaPart8DecisionFactInput) {
  exactKeys(input, EXACT_FACT_KEYS, "fact");
  if (typeof input.measureTaken !== "boolean") invalid("measureTaken must be boolean.", "measureTaken");
  if (
    (input.measureTaken &&
      (typeof input.moderationMeasureId !== "string" || !MEASURE_IDENTIFIER.test(input.moderationMeasureId))) ||
    (!input.measureTaken && input.moderationMeasureId !== null)
  ) {
    invalid("moderationMeasureId is required exactly when a measure was taken.", "moderationMeasureId");
  }
  if (!DSA_PART8_ORIGINS.includes(input.origin)) invalid("origin is invalid.", "origin");
  if (!DSA_PART8_AUTOMATION_PROCESSING.includes(input.automationProcessing)) {
    invalid("automationProcessing is invalid.", "automationProcessing");
  }
  if (!Number.isSafeInteger(input.expectedEvaluationCount) || input.expectedEvaluationCount < 0) {
    invalid("expectedEvaluationCount must be a non-negative safe integer.", "expectedEvaluationCount");
  }
  if (!SHA256.test(input.evaluationSetRoot)) {
    invalid("evaluationSetRoot must be a canonical SHA-256 binding.", "evaluationSetRoot");
  }
  if (
    (input.automationProcessing === DSA_PART8_NOT_AUTOMATED && input.expectedEvaluationCount !== 0) ||
    (input.automationProcessing !== DSA_PART8_NOT_AUTOMATED && input.expectedEvaluationCount < 1)
  ) {
    invalid(
      "Evaluation count must be zero for non-automated decisions and positive for automated decisions.",
      "expectedEvaluationCount",
    );
  }
  if (
    input.expectedEvaluationCount === 0 &&
    input.evaluationSetRoot !== DSA_PART8_EMPTY_AUTOMATED_MEANS_EVALUATION_SET_ROOT
  ) {
    invalid("An empty evaluation set must use the canonical empty-set root.", "evaluationSetRoot");
  }

  if (input.origin === "article16_notice") {
    if (
      typeof input.article16NoticeId !== "string" ||
      !NOTICE_IDENTIFIER.test(input.article16NoticeId) ||
      input.notifierClass === null ||
      !DSA_PART8_NOTIFIER_CLASSES.includes(input.notifierClass)
    ) {
      invalid("Article 16 notice origin requires a notice ID and notifier class.", "article16NoticeId");
    }
  } else if (input.article16NoticeId !== null || input.notifierClass !== null) {
    invalid("Notice fields are allowed only for Article 16 notice origin.", "article16NoticeId");
  }

  exactKeys(input.languageAttribution, EXACT_LANGUAGE_KEYS, "languageAttribution");
  if (!Array.isArray(input.languageAttribution.languageCodes)) {
    invalid("languageCodes must be an array.", "languageAttribution.languageCodes");
  }
  const languageCodes = [...input.languageAttribution.languageCodes].sort(portableCompare);
  if (
    languageCodes.some(code => !EU_OFFICIAL_LANGUAGE_CODES.includes(code)) ||
    new Set(languageCodes).size !== languageCodes.length
  ) {
    invalid(
      "languageCodes must contain unique lower-case EU official language codes.",
      "languageAttribution.languageCodes",
    );
  }
  const noLanguageReason = input.languageAttribution.noLanguageReason;
  if (
    (languageCodes.length === 0 &&
      (noLanguageReason === null || !DSA_PART8_NO_LANGUAGE_REASONS.includes(noLanguageReason))) ||
    (languageCodes.length > 0 && noLanguageReason !== null)
  ) {
    invalid(
      "A coded no-language reason is required exactly when no language is attributed.",
      "languageAttribution.noLanguageReason",
    );
  }

  return {
    schemaVersion: DSA_PART8_DECISION_FACT_SCHEMA_VERSION,
    measureTaken: input.measureTaken,
    moderationMeasureId: input.moderationMeasureId,
    origin: input.origin,
    automationProcessing: input.automationProcessing,
    expectedEvaluationCount: input.expectedEvaluationCount,
    evaluationSetRoot: input.evaluationSetRoot,
    article16NoticeId: input.article16NoticeId,
    notifierClass: input.notifierClass,
    languageAttribution: { languageCodes, noLanguageReason },
  } as const;
}

export function normalizeDsaPart8AutomatedMeansEvaluation(input: DsaPart8AutomatedMeansEvaluationInput) {
  exactKeys(input, EXACT_EVALUATION_KEYS, "evaluation");
  if (!EVALUATION_IDENTIFIER.test(input.evaluationId)) {
    invalid("evaluationId is invalid.", "evaluationId");
  }
  if (!IDENTIFIER.test(input.systemId)) invalid("systemId is invalid.", "systemId");
  if (!IDENTIFIER.test(input.systemVersion)) invalid("systemVersion is invalid.", "systemVersion");
  if (!DSA_PART8_CLASSIFIER_MACHINE_CLASSES.includes(input.machineClass)) {
    invalid("machineClass is invalid.", "machineClass");
  }
  if (
    typeof input.publicDesignation !== "string" ||
    input.publicDesignation !== input.publicDesignation.trim() ||
    !PUBLIC_DESIGNATION.test(input.publicDesignation) ||
    FORMULA_PREFIX.test(input.publicDesignation)
  ) {
    invalid("publicDesignation must be a short, canonical public label.", "publicDesignation");
  }
  if (input.automatedOutcome !== "pass" && input.automatedOutcome !== "fail") {
    invalid("automatedOutcome is invalid.", "automatedOutcome");
  }
  return {
    schemaVersion: DSA_PART8_AUTOMATED_MEANS_EVALUATION_SCHEMA_VERSION,
    evaluationId: input.evaluationId,
    systemId: input.systemId,
    systemVersion: input.systemVersion,
    machineClass: input.machineClass,
    publicDesignation: input.publicDesignation,
    automatedOutcome: input.automatedOutcome,
  } as const;
}

export function normalizeDsaPart8AutomatedMeansEvaluationSet(inputs: readonly DsaPart8AutomatedMeansEvaluationInput[]) {
  if (!Array.isArray(inputs)) invalid("evaluations must be an array.", "evaluations");
  const evaluations = inputs
    .map(normalizeDsaPart8AutomatedMeansEvaluation)
    .sort((left, right) => portableCompare(left.evaluationId, right.evaluationId));
  if (new Set(evaluations.map(evaluation => evaluation.evaluationId)).size !== evaluations.length) {
    invalid("evaluationId values must be unique within a decision.", "evaluations");
  }
  if (
    new Set(evaluations.map(evaluation => `${evaluation.systemId}\u0000${evaluation.systemVersion}`)).size !==
    evaluations.length
  ) {
    invalid("Each systemId and systemVersion pair may occur only once per decision.", "evaluations");
  }
  return {
    schemaVersion: DSA_PART8_AUTOMATED_MEANS_EVALUATION_SET_SCHEMA_VERSION,
    evaluations,
    evaluationSetRoot: sha256Rfc8785({
      schemaVersion: DSA_PART8_AUTOMATED_MEANS_EVALUATION_SET_SCHEMA_VERSION,
      evaluations,
    }),
  } as const;
}

async function requireManager(client: PoolClient, accountAddress: string, workspaceId: string) {
  const actor = normalizedActor(accountAddress);
  const membership = await client.query(
    `SELECT m.role FROM tokenless_workspace_members m
     JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id AND w.status='active'
     WHERE m.workspace_id=$1 AND m.account_address=$2 AND m.role IN ('owner','admin') LIMIT 1`,
    [workspaceId, actor],
  );
  if (membership.rowCount !== 1) {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
  return actor;
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
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

export async function recordDsaPart8DecisionFact(input: {
  accountAddress: string;
  workspaceId: string;
  providerDecisionId: string;
  decisionVersion: number;
  fact: DsaPart8DecisionFactInput;
  evaluations: readonly DsaPart8AutomatedMeansEvaluationInput[];
}) {
  if (!WORKSPACE_IDENTIFIER.test(input.workspaceId) || !IDENTIFIER.test(input.providerDecisionId)) {
    invalid("Decision scope is invalid.");
  }
  const decisionVersion = positiveInteger(input.decisionVersion, "decisionVersion");
  const fact = normalizeDsaPart8DecisionFact(input.fact);
  const evaluationSet = normalizeDsaPart8AutomatedMeansEvaluationSet(input.evaluations);
  if (
    evaluationSet.evaluations.length !== fact.expectedEvaluationCount ||
    evaluationSet.evaluationSetRoot !== fact.evaluationSetRoot
  ) {
    invalid("The complete evaluation set does not match the decision fact binding.", "evaluations");
  }
  const factJson = canonicalizeRfc8785(fact);
  const factHash = sha256Rfc8785(fact);
  const evaluationRows = evaluationSet.evaluations.map(evaluation => ({
    evaluation,
    evaluationJson: canonicalizeRfc8785(evaluation),
    evaluationHash: sha256Rfc8785(evaluation),
  }));
  return inTransaction(async client => {
    const now = await dsaEvidenceTransactionTimestamp(client);
    const actor = await requireManager(client, input.accountAddress, input.workspaceId);
    const decision = await client.query(
      `SELECT sor_applicability,non_required_basis FROM tokenless_dsa_source_decision_versions
       WHERE workspace_id=$1 AND provider_decision_id=$2 AND decision_version=$3 FOR SHARE`,
      [input.workspaceId, input.providerDecisionId, decisionVersion],
    );
    if (decision.rowCount !== 1) {
      throw new TokenlessServiceError("Source decision not found.", 404, "dsa_source_decision_not_found");
    }
    const sourceDecision = decision.rows[0] as Row;
    if (
      !fact.measureTaken &&
      (text(sourceDecision, "sor_applicability") === "required" ||
        text(sourceDecision, "non_required_basis") !== text(sourceDecision, "sor_applicability"))
    ) {
      throw new TokenlessServiceError(
        "A no-measure evaluation requires a coded non-required statement-of-reasons basis.",
        409,
        "dsa_no_measure_requires_non_required_basis",
      );
    }
    const existing = await client.query(
      `SELECT provider_decision_id,decision_version,measure_taken,moderation_measure_id,expected_evaluation_count,
              evaluation_set_root,fact_json,fact_hash,created_at
       FROM tokenless_dsa_content_moderation_decision_facts
       WHERE workspace_id=$1
         AND ((provider_decision_id=$2 AND decision_version=$3)
              OR ($4 IS NOT NULL AND moderation_measure_id=$4))
       FOR UPDATE`,
      [input.workspaceId, input.providerDecisionId, decisionVersion, fact.moderationMeasureId],
    );
    const exact = (existing.rows as Row[]).find(
      row =>
        text(row, "provider_decision_id") === input.providerDecisionId &&
        Number(row.decision_version) === decisionVersion,
    );
    if (exact) {
      if (
        Boolean(exact.measure_taken) === fact.measureTaken &&
        text(exact, "moderation_measure_id") === fact.moderationMeasureId &&
        Number(exact.expected_evaluation_count) === fact.expectedEvaluationCount &&
        text(exact, "evaluation_set_root") === fact.evaluationSetRoot &&
        text(exact, "fact_json") === factJson &&
        text(exact, "fact_hash") === factHash
      ) {
        const persistedEvaluations = await client.query(
          `SELECT evaluation_id,evaluation_json,evaluation_hash
           FROM tokenless_dsa_automated_means_evaluations
           WHERE workspace_id=$1 AND provider_decision_id=$2 AND decision_version=$3
           ORDER BY evaluation_id
           FOR SHARE`,
          [input.workspaceId, input.providerDecisionId, decisionVersion],
        );
        const completeRetry =
          persistedEvaluations.rowCount === evaluationRows.length &&
          (persistedEvaluations.rows as Row[]).every(
            (row, index) =>
              text(row, "evaluation_id") === evaluationRows[index]?.evaluation.evaluationId &&
              text(row, "evaluation_json") === evaluationRows[index]?.evaluationJson &&
              text(row, "evaluation_hash") === evaluationRows[index]?.evaluationHash,
          );
        if (!completeRetry) {
          throw new TokenlessServiceError(
            "The persisted evaluation set does not match its immutable decision binding.",
            409,
            "dsa_part8_evaluation_set_conflict",
          );
        }
        return {
          ...fact,
          evaluations: evaluationSet.evaluations,
          factHash,
          createdAt: new Date(String(exact.created_at)).toISOString(),
          idempotent: true,
        };
      }
      throw new TokenlessServiceError(
        "This source decision already has different immutable Part 8 facts.",
        409,
        "dsa_part8_decision_fact_conflict",
      );
    }
    if ((existing.rowCount ?? 0) > 0) {
      throw new TokenlessServiceError(
        "moderationMeasureId already belongs to another source decision.",
        409,
        "dsa_moderation_measure_id_conflict",
      );
    }
    try {
      await client.query(
        `INSERT INTO tokenless_dsa_content_moderation_decision_facts
         (workspace_id,provider_decision_id,decision_version,schema_version,measure_taken,moderation_measure_id,origin,
          automation_processing,expected_evaluation_count,evaluation_set_root,article16_notice_id,notifier_class,
          language_codes_json,no_language_reason,fact_json,fact_hash,created_by,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          input.workspaceId,
          input.providerDecisionId,
          decisionVersion,
          DSA_PART8_DECISION_FACT_SCHEMA_VERSION,
          fact.measureTaken,
          fact.moderationMeasureId,
          fact.origin,
          fact.automationProcessing,
          fact.expectedEvaluationCount,
          fact.evaluationSetRoot,
          fact.article16NoticeId,
          fact.notifierClass,
          canonicalizeRfc8785(fact.languageAttribution.languageCodes),
          fact.languageAttribution.noLanguageReason,
          factJson,
          factHash,
          actor,
          now,
        ],
      );
      for (const row of evaluationRows) {
        await client.query(
          `INSERT INTO tokenless_dsa_automated_means_evaluations
           (workspace_id,provider_decision_id,decision_version,evaluation_id,schema_version,system_id,system_version,
            machine_class,public_designation,automated_outcome,evaluation_json,evaluation_hash,created_by,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            input.workspaceId,
            input.providerDecisionId,
            decisionVersion,
            row.evaluation.evaluationId,
            DSA_PART8_AUTOMATED_MEANS_EVALUATION_SCHEMA_VERSION,
            row.evaluation.systemId,
            row.evaluation.systemVersion,
            row.evaluation.machineClass,
            row.evaluation.publicDesignation,
            row.evaluation.automatedOutcome,
            row.evaluationJson,
            row.evaluationHash,
            actor,
            now,
          ],
        );
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        throw new TokenlessServiceError(
          "The decision or moderation measure was recorded concurrently with different facts.",
          409,
          "dsa_part8_decision_fact_conflict",
        );
      }
      throw error;
    }
    return {
      ...fact,
      evaluations: evaluationSet.evaluations,
      factHash,
      createdAt: now.toISOString(),
      idempotent: false,
    };
  });
}
