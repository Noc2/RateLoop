import { type HumanAssuranceRubric, parseHumanAssuranceRubric } from "@rateloop/sdk";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { reserveWorkspaceUsageAllocations } from "~~/lib/billing/entitlements";
import { dbPool } from "~~/lib/db";
import type { TokenlessWorkspaceRole } from "~~/lib/db/productSchema";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import {
  type AssurancePrincipal,
  canonicalizeHumanAssuranceDocument,
  hashHumanAssuranceDocument,
} from "~~/lib/tokenless/humanAssurance";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const ASSURANCE_RUN_ORCHESTRATION_VERSION = "rateloop-assurance-run-orchestration-v1";
export const MAX_CASE_IMPORT_BYTES = 1_000_000;
export const MAX_IMPORTED_CASES = 200;
const MAX_CONTEXT_ARTIFACTS = 20;
const MAX_CHECKS_PER_CASE = 20;
const WRITE_ROLES = new Set<TokenlessWorkspaceRole>(["owner", "admin", "member"]);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const CHECK_PATH_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,9}$/u;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/u;
const ROUND_ID_PATTERN = /^(?:0|[1-9]\d*)$/u;
const FORBIDDEN_PATH_PARTS = new Set(["__proto__", "constructor", "prototype"]);

type QueryRow = Record<string, unknown>;
type Scalar = string | number | boolean | null;

export type DeterministicCheck =
  | { key: string; path: string; operator: "equals"; expected: Scalar }
  | { key: string; path: string; operator: "one_of"; expected: Scalar[] }
  | { key: string; path: string; operator: "number_gte" | "number_lte"; expected: number }
  | { key: string; path: string; operator: "exists" };

export type ImportedAssuranceCase = {
  title: string;
  instructions: string;
  baselineArtifactId: string;
  candidateArtifactId: string;
  contextArtifactIds: string[];
  objectiveReference?: string;
  deterministicChecks: DeterministicCheck[];
};

export type BlindedArtifactVariants = {
  variantAArtifactId: string;
  variantBArtifactId: string;
  blindingCommitment: `sha256:${string}`;
  secretJson: string;
};

export type AssuranceRunOrchestrationManifest = {
  schemaVersion: typeof ASSURANCE_RUN_ORCHESTRATION_VERSION;
  kind: "run_orchestration_manifest";
  runId: string;
  projectId: string;
  suite: { suiteId: string; version: number; manifestHash: string };
  rubric: {
    rubricId: string;
    version: number;
    rubricHash: string;
    passRule: HumanAssuranceRubric["passRule"];
    passRuleHash: string;
  };
  audiencePolicy: {
    policyId: string;
    version: number;
    manifestHash: string;
    admissionPolicyHash: `0x${string}`;
  };
  randomization: { algorithm: "hmac-sha256-v1"; commitment: string };
  rerun: {
    rootRunId: string;
    previousRunId: string | null;
    previousManifestHash: string | null;
    ordinal: number;
  };
  cases: Array<{
    caseId: string;
    position: number;
    variants: [{ label: "A"; artifactId: string }, { label: "B"; artifactId: string }];
    blindingCommitment: string;
    deterministicChecksHash: string;
    contentId: `0x${string}`;
  }>;
  aggregate: {
    state: "frozen";
    totalCases: number;
    roundStates: { planned: number };
    deterministicChecks: { pending: number };
    validResponses: 0;
    decision: "pending";
  };
};

const ROUND_STATUSES = [
  "planned",
  "submitted",
  "open",
  "revealable",
  "settling",
  "finalized",
  "terminal",
  "failed",
  "offchain_complete",
] as const;
export type AssuranceCaseRoundStatus = (typeof ROUND_STATUSES)[number];
const ROUND_STATUS_TRANSITIONS = new Map<AssuranceCaseRoundStatus, ReadonlySet<AssuranceCaseRoundStatus>>([
  ["planned", new Set(["submitted", "open", "revealable", "settling", "finalized", "terminal", "failed"])],
  ["submitted", new Set(["open", "revealable", "settling", "finalized", "terminal", "failed"])],
  ["open", new Set(["revealable", "settling", "finalized", "terminal", "failed"])],
  ["revealable", new Set(["settling", "finalized", "terminal", "failed"])],
  ["settling", new Set(["finalized", "terminal", "failed"])],
  ["finalized", new Set()],
  ["terminal", new Set()],
  ["failed", new Set()],
  ["offchain_complete", new Set()],
]);

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowNumber(row: QueryRow | undefined, key: string) {
  const value = Number(row?.[key]);
  return Number.isSafeInteger(value) ? value : null;
}

function serviceError(message: string, code = "invalid_assurance_run_orchestration", status = 400): never {
  throw new TokenlessServiceError(message, status, code);
}

function requiredText(value: unknown, field: string, maximum: number) {
  if (typeof value !== "string") serviceError(`${field} must be text.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    serviceError(`${field} must contain between 1 and ${maximum} characters.`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, maximum: number) {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredText(value, field, maximum);
}

function identifier(value: unknown, field: string) {
  const normalized = requiredText(value, field, 128);
  if (!IDENTIFIER_PATTERN.test(normalized)) serviceError(`${field} is not a valid identifier.`);
  return normalized;
}

function scalar(value: unknown, field: string): Scalar {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  serviceError(`${field} must be a finite JSON scalar.`);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string) {
  const permitted = new Set(allowed);
  const unknown = Object.keys(value).filter(key => !permitted.has(key));
  if (unknown.length) serviceError(`${field} contains unsupported fields: ${unknown.join(", ")}.`);
}

function validateChecks(value: unknown): DeterministicCheck[] {
  if (!Array.isArray(value) || value.length > MAX_CHECKS_PER_CASE) {
    serviceError(`deterministicChecks must be an array with at most ${MAX_CHECKS_PER_CASE} entries.`);
  }
  const keys = new Set<string>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      serviceError(`deterministicChecks[${index}] must be an object.`);
    }
    const check = raw as Record<string, unknown>;
    const operator = requiredText(check.operator, `deterministicChecks[${index}].operator`, 32);
    exactKeys(
      check,
      operator === "exists" ? ["key", "path", "operator"] : ["key", "path", "operator", "expected"],
      `deterministicChecks[${index}]`,
    );
    const key = identifier(check.key, `deterministicChecks[${index}].key`);
    if (keys.has(key)) serviceError(`Deterministic check key ${key} is duplicated.`);
    keys.add(key);
    const path = requiredText(check.path, `deterministicChecks[${index}].path`, 320);
    if (!CHECK_PATH_PATTERN.test(path) || path.split(".").some(part => FORBIDDEN_PATH_PARTS.has(part))) {
      serviceError(`deterministicChecks[${index}].path is invalid.`);
    }
    if (operator === "exists") return { key, path, operator };
    if (operator === "equals") {
      return { key, path, operator, expected: scalar(check.expected, `deterministicChecks[${index}].expected`) };
    }
    if (operator === "one_of") {
      if (!Array.isArray(check.expected) || check.expected.length < 1 || check.expected.length > 20) {
        serviceError(`deterministicChecks[${index}].expected must contain 1-20 scalar values.`);
      }
      return {
        key,
        path,
        operator,
        expected: check.expected.map((entry, expectedIndex) =>
          scalar(entry, `deterministicChecks[${index}].expected[${expectedIndex}]`),
        ),
      };
    }
    if (operator === "number_gte" || operator === "number_lte") {
      if (typeof check.expected !== "number" || !Number.isFinite(check.expected)) {
        serviceError(`deterministicChecks[${index}].expected must be a finite number.`);
      }
      return { key, path, operator, expected: check.expected };
    }
    serviceError(`deterministicChecks[${index}].operator is unsupported.`);
  });
}

function stringArray(value: unknown, field: string, maximum: number) {
  if (!Array.isArray(value) || value.length > maximum) {
    serviceError(`${field} must be an array with at most ${maximum} identifiers.`);
  }
  const result = value.map((entry, index) => identifier(entry, `${field}[${index}]`));
  if (new Set(result).size !== result.length) serviceError(`${field} must not contain duplicates.`);
  return result;
}

function normalizeCase(value: unknown, index: number): ImportedAssuranceCase {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    serviceError(`cases[${index}] must be an object.`);
  }
  const entry = value as Record<string, unknown>;
  exactKeys(
    entry,
    [
      "title",
      "instructions",
      "baselineArtifactId",
      "candidateArtifactId",
      "contextArtifactIds",
      "objectiveReference",
      "deterministicChecks",
    ],
    `cases[${index}]`,
  );
  const baselineArtifactId = identifier(entry.baselineArtifactId, `cases[${index}].baselineArtifactId`);
  const candidateArtifactId = identifier(entry.candidateArtifactId, `cases[${index}].candidateArtifactId`);
  if (baselineArtifactId === candidateArtifactId) {
    serviceError(`cases[${index}] must use different baseline and candidate artifacts.`);
  }
  return {
    title: requiredText(entry.title, `cases[${index}].title`, 200),
    instructions: requiredText(entry.instructions, `cases[${index}].instructions`, 10_000),
    baselineArtifactId,
    candidateArtifactId,
    contextArtifactIds: stringArray(
      entry.contextArtifactIds ?? [],
      `cases[${index}].contextArtifactIds`,
      MAX_CONTEXT_ARTIFACTS,
    ),
    objectiveReference: optionalText(entry.objectiveReference, `cases[${index}].objectiveReference`, 2_000),
    deterministicChecks: validateChecks(entry.deterministicChecks ?? []),
  };
}

function parseCsvRecords(payload: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  for (let index = 0; index < payload.length; index += 1) {
    const character = payload[index];
    if (quoted) {
      if (character === '"') {
        if (payload[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (closedQuote && character !== "," && character !== "\n" && character !== "\r") {
      serviceError("CSV quoted fields must end at a delimiter or line ending.");
    }
    if (character === '"' && field.length === 0) quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
      closedQuote = false;
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && payload[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some(value => value.length > 0)) rows.push(row);
      row = [];
      field = "";
      closedQuote = false;
      if (rows.length > MAX_IMPORTED_CASES + 1) serviceError(`CSV imports are limited to ${MAX_IMPORTED_CASES} cases.`);
    } else if (character === '"') {
      serviceError("CSV quotes must start at the beginning of a field.");
    } else {
      field += character;
    }
    if (field.length > 20_000) serviceError("CSV fields must not exceed 20000 characters.");
  }
  if (quoted) serviceError("CSV contains an unterminated quoted field.");
  row.push(field);
  if (row.some(value => value.length > 0)) rows.push(row);
  if (rows.length < 2) serviceError("CSV must contain a header and at least one case.");
  const headers = rows[0].map(header => header.trim());
  if (new Set(headers).size !== headers.length) serviceError("CSV headers must be unique.");
  const allowed = [
    "title",
    "instructions",
    "baselineArtifactId",
    "candidateArtifactId",
    "contextArtifactIds",
    "objectiveReference",
    "deterministicChecks",
  ];
  exactKeys(Object.fromEntries(headers.map(header => [header, true])), allowed, "CSV header");
  for (const required of allowed.slice(0, 4)) {
    if (!headers.includes(required)) serviceError(`CSV is missing required header ${required}.`);
  }
  return rows.slice(1).map((values, index) => {
    if (values.length !== headers.length) serviceError(`CSV row ${index + 2} has the wrong number of fields.`);
    const record: Record<string, unknown> = Object.fromEntries(
      headers.map((header, column) => [header, values[column]]),
    );
    for (const fieldName of ["contextArtifactIds", "deterministicChecks"] as const) {
      const raw = typeof record[fieldName] === "string" ? record[fieldName].trim() : "";
      if (!raw) record[fieldName] = [];
      else {
        try {
          record[fieldName] = JSON.parse(raw);
        } catch {
          serviceError(`CSV row ${index + 2} field ${fieldName} must be valid JSON.`);
        }
      }
    }
    return record;
  });
}

export function parseAssuranceCaseImport(input: { format: "csv" | "json"; payload: string }) {
  if (Buffer.byteLength(input.payload, "utf8") > MAX_CASE_IMPORT_BYTES) {
    serviceError(
      `Case imports must not exceed ${MAX_CASE_IMPORT_BYTES} bytes.`,
      "assurance_case_import_too_large",
      413,
    );
  }
  if (input.payload.includes("\u0000")) serviceError("Case imports must not contain NUL bytes.");
  let rawCases: unknown;
  if (input.format === "csv") rawCases = parseCsvRecords(input.payload);
  else {
    try {
      const document = JSON.parse(input.payload) as unknown;
      if (Array.isArray(document)) rawCases = document;
      else if (document && typeof document === "object" && !Array.isArray(document)) {
        exactKeys(document as Record<string, unknown>, ["cases"], "JSON import");
        rawCases = (document as Record<string, unknown>).cases;
      } else serviceError("JSON case imports must be an array or an object containing cases.");
    } catch (error) {
      if (error instanceof TokenlessServiceError) throw error;
      serviceError("Case import is not valid JSON.");
    }
  }
  if (!Array.isArray(rawCases) || rawCases.length < 1 || rawCases.length > MAX_IMPORTED_CASES) {
    serviceError(`Case imports must contain between 1 and ${MAX_IMPORTED_CASES} cases.`);
  }
  return rawCases.map(normalizeCase);
}

function pathValue(value: unknown, path: string) {
  let current = value;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, part)) {
      return { exists: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[part];
  }
  return { exists: true, value: current };
}

export function evaluateDeterministicChecks(checks: DeterministicCheck[], observed: unknown) {
  const normalized = validateChecks(checks);
  const results = normalized.map(check => {
    const actual = pathValue(observed, check.path);
    let passed = false;
    if (check.operator === "exists") passed = actual.exists;
    else if (check.operator === "equals") passed = actual.exists && Object.is(actual.value, check.expected);
    else if (check.operator === "one_of") {
      passed = actual.exists && check.expected.some(expected => Object.is(expected, actual.value));
    } else if (check.operator === "number_gte") {
      passed = typeof actual.value === "number" && Number.isFinite(actual.value) && actual.value >= check.expected;
    } else {
      passed = typeof actual.value === "number" && Number.isFinite(actual.value) && actual.value <= check.expected;
    }
    return {
      key: check.key,
      passed,
      observedHash: hashHumanAssuranceDocument(actual.exists ? actual.value : { missing: true }),
    };
  });
  return {
    status: results.every(result => result.passed) ? ("passed" as const) : ("failed" as const),
    results,
  };
}

export function buildBlindedArtifactVariants(input: {
  runId: string;
  caseId: string;
  baselineArtifactId: string;
  candidateArtifactId: string;
  entropy: Uint8Array;
}): BlindedArtifactVariants {
  if (input.entropy.byteLength !== 32) throw new Error("Blinding entropy must contain exactly 32 bytes.");
  const nonce = Buffer.from(input.entropy).toString("base64url");
  const baselineIsA =
    (createHmac("sha256", input.entropy).update(`${input.runId}:${input.caseId}:order`).digest()[0] & 1) === 0;
  const variantAArtifactId = baselineIsA ? input.baselineArtifactId : input.candidateArtifactId;
  const variantBArtifactId = baselineIsA ? input.candidateArtifactId : input.baselineArtifactId;
  const secret = {
    algorithm: "hmac-sha256-v1",
    nonce,
    baselineVariant: baselineIsA ? "A" : "B",
  };
  const blindingCommitment = hashHumanAssuranceDocument({
    runId: input.runId,
    caseId: input.caseId,
    variantAArtifactId,
    variantBArtifactId,
    ...secret,
  });
  return {
    variantAArtifactId,
    variantBArtifactId,
    blindingCommitment,
    secretJson: canonicalizeHumanAssuranceDocument(secret),
  };
}

export function verifyBlindingCommitment(input: {
  runId: string;
  caseId: string;
  variantAArtifactId: string;
  variantBArtifactId: string;
  blindingCommitment: string;
  secretJson: string;
}) {
  try {
    const secret = JSON.parse(input.secretJson) as Record<string, unknown>;
    exactKeys(secret, ["algorithm", "nonce", "baselineVariant"], "blinding secret");
    if (
      secret.algorithm !== "hmac-sha256-v1" ||
      typeof secret.nonce !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/u.test(secret.nonce) ||
      (secret.baselineVariant !== "A" && secret.baselineVariant !== "B")
    ) {
      return false;
    }
    return (
      hashHumanAssuranceDocument({
        runId: input.runId,
        caseId: input.caseId,
        variantAArtifactId: input.variantAArtifactId,
        variantBArtifactId: input.variantBArtifactId,
        ...secret,
      }) === input.blindingCommitment
    );
  } catch {
    return false;
  }
}

async function assertWorkspaceWriteAccess(client: PoolClient, principal: AssurancePrincipal, workspaceId: string) {
  if (principal.kind === "api_key" || principal.kind === "workspace_session") {
    if (principal.workspaceId !== workspaceId || !WRITE_ROLES.has(principal.role)) {
      serviceError("Assurance resource not found.", "assurance_resource_not_found", 404);
    }
    return;
  }
  const membership = await client.query(
    `SELECT role FROM tokenless_workspace_members
     WHERE workspace_id = $1 AND account_address = $2 LIMIT 1`,
    [workspaceId, principal.accountAddress.toLowerCase()],
  );
  const role = rowString(membership.rows[0] as QueryRow | undefined, "role") as TokenlessWorkspaceRole | null;
  if (!role || !WRITE_ROLES.has(role)) {
    serviceError("Assurance resource not found.", "assurance_resource_not_found", 404);
  }
}

function principalLabel(principal: AssurancePrincipal) {
  return principal.kind === "api_key"
    ? `api_key:${principal.apiKeyId}`
    : `account:${principal.accountAddress.toLowerCase()}`;
}

export async function importAssuranceCases(input: {
  principal: AssurancePrincipal;
  suiteId: string;
  suiteVersion: number;
  format: "csv" | "json";
  payload: string;
}) {
  const cases = parseAssuranceCaseImport(input);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const suiteResult = await client.query(
      `SELECT s.project_id, s.status, p.workspace_id
       FROM tokenless_assurance_suites s
       JOIN tokenless_assurance_projects p ON p.project_id = s.project_id
       WHERE s.suite_id = $1 AND s.version = $2 LIMIT 1`,
      [input.suiteId, input.suiteVersion],
    );
    const suite = suiteResult.rows[0] as QueryRow | undefined;
    const projectId = rowString(suite, "project_id");
    const workspaceId = rowString(suite, "workspace_id");
    if (!projectId || !workspaceId) serviceError("Assurance suite not found.", "assurance_suite_not_found", 404);
    await assertWorkspaceWriteAccess(client, input.principal, workspaceId);
    if (rowString(suite, "status") !== "draft") {
      serviceError("Frozen suites cannot accept case imports.", "assurance_suite_immutable", 409);
    }
    const countResult = await client.query(
      `SELECT COUNT(*) AS case_count, COALESCE(MAX(position), -1) AS maximum_position
       FROM tokenless_assurance_cases WHERE suite_id = $1 AND suite_version = $2`,
      [input.suiteId, input.suiteVersion],
    );
    const existingCount = rowNumber(countResult.rows[0] as QueryRow, "case_count") ?? 0;
    const maximumPosition = rowNumber(countResult.rows[0] as QueryRow, "maximum_position") ?? -1;
    if (existingCount + cases.length > MAX_IMPORTED_CASES) {
      serviceError(`A suite may contain at most ${MAX_IMPORTED_CASES} cases.`);
    }
    const artifactIds = [
      ...new Set(
        cases.flatMap(assuranceCase => [
          assuranceCase.baselineArtifactId,
          assuranceCase.candidateArtifactId,
          ...assuranceCase.contextArtifactIds,
        ]),
      ),
    ];
    const placeholders = artifactIds.map((_, index) => `$${index + 2}`).join(", ");
    const artifactsResult = await client.query(
      `SELECT artifact_id, role FROM tokenless_assurance_artifacts
       WHERE project_id = $1 AND artifact_id IN (${placeholders})`,
      [projectId, ...artifactIds],
    );
    const artifacts = new Map(
      artifactsResult.rows.map(row => [
        rowString(row as QueryRow, "artifact_id")!,
        rowString(row as QueryRow, "role")!,
      ]),
    );
    const inserted = [];
    for (const [index, assuranceCase] of cases.entries()) {
      if (
        artifacts.get(assuranceCase.baselineArtifactId) !== "baseline" ||
        artifacts.get(assuranceCase.candidateArtifactId) !== "candidate" ||
        assuranceCase.contextArtifactIds.some(id => artifacts.get(id) !== "context")
      ) {
        serviceError(`Imported case ${index + 1} references a missing or incorrectly typed artifact.`);
      }
      const caseId = `hac_${randomUUID().replaceAll("-", "")}`;
      const position = maximumPosition + index + 1;
      const now = new Date();
      await client.query(
        `INSERT INTO tokenless_assurance_cases
         (case_id, project_id, suite_id, suite_version, position, title, instructions,
          baseline_artifact_id, candidate_artifact_id, context_artifact_ids_json,
          objective_reference, deterministic_checks_json, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft', $13, $13)`,
        [
          caseId,
          projectId,
          input.suiteId,
          input.suiteVersion,
          position,
          assuranceCase.title,
          assuranceCase.instructions,
          assuranceCase.baselineArtifactId,
          assuranceCase.candidateArtifactId,
          JSON.stringify(assuranceCase.contextArtifactIds),
          assuranceCase.objectiveReference ?? null,
          canonicalizeHumanAssuranceDocument(assuranceCase.deterministicChecks),
          now,
        ],
      );
      inserted.push({ caseId, position });
    }
    await client.query("COMMIT");
    return { projectId, importedBy: principalLabel(input.principal), cases: inserted };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function loadRunWithAccess(
  client: PoolClient,
  principal: AssurancePrincipal,
  runId: string,
  options: { lock?: boolean } = {},
) {
  const result = await client.query(
    `SELECT r.*, p.workspace_id, s.status AS suite_status,
            s.manifest_hash AS suite_manifest_hash, s.manifest_json AS suite_manifest_json,
            a.policy_hash AS current_policy_hash, a.policy_json AS audience_policy_json
     FROM tokenless_assurance_runs r
     JOIN tokenless_assurance_projects p ON p.project_id = r.project_id
     JOIN tokenless_assurance_suites s ON s.suite_id = r.suite_id AND s.version = r.suite_version
     JOIN tokenless_assurance_audience_policies a
       ON a.policy_id = r.audience_policy_id AND a.version = r.audience_policy_version
     WHERE r.run_id = $1 LIMIT 1${options.lock ? " FOR UPDATE" : ""}`,
    [runId],
  );
  const run = result.rows[0] as QueryRow | undefined;
  const workspaceId = rowString(run, "workspace_id");
  if (!run || !workspaceId) serviceError("Assurance run not found.", "assurance_run_not_found", 404);
  await assertWorkspaceWriteAccess(client, principal, workspaceId);
  return run;
}

async function resolveRerunLineage(client: PoolClient, run: QueryRow) {
  const currentRunId = rowString(run, "run_id")!;
  const projectId = rowString(run, "project_id")!;
  const previousRunId = rowString(run, "previous_run_id");
  if (!previousRunId) return { rootRunId: currentRunId, previousRunId: null, previousManifestHash: null, ordinal: 1 };
  const seen = new Set([currentRunId]);
  let cursor: string | null = previousRunId;
  let rootRunId = currentRunId;
  let previousManifestHash: string | null = null;
  let ordinal = 1;
  while (cursor) {
    if (seen.has(cursor) || ordinal >= 50) throw new Error("Assurance rerun lineage is cyclic or too deep.");
    seen.add(cursor);
    const result = await client.query(
      `SELECT run_id, project_id, previous_run_id, manifest_hash, status
       FROM tokenless_assurance_runs WHERE run_id = $1 LIMIT 1`,
      [cursor],
    );
    const ancestor = result.rows[0] as QueryRow | undefined;
    if (
      rowString(ancestor, "project_id") !== projectId ||
      rowString(ancestor, "status") !== "completed" ||
      !HASH_PATTERN.test(rowString(ancestor, "manifest_hash") ?? "")
    ) {
      serviceError(
        "Rerun lineage must reference completed, frozen runs in the same project.",
        "invalid_previous_assurance_run",
      );
    }
    if (cursor === previousRunId) previousManifestHash = rowString(ancestor, "manifest_hash");
    rootRunId = cursor;
    cursor = rowString(ancestor, "previous_run_id");
    ordinal += 1;
  }
  return { rootRunId, previousRunId, previousManifestHash, ordinal };
}

function contentId(value: unknown): `0x${string}` {
  return `0x${createHash("sha256").update(canonicalizeHumanAssuranceDocument(value)).digest("hex")}`;
}

export async function freezeAssuranceRunOrchestration(input: { principal: AssurancePrincipal; runId: string }) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const run = await loadRunWithAccess(client, input.principal, input.runId, { lock: true });
    if (rowString(run, "status") === "frozen" && rowString(run, "manifest_hash")) {
      const manifest = JSON.parse(
        rowString(run, "manifest_json") ?? "null",
      ) as AssuranceRunOrchestrationManifest | null;
      if (manifest?.schemaVersion !== ASSURANCE_RUN_ORCHESTRATION_VERSION) {
        serviceError(
          "This frozen run does not contain orchestration metadata.",
          "assurance_run_orchestration_missing",
          409,
        );
      }
      if (hashHumanAssuranceDocument(manifest) !== rowString(run, "manifest_hash")) {
        throw new Error("Frozen run orchestration manifest hash does not match its content.");
      }
      await client.query("COMMIT");
      return { manifest, manifestHash: rowString(run, "manifest_hash")!, status: "frozen" as const };
    }
    if (rowString(run, "status") !== "draft") {
      serviceError("Only draft runs can be orchestrated.", "invalid_assurance_run_transition", 409);
    }
    if (rowString(run, "suite_status") !== "frozen") throw new Error("Run suite is not frozen.");
    const suiteManifestHash = rowString(run, "suite_manifest_hash");
    const suiteManifestJson = rowString(run, "suite_manifest_json");
    if (!suiteManifestHash || !suiteManifestJson || !HASH_PATTERN.test(suiteManifestHash)) {
      throw new Error("Frozen suite manifest is missing or invalid.");
    }
    if (rowString(run, "policy_hash") !== rowString(run, "current_policy_hash")) {
      throw new Error("Run audience policy hash does not match the frozen policy record.");
    }
    const responseCount = await client.query(
      "SELECT COUNT(*) AS response_count FROM tokenless_assurance_responses WHERE run_id = $1",
      [input.runId],
    );
    if ((rowNumber(responseCount.rows[0] as QueryRow, "response_count") ?? 0) !== 0) {
      serviceError(
        "Rubric and pass rule must be frozen before any response is accepted.",
        "assurance_responses_already_exist",
        409,
      );
    }
    const existingCases = await client.query(
      "SELECT COUNT(*) AS case_count FROM tokenless_assurance_run_cases WHERE run_id = $1",
      [input.runId],
    );
    if ((rowNumber(existingCases.rows[0] as QueryRow, "case_count") ?? 0) !== 0) {
      throw new Error("Draft run already has orchestration rows.");
    }
    const casesResult = await client.query(
      `SELECT case_id, position, baseline_artifact_id, candidate_artifact_id, deterministic_checks_json
       FROM tokenless_assurance_cases
       WHERE suite_id = $1 AND suite_version = $2 AND status = 'ready'
       ORDER BY position ASC`,
      [rowString(run, "suite_id"), rowNumber(run, "suite_version")],
    );
    if (casesResult.rows.length === 0) throw new Error("Frozen run suite has no ready cases.");
    const suiteManifest = JSON.parse(suiteManifestJson) as Record<string, unknown>;
    if (hashHumanAssuranceDocument(suiteManifest) !== suiteManifestHash) {
      throw new Error("Frozen suite manifest hash does not match its content.");
    }
    const rubric = parseHumanAssuranceRubric(suiteManifest.rubric);
    const audiencePolicyJson = rowString(run, "audience_policy_json");
    if (!audiencePolicyJson) throw new Error("Audience policy JSON is missing.");
    const audiencePolicy = JSON.parse(audiencePolicyJson) as Record<string, unknown>;
    const admissionPolicy = freezeAdmissionPolicy(audiencePolicy);
    if (!BYTES32_PATTERN.test(admissionPolicy.admissionPolicyHash))
      throw new Error("Admission policy hash is invalid.");
    const rerun = await resolveRerunLineage(client, run);
    const now = new Date();
    const casePlans = [];
    for (const rawCase of casesResult.rows) {
      const assuranceCase = rawCase as QueryRow;
      const caseId = rowString(assuranceCase, "case_id")!;
      const checks = validateChecks(JSON.parse(rowString(assuranceCase, "deterministic_checks_json") ?? "[]"));
      const variants = buildBlindedArtifactVariants({
        runId: input.runId,
        caseId,
        baselineArtifactId: rowString(assuranceCase, "baseline_artifact_id")!,
        candidateArtifactId: rowString(assuranceCase, "candidate_artifact_id")!,
        entropy: randomBytes(32),
      });
      const deterministicChecksHash = hashHumanAssuranceDocument(checks);
      const caseContentId = contentId({
        schemaVersion: ASSURANCE_RUN_ORCHESTRATION_VERSION,
        runId: input.runId,
        caseId,
        suiteManifestHash,
        admissionPolicyHash: admissionPolicy.admissionPolicyHash,
        blindingCommitment: variants.blindingCommitment,
        deterministicChecksHash,
      });
      const position = rowNumber(assuranceCase, "position")!;
      await client.query(
        `INSERT INTO tokenless_assurance_run_cases
         (run_id, case_id, position, variant_a_artifact_id, variant_b_artifact_id,
          blinding_commitment, blinding_secret_json, deterministic_checks_json,
          deterministic_checks_hash, deterministic_checks_status, content_id,
          admission_policy_hash, round_status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'planned', $13, $13)`,
        [
          input.runId,
          caseId,
          position,
          variants.variantAArtifactId,
          variants.variantBArtifactId,
          variants.blindingCommitment,
          variants.secretJson,
          canonicalizeHumanAssuranceDocument(checks),
          deterministicChecksHash,
          checks.length ? "pending" : "not_applicable",
          caseContentId,
          admissionPolicy.admissionPolicyHash,
          now,
        ],
      );
      casePlans.push({
        caseId,
        position,
        variants: [
          { label: "A", artifactId: variants.variantAArtifactId },
          { label: "B", artifactId: variants.variantBArtifactId },
        ] as [{ label: "A"; artifactId: string }, { label: "B"; artifactId: string }],
        blindingCommitment: variants.blindingCommitment,
        deterministicChecksHash,
        contentId: caseContentId,
      });
    }
    await reserveWorkspaceUsageAllocations(client, {
      workspaceId: rowString(run, "workspace_id")!,
      runId: input.runId,
      caseIds: casePlans.map(plan => plan.caseId),
      requiresPaidPanels: audiencePolicy.compensation === "paid",
      now,
    });
    const passRule = rubric.passRule;
    const manifest: AssuranceRunOrchestrationManifest = {
      schemaVersion: ASSURANCE_RUN_ORCHESTRATION_VERSION,
      kind: "run_orchestration_manifest",
      runId: input.runId,
      projectId: rowString(run, "project_id")!,
      suite: {
        suiteId: rowString(run, "suite_id")!,
        version: rowNumber(run, "suite_version")!,
        manifestHash: suiteManifestHash,
      },
      rubric: {
        rubricId: rubric.rubricId,
        version: rubric.version,
        rubricHash: hashHumanAssuranceDocument(rubric),
        passRule,
        passRuleHash: hashHumanAssuranceDocument(passRule),
      },
      audiencePolicy: {
        policyId: rowString(run, "audience_policy_id")!,
        version: rowNumber(run, "audience_policy_version")!,
        manifestHash: rowString(run, "policy_hash")!,
        admissionPolicyHash: admissionPolicy.admissionPolicyHash,
      },
      randomization: {
        algorithm: "hmac-sha256-v1",
        commitment: hashHumanAssuranceDocument(casePlans.map(plan => plan.blindingCommitment)),
      },
      rerun,
      cases: casePlans,
      aggregate: {
        state: "frozen",
        totalCases: casePlans.length,
        roundStates: { planned: casePlans.length },
        deterministicChecks: {
          pending: casePlans.filter(plan => {
            const source = casesResult.rows.find(
              row => rowString(row as QueryRow, "case_id") === plan.caseId,
            ) as QueryRow;
            return JSON.parse(rowString(source, "deterministic_checks_json") ?? "[]").length > 0;
          }).length,
        },
        validResponses: 0,
        decision: "pending",
      },
    };
    const manifestJson = canonicalizeHumanAssuranceDocument(manifest);
    const manifestHash = hashHumanAssuranceDocument(manifest);
    const updated = await client.query(
      `UPDATE tokenless_assurance_runs
       SET status = 'frozen', manifest_hash = $1, manifest_json = $2, frozen_at = $3, updated_at = $3
       WHERE run_id = $4 AND status = 'draft'`,
      [manifestHash, manifestJson, now, input.runId],
    );
    if (updated.rowCount !== 1)
      serviceError("Run changed while orchestration was freezing.", "assurance_run_conflict", 409);
    await client.query("COMMIT");
    return { manifest, manifestHash, status: "frozen" as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordDeterministicCheckResult(input: {
  principal: AssurancePrincipal;
  runId: string;
  caseId: string;
  observed: unknown;
}) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const run = await loadRunWithAccess(client, input.principal, input.runId, { lock: true });
    if (["completed", "cancelled"].includes(rowString(run, "status") ?? "")) {
      serviceError("Completed or cancelled runs cannot accept check results.", "assurance_run_immutable", 409);
    }
    const result = await client.query(
      `SELECT deterministic_checks_json FROM tokenless_assurance_run_cases
       WHERE run_id = $1 AND case_id = $2 LIMIT 1`,
      [input.runId, input.caseId],
    );
    const row = result.rows[0] as QueryRow | undefined;
    if (!row) serviceError("Run case not found.", "assurance_run_case_not_found", 404);
    const checks = validateChecks(JSON.parse(rowString(row, "deterministic_checks_json") ?? "[]"));
    const evaluation = checks.length
      ? evaluateDeterministicChecks(checks, input.observed)
      : { status: "not_applicable" as const, results: [] };
    await client.query(
      `UPDATE tokenless_assurance_run_cases
       SET deterministic_checks_status = $1, deterministic_checks_result_json = $2, updated_at = $3
       WHERE run_id = $4 AND case_id = $5`,
      [evaluation.status, canonicalizeHumanAssuranceDocument(evaluation), new Date(), input.runId, input.caseId],
    );
    await client.query("COMMIT");
    return evaluation;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function bindAssuranceCaseRound(input: {
  principal: AssurancePrincipal;
  runId: string;
  caseId: string;
  roundId: string;
  status: Exclude<AssuranceCaseRoundStatus, "planned">;
}) {
  if (!ROUND_ID_PATTERN.test(input.roundId)) serviceError("roundId must be an unsigned base-10 integer string.");
  if (
    !(ROUND_STATUSES as readonly string[]).includes(input.status) ||
    String(input.status) === "planned" ||
    String(input.status) === "offchain_complete"
  ) {
    serviceError("Round status is invalid.");
  }
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await loadRunWithAccess(client, input.principal, input.runId, { lock: true });
    const current = await client.query(
      `SELECT round_id, round_status, content_id, admission_policy_hash FROM tokenless_assurance_run_cases
       WHERE run_id = $1 AND case_id = $2 LIMIT 1`,
      [input.runId, input.caseId],
    );
    const row = current.rows[0] as QueryRow | undefined;
    if (!row) serviceError("Run case not found.", "assurance_run_case_not_found", 404);
    const existingRoundId = rowString(row, "round_id");
    if (existingRoundId && existingRoundId !== input.roundId) {
      serviceError("A run case cannot be rebound to another round.", "assurance_round_binding_conflict", 409);
    }
    const currentStatus = rowString(row, "round_status") as AssuranceCaseRoundStatus;
    if (currentStatus !== input.status && !ROUND_STATUS_TRANSITIONS.get(currentStatus)?.has(input.status)) {
      serviceError(
        `Cannot move a case round from ${currentStatus} to ${input.status}.`,
        "invalid_assurance_round_transition",
        409,
      );
    }
    await client.query(
      `UPDATE tokenless_assurance_run_cases SET round_id = $1, round_status = $2, updated_at = $3
       WHERE run_id = $4 AND case_id = $5`,
      [input.roundId, input.status, new Date(), input.runId, input.caseId],
    );
    await client.query("COMMIT");
    return {
      runId: input.runId,
      caseId: input.caseId,
      roundId: input.roundId,
      status: input.status,
      contentId: rowString(row, "content_id"),
      admissionPolicyHash: rowString(row, "admission_policy_hash"),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getAssuranceRunAggregateState(input: { principal: AssurancePrincipal; runId: string }) {
  const client = await dbPool.connect();
  try {
    const run = await loadRunWithAccess(client, input.principal, input.runId);
    const manifestJson = rowString(run, "manifest_json");
    if (!manifestJson) serviceError("Run is not frozen.", "assurance_run_not_frozen", 409);
    const manifest = JSON.parse(manifestJson) as {
      schemaVersion?: string;
      rubric?: { passRule?: HumanAssuranceRubric["passRule"] };
      rerun?: unknown;
    };
    if (manifest.schemaVersion !== ASSURANCE_RUN_ORCHESTRATION_VERSION || !manifest.rubric?.passRule) {
      serviceError("Run orchestration manifest is unavailable.", "assurance_run_orchestration_missing", 409);
    }
    const [caseResult, responseResult] = await Promise.all([
      client.query(
        `SELECT round_status, deterministic_checks_status, COUNT(*) AS count
         FROM tokenless_assurance_run_cases WHERE run_id = $1
         GROUP BY round_status, deterministic_checks_status`,
        [input.runId],
      ),
      client.query(
        `SELECT choice, COUNT(*) AS count FROM tokenless_assurance_responses
         WHERE run_id = $1 AND validity = 'valid' GROUP BY choice`,
        [input.runId],
      ),
    ]);
    const roundStates: Record<string, number> = {};
    const deterministicChecks = { notApplicable: 0, pending: 0, passed: 0, failed: 0 };
    let totalCases = 0;
    for (const raw of caseResult.rows) {
      const row = raw as QueryRow;
      const count = rowNumber(row, "count") ?? 0;
      totalCases += count;
      const roundStatus = rowString(row, "round_status")!;
      roundStates[roundStatus] = (roundStates[roundStatus] ?? 0) + count;
      const checkStatus = rowString(row, "deterministic_checks_status");
      if (checkStatus === "not_applicable") deterministicChecks.notApplicable += count;
      else if (checkStatus === "pending") deterministicChecks.pending += count;
      else if (checkStatus === "passed") deterministicChecks.passed += count;
      else if (checkStatus === "failed") deterministicChecks.failed += count;
    }
    const choices = { baseline: 0, candidate: 0, tie: 0 };
    for (const raw of responseResult.rows) {
      const row = raw as QueryRow;
      const choice = rowString(row, "choice");
      if (choice === "baseline" || choice === "candidate" || choice === "tie") {
        choices[choice] = rowNumber(row, "count") ?? 0;
      }
    }
    const validResponses = choices.baseline + choices.candidate + choices.tie;
    const candidatePreferenceShareBps =
      validResponses === 0 ? null : Math.floor((choices.candidate * 10_000) / validResponses);
    const passRule = manifest.rubric.passRule;
    const humanDecision =
      validResponses < passRule.minimumValidResponses || candidatePreferenceShareBps === null
        ? "pending"
        : candidatePreferenceShareBps >= passRule.thresholdBps
          ? "passed"
          : "failed";
    const decision =
      deterministicChecks.failed > 0
        ? "failed"
        : deterministicChecks.pending > 0 || humanDecision === "pending"
          ? "pending"
          : humanDecision;
    return {
      runId: input.runId,
      runStatus: rowString(run, "status"),
      totalCases,
      roundStates,
      deterministicChecks,
      responses: { ...choices, valid: validResponses },
      candidatePreferenceShareBps,
      passRule,
      decision,
      rerun: manifest.rerun ?? null,
    };
  } finally {
    client.release();
  }
}
