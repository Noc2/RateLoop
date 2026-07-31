import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const DSA_PART8_SOURCE_FACT_SCHEMA_VERSION = "rateloop.dsa-part8-moderation-measure.v1" as const;

export const DSA_PART8_ORIGINS = ["authority_order", "article16_notice", "own_initiative"] as const;
export const DSA_PART8_AUTOMATION_PROCESSING = ["solely_automated", "not_solely_automated"] as const;
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

export type DsaPart8SourceFactInput = {
  moderationMeasureId: string;
  origin: DsaPart8Origin;
  automationProcessing: DsaPart8AutomationProcessing;
  article16NoticeId: string | null;
  notifierClass: DsaPart8NotifierClass | null;
  automaticRemoval: boolean;
  classifier: null | {
    systemId: string;
    version: string;
    machineClass: DsaPart8ClassifierMachineClass;
  };
  languageAttribution: {
    languageCodes: readonly EuOfficialLanguageCode[];
    noLanguageReason: DsaPart8NoLanguageReason | null;
  };
};

const EXACT_FACT_KEYS = [
  "article16NoticeId",
  "automaticRemoval",
  "automationProcessing",
  "classifier",
  "languageAttribution",
  "moderationMeasureId",
  "notifierClass",
  "origin",
] as const;
const EXACT_CLASSIFIER_KEYS = ["machineClass", "systemId", "version"] as const;
const EXACT_LANGUAGE_KEYS = ["languageCodes", "noLanguageReason"] as const;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const WORKSPACE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u;
const MEASURE_IDENTIFIER = /^measure_[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/u;
const NOTICE_IDENTIFIER = /^notice_[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/u;
const CLASSIFIER_IDENTIFIER = /^classifier_[A-Za-z0-9][A-Za-z0-9_.:-]{2,159}$/u;

function invalid(message: string, field?: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_dsa_part8_source_fact", false, field);
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

function validNow(value: Date | undefined) {
  const parsed = value ?? new Date();
  if (!(parsed instanceof Date) || !Number.isFinite(parsed.getTime())) invalid("now must be a valid date.", "now");
  return parsed;
}

function portableCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function normalizeDsaPart8SourceFact(input: DsaPart8SourceFactInput) {
  exactKeys(input, EXACT_FACT_KEYS, "fact");
  if (!MEASURE_IDENTIFIER.test(input.moderationMeasureId))
    invalid("moderationMeasureId is invalid.", "moderationMeasureId");
  if (!DSA_PART8_ORIGINS.includes(input.origin)) invalid("origin is invalid.", "origin");
  if (!DSA_PART8_AUTOMATION_PROCESSING.includes(input.automationProcessing)) {
    invalid("automationProcessing is invalid.", "automationProcessing");
  }
  if (typeof input.automaticRemoval !== "boolean") invalid("automaticRemoval must be boolean.", "automaticRemoval");

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

  let classifier: DsaPart8SourceFactInput["classifier"] = null;
  if (input.automationProcessing === "solely_automated") {
    exactKeys(input.classifier, EXACT_CLASSIFIER_KEYS, "classifier");
    if (
      !input.classifier ||
      !CLASSIFIER_IDENTIFIER.test(input.classifier.systemId) ||
      !IDENTIFIER.test(input.classifier.version) ||
      !DSA_PART8_CLASSIFIER_MACHINE_CLASSES.includes(input.classifier.machineClass)
    ) {
      invalid("Solely automated processing requires typed classifier facts.", "classifier");
    }
    classifier = { ...input.classifier };
  } else if (input.classifier !== null) {
    invalid("Classifier facts must be null when processing was not solely automated.", "classifier");
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
    schemaVersion: DSA_PART8_SOURCE_FACT_SCHEMA_VERSION,
    moderationMeasureId: input.moderationMeasureId,
    origin: input.origin,
    automationProcessing: input.automationProcessing,
    article16NoticeId: input.article16NoticeId,
    notifierClass: input.notifierClass,
    automaticRemoval: input.automaticRemoval,
    classifier,
    languageAttribution: { languageCodes, noLanguageReason },
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

export async function recordDsaPart8SourceFact(input: {
  accountAddress: string;
  workspaceId: string;
  providerDecisionId: string;
  decisionVersion: number;
  fact: DsaPart8SourceFactInput;
  now?: Date;
}) {
  if (!WORKSPACE_IDENTIFIER.test(input.workspaceId) || !IDENTIFIER.test(input.providerDecisionId)) {
    invalid("Decision scope is invalid.");
  }
  const decisionVersion = positiveInteger(input.decisionVersion, "decisionVersion");
  const fact = normalizeDsaPart8SourceFact(input.fact);
  const factJson = canonicalizeRfc8785(fact);
  const factHash = sha256Rfc8785(fact);
  const now = validNow(input.now);

  return inTransaction(async client => {
    const actor = await requireManager(client, input.accountAddress, input.workspaceId);
    const decision = await client.query(
      `SELECT 1 FROM tokenless_dsa_source_decision_versions
       WHERE workspace_id=$1 AND provider_decision_id=$2 AND decision_version=$3 FOR SHARE`,
      [input.workspaceId, input.providerDecisionId, decisionVersion],
    );
    if (decision.rowCount !== 1) {
      throw new TokenlessServiceError("Source decision not found.", 404, "dsa_source_decision_not_found");
    }
    const existing = await client.query(
      `SELECT provider_decision_id,decision_version,moderation_measure_id,fact_json,fact_hash,created_at
       FROM tokenless_dsa_moderation_measure_facts
       WHERE workspace_id=$1
         AND ((provider_decision_id=$2 AND decision_version=$3) OR moderation_measure_id=$4)
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
        text(exact, "moderation_measure_id") === fact.moderationMeasureId &&
        text(exact, "fact_json") === factJson &&
        text(exact, "fact_hash") === factHash
      ) {
        return { ...fact, factHash, createdAt: new Date(String(exact.created_at)).toISOString(), idempotent: true };
      }
      throw new TokenlessServiceError(
        "This source decision already has different immutable Part 8 facts.",
        409,
        "dsa_part8_source_fact_conflict",
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
        `INSERT INTO tokenless_dsa_moderation_measure_facts
         (workspace_id,provider_decision_id,decision_version,schema_version,moderation_measure_id,origin,
          automation_processing,article16_notice_id,notifier_class,automatic_removal,classifier_system_id,
          classifier_version,classifier_machine_class,language_codes_json,no_language_reason,fact_json,fact_hash,
          created_by,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          input.workspaceId,
          input.providerDecisionId,
          decisionVersion,
          DSA_PART8_SOURCE_FACT_SCHEMA_VERSION,
          fact.moderationMeasureId,
          fact.origin,
          fact.automationProcessing,
          fact.article16NoticeId,
          fact.notifierClass,
          fact.automaticRemoval,
          fact.classifier?.systemId ?? null,
          fact.classifier?.version ?? null,
          fact.classifier?.machineClass ?? null,
          canonicalizeRfc8785(fact.languageAttribution.languageCodes),
          fact.languageAttribution.noLanguageReason,
          factJson,
          factHash,
          actor,
          now,
        ],
      );
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        throw new TokenlessServiceError(
          "The decision or moderation measure was recorded concurrently with different facts.",
          409,
          "dsa_part8_source_fact_conflict",
        );
      }
      throw error;
    }
    return { ...fact, factHash, createdAt: now.toISOString(), idempotent: false };
  });
}
