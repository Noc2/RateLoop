import { type HumanAssuranceAudiencePolicy, parseHumanAssuranceRubric } from "@rateloop/sdk";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import {
  type CohortSource,
  assertAssuranceAssignmentSettlementAvailable,
  assertMatchingPrivateGroupSnapshot,
} from "~~/lib/tokenless/audienceAssignments";
import { recordGoldOutcomesForResponseBatch } from "~~/lib/tokenless/goldQuality";
import { canonicalizeHumanAssuranceDocument, hashHumanAssuranceDocument } from "~~/lib/tokenless/humanAssurance";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/u;
const RESPONSE_SCHEMA_VERSION = "rateloop-assurance-response-v1";
const RATIONALE_KEY_DOMAIN = "assurance_rationale";
const REVIEWER_MAPPING_KEY_DOMAIN = "assurance_reviewer_mapping";
const ACTIVE_RUN_STATUSES = new Set(["frozen", "recruiting", "collecting"]);

type QueryRow = Record<string, unknown>;
export type AssuranceResponseKeyring = { currentVersion: string; keys: Map<string, Buffer> };
export type AssuranceResponseKeyrings = {
  rationale: AssuranceResponseKeyring;
  reviewerMapping: AssuranceResponseKeyring;
};

export type AssuranceCaseResponseInput = {
  caseId: string;
  displayedOption: "A" | "B";
  selectedArtifactId: string;
  failureTagKeys: string[];
  rationale: string;
};

export type SubmitAssuranceResponsesInput = {
  assignmentId: string;
  baseAccountAddress: string;
  idempotencyKey: string;
  responses: AssuranceCaseResponseInput[];
  now?: Date;
};

let keyringsOverride: AssuranceResponseKeyrings | null = null;

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowBoolean(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === true || value === "true";
}

function serviceError(message: string, code: string, status = 400): never {
  throw new TokenlessServiceError(message, status, code);
}

function requiredIdentifier(value: string, field: string) {
  const normalized = value.trim();
  if (!IDENTIFIER_PATTERN.test(normalized)) serviceError(`${field} is invalid.`, "invalid_assurance_response");
  return normalized;
}

function parseJson<T>(value: unknown, field: string): T {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    throw new Error(`Database returned invalid ${field}.`);
  }
}

function loadKeyring(prefix: string, publicPrefix: string): AssuranceResponseKeyring {
  if (process.env[`NEXT_PUBLIC_${publicPrefix}_KEYS`] || process.env[`NEXT_PUBLIC_${publicPrefix}_KEY_VERSION`]) {
    throw new Error(`${publicPrefix} keys must never use NEXT_PUBLIC variables.`);
  }
  const currentVersion = process.env[`${prefix}_KEY_VERSION`]?.trim();
  const rawKeys = process.env[`${prefix}_KEYS`]?.trim();
  if (!currentVersion || !rawKeys) {
    throw new TokenlessServiceError("The assurance response vault is unavailable.", 503, "response_vault_unavailable");
  }
  let source: Record<string, string>;
  try {
    source = JSON.parse(rawKeys) as Record<string, string>;
  } catch {
    throw new Error(`${prefix}_KEYS must be a JSON object of base64url keys.`);
  }
  const keys = new Map<string, Buffer>();
  for (const [version, encoded] of Object.entries(source)) {
    const key = Buffer.from(encoded, "base64url");
    if (key.length !== 32) throw new Error(`${prefix} key ${version} must contain exactly 32 bytes.`);
    keys.set(version, key);
  }
  if (!keys.has(currentVersion)) throw new Error(`${prefix} current key version is missing.`);
  return { currentVersion, keys };
}

function getKeyrings(): AssuranceResponseKeyrings {
  if (keyringsOverride) return keyringsOverride;
  return {
    rationale: loadKeyring("TOKENLESS_ASSURANCE_RATIONALE_VAULT", "TOKENLESS_ASSURANCE_RATIONALE_VAULT"),
    reviewerMapping: loadKeyring("TOKENLESS_ASSURANCE_REVIEWER_MAPPING", "TOKENLESS_ASSURANCE_REVIEWER_MAPPING"),
  };
}

function rationaleDigest(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function reviewerKey(
  input: { accountAddress: string; runId: string },
  keyring: AssuranceResponseKeyring,
  version = keyring.currentVersion,
) {
  const key = keyring.keys.get(version);
  if (!key) throw new Error(`Reviewer mapping key ${version} is unavailable.`);
  return `hmac-sha256:${version}:${createHmac("sha256", key)
    .update(`${REVIEWER_MAPPING_KEY_DOMAIN}:${input.runId}:${input.accountAddress}`)
    .digest("hex")}`;
}

function encryptRationale(
  input: {
    caseId: string;
    digest: string;
    rationale: string;
    reviewerKey: string;
    runId: string;
  },
  keyring: AssuranceResponseKeyring,
) {
  const key = keyring.keys.get(keyring.currentVersion)!;
  const nonce = randomBytes(12);
  const aad = `${RATIONALE_KEY_DOMAIN}:${input.runId}:${input.caseId}:${input.reviewerKey}:${input.digest}`;
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(input.rationale, "utf8"), cipher.final()]);
  return {
    ciphertext: `v1.${nonce.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString(
      "base64url",
    )}`,
    keyRef: `${RATIONALE_KEY_DOMAIN}:${keyring.currentVersion}`,
  };
}

function decryptRationale(row: QueryRow) {
  const keyRef = rowString(row, "rationale_key_ref") ?? "";
  const keyVersion = keyRef.startsWith(`${RATIONALE_KEY_DOMAIN}:`) ? keyRef.slice(RATIONALE_KEY_DOMAIN.length + 1) : "";
  const key = getKeyrings().rationale.keys.get(keyVersion);
  if (!key) throw new Error(`Assurance rationale vault key ${keyVersion} is unavailable.`);
  const parts = (rowString(row, "rationale_ciphertext") ?? "").split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Assurance rationale ciphertext is invalid.");
  const digest = rowString(row, "rationale_digest");
  if (!digest || !/^sha256:[0-9a-f]{64}$/u.test(digest)) {
    throw new Error("Assurance rationale digest is unavailable.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1]!, "base64url"));
  decipher.setAAD(
    Buffer.from(
      `${RATIONALE_KEY_DOMAIN}:${rowString(row, "run_id")}:${rowString(row, "case_id")}:${rowString(row, "reviewer_key")}:${digest}`,
    ),
  );
  decipher.setAuthTag(Buffer.from(parts[2]!, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(parts[3]!, "base64url")), decipher.final()]).toString("utf8");
}

/**
 * Resolve exactly one private assurance rationale after the Feedback Bonus
 * service has authorized its pool and awarder. This is deliberately not a
 * generic response-vault read: the response must belong to the opportunity's
 * frozen run in the requested workspace.
 */
export async function readFeedbackBonusAssuranceResponse(input: {
  responseId: string;
  workspaceId: string;
  opportunityId: string;
}) {
  const result = await dbPool.query(
    `SELECT response.*
     FROM tokenless_assurance_responses response
     JOIN tokenless_agent_review_opportunities opportunity
       ON opportunity.run_id = response.run_id
      AND opportunity.workspace_id = $2
      AND opportunity.opportunity_id = $3
     LEFT JOIN tokenless_assurance_run_gold_items gold
       ON gold.run_id = response.run_id AND gold.case_id = response.case_id
     WHERE response.response_id = $1
       AND gold.case_id IS NULL
       AND response.validity = 'valid'
       AND response.rationale_ciphertext IS NOT NULL
       AND response.rationale_key_ref IS NOT NULL
       AND response.rationale_digest IS NOT NULL
     LIMIT 2`,
    [input.responseId, input.workspaceId, input.opportunityId],
  );
  if (result.rowCount !== 1) {
    throw new TokenlessServiceError(
      "The selected private feedback body is unavailable.",
      409,
      "feedback_bonus_body_unavailable",
    );
  }
  const body = decryptRationale(result.rows[0] as QueryRow).trim();
  if (!body) {
    throw new TokenlessServiceError(
      "The selected private response has no awardable written feedback.",
      409,
      "feedback_bonus_body_unavailable",
    );
  }
  return body;
}

function validateResponseBatch(responses: AssuranceCaseResponseInput[]) {
  if (!Array.isArray(responses) || responses.length === 0 || responses.length > 200) {
    serviceError("responses must contain 1-200 assigned cases.", "invalid_assurance_response");
  }
  const seen = new Set<string>();
  return responses.map(response => {
    const caseId = requiredIdentifier(response.caseId, "caseId");
    if (seen.has(caseId)) serviceError("Each assigned case may be submitted only once.", "duplicate_assurance_case");
    seen.add(caseId);
    if (response.displayedOption !== "A" && response.displayedOption !== "B") {
      serviceError("displayedOption must be A or B.", "invalid_assurance_response");
    }
    const selectedArtifactId = requiredIdentifier(response.selectedArtifactId, "selectedArtifactId");
    const rationale = response.rationale.trim();
    if (rationale.length > 2_000) {
      serviceError("rationale must not exceed 2000 characters.", "invalid_assurance_rationale");
    }
    if (
      !Array.isArray(response.failureTagKeys) ||
      response.failureTagKeys.length > 50 ||
      response.failureTagKeys.some(value => typeof value !== "string" || !IDENTIFIER_PATTERN.test(value))
    ) {
      serviceError("failureTagKeys are invalid.", "invalid_assurance_failure_tags");
    }
    const failureTagKeys = [...new Set(response.failureTagKeys)].sort();
    if (failureTagKeys.length !== response.failureTagKeys.length) {
      serviceError("failureTagKeys must be unique.", "invalid_assurance_failure_tags");
    }
    return { ...response, caseId, selectedArtifactId, rationale, failureTagKeys };
  });
}

function loadCapabilitySnapshot(assignment: QueryRow) {
  const snapshot = parseJson<{
    assertions?: Array<{ capabilities?: unknown[] }>;
    qualifications?: Array<{ key?: unknown }>;
  }>(assignment.assurance_snapshot_json, "assignment assurance snapshot");
  if (
    !rowString(assignment, "assurance_snapshot_hash") ||
    hashHumanAssuranceDocument(snapshot) !== rowString(assignment, "assurance_snapshot_hash")
  ) {
    serviceError("The assignment assurance snapshot is invalid.", "assurance_snapshot_mismatch", 409);
  }
  const qualificationKeys = [
    ...new Set(
      (snapshot.qualifications ?? []).map(value => value.key).filter(value => typeof value === "string") as string[],
    ),
  ].sort();
  const assuranceCapabilities = [
    ...new Set(
      (snapshot.assertions ?? []).flatMap(value =>
        (value.capabilities ?? []).filter(capability => typeof capability === "string").map(String),
      ),
    ),
  ].sort();
  return { assuranceCapabilities, qualificationKeys };
}

function validateFrozenManifests(input: {
  assignment: QueryRow;
  runCases: QueryRow[];
  suiteManifest: Record<string, unknown>;
}) {
  const runManifestJson = rowString(input.assignment, "manifest_json");
  const runManifestHash = rowString(input.assignment, "manifest_hash");
  const suiteManifestHash = rowString(input.assignment, "suite_manifest_hash");
  if (!runManifestJson || !runManifestHash || !suiteManifestHash) {
    serviceError("The frozen run manifest is unavailable.", "assurance_run_binding_mismatch", 409);
  }
  const runManifest = parseJson<Record<string, unknown>>(runManifestJson, "run manifest");
  const frozenPolicy = parseJson<Record<string, unknown>>(input.assignment.frozen_policy_json, "audience policy");
  if (
    hashHumanAssuranceDocument(runManifest) !== runManifestHash ||
    hashHumanAssuranceDocument(input.suiteManifest) !== suiteManifestHash ||
    hashHumanAssuranceDocument(frozenPolicy) !== rowString(input.assignment, "policy_hash") ||
    rowString(input.assignment, "subpanel_manifest_hash") !== runManifestHash ||
    rowString(input.assignment, "subpanel_policy_hash") !== rowString(input.assignment, "policy_hash") ||
    rowString(input.assignment, "frozen_policy_hash") !== rowString(input.assignment, "policy_hash")
  ) {
    serviceError("The assignment no longer matches its frozen run and policy.", "assurance_run_binding_mismatch", 409);
  }
  const manifest = runManifest as {
    audiencePolicy?: { admissionPolicyHash?: string };
    cases?: Array<{ caseId?: string; variants?: Array<{ label?: string; artifactId?: string }> }>;
    rubric?: { rubricHash?: string };
    suite?: { manifestHash?: string };
  };
  const rubric = parseHumanAssuranceRubric(input.suiteManifest.rubric);
  if (
    manifest.rubric?.rubricHash !== hashHumanAssuranceDocument(rubric) ||
    manifest.suite?.manifestHash !== suiteManifestHash ||
    (runManifest as { audiencePolicy?: { manifestHash?: string } }).audiencePolicy?.manifestHash !==
      rowString(input.assignment, "policy_hash")
  ) {
    serviceError("The assignment rubric no longer matches its frozen run.", "assurance_run_binding_mismatch", 409);
  }
  const manifestCases = new Map((manifest.cases ?? []).map(value => [value.caseId, value]));
  if (manifestCases.size !== input.runCases.length) {
    serviceError("The frozen run case set is incomplete.", "assurance_run_binding_mismatch", 409);
  }
  for (const row of input.runCases) {
    const caseId = rowString(row, "case_id")!;
    const manifestCase = manifestCases.get(caseId);
    const variants = new Map((manifestCase?.variants ?? []).map(value => [value.label, value.artifactId]));
    if (
      variants.get("A") !== rowString(row, "variant_a_artifact_id") ||
      variants.get("B") !== rowString(row, "variant_b_artifact_id") ||
      rowString(row, "admission_policy_hash") !== manifest.audiencePolicy?.admissionPolicyHash
    ) {
      serviceError("The frozen run case binding is invalid.", "assurance_run_binding_mismatch", 409);
    }
  }
  return rubric;
}

function buildResponseRecord(input: {
  assignment: QueryRow;
  caseRow: QueryRow;
  capabilities: string[];
  displayedOption: "A" | "B";
  failureTagKeys: string[];
  qualificationKeys: string[];
  rationale: string;
  rationaleMode: "off" | "optional" | "required";
  rationaleKeyring: AssuranceResponseKeyring;
  reviewerKey: string;
  selectedArtifactId: string;
}) {
  const expectedDisplayedArtifact =
    input.displayedOption === "A"
      ? rowString(input.caseRow, "variant_a_artifact_id")
      : rowString(input.caseRow, "variant_b_artifact_id");
  const variants = new Set([
    rowString(input.caseRow, "variant_a_artifact_id"),
    rowString(input.caseRow, "variant_b_artifact_id"),
  ]);
  if (input.selectedArtifactId !== expectedDisplayedArtifact || !variants.has(input.selectedArtifactId)) {
    serviceError("The selected option does not match the frozen blinded case.", "assurance_case_binding_mismatch", 409);
  }
  const canonicalChoice =
    input.selectedArtifactId === rowString(input.caseRow, "baseline_artifact_id")
      ? "baseline"
      : input.selectedArtifactId === rowString(input.caseRow, "candidate_artifact_id")
        ? "candidate"
        : null;
  if (!canonicalChoice) {
    serviceError("The selected artifact is not a frozen case variant.", "assurance_case_binding_mismatch", 409);
  }
  const digest = rationaleDigest(input.rationale);
  const responseDigest = hashHumanAssuranceDocument({
    schemaVersion: RESPONSE_SCHEMA_VERSION,
    runId: rowString(input.assignment, "run_id"),
    runManifestHash: rowString(input.assignment, "manifest_hash"),
    policyHash: rowString(input.assignment, "policy_hash"),
    caseId: rowString(input.caseRow, "case_id"),
    reviewerKey: input.reviewerKey,
    reviewerSource: rowString(input.assignment, "source"),
    displayedOption: input.displayedOption,
    selectedArtifactId: input.selectedArtifactId,
    canonicalChoice,
    failureTagKeys: input.failureTagKeys,
    rationaleDigest: digest,
    qualificationKeys: input.qualificationKeys,
    assuranceCapabilities: input.capabilities,
  });
  const encrypted =
    input.rationaleMode === "off"
      ? { ciphertext: null, keyRef: null }
      : encryptRationale(
          {
            caseId: rowString(input.caseRow, "case_id")!,
            digest,
            rationale: input.rationale,
            reviewerKey: input.reviewerKey,
            runId: rowString(input.assignment, "run_id")!,
          },
          input.rationaleKeyring,
        );
  return {
    canonicalChoice,
    responseDigest,
    rationaleDigest: encrypted.ciphertext === null ? null : digest,
    ...encrypted,
  };
}

async function verifyReplay(input: {
  assignment: QueryRow;
  client: PoolClient;
  expected: Array<{ caseId: string; responseDigest: string }>;
  reviewerKey: string;
}) {
  const result = await input.client.query(
    `SELECT response_id, case_id, response_digest, validity, settlement_reference
     FROM tokenless_assurance_responses WHERE run_id = $1 AND reviewer_key = $2 ORDER BY case_id`,
    [rowString(input.assignment, "run_id"), input.reviewerKey],
  );
  if (result.rowCount === 0) return null;
  if (result.rowCount !== input.expected.length) {
    serviceError("This assignment contains an incomplete prior response.", "assurance_response_conflict", 409);
  }
  const expected = new Map(input.expected.map(value => [value.caseId, value.responseDigest]));
  if (
    result.rows.some(value => {
      const row = value as QueryRow;
      return expected.get(rowString(row, "case_id") ?? "") !== rowString(row, "response_digest");
    })
  ) {
    serviceError("This assignment already contains a different response.", "assurance_response_conflict", 409);
  }
  return result.rows as QueryRow[];
}

export async function submitAssuranceResponses(input: SubmitAssuranceResponsesInput) {
  const assignmentId = requiredIdentifier(input.assignmentId, "assignmentId");
  if (!IDEMPOTENCY_PATTERN.test(input.idempotencyKey)) {
    serviceError("idempotencyKey is invalid.", "invalid_assurance_response");
  }
  const principalId = input.baseAccountAddress.trim();
  if (!principalId) serviceError("A valid signed-in account is required.", "invalid_account", 401);
  const responses = validateResponseBatch(input.responses);
  const now = input.now ?? new Date();
  const keyrings = getKeyrings();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT assignment_id FROM tokenless_assurance_assignments WHERE assignment_id = $1 FOR UPDATE",
      [assignmentId],
    );
    const assignmentResult = await client.query(
      `SELECT a.*, r.status AS run_status, r.policy_hash, r.manifest_hash, r.manifest_json,
              s.manifest_hash AS suite_manifest_hash, s.manifest_json AS suite_manifest_json,
              sp.policy_hash AS subpanel_policy_hash, sp.run_manifest_hash AS subpanel_manifest_hash,
              sp.private_group_id AS subpanel_private_group_id,
              sp.private_group_policy_version AS subpanel_private_group_policy_version,
              sp.private_group_policy_hash AS subpanel_private_group_policy_hash,
              ap.policy_hash AS frozen_policy_hash, ap.policy_json AS frozen_policy_json
       FROM tokenless_assurance_assignments a
       JOIN tokenless_assurance_runs r ON r.run_id = a.run_id AND r.project_id = a.project_id
       JOIN tokenless_assurance_suites s ON s.suite_id = r.suite_id AND s.version = r.suite_version
       JOIN tokenless_assurance_run_subpanels sp ON sp.subpanel_id = a.subpanel_id
       LEFT JOIN tokenless_rater_profiles owner_profile ON owner_profile.rater_id = a.rater_id
       JOIN tokenless_assurance_audience_policies ap
         ON ap.policy_id = r.audience_policy_id AND ap.version = r.audience_policy_version
       WHERE a.assignment_id = $1
         AND ((a.rater_id IS NOT NULL AND owner_profile.principal_id = $2)
           OR (a.rater_id IS NULL AND a.reviewer_account_address = $2))
       LIMIT 1`,
      [assignmentId, principalId],
    );
    const assignment = assignmentResult.rows[0] as QueryRow | undefined;
    if (!assignment) serviceError("Assignment not found.", "assignment_not_found", 404);
    const accountAddress = rowString(assignment, "reviewer_account_address")!;
    const identityReference = rowString(assignment, "rater_id") ?? principalId;
    assertAssuranceAssignmentSettlementAvailable({
      paidAssignment: rowBoolean(assignment, "paid_assignment"),
      policy: parseJson<HumanAssuranceAudiencePolicy>(assignment.frozen_policy_json, "audience policy"),
      source: rowString(assignment, "source") as CohortSource,
    });
    assertMatchingPrivateGroupSnapshot(assignment);
    const assignmentStatus = rowString(assignment, "status");
    const completedReplay = assignmentStatus === "completed";
    if (!completedReplay && !ACTIVE_RUN_STATUSES.has(rowString(assignment, "run_status") ?? "")) {
      serviceError("This run is not accepting assigned responses.", "assurance_run_not_collecting", 409);
    }
    if (
      !["accepted", "completed"].includes(assignmentStatus ?? "") ||
      !rowString(assignment, "confidentiality_accepted_at") ||
      (!completedReplay && new Date(rowString(assignment, "assignment_expires_at") ?? 0) <= now)
    ) {
      serviceError("Assignment is not active.", "assignment_expired", 410);
    }
    const runCasesResult = await client.query(
      `SELECT rc.*, c.baseline_artifact_id, c.candidate_artifact_id
       FROM tokenless_assurance_run_cases rc
       JOIN tokenless_assurance_cases c ON c.case_id = rc.case_id
       WHERE rc.run_id = $1 ORDER BY rc.position ASC FOR SHARE`,
      [rowString(assignment, "run_id")],
    );
    const runCases = runCasesResult.rows as QueryRow[];
    if (!runCases.length || runCases.length !== responses.length) {
      serviceError("Every assigned case must be submitted exactly once.", "incomplete_assurance_response", 400);
    }
    const suiteManifest = parseJson<Record<string, unknown>>(assignment.suite_manifest_json, "suite manifest");
    const rubric = validateFrozenManifests({ assignment, runCases, suiteManifest });
    const allowedTags = new Set(rubric.failureTags.map(tag => tag.key));
    const minimumRationaleLength =
      rubric.rationale.mode === "off"
        ? 0
        : rubric.rationale.mode === "required"
          ? Math.max(10, rubric.rationale.minLength ?? 0)
          : 0;
    const maximumRationaleLength = rubric.rationale.mode === "off" ? 0 : Math.min(2_000, rubric.rationale.maxLength);
    const inputByCase = new Map(responses.map(response => [response.caseId, response]));
    if (runCases.some(row => !inputByCase.has(rowString(row, "case_id")!))) {
      serviceError("Every assigned case must be submitted exactly once.", "incomplete_assurance_response", 400);
    }
    const { assuranceCapabilities, qualificationKeys } = loadCapabilitySnapshot(assignment);
    const pseudonymCandidates = [...keyrings.reviewerMapping.keys.keys()].map(version =>
      reviewerKey(
        { accountAddress: identityReference, runId: rowString(assignment, "run_id")! },
        keyrings.reviewerMapping,
        version,
      ),
    );
    const existingReviewer = await client.query(
      `SELECT reviewer_key FROM tokenless_assurance_responses
       WHERE run_id = $1 AND reviewer_key = ANY($2::text[]) LIMIT 1`,
      [rowString(assignment, "run_id"), pseudonymCandidates],
    );
    const pseudonym =
      rowString(existingReviewer.rows[0] as QueryRow | undefined, "reviewer_key") ??
      reviewerKey(
        { accountAddress: identityReference, runId: rowString(assignment, "run_id")! },
        keyrings.reviewerMapping,
      );
    const records = runCases.map(caseRow => {
      const response = inputByCase.get(rowString(caseRow, "case_id")!)!;
      if (response.rationale.length < minimumRationaleLength || response.rationale.length > maximumRationaleLength) {
        serviceError(
          `rationale must satisfy the frozen rubric (${minimumRationaleLength}-${maximumRationaleLength} characters).`,
          "invalid_assurance_rationale",
        );
      }
      if (response.failureTagKeys.some(tag => !allowedTags.has(tag))) {
        serviceError("A failure tag is not part of the frozen rubric.", "invalid_assurance_failure_tags");
      }
      return {
        caseId: response.caseId,
        ...buildResponseRecord({
          assignment,
          caseRow,
          capabilities: assuranceCapabilities,
          displayedOption: response.displayedOption,
          failureTagKeys: response.failureTagKeys,
          qualificationKeys,
          rationale: response.rationale,
          rationaleMode: rubric.rationale.mode,
          rationaleKeyring: keyrings.rationale,
          reviewerKey: pseudonym,
          selectedArtifactId: response.selectedArtifactId,
        }),
        failureTagKeys: response.failureTagKeys,
      };
    });
    const existing = await verifyReplay({ assignment, client, expected: records, reviewerKey: pseudonym });
    if (existing) {
      await client.query("COMMIT");
      return {
        assignmentId,
        accepted: true as const,
        replay: true,
        responseCount: existing.length,
        compensation: "unpaid" as const,
        settlementStatus: "not_applicable" as const,
      };
    }
    if (completedReplay) {
      serviceError("The completed assignment has no matching response batch.", "assurance_response_conflict", 409);
    }
    for (const record of records) {
      await client.query(
        `INSERT INTO tokenless_assurance_responses
         (response_id, run_id, case_id, reviewer_key, reviewer_source, choice,
          failure_tag_keys_json, rationale_ciphertext, rationale_key_ref, rationale_digest,
          qualification_keys_json, assurance_capabilities_json, response_digest,
          settlement_reference, validity, submitted_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULL, $14, $15, $15)`,
        [
          `hares_${randomUUID().replaceAll("-", "")}`,
          rowString(assignment, "run_id"),
          record.caseId,
          pseudonym,
          rowString(assignment, "source"),
          record.canonicalChoice,
          canonicalizeHumanAssuranceDocument(record.failureTagKeys),
          record.ciphertext,
          record.keyRef,
          record.rationaleDigest,
          canonicalizeHumanAssuranceDocument(qualificationKeys),
          canonicalizeHumanAssuranceDocument(assuranceCapabilities),
          record.responseDigest,
          "valid",
          now,
        ],
      );
    }
    await recordGoldOutcomesForResponseBatch(client, {
      runId: rowString(assignment, "run_id")!,
      reviewerKey: pseudonym,
      reviewerPrincipalId: principalId,
      assignmentId,
      workspaceId: rowString(assignment, "workspace_id")!,
      projectId: rowString(assignment, "project_id")!,
      reviewerSource: rowString(assignment, "source") as "customer_invited" | "rateloop_network",
      responses: records.map(record => ({ caseId: record.caseId, canonicalChoice: record.canonicalChoice })),
      now,
    });
    const completed = await client.query(
      `UPDATE tokenless_assurance_assignments SET status = 'completed', lease_state = 'expired', updated_at = $1
       WHERE assignment_id = $2 AND status = 'accepted'`,
      [now, assignmentId],
    );
    if (completed.rowCount !== 1) {
      serviceError("Assignment completion conflicted with another request.", "assurance_response_conflict", 409);
    }
    await Promise.all([
      client.query(
        `UPDATE tokenless_assurance_run_subpanels SET active_reservations = active_reservations - 1
         WHERE subpanel_id = $1 AND active_reservations > 0`,
        [rowString(assignment, "subpanel_id")],
      ),
      client.query(
        `UPDATE tokenless_assurance_cohorts SET active_reservations = active_reservations - 1
         WHERE project_id = $1 AND cohort_id = $2 AND active_reservations > 0`,
        [rowString(assignment, "project_id"), rowString(assignment, "cohort_id")],
      ),
      client.query(
        `UPDATE tokenless_assurance_cohort_reviewers SET active_reservations = active_reservations - 1
         WHERE project_id = $1 AND cohort_id = $2 AND reviewer_account_address = $3
           AND active_reservations > 0`,
        [rowString(assignment, "project_id"), rowString(assignment, "cohort_id"), accountAddress],
      ),
    ]);
    await client.query("COMMIT");
    return {
      assignmentId,
      accepted: true as const,
      replay: false,
      responseCount: records.length,
      compensation: "unpaid" as const,
      settlementStatus: "not_applicable" as const,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Decrypts one stored rationale for the workspace-owned oversight case view.
 * The caller must already have enforced the decision-gated run access and the
 * customer-invited lane: the workspace owns invited-lane review material,
 * while RateLoop-network responses stay aggregate-only everywhere.
 */
export function decryptWorkspaceOwnedRationale(row: QueryRow) {
  return decryptRationale(row);
}

export function __setAssuranceResponseKeyringsForTests(value: AssuranceResponseKeyrings | null) {
  keyringsOverride = value;
}
