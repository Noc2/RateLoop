import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import {
  DSA_SOR_APPLICABILITY,
  DSA_TRANSPARENCY_DATABASE_SCHEMA_VERSION,
  type DsaSorApplicability,
  classifyDsaSorPuidLookup,
  classifyDsaSorSubmission,
} from "~~/lib/tokenless/dsaStatementOfReasons";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const DSA_POPULATION_SCHEMA_VERSION = "rateloop.dsa-population.v1" as const;
export const DSA_SOURCE_DECISION_SCHEMA_VERSION = "rateloop.dsa-source-decision.v1" as const;
export const DSA_ENGAGEMENT_SCHEMA_VERSION = "rateloop.dsa-engagement.v1" as const;
export const DSA_RECONCILIATION_SCHEMA_VERSION = "rateloop.dsa-population-reconciliation.v1" as const;
export const DSA_TRANSPARENCY_PAYLOAD_SCHEMA_VERSION = "rateloop.dsa-transparency-payload.v1" as const;
export const DSA_TRANSPARENCY_ATTEMPT_SCHEMA_VERSION = "rateloop.dsa-transparency-attempt.v1" as const;
export const DSA_TRANSPARENCY_RECEIPT_SCHEMA_VERSION = "rateloop.dsa-transparency-receipt.v1" as const;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const SIMPLE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/u;
const PUID = /^[A-Za-z0-9_-]{1,500}$/u;
const MAX_PAGE_ROWS = 1_000;
const MAX_POPULATION_ROWS = 50_000;
const RECONCILIATION_PAGE_ROWS = 1_000;
const APPLICABILITY = new Set<string>(DSA_SOR_APPLICABILITY);

const DSA_TRIGGER_SOURCES = [
  "automated_detection",
  "trusted_flagger",
  "recipient_report",
  "authority_order",
  "own_initiative",
  "other",
] as const;
const DSA_ELIGIBILITY_STATUSES = ["eligible", "excluded"] as const;
const DSA_STATEMENT_CATEGORIES = [
  "STATEMENT_CATEGORY_ILLEGAL_CONTENT",
  "STATEMENT_CATEGORY_INCOMPATIBLE_CONTENT",
] as const;
// The first pilot is deliberately one category. Expand this allowlist only from a
// checked-in Commission schema update; never accept arbitrary category strings.
const DSA_PILOT_CATEGORY_SPECIFICATIONS = ["KEYWORD_OTHER"] as const;
const DSA_REASON_CODES = ["ILLEGAL_POLICY_MATCH", "TERMS_POLICY_MATCH"] as const;
const SERVER_DECISION_FACTS: Record<(typeof DSA_REASON_CODES)[number], string> = {
  ILLEGAL_POLICY_MATCH: "The content matched the recorded illegal-content policy category.",
  TERMS_POLICY_MATCH: "The content matched the recorded terms-and-conditions policy category.",
};

export type DsaTransparencyPilotStatement = {
  decisionVisibility: "DECISION_VISIBILITY_CONTENT_DISABLED";
  contentId: string;
  category: (typeof DSA_STATEMENT_CATEGORIES)[number];
  categorySpecification: (typeof DSA_PILOT_CATEGORY_SPECIFICATIONS)[number];
  reasonCode: (typeof DSA_REASON_CODES)[number];
};

type Row = Record<string, unknown>;

export type DsaPopulationRowInput = {
  engagementId: string;
  engagementVersion: number;
  providerDecisionId: string;
  decisionVersion: number;
  service: string;
  sourceSystem: string;
  decisionAt: Date;
  language: string;
  contentFormat: string;
  harmonisedCategory: (typeof DSA_PILOT_CATEGORY_SPECIFICATIONS)[number];
  triggerSource: (typeof DSA_TRIGGER_SOURCES)[number];
  policyVersion: string;
  automatedSystemVersion: string;
  originalAutomatedLabel: string;
  originalRestriction: string;
  eligibilityStatus: (typeof DSA_ELIGIBILITY_STATUSES)[number];
  exclusionReason: string | null;
  contentHash: `sha256:${string}`;
  contentLocator: string;
  partitionValues: Record<string, string>;
  sorApplicability: DsaSorApplicability;
  nonRequiredBasis?: Exclude<DsaSorApplicability, "required">;
  transparency?: {
    payloadVersion: number;
    statement: DsaTransparencyPilotStatement;
  };
};

export type DsaReconciliationBlocker = {
  code:
    | "extra_pages"
    | "missing_pages"
    | "row_count_mismatch"
    | "source_totals_mismatch"
    | "partition_totals_mismatch"
    | "source_manifest_mismatch"
    | "page_row_count_mismatch"
    | "unmatched_source_decision"
    | "missing_transparency_payload"
    | "missing_transparency_receipt";
  count: number;
};

function text(row: Row | undefined, field: string) {
  const value = row?.[field];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row | undefined, field: string, minimum = 0) {
  const value = Number(row?.[field]);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TokenlessServiceError("Stored DSA evidence is invalid.", 500, "stored_dsa_evidence_invalid");
  }
  return value;
}

function date(value: unknown, field: string) {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new TokenlessServiceError(`${field} must be a valid date.`, 400, "invalid_dsa_population");
  }
  return parsed;
}

function positiveInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new TokenlessServiceError(
      `${field} must be a positive integer.`,
      400,
      "invalid_dsa_population",
      false,
      field,
    );
  }
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
  return date(value ?? new Date(), "now");
}

function parseStoredJson(value: string | null, field: string): unknown {
  try {
    if (value === null) throw new Error("missing");
    return JSON.parse(value) as unknown;
  } catch {
    throw new TokenlessServiceError(`Stored ${field} is invalid.`, 500, "stored_dsa_evidence_invalid");
  }
}

function uniqueStrings(values: readonly string[], field: string, pattern = IDENTIFIER) {
  const normalized = [...values];
  if (
    normalized.length === 0 ||
    normalized.some(value => !pattern.test(value)) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new TokenlessServiceError(`${field} must contain unique valid identifiers.`, 400, "invalid_dsa_population");
  }
  return normalized.sort();
}

function normalizedSourceTotals(sourceSystems: readonly string[], input: Record<string, number>) {
  const keys = Object.keys(input).sort();
  if (
    keys.length !== sourceSystems.length ||
    keys.some((key, index) => key !== sourceSystems[index]) ||
    keys.some(key => !Number.isSafeInteger(input[key]) || Number(input[key]) < 0)
  ) {
    throw new TokenlessServiceError(
      "Declared source totals must exactly cover the declared source systems.",
      400,
      "invalid_dsa_population",
    );
  }
  return Object.fromEntries(keys.map(key => [key, Number(input[key])]));
}

function partitionKey(dimensions: readonly string[], values: Record<string, string>) {
  const keys = Object.keys(values).sort();
  if (
    keys.length !== dimensions.length ||
    keys.some((key, index) => key !== dimensions[index]) ||
    keys.some(
      key => typeof values[key] !== "string" || String(values[key]).length === 0 || String(values[key]).length > 160,
    )
  ) {
    throw new TokenlessServiceError(
      "Partition values must exactly cover every declared dimension.",
      400,
      "invalid_dsa_population_row",
    );
  }
  return canonicalizeRfc8785(Object.fromEntries(keys.map(key => [key, values[key]])));
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

function addCount(target: Record<string, number>, key: string) {
  target[key] = (target[key] ?? 0) + 1;
}

function sameJson(left: unknown, right: unknown) {
  return canonicalizeRfc8785(left) === canonicalizeRfc8785(right);
}

function comparePortableAscii(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedText(value: unknown, field: string, maximum = 160) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || value.trim() !== value) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_dsa_population_row", false, field);
  }
  return value;
}

function validEan13(value: string) {
  if (!/^[0-9]{13}$/u.test(value)) return false;
  const digits = [...value].map(Number);
  const checksum = digits.slice(0, 12).reduce((sum, digit, index) => sum + digit * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (checksum % 10)) % 10 === digits[12];
}

function normalizePilotStatement(input: DsaTransparencyPilotStatement, harmonisedCategory: string) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TokenlessServiceError("Transparency statement is invalid.", 400, "invalid_dsa_population_row");
  }
  const keys = Object.keys(input).sort();
  const expectedKeys = ["category", "categorySpecification", "contentId", "decisionVisibility", "reasonCode"];
  if (!sameJson(keys, expectedKeys)) {
    throw new TokenlessServiceError(
      "Transparency statement contains unsupported fields.",
      400,
      "dsa_transparency_preflight_failed",
    );
  }
  if (
    input.decisionVisibility !== "DECISION_VISIBILITY_CONTENT_DISABLED" ||
    !validEan13(input.contentId) ||
    !DSA_STATEMENT_CATEGORIES.includes(input.category) ||
    !DSA_PILOT_CATEGORY_SPECIFICATIONS.includes(input.categorySpecification) ||
    input.categorySpecification !== harmonisedCategory ||
    !DSA_REASON_CODES.includes(input.reasonCode) ||
    (input.category === "STATEMENT_CATEGORY_ILLEGAL_CONTENT") !== (input.reasonCode === "ILLEGAL_POLICY_MATCH")
  ) {
    throw new TokenlessServiceError(
      "Transparency statement is outside the current typed Commission pilot schema.",
      400,
      "dsa_transparency_preflight_failed",
    );
  }
  return {
    category: input.category,
    category_specification: input.categorySpecification,
    content_id: input.contentId,
    decision_facts: SERVER_DECISION_FACTS[input.reasonCode],
    decision_visibility: [input.decisionVisibility],
  };
}

type DsaSourceManifestUnit = { providerDecisionId: string; decisionVersion: number };

function recordDigest(domain: string, header: unknown) {
  const digest = createHash("sha256");
  digest.update(`${domain}\0${canonicalizeRfc8785(header)}\n`, "utf8");
  return {
    add(value: unknown) {
      digest.update(`${canonicalizeRfc8785(value)}\n`, "utf8");
    },
    finish() {
      return `sha256:${digest.digest("hex")}` as const;
    },
  };
}

export function computeDsaSourceManifestRoot(input: readonly DsaSourceManifestUnit[]) {
  const normalized = input
    .map(unit => {
      if (!IDENTIFIER.test(unit.providerDecisionId)) {
        throw new TokenlessServiceError("Source manifest decision ID is invalid.", 400, "invalid_dsa_population");
      }
      return {
        providerDecisionId: unit.providerDecisionId,
        decisionVersion: positiveInteger(unit.decisionVersion, "decisionVersion"),
      };
    })
    .sort(
      (left, right) =>
        comparePortableAscii(left.providerDecisionId, right.providerDecisionId) ||
        left.decisionVersion - right.decisionVersion,
    );
  if (new Set(normalized.map(unit => unit.providerDecisionId)).size !== normalized.length) {
    throw new TokenlessServiceError(
      "Source manifest contains a provider decision more than once, including across versions.",
      400,
      "invalid_dsa_population",
    );
  }
  const digest = recordDigest("rateloop.dsa-source-manifest.v1", { count: normalized.length });
  normalized.forEach(unit => digest.add(unit));
  return digest.finish();
}

function populationRootDigest(declaredContractHash: string) {
  return recordDigest("rateloop.dsa-population-root.v1", { declaredContractHash });
}

function opaquePuid() {
  return `rls_${randomUUID().replaceAll("-", "")}`;
}

function attemptId() {
  const compact = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "").slice(0, 8);
  return `dsaa_${compact}`;
}

export async function createDsaPopulationVersion(input: {
  accountAddress: string;
  workspaceId: string;
  populationId: string;
  version: number;
  periodStart: Date;
  periodEnd: Date;
  sourceSystems: readonly string[];
  partitionDimensions: readonly string[];
  declaredSourceTotals: Record<string, number>;
  declaredPartitionTotals: readonly { values: Record<string, string>; total: number }[];
  expectedSourceManifest: readonly DsaSourceManifestUnit[];
  expectedRowCount: number;
  expectedPageCount: number;
  now?: Date;
}) {
  if (!SIMPLE_IDENTIFIER.test(input.workspaceId) || !SIMPLE_IDENTIFIER.test(input.populationId)) {
    throw new TokenlessServiceError("Population scope is invalid.", 400, "invalid_dsa_population");
  }
  const version = positiveInteger(input.version, "version");
  const expectedRowCount = positiveInteger(input.expectedRowCount, "expectedRowCount");
  const expectedPageCount = positiveInteger(input.expectedPageCount, "expectedPageCount");
  if (
    expectedPageCount > expectedRowCount ||
    expectedRowCount > MAX_POPULATION_ROWS ||
    expectedPageCount > MAX_POPULATION_ROWS
  ) {
    throw new TokenlessServiceError("Population size is invalid.", 400, "invalid_dsa_population");
  }
  const periodStart = date(input.periodStart, "periodStart");
  const periodEnd = date(input.periodEnd, "periodEnd");
  if (periodEnd <= periodStart) {
    throw new TokenlessServiceError("periodEnd must be after periodStart.", 400, "invalid_dsa_population");
  }
  const sourceSystems = uniqueStrings(input.sourceSystems, "sourceSystems");
  const partitionDimensions = uniqueStrings(input.partitionDimensions, "partitionDimensions");
  const sourceTotals = normalizedSourceTotals(sourceSystems, input.declaredSourceTotals);
  const partitionTotals: Record<string, number> = {};
  for (const entry of input.declaredPartitionTotals) {
    if (!Number.isSafeInteger(entry.total) || entry.total < 0) {
      throw new TokenlessServiceError("Partition totals must be non-negative integers.", 400, "invalid_dsa_population");
    }
    const key = partitionKey(partitionDimensions, entry.values);
    if (partitionTotals[key] !== undefined) {
      throw new TokenlessServiceError("Declared partition totals contain a duplicate.", 400, "invalid_dsa_population");
    }
    partitionTotals[key] = entry.total;
  }
  const sortedPartitionTotals = Object.fromEntries(
    Object.entries(partitionTotals).sort(([left], [right]) => comparePortableAscii(left, right)),
  );
  const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
  if (
    sum(Object.values(sourceTotals)) !== expectedRowCount ||
    sum(Object.values(sortedPartitionTotals)) !== expectedRowCount ||
    input.expectedSourceManifest.length !== expectedRowCount
  ) {
    throw new TokenlessServiceError("Declared totals must equal expectedRowCount.", 400, "invalid_dsa_population");
  }
  const declaredSourceManifestRoot = computeDsaSourceManifestRoot(input.expectedSourceManifest);
  const contract = {
    schemaVersion: DSA_POPULATION_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    populationId: input.populationId,
    version,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    sourceSystems,
    partitionDimensions,
    declaredSourceTotals: sourceTotals,
    declaredPartitionTotals: sortedPartitionTotals,
    declaredSourceManifestRoot,
    expectedRowCount,
    expectedPageCount,
  };
  const declaredContractHash = sha256Rfc8785(contract);
  const now = validNow(input.now);
  return inTransaction(async client => {
    const actor = await requireManager(client, input.accountAddress, input.workspaceId);
    const existing = await client.query(
      `SELECT declared_contract_hash,status,created_at FROM tokenless_dsa_population_versions
       WHERE workspace_id=$1 AND population_id=$2 AND version=$3 FOR UPDATE`,
      [input.workspaceId, input.populationId, version],
    );
    if (existing.rowCount === 1) {
      if (text(existing.rows[0] as Row, "declared_contract_hash") !== declaredContractHash) {
        throw new TokenlessServiceError(
          "This population version already has a different frozen ingest contract. Create a new version.",
          409,
          "dsa_population_version_conflict",
        );
      }
      return { ...contract, declaredContractHash, status: text(existing.rows[0] as Row, "status"), idempotent: true };
    }
    await client.query(
      `INSERT INTO tokenless_dsa_population_versions
       (workspace_id,population_id,version,schema_version,source_systems_json,partition_dimensions_json,
        declared_source_totals_json,declared_partition_totals_json,declared_source_manifest_root,
        declared_contract_hash,period_start,period_end,expected_row_count,expected_page_count,status,created_by,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'ingesting',$15,$16)`,
      [
        input.workspaceId,
        input.populationId,
        version,
        DSA_POPULATION_SCHEMA_VERSION,
        canonicalizeRfc8785(sourceSystems),
        canonicalizeRfc8785(partitionDimensions),
        canonicalizeRfc8785(sourceTotals),
        canonicalizeRfc8785(sortedPartitionTotals),
        declaredSourceManifestRoot,
        declaredContractHash,
        periodStart,
        periodEnd,
        expectedRowCount,
        expectedPageCount,
        actor,
        now,
      ],
    );
    return { ...contract, declaredContractHash, status: "ingesting" as const, idempotent: false };
  });
}

type NormalizedPopulationRow = {
  engagementId: string;
  engagementVersion: number;
  engagementJson: string;
  engagementHash: string;
  providerDecisionId: string;
  decisionVersion: number;
  sourceSystem: string;
  sourceDecisionJson: string;
  sourceDecisionHash: string;
  decisionAt: Date;
  partitionKey: string;
  partitionValuesJson: string;
  sorApplicability: DsaSorApplicability;
  nonRequiredBasis: string | null;
  transparency: null | {
    payloadVersion: number;
    payloadJson: string;
    payloadHash: string;
    internalReferenceHash: string;
  };
};

function normalizePopulationRow(
  input: DsaPopulationRowInput,
  contract: {
    sourceSystems: readonly string[];
    partitionDimensions: readonly string[];
    periodStart: Date;
    periodEnd: Date;
  },
): NormalizedPopulationRow {
  if (!IDENTIFIER.test(input.engagementId) || !IDENTIFIER.test(input.providerDecisionId)) {
    throw new TokenlessServiceError("Population row identifiers are invalid.", 400, "invalid_dsa_population_row");
  }
  const engagementVersion = positiveInteger(input.engagementVersion, "engagementVersion");
  const decisionVersion = positiveInteger(input.decisionVersion, "decisionVersion");
  if (!contract.sourceSystems.includes(input.sourceSystem)) {
    throw new TokenlessServiceError("Population row source system is undeclared.", 400, "invalid_dsa_population_row");
  }
  const service = boundedText(input.service, "service");
  const language = boundedText(input.language, "language", 35);
  const contentFormat = boundedText(input.contentFormat, "contentFormat", 160);
  const policyVersion = boundedText(input.policyVersion, "policyVersion");
  const automatedSystemVersion = boundedText(input.automatedSystemVersion, "automatedSystemVersion");
  const originalAutomatedLabel = boundedText(input.originalAutomatedLabel, "originalAutomatedLabel");
  const originalRestriction = boundedText(input.originalRestriction, "originalRestriction");
  if (
    !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(language) ||
    !/^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u.test(contentFormat) ||
    !DSA_PILOT_CATEGORY_SPECIFICATIONS.includes(input.harmonisedCategory) ||
    !DSA_TRIGGER_SOURCES.includes(input.triggerSource) ||
    !DSA_ELIGIBILITY_STATUSES.includes(input.eligibilityStatus) ||
    !/^sha256:[0-9a-f]{64}$/u.test(input.contentHash) ||
    !/^dsaobj_[A-Za-z0-9_-]{16,160}$/u.test(input.contentLocator)
  ) {
    throw new TokenlessServiceError("Population row contract is invalid.", 400, "invalid_dsa_population_row");
  }
  const exclusionReason = input.exclusionReason;
  if (
    (input.eligibilityStatus === "eligible" && exclusionReason !== null) ||
    (input.eligibilityStatus === "excluded" &&
      (typeof exclusionReason !== "string" || !/^[a-z][a-z0-9_]{2,79}$/u.test(exclusionReason)))
  ) {
    throw new TokenlessServiceError("Eligibility and exclusion reason conflict.", 400, "invalid_dsa_population_row");
  }
  const decisionAt = date(input.decisionAt, "decisionAt");
  if (decisionAt < contract.periodStart || decisionAt >= contract.periodEnd) {
    throw new TokenlessServiceError(
      "Population row is outside the declared period.",
      400,
      "invalid_dsa_population_row",
    );
  }
  if (!APPLICABILITY.has(input.sorApplicability)) {
    throw new TokenlessServiceError(
      "Statement-of-reasons applicability is invalid.",
      400,
      "invalid_dsa_population_row",
    );
  }
  const nonRequiredBasis = input.sorApplicability === "required" ? null : (input.nonRequiredBasis ?? null);
  if (
    (input.sorApplicability === "required" && input.nonRequiredBasis !== undefined) ||
    (input.sorApplicability !== "required" && nonRequiredBasis !== input.sorApplicability)
  ) {
    throw new TokenlessServiceError(
      "A coded non-required basis must exactly match every non-required applicability decision.",
      400,
      "invalid_dsa_population_row",
    );
  }
  const sourceDecisionJson = canonicalizeRfc8785({
    automatedSystemVersion,
    decisionAt: decisionAt.toISOString(),
    decisionVersion,
    originalAutomatedLabel,
    originalRestriction,
    policyVersion,
    providerDecisionId: input.providerDecisionId,
    service,
    sourceSystem: input.sourceSystem,
    triggerSource: input.triggerSource,
  });
  const engagementJson = canonicalizeRfc8785({
    contentFormat,
    contentHash: input.contentHash,
    contentLocator: input.contentLocator,
    eligibilityStatus: input.eligibilityStatus,
    engagementId: input.engagementId,
    engagementVersion,
    eventTime: decisionAt.toISOString(),
    exclusionReason,
    harmonisedCategory: input.harmonisedCategory,
    language,
    service,
  });
  const partitionValuesJson = partitionKey(contract.partitionDimensions, input.partitionValues);
  let transparency: NormalizedPopulationRow["transparency"] = null;
  if (input.transparency) {
    const payloadVersion = positiveInteger(input.transparency.payloadVersion, "payloadVersion");
    const payload = normalizePilotStatement(input.transparency.statement, input.harmonisedCategory);
    const payloadJson = canonicalizeRfc8785(payload);
    transparency = {
      payloadVersion,
      payloadJson,
      payloadHash: sha256Rfc8785(payload),
      internalReferenceHash: sha256Rfc8785({ providerDecisionId: input.providerDecisionId, decisionVersion }),
    };
  }
  if (input.sorApplicability === "required" && transparency === null) {
    throw new TokenlessServiceError(
      "A required statement must bind a typed Transparency Database payload before ingest.",
      400,
      "dsa_transparency_payload_required",
    );
  }
  return {
    engagementId: input.engagementId,
    engagementVersion,
    engagementJson,
    engagementHash: sha256Rfc8785(JSON.parse(engagementJson)),
    providerDecisionId: input.providerDecisionId,
    decisionVersion,
    sourceSystem: input.sourceSystem,
    sourceDecisionJson,
    sourceDecisionHash: sha256Rfc8785(JSON.parse(sourceDecisionJson)),
    decisionAt,
    partitionKey: partitionValuesJson,
    partitionValuesJson,
    sorApplicability: input.sorApplicability,
    nonRequiredBasis,
    transparency,
  };
}

function placeholders(rowCount: number, columnCount: number, start = 1) {
  return Array.from(
    { length: rowCount },
    (_row, rowIndex) =>
      `(${Array.from({ length: columnCount }, (_column, columnIndex) => `$${start + rowIndex * columnCount + columnIndex}`).join(",")})`,
  ).join(",");
}

export async function ingestDsaPopulationPage(input: {
  accountAddress: string;
  workspaceId: string;
  populationId: string;
  populationVersion: number;
  pageNumber: number;
  idempotencyKey: string;
  rows: readonly DsaPopulationRowInput[];
  now?: Date;
}) {
  if (
    !SIMPLE_IDENTIFIER.test(input.workspaceId) ||
    !SIMPLE_IDENTIFIER.test(input.populationId) ||
    !IDEMPOTENCY_KEY.test(input.idempotencyKey) ||
    input.rows.length === 0 ||
    input.rows.length > MAX_PAGE_ROWS
  ) {
    throw new TokenlessServiceError("Population ingest page is invalid.", 400, "invalid_dsa_population_page");
  }
  const populationVersion = positiveInteger(input.populationVersion, "populationVersion");
  const pageNumber = positiveInteger(input.pageNumber, "pageNumber");
  const now = validNow(input.now);
  return inTransaction(async client => {
    await requireManager(client, input.accountAddress, input.workspaceId);
    const populationResult = await client.query(
      `SELECT * FROM tokenless_dsa_population_versions
       WHERE workspace_id=$1 AND population_id=$2 AND version=$3 FOR UPDATE`,
      [input.workspaceId, input.populationId, populationVersion],
    );
    const population = populationResult.rows[0] as Row | undefined;
    if (!population || text(population, "status") !== "ingesting") {
      throw new TokenlessServiceError("Open population version not found.", 404, "dsa_population_not_found");
    }
    const expectedPageCount = integer(population, "expected_page_count", 1);
    if (pageNumber > expectedPageCount) {
      throw new TokenlessServiceError(
        "Page number exceeds the frozen ingest contract.",
        409,
        "dsa_population_page_conflict",
      );
    }
    const sourceSystems = parseStoredJson(text(population, "source_systems_json"), "source systems");
    const partitionDimensions = parseStoredJson(text(population, "partition_dimensions_json"), "partition dimensions");
    if (!Array.isArray(sourceSystems) || !sourceSystems.every(value => typeof value === "string")) {
      throw new TokenlessServiceError("Stored source systems are invalid.", 500, "stored_dsa_evidence_invalid");
    }
    if (!Array.isArray(partitionDimensions) || !partitionDimensions.every(value => typeof value === "string")) {
      throw new TokenlessServiceError("Stored partition dimensions are invalid.", 500, "stored_dsa_evidence_invalid");
    }
    const normalized = input.rows
      .map(row =>
        normalizePopulationRow(row, {
          sourceSystems,
          partitionDimensions,
          periodStart: date(population.period_start, "stored period start"),
          periodEnd: date(population.period_end, "stored period end"),
        }),
      )
      .sort(
        (left, right) =>
          comparePortableAscii(left.engagementId, right.engagementId) ||
          left.engagementVersion - right.engagementVersion,
      );
    if (
      new Set(normalized.map(row => row.engagementId)).size !== normalized.length ||
      new Set(normalized.map(row => row.providerDecisionId)).size !== normalized.length
    ) {
      throw new TokenlessServiceError("Population page contains duplicate rows.", 409, "dsa_population_duplicate_row");
    }
    const requestIdentity = normalized.map(row => ({
      ...row,
      decisionAt: row.decisionAt.toISOString(),
      transparency: row.transparency,
    }));
    const requestHash = sha256Rfc8785({
      populationId: input.populationId,
      populationVersion,
      pageNumber,
      rows: requestIdentity,
    });
    const pageRoot = sha256Rfc8785({ schemaVersion: "rateloop.dsa-population-ingest-page.v1", rows: requestIdentity });
    const idempotencyKeyHash = sha256Rfc8785({ idempotencyKey: input.idempotencyKey });
    const existingPage = await client.query(
      `SELECT page_number,idempotency_key_hash,request_hash,page_root,row_count
       FROM tokenless_dsa_population_ingest_pages
       WHERE workspace_id=$1 AND population_id=$2 AND population_version=$3
         AND (page_number=$4 OR idempotency_key_hash=$5) FOR UPDATE`,
      [input.workspaceId, input.populationId, populationVersion, pageNumber, idempotencyKeyHash],
    );
    if ((existingPage.rowCount ?? 0) > 0) {
      const exact = existingPage.rows.find(
        row =>
          integer(row as Row, "page_number", 1) === pageNumber &&
          text(row as Row, "idempotency_key_hash") === idempotencyKeyHash &&
          text(row as Row, "request_hash") === requestHash &&
          text(row as Row, "page_root") === pageRoot &&
          integer(row as Row, "row_count", 1) === normalized.length,
      );
      if (exact && existingPage.rowCount === 1) {
        return { pageNumber, pageRoot, requestHash, rowCount: normalized.length, idempotent: true };
      }
      throw new TokenlessServiceError(
        "Population page conflicts with prior ingest.",
        409,
        "dsa_population_page_conflict",
      );
    }
    const currentCountResult = await client.query(
      `SELECT COUNT(*) AS row_count FROM tokenless_dsa_engagement_versions
       WHERE workspace_id=$1 AND population_id=$2 AND population_version=$3`,
      [input.workspaceId, input.populationId, populationVersion],
    );
    if (
      integer(currentCountResult.rows[0] as Row, "row_count") + normalized.length >
      integer(population, "expected_row_count", 1)
    ) {
      throw new TokenlessServiceError("Population page exceeds expectedRowCount.", 409, "dsa_population_extra_rows");
    }
    const ids = normalized.map(row => row.providerDecisionId);
    const engagementIds = normalized.map(row => row.engagementId);
    const existingMembers = await client.query(
      `SELECT provider_decision_id,engagement_id FROM tokenless_dsa_engagement_versions
       WHERE workspace_id=$1 AND population_id=$2 AND population_version=$3
         AND (provider_decision_id IN (${ids.map((_id, index) => `$${index + 4}`).join(",")})
          OR engagement_id IN (${engagementIds.map((_id, index) => `$${index + 4 + ids.length}`).join(",")}))`,
      [input.workspaceId, input.populationId, populationVersion, ...ids, ...engagementIds],
    );
    if ((existingMembers.rowCount ?? 0) > 0) {
      throw new TokenlessServiceError(
        "Provider decision or engagement is already in this population, including under another version.",
        409,
        "dsa_population_duplicate_row",
      );
    }
    const existingSources = await client.query(
      `SELECT provider_decision_id,decision_version,source_decision_hash,source_system,decision_at,
              sor_applicability,non_required_basis
       FROM tokenless_dsa_source_decision_versions
       WHERE workspace_id=$1 AND provider_decision_id IN (${ids.map((_id, index) => `$${index + 2}`).join(",")})`,
      [input.workspaceId, ...ids],
    );
    const existingByVersion = new Map(
      existingSources.rows.map(row => [
        `${text(row as Row, "provider_decision_id")}:${integer(row as Row, "decision_version", 1)}`,
        row as Row,
      ]),
    );
    for (const row of normalized) {
      const existing = existingByVersion.get(`${row.providerDecisionId}:${row.decisionVersion}`);
      if (
        existing &&
        (text(existing, "source_decision_hash") !== row.sourceDecisionHash ||
          text(existing, "source_system") !== row.sourceSystem ||
          date(existing.decision_at, "stored decision time").getTime() !== row.decisionAt.getTime() ||
          text(existing, "sor_applicability") !== row.sorApplicability ||
          text(existing, "non_required_basis") !== row.nonRequiredBasis)
      ) {
        throw new TokenlessServiceError(
          "Provider decision version conflicts with immutable source evidence. Create an explicit new decision version.",
          409,
          "dsa_source_decision_version_conflict",
        );
      }
    }
    const newSources = normalized.filter(
      row => !existingByVersion.has(`${row.providerDecisionId}:${row.decisionVersion}`),
    );
    if (newSources.length > 0) {
      await client.query(
        `INSERT INTO tokenless_dsa_source_decision_versions
         (workspace_id,provider_decision_id,decision_version,schema_version,source_system,source_decision_json,
          source_decision_hash,decision_at,sor_applicability,non_required_basis,created_at)
         VALUES ${placeholders(newSources.length, 11)}`,
        newSources.flatMap(row => [
          input.workspaceId,
          row.providerDecisionId,
          row.decisionVersion,
          DSA_SOURCE_DECISION_SCHEMA_VERSION,
          row.sourceSystem,
          row.sourceDecisionJson,
          row.sourceDecisionHash,
          row.decisionAt,
          row.sorApplicability,
          row.nonRequiredBasis,
          now,
        ]),
      );
    }
    const existingEngagements = await client.query(
      `SELECT engagement_id,engagement_version,engagement_hash
       FROM tokenless_dsa_source_engagement_versions
       WHERE workspace_id=$1 AND engagement_id IN (${engagementIds.map((_id, index) => `$${index + 2}`).join(",")})`,
      [input.workspaceId, ...engagementIds],
    );
    const existingEngagementByVersion = new Map(
      existingEngagements.rows.map(row => [
        `${text(row as Row, "engagement_id")}:${integer(row as Row, "engagement_version", 1)}`,
        row as Row,
      ]),
    );
    for (const row of normalized) {
      const existing = existingEngagementByVersion.get(`${row.engagementId}:${row.engagementVersion}`);
      if (existing && text(existing, "engagement_hash") !== row.engagementHash) {
        throw new TokenlessServiceError(
          "Engagement version conflicts with immutable source evidence. Create an explicit new engagement version.",
          409,
          "dsa_source_engagement_version_conflict",
        );
      }
    }
    const newEngagements = normalized.filter(
      row => !existingEngagementByVersion.has(`${row.engagementId}:${row.engagementVersion}`),
    );
    if (newEngagements.length > 0) {
      await client.query(
        `INSERT INTO tokenless_dsa_source_engagement_versions
         (workspace_id,engagement_id,engagement_version,schema_version,engagement_json,engagement_hash,created_at)
         VALUES ${placeholders(newEngagements.length, 7)}`,
        newEngagements.flatMap(row => [
          input.workspaceId,
          row.engagementId,
          row.engagementVersion,
          DSA_ENGAGEMENT_SCHEMA_VERSION,
          row.engagementJson,
          row.engagementHash,
          now,
        ]),
      );
    }
    const generatedPayloads: Array<{
      providerDecisionId: string;
      decisionVersion: number;
      payloadVersion: number;
      puid: string;
    }> = [];
    for (const row of normalized) {
      if (!row.transparency) continue;
      const storedPayload = await client.query(
        `SELECT p.puid,p.payload_hash,p.request_hash,p.server_generated_text_only,
                x.internal_reference_hash
         FROM tokenless_dsa_transparency_payload_versions p
         JOIN tokenless_dsa_transparency_private_crosswalks x
           ON x.workspace_id=p.workspace_id AND x.provider_decision_id=p.provider_decision_id
          AND x.decision_version=p.decision_version AND x.payload_version=p.payload_version
         WHERE p.workspace_id=$1 AND p.provider_decision_id=$2 AND p.decision_version=$3 AND p.payload_version=$4
         FOR UPDATE`,
        [input.workspaceId, row.providerDecisionId, row.decisionVersion, row.transparency.payloadVersion],
      );
      if (storedPayload.rowCount === 1) {
        const stored = storedPayload.rows[0] as Row;
        const storedPuid = text(stored, "puid")!;
        const expectedRequestHash = sha256Rfc8785({
          payload: JSON.parse(row.transparency.payloadJson) as unknown,
          puid: storedPuid,
        });
        if (
          !PUID.test(storedPuid) ||
          text(stored, "payload_hash") !== row.transparency.payloadHash ||
          text(stored, "request_hash") !== expectedRequestHash ||
          text(stored, "internal_reference_hash") !== row.transparency.internalReferenceHash ||
          stored.server_generated_text_only !== true
        ) {
          throw new TokenlessServiceError(
            "Transparency Database payload version conflicts with immutable evidence. Create a new payload version.",
            409,
            "dsa_transparency_payload_version_conflict",
          );
        }
        generatedPayloads.push({
          providerDecisionId: row.providerDecisionId,
          decisionVersion: row.decisionVersion,
          payloadVersion: row.transparency.payloadVersion,
          puid: storedPuid,
        });
        continue;
      }
      const puid = opaquePuid();
      const requestHash = sha256Rfc8785({ payload: JSON.parse(row.transparency.payloadJson) as unknown, puid });
      await client.query(
        `INSERT INTO tokenless_dsa_transparency_payload_versions
         (workspace_id,provider_decision_id,decision_version,payload_version,schema_version,commission_schema_version,
          puid,payload_json,payload_hash,request_hash,server_generated_text_only,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11)`,
        [
          input.workspaceId,
          row.providerDecisionId,
          row.decisionVersion,
          row.transparency.payloadVersion,
          DSA_TRANSPARENCY_PAYLOAD_SCHEMA_VERSION,
          DSA_TRANSPARENCY_DATABASE_SCHEMA_VERSION,
          puid,
          row.transparency.payloadJson,
          row.transparency.payloadHash,
          requestHash,
          now,
        ],
      );
      await client.query(
        `INSERT INTO tokenless_dsa_transparency_private_crosswalks
         (workspace_id,provider_decision_id,decision_version,payload_version,puid,internal_reference_hash,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          input.workspaceId,
          row.providerDecisionId,
          row.decisionVersion,
          row.transparency.payloadVersion,
          puid,
          row.transparency.internalReferenceHash,
          now,
        ],
      );
      generatedPayloads.push({
        providerDecisionId: row.providerDecisionId,
        decisionVersion: row.decisionVersion,
        payloadVersion: row.transparency.payloadVersion,
        puid,
      });
    }
    await client.query(
      `INSERT INTO tokenless_dsa_engagement_versions
       (workspace_id,population_id,population_version,engagement_id,engagement_version,schema_version,
        provider_decision_id,decision_version,transparency_payload_version,partition_key,partition_values_json,
        ingest_page_number,created_at)
       VALUES ${placeholders(normalized.length, 13)}`,
      normalized.flatMap(row => [
        input.workspaceId,
        input.populationId,
        populationVersion,
        row.engagementId,
        row.engagementVersion,
        DSA_ENGAGEMENT_SCHEMA_VERSION,
        row.providerDecisionId,
        row.decisionVersion,
        row.transparency?.payloadVersion ?? null,
        row.partitionKey,
        row.partitionValuesJson,
        pageNumber,
        now,
      ]),
    );
    await client.query(
      `INSERT INTO tokenless_dsa_population_ingest_pages
       (workspace_id,population_id,population_version,page_number,schema_version,idempotency_key_hash,
        request_hash,page_root,row_count,created_at)
       VALUES ($1,$2,$3,$4,'rateloop.dsa-population-ingest-page.v1',$5,$6,$7,$8,$9)`,
      [
        input.workspaceId,
        input.populationId,
        populationVersion,
        pageNumber,
        idempotencyKeyHash,
        requestHash,
        pageRoot,
        normalized.length,
        now,
      ],
    );
    return {
      pageNumber,
      pageRoot,
      requestHash,
      rowCount: normalized.length,
      transparencyPayloads: generatedPayloads,
      idempotent: false,
    };
  });
}

function blocker(blockers: DsaReconciliationBlocker[], code: DsaReconciliationBlocker["code"], count: number) {
  if (count > 0) blockers.push({ code, count });
}

export async function reconcileAndFreezeDsaPopulation(input: {
  accountAddress: string;
  workspaceId: string;
  populationId: string;
  populationVersion: number;
  now?: Date;
}) {
  const populationVersion = positiveInteger(input.populationVersion, "populationVersion");
  const now = validNow(input.now);
  return inTransaction(async client => {
    const actor = await requireManager(client, input.accountAddress, input.workspaceId);
    const populationResult = await client.query(
      `SELECT * FROM tokenless_dsa_population_versions
       WHERE workspace_id=$1 AND population_id=$2 AND version=$3 FOR UPDATE`,
      [input.workspaceId, input.populationId, populationVersion],
    );
    const population = populationResult.rows[0] as Row | undefined;
    if (!population) throw new TokenlessServiceError("Population not found.", 404, "dsa_population_not_found");
    if (text(population, "status") === "frozen") {
      return {
        status: "frozen" as const,
        reconciliationVersion: integer(population, "frozen_reconciliation_version", 1),
        computedRoot: text(population, "frozen_root")!,
        computedRowCount: integer(population, "frozen_row_count", 1),
        blockers: [] as DsaReconciliationBlocker[],
        idempotent: true,
      };
    }
    const blockers: DsaReconciliationBlocker[] = [];
    const expectedRowCount = integer(population, "expected_row_count", 1);
    const expectedPageCount = integer(population, "expected_page_count", 1);
    const declaredSourceTotals = parseStoredJson(
      text(population, "declared_source_totals_json"),
      "declared source totals",
    );
    const declaredPartitionTotals = parseStoredJson(
      text(population, "declared_partition_totals_json"),
      "declared partition totals",
    );
    if (
      !declaredSourceTotals ||
      typeof declaredSourceTotals !== "object" ||
      Array.isArray(declaredSourceTotals) ||
      !declaredPartitionTotals ||
      typeof declaredPartitionTotals !== "object" ||
      Array.isArray(declaredPartitionTotals)
    ) {
      throw new TokenlessServiceError("Stored declared totals are invalid.", 500, "stored_dsa_evidence_invalid");
    }
    const sourceTotals: Record<string, number> = Object.fromEntries(
      Object.keys(declaredSourceTotals).map(key => [key, 0]),
    );
    const partitionTotals: Record<string, number> = Object.fromEntries(
      Object.keys(declaredPartitionTotals).map(key => [key, 0]),
    );
    const actualPageCounts = new Map<number, number>();
    const rootDigest = populationRootDigest(text(population, "declared_contract_hash")!);
    let computedRowCount = 0;
    let unmatchedSourceDecisions = 0;
    let missingPayloads = 0;
    let missingReceipts = 0;
    let engagementCursor: { hex: string; version: number } | null = null;
    for (;;) {
      const cursorPredicate = engagementCursor
        ? `AND (encode(convert_to(e.engagement_id,'UTF8'),'hex') > $4
             OR (encode(convert_to(e.engagement_id,'UTF8'),'hex') = $4 AND e.engagement_version > $5))`
        : "";
      const page = await client.query(
        `SELECT e.engagement_id,e.engagement_version,e.provider_decision_id,e.decision_version,
                e.transparency_payload_version,e.partition_key,e.partition_values_json,e.ingest_page_number,
                source_engagement.engagement_hash,s.source_system,s.source_decision_hash,s.decision_at,
                s.sor_applicability,s.non_required_basis,p.payload_version,p.puid,p.payload_hash,r.receipt_hash,
                encode(convert_to(e.engagement_id,'UTF8'),'hex') AS engagement_cursor
         FROM tokenless_dsa_engagement_versions e
         LEFT JOIN tokenless_dsa_source_engagement_versions source_engagement
           ON source_engagement.workspace_id=e.workspace_id AND source_engagement.engagement_id=e.engagement_id
          AND source_engagement.engagement_version=e.engagement_version
         LEFT JOIN tokenless_dsa_source_decision_versions s
           ON s.workspace_id=e.workspace_id AND s.provider_decision_id=e.provider_decision_id
          AND s.decision_version=e.decision_version
         LEFT JOIN tokenless_dsa_transparency_payload_versions p
           ON p.workspace_id=e.workspace_id AND p.provider_decision_id=e.provider_decision_id
          AND p.decision_version=e.decision_version AND p.payload_version=e.transparency_payload_version
         LEFT JOIN tokenless_dsa_transparency_receipt_versions r
           ON r.workspace_id=p.workspace_id AND r.provider_decision_id=p.provider_decision_id
          AND r.decision_version=p.decision_version AND r.payload_version=p.payload_version
         WHERE e.workspace_id=$1 AND e.population_id=$2 AND e.population_version=$3 ${cursorPredicate}
         ORDER BY encode(convert_to(e.engagement_id,'UTF8'),'hex'),e.engagement_version
         LIMIT ${RECONCILIATION_PAGE_ROWS}`,
        engagementCursor
          ? [input.workspaceId, input.populationId, populationVersion, engagementCursor.hex, engagementCursor.version]
          : [input.workspaceId, input.populationId, populationVersion],
      );
      const rows = page.rows as Row[];
      for (const row of rows) {
        const providerDecisionId = text(row, "provider_decision_id")!;
        const decisionVersion = integer(row, "decision_version", 1);
        const applicability = text(row, "sor_applicability");
        const payloadVersion =
          row.transparency_payload_version === null ? null : integer(row, "transparency_payload_version", 1);
        const pageNumber = integer(row, "ingest_page_number", 1);
        actualPageCounts.set(pageNumber, (actualPageCounts.get(pageNumber) ?? 0) + 1);
        computedRowCount += 1;
        addCount(sourceTotals, text(row, "source_system") ?? "__unmatched__");
        addCount(partitionTotals, text(row, "partition_key") ?? "__unmatched__");
        if (!text(row, "source_decision_hash") || !text(row, "engagement_hash")) unmatchedSourceDecisions += 1;
        if (applicability === "required" && payloadVersion === null) missingPayloads += 1;
        if (applicability === "required" && !text(row, "receipt_hash")) missingReceipts += 1;
        rootDigest.add({
          engagementId: text(row, "engagement_id"),
          engagementVersion: integer(row, "engagement_version", 1),
          engagementHash: text(row, "engagement_hash"),
          providerDecisionId,
          decisionVersion,
          sourceSystem: text(row, "source_system"),
          sourceDecisionHash: text(row, "source_decision_hash"),
          decisionAt: date(row.decision_at, "stored decision time").toISOString(),
          partitionValues: parseStoredJson(text(row, "partition_values_json"), "partition values"),
          sorApplicability: applicability,
          nonRequiredBasis: text(row, "non_required_basis"),
          transparency:
            payloadVersion === null
              ? null
              : {
                  payloadVersion,
                  puid: text(row, "puid"),
                  payloadHash: text(row, "payload_hash"),
                  receiptHash: text(row, "receipt_hash"),
                },
        });
      }
      if (rows.length < RECONCILIATION_PAGE_ROWS) break;
      const last = rows.at(-1)!;
      engagementCursor = {
        hex: text(last, "engagement_cursor")!,
        version: integer(last, "engagement_version", 1),
      };
    }
    const computedRoot = rootDigest.finish();
    const sourceManifestDigest = recordDigest("rateloop.dsa-source-manifest.v1", { count: computedRowCount });
    let sourceCursor: { hex: string; version: number } | null = null;
    for (;;) {
      const cursorPredicate = sourceCursor
        ? `AND (encode(convert_to(provider_decision_id,'UTF8'),'hex') > $4
             OR (encode(convert_to(provider_decision_id,'UTF8'),'hex') = $4 AND decision_version > $5))`
        : "";
      const page = await client.query(
        `SELECT provider_decision_id,decision_version,
                encode(convert_to(provider_decision_id,'UTF8'),'hex') AS decision_cursor
         FROM tokenless_dsa_engagement_versions
         WHERE workspace_id=$1 AND population_id=$2 AND population_version=$3 ${cursorPredicate}
         ORDER BY encode(convert_to(provider_decision_id,'UTF8'),'hex'),decision_version
         LIMIT ${RECONCILIATION_PAGE_ROWS}`,
        sourceCursor
          ? [input.workspaceId, input.populationId, populationVersion, sourceCursor.hex, sourceCursor.version]
          : [input.workspaceId, input.populationId, populationVersion],
      );
      const rows = page.rows as Row[];
      rows.forEach(row =>
        sourceManifestDigest.add({
          providerDecisionId: text(row, "provider_decision_id"),
          decisionVersion: integer(row, "decision_version", 1),
        }),
      );
      if (rows.length < RECONCILIATION_PAGE_ROWS) break;
      const last = rows.at(-1)!;
      sourceCursor = { hex: text(last, "decision_cursor")!, version: integer(last, "decision_version", 1) };
    }
    const computedSourceManifestRoot = sourceManifestDigest.finish();
    const pagesResult = await client.query(
      `SELECT page_number,row_count FROM tokenless_dsa_population_ingest_pages
       WHERE workspace_id=$1 AND population_id=$2 AND population_version=$3 ORDER BY page_number`,
      [input.workspaceId, input.populationId, populationVersion],
    );
    const pageRows = pagesResult.rows as Row[];
    const pageNumbers = new Set(pageRows.map(row => integer(row, "page_number", 1)));
    let missingPages = 0;
    for (let pageNumber = 1; pageNumber <= expectedPageCount; pageNumber += 1) {
      if (!pageNumbers.has(pageNumber)) missingPages += 1;
    }
    blocker(blockers, "missing_pages", missingPages);
    blocker(blockers, "extra_pages", [...pageNumbers].filter(page => page > expectedPageCount).length);
    blocker(blockers, "row_count_mismatch", Math.abs(expectedRowCount - computedRowCount));
    blocker(
      blockers,
      "page_row_count_mismatch",
      pageRows.filter(row => actualPageCounts.get(integer(row, "page_number", 1)) !== integer(row, "row_count", 1))
        .length,
    );
    blocker(blockers, "unmatched_source_decision", unmatchedSourceDecisions);
    blocker(blockers, "missing_transparency_payload", missingPayloads);
    blocker(blockers, "missing_transparency_receipt", missingReceipts);
    const sortedSourceTotals = Object.fromEntries(
      Object.entries(sourceTotals).sort(([left], [right]) => comparePortableAscii(left, right)),
    );
    const sortedPartitionTotals = Object.fromEntries(
      Object.entries(partitionTotals).sort(([left], [right]) => comparePortableAscii(left, right)),
    );
    blocker(blockers, "source_totals_mismatch", sameJson(sortedSourceTotals, declaredSourceTotals) ? 0 : 1);
    blocker(blockers, "partition_totals_mismatch", sameJson(sortedPartitionTotals, declaredPartitionTotals) ? 0 : 1);
    blocker(
      blockers,
      "source_manifest_mismatch",
      computedSourceManifestRoot === text(population, "declared_source_manifest_root") ? 0 : 1,
    );
    const prior = await client.query(
      `SELECT COALESCE(MAX(reconciliation_version),0) AS version
       FROM tokenless_dsa_population_reconciliation_versions
       WHERE workspace_id=$1 AND population_id=$2 AND population_version=$3`,
      [input.workspaceId, input.populationId, populationVersion],
    );
    const reconciliationVersion = integer(prior.rows[0] as Row, "version") + 1;
    const reconciliation = {
      schemaVersion: DSA_RECONCILIATION_SCHEMA_VERSION,
      workspaceId: input.workspaceId,
      populationId: input.populationId,
      populationVersion,
      reconciliationVersion,
      status: blockers.length === 0 ? ("reconciled" as const) : ("blocked" as const),
      computedRowCount,
      computedRoot,
      computedSourceTotals: sortedSourceTotals,
      computedPartitionTotals: sortedPartitionTotals,
      blockers,
    };
    const reconciliationHash = sha256Rfc8785(reconciliation);
    await client.query(
      `INSERT INTO tokenless_dsa_population_reconciliation_versions
       (workspace_id,population_id,population_version,reconciliation_version,schema_version,status,
        computed_row_count,computed_root,computed_source_totals_json,computed_partition_totals_json,
        blockers_json,reconciliation_hash,created_by,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        input.workspaceId,
        input.populationId,
        populationVersion,
        reconciliationVersion,
        DSA_RECONCILIATION_SCHEMA_VERSION,
        reconciliation.status,
        computedRowCount,
        computedRoot,
        canonicalizeRfc8785(sortedSourceTotals),
        canonicalizeRfc8785(sortedPartitionTotals),
        canonicalizeRfc8785(blockers),
        reconciliationHash,
        actor,
        now,
      ],
    );
    if (blockers.length > 0) {
      return { ...reconciliation, reconciliationHash, idempotent: false };
    }
    await client.query(
      `UPDATE tokenless_dsa_population_versions
       SET status='frozen',frozen_reconciliation_version=$1,frozen_root=$2,frozen_row_count=$3,frozen_at=$4
       WHERE workspace_id=$5 AND population_id=$6 AND version=$7 AND status='ingesting'`,
      [
        reconciliationVersion,
        computedRoot,
        computedRowCount,
        now,
        input.workspaceId,
        input.populationId,
        populationVersion,
      ],
    );
    return { ...reconciliation, status: "frozen" as const, reconciliationHash, idempotent: false };
  });
}

function validCommissionUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "transparency.dsa.ec.europa.eu";
  } catch {
    return false;
  }
}

export async function recordDsaTransparencyDeliveryResult(input: {
  accountAddress: string;
  workspaceId: string;
  providerDecisionId: string;
  decisionVersion: number;
  payloadVersion: number;
  operation: "submit" | "puid_lookup";
  idempotencyKey: string;
  httpStatus: number;
  resultBody: unknown;
  startedAt: Date;
  completedAt: Date;
}) {
  if (
    !SIMPLE_IDENTIFIER.test(input.workspaceId) ||
    !IDENTIFIER.test(input.providerDecisionId) ||
    !IDEMPOTENCY_KEY.test(input.idempotencyKey) ||
    !Number.isSafeInteger(input.httpStatus) ||
    input.httpStatus < 100 ||
    input.httpStatus > 599
  ) {
    throw new TokenlessServiceError("Transparency delivery result is invalid.", 400, "invalid_dsa_delivery_result");
  }
  const decisionVersion = positiveInteger(input.decisionVersion, "decisionVersion");
  const payloadVersion = positiveInteger(input.payloadVersion, "payloadVersion");
  const startedAt = date(input.startedAt, "startedAt");
  const completedAt = date(input.completedAt, "completedAt");
  if (completedAt < startedAt) {
    throw new TokenlessServiceError("completedAt must not precede startedAt.", 400, "invalid_dsa_delivery_result");
  }
  const normalizedBody = input.resultBody === undefined ? null : input.resultBody;
  let resultJson: string;
  try {
    resultJson = canonicalizeRfc8785(normalizedBody);
  } catch {
    throw new TokenlessServiceError("Delivery result must be valid I-JSON.", 400, "invalid_dsa_delivery_result");
  }
  const resultHash = sha256Rfc8785(normalizedBody);
  const idempotencyKeyHash = sha256Rfc8785({ idempotencyKey: input.idempotencyKey });
  return inTransaction(async client => {
    await requireManager(client, input.accountAddress, input.workspaceId);
    const payloadResult = await client.query(
      `SELECT puid,payload_json,payload_hash,request_hash FROM tokenless_dsa_transparency_payload_versions
       WHERE workspace_id=$1 AND provider_decision_id=$2 AND decision_version=$3 AND payload_version=$4 FOR UPDATE`,
      [input.workspaceId, input.providerDecisionId, decisionVersion, payloadVersion],
    );
    const payload = payloadResult.rows[0] as Row | undefined;
    if (!payload)
      throw new TokenlessServiceError("Transparency payload not found.", 404, "dsa_transparency_payload_not_found");
    const requestHash =
      input.operation === "submit" ? text(payload, "request_hash")! : sha256Rfc8785({ puid: text(payload, "puid") });
    const idempotent = await client.query(
      `SELECT operation,request_hash,http_status,outcome,result_hash,attempt_version
       FROM tokenless_dsa_transparency_delivery_attempts
       WHERE workspace_id=$1 AND provider_decision_id=$2 AND decision_version=$3 AND payload_version=$4
         AND idempotency_key_hash=$5 FOR UPDATE`,
      [input.workspaceId, input.providerDecisionId, decisionVersion, payloadVersion, idempotencyKeyHash],
    );
    if (idempotent.rowCount === 1) {
      const stored = idempotent.rows[0] as Row;
      if (
        text(stored, "operation") === input.operation &&
        text(stored, "request_hash") === requestHash &&
        integer(stored, "http_status", 100) === input.httpStatus &&
        text(stored, "result_hash") === resultHash
      ) {
        return {
          attemptVersion: integer(stored, "attempt_version", 1),
          outcome: text(stored, "outcome"),
          idempotent: true,
        };
      }
      throw new TokenlessServiceError(
        "Delivery idempotency key conflicts with prior evidence.",
        409,
        "dsa_delivery_idempotency_conflict",
      );
    }
    const receipt = await client.query(
      `SELECT receipt_hash FROM tokenless_dsa_transparency_receipt_versions
       WHERE workspace_id=$1 AND provider_decision_id=$2 AND decision_version=$3 AND payload_version=$4`,
      [input.workspaceId, input.providerDecisionId, decisionVersion, payloadVersion],
    );
    if ((receipt.rowCount ?? 0) > 0) {
      throw new TokenlessServiceError(
        "Transparency payload already has complete delivery evidence.",
        409,
        "dsa_delivery_complete",
      );
    }
    const latestResult = await client.query(
      `SELECT attempt_version,operation,outcome FROM tokenless_dsa_transparency_delivery_attempts
       WHERE workspace_id=$1 AND provider_decision_id=$2 AND decision_version=$3 AND payload_version=$4
       ORDER BY attempt_version DESC LIMIT 1 FOR UPDATE`,
      [input.workspaceId, input.providerDecisionId, decisionVersion, payloadVersion],
    );
    const latest = latestResult.rows[0] as Row | undefined;
    const latestOutcome = text(latest, "outcome");
    if (
      input.operation === "puid_lookup" &&
      latestOutcome !== "unknown_pending_puid_lookup" &&
      latestOutcome !== "puid_lookup_unknown"
    ) {
      throw new TokenlessServiceError(
        "PUID lookup is allowed only after an ambiguous submission.",
        409,
        "dsa_puid_lookup_not_required",
      );
    }
    if (input.operation === "submit" && latestOutcome !== null && latestOutcome !== "puid_absent_retry_allowed") {
      throw new TokenlessServiceError(
        latestOutcome === "unknown_pending_puid_lookup" || latestOutcome === "puid_lookup_unknown"
          ? "Check the PUID before retrying an ambiguous submission."
          : "Create a new payload version before another submission.",
        409,
        latestOutcome === "unknown_pending_puid_lookup" || latestOutcome === "puid_lookup_unknown"
          ? "dsa_puid_lookup_required"
          : "dsa_delivery_terminal",
      );
    }
    let outcome: string;
    let creationReceipt: ReturnType<typeof classifyDsaSorSubmission>["receipt"] = null;
    let verifiedLookupReceipt: { httpStatus: 302; puid: string; resultHash: string } | null = null;
    if (input.operation === "submit") {
      const classified = classifyDsaSorSubmission(input.httpStatus, normalizedBody);
      creationReceipt = classified.receipt;
      outcome =
        classified.status === "unknown_outcome_check_puid_before_retry"
          ? "unknown_pending_puid_lookup"
          : classified.status;
    } else {
      const classified = classifyDsaSorPuidLookup(input.httpStatus);
      const lookupBody =
        normalizedBody && typeof normalizedBody === "object" && !Array.isArray(normalizedBody)
          ? (normalizedBody as Record<string, unknown>)
          : null;
      const verifiedExisting =
        classified === "exists" &&
        lookupBody !== null &&
        Object.keys(lookupBody)
          .sort()
          .every((key, index) => key === ["message", "puid"][index]) &&
        Object.keys(lookupBody).length === 2 &&
        typeof lookupBody.message === "string" &&
        lookupBody.message.length > 0 &&
        lookupBody.message.length <= 500 &&
        lookupBody.puid === text(payload, "puid");
      if (verifiedExisting) {
        verifiedLookupReceipt = { httpStatus: 302, puid: text(payload, "puid")!, resultHash };
      }
      outcome = verifiedExisting
        ? "puid_exists_verified"
        : classified === "absent"
          ? "puid_absent_retry_allowed"
          : "puid_lookup_unknown";
    }
    if (
      creationReceipt &&
      (!validCommissionUrl(creationReceipt.permalink) || !validCommissionUrl(creationReceipt.self))
    ) {
      creationReceipt = null;
      outcome = "invalid_creation_receipt";
    }
    const attemptVersion = (latest ? integer(latest, "attempt_version", 1) : 0) + 1;
    const id = attemptId();
    await client.query(
      `INSERT INTO tokenless_dsa_transparency_delivery_attempts
       (attempt_id,workspace_id,provider_decision_id,decision_version,payload_version,attempt_version,
        schema_version,operation,idempotency_key_hash,request_hash,http_status,outcome,result_json,result_hash,
        started_at,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        id,
        input.workspaceId,
        input.providerDecisionId,
        decisionVersion,
        payloadVersion,
        attemptVersion,
        DSA_TRANSPARENCY_ATTEMPT_SCHEMA_VERSION,
        input.operation,
        idempotencyKeyHash,
        requestHash,
        input.httpStatus,
        outcome,
        resultJson,
        resultHash,
        startedAt,
        completedAt,
      ],
    );
    if ((creationReceipt && outcome === "created") || (verifiedLookupReceipt && outcome === "puid_exists_verified")) {
      const receiptEvidence = creationReceipt ?? verifiedLookupReceipt!;
      const receiptJson = canonicalizeRfc8785(receiptEvidence);
      await client.query(
        `INSERT INTO tokenless_dsa_transparency_receipt_versions
         (workspace_id,provider_decision_id,decision_version,payload_version,receipt_version,schema_version,
          receipt_source,attempt_id,commission_uuid,commission_id,commission_created_at,commission_permalink,commission_self,
          receipt_json,receipt_hash,received_at)
         VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          input.workspaceId,
          input.providerDecisionId,
          decisionVersion,
          payloadVersion,
          DSA_TRANSPARENCY_RECEIPT_SCHEMA_VERSION,
          creationReceipt ? "creation_201" : "verified_puid_lookup_302",
          id,
          creationReceipt?.uuid ?? null,
          creationReceipt ? String(creationReceipt.id) : null,
          creationReceipt ? new Date(creationReceipt.created_at) : null,
          creationReceipt?.permalink ?? null,
          creationReceipt?.self ?? null,
          receiptJson,
          sha256Rfc8785(receiptEvidence),
          completedAt,
        ],
      );
    }
    return { attemptVersion, outcome, idempotent: false };
  });
}

export async function getFrozenDsaPopulationContract(input: {
  accountAddress: string;
  workspaceId: string;
  populationId: string;
  populationVersion: number;
}) {
  const populationVersion = positiveInteger(input.populationVersion, "populationVersion");
  const client = await dbPool.connect();
  try {
    await requireManager(client, input.accountAddress, input.workspaceId);
    const result = await client.query(
      `SELECT p.*,r.reconciliation_hash,r.computed_source_totals_json,r.computed_partition_totals_json
       FROM tokenless_dsa_population_versions p
       JOIN tokenless_dsa_population_reconciliation_versions r
         ON r.workspace_id=p.workspace_id AND r.population_id=p.population_id
        AND r.population_version=p.version AND r.reconciliation_version=p.frozen_reconciliation_version
       WHERE p.workspace_id=$1 AND p.population_id=$2 AND p.version=$3 AND p.status='frozen'`,
      [input.workspaceId, input.populationId, populationVersion],
    );
    const row = result.rows[0] as Row | undefined;
    if (!row) throw new TokenlessServiceError("Frozen population not found.", 404, "dsa_population_not_found");
    return {
      schemaVersion: DSA_POPULATION_SCHEMA_VERSION,
      workspaceId: input.workspaceId,
      populationId: input.populationId,
      version: populationVersion,
      declaredContractHash: text(row, "declared_contract_hash")!,
      declaredSourceManifestRoot: text(row, "declared_source_manifest_root")!,
      root: text(row, "frozen_root")!,
      rowCount: integer(row, "frozen_row_count", 1),
      reconciliationVersion: integer(row, "frozen_reconciliation_version", 1),
      reconciliationHash: text(row, "reconciliation_hash")!,
      periodStart: date(row.period_start, "stored period start").toISOString(),
      periodEnd: date(row.period_end, "stored period end").toISOString(),
      sourceTotals: parseStoredJson(text(row, "computed_source_totals_json"), "computed source totals"),
      partitionTotals: parseStoredJson(text(row, "computed_partition_totals_json"), "computed partition totals"),
    };
  } finally {
    client.release();
  }
}

export const __dsaPopulationLedgerTestUtils = {
  partitionKey,
  sha256Rfc8785,
};
