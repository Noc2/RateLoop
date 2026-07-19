import {
  HUMAN_ASSURANCE_SCHEMA_VERSION,
  type HumanAssurancePrivateReviewCreateRequest,
  type HumanAssurancePrivateReviewCreateResponse,
} from "@rateloop/sdk";
import { randomUUID } from "node:crypto";
import "server-only";
import { dbClient } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { assertCredentialDataPolicy, assertDataIngressPolicy } from "~~/lib/privacy/dataPolicy";
import { commitPrivateReviewArtifact, storeEncryptedPrivateReviewArtifacts } from "~~/lib/tokenless/artifactPrivacy";
import { hashHumanAssuranceDocument } from "~~/lib/tokenless/humanAssurance";
import type { ProductPrincipal } from "~~/lib/tokenless/productCore";
import { authorizeProjectSubject } from "~~/lib/tokenless/projectAccess";
import { expertiseQualificationRules, normalizeReviewerExpertiseKeys } from "~~/lib/tokenless/reviewerExpertise";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type QueryRow = Record<string, unknown>;
type PrivateReviewPrincipal = Extract<ProductPrincipal, { kind: "api_key" }>;
type CallerCredentialKind = "api_key" | "oauth_token_family";
type ExternalPrivateReviewContentCommitments = {
  sourceEvidenceHash: `sha256:${string}`;
  suggestionCommitment: `sha256:${string}`;
};

const PRIVATE_SENSITIVITIES = ["internal", "confidential", "restricted", "regulated"] as const;
const PREPARATION_LEASE_MS = 60_000;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowInteger(row: QueryRow | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value)) throw new Error(`Database returned an invalid ${key}.`);
  return value;
}

function rowBoolean(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  if (value === true || value === false) return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  throw new Error(`Database returned an invalid ${key}.`);
}

function parseArray(value: unknown, field: string) {
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== "string")) throw new Error("invalid");
    return [...new Set(parsed)].sort();
  } catch {
    throw new Error(`Database returned invalid ${field}.`);
  }
}

function parseJson(value: unknown, field: string) {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error("invalid");
    return parsed;
  } catch {
    throw new Error(`Database returned invalid ${field}.`);
  }
}

function effectiveCohortQualificationRules(row: QueryRow) {
  const requiredExpertise = normalizeReviewerExpertiseKeys(
    JSON.parse(rowString(row, "required_expertise_keys_json") ?? "[]"),
  );
  const stored = parseJson(row.qualification_rules_json, "cohort qualification rules");
  if (!Array.isArray(stored)) throw new Error("Database returned invalid cohort qualification rules.");
  const required = expertiseQualificationRules(requiredExpertise);
  const requiredKeys = new Set(required.map(rule => rule.key));
  return [
    ...stored.filter(rule => {
      if (!rule || typeof rule !== "object") throw new Error("Database returned invalid cohort qualification rules.");
      return !requiredKeys.has(String((rule as Record<string, unknown>).key));
    }),
    ...required,
  ];
}

function decodeArtifact(value: string, field: string) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024 || bytes.toString("base64") !== value) {
    throw new TokenlessServiceError(`${field} must contain canonical base64.`, 400, "invalid_private_review");
  }
  return new Uint8Array(bytes);
}

function externalContentCommitments(value: ExternalPrivateReviewContentCommitments | undefined) {
  if (value === undefined) return null;
  if (!HASH_PATTERN.test(value.sourceEvidenceHash) || !HASH_PATTERN.test(value.suggestionCommitment)) {
    throw new TokenlessServiceError(
      "External private review content commitments are invalid.",
      400,
      "invalid_private_review",
    );
  }
  return value;
}

function resolveCallerCredential(row: QueryRow, presentedCredentialId: string) {
  const apiKeyId = rowString(row, "api_key_id");
  const tokenFamilyId = rowString(row, "token_family_id");
  const callerCredentialKind: CallerCredentialKind = tokenFamilyId ? "oauth_token_family" : "api_key";
  const callerCredentialId = tokenFamilyId ?? apiKeyId;
  if (
    !callerCredentialId ||
    callerCredentialId !== presentedCredentialId ||
    Boolean(apiKeyId) === Boolean(tokenFamilyId)
  ) {
    throw new TokenlessServiceError(
      "The agent integration credential does not match this caller.",
      409,
      "private_review_integration_binding_mismatch",
    );
  }
  return { callerCredentialId, callerCredentialKind };
}

function responseFromRow(row: QueryRow): HumanAssurancePrivateReviewCreateResponse {
  const status = rowString(row, "foundation_status");
  if (status !== "ready_for_assignment" && status !== "awaiting_owner_rebind") {
    throw new TokenlessServiceError(
      "The private review is still preparing. Retry the same idempotent request.",
      409,
      "private_review_preparing",
    );
  }
  return {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    privateReviewId: rowString(row, "private_review_id")!,
    status,
    lane: "private",
    task: { kind: "binary_review", commitment: rowString(row, "task_commitment") as `sha256:${string}` },
    bindings: {
      bindingHash: rowString(row, "binding_hash") as `sha256:${string}`,
      project: {
        projectId: rowString(row, "project_id")!,
        hash: rowString(row, "project_binding_hash") as `sha256:${string}`,
      },
      requestProfile: {
        id: rowString(row, "request_profile_id")!,
        version: rowInteger(row, "request_profile_version"),
        hash: rowString(row, "request_profile_hash") as `sha256:${string}`,
      },
      privateGroup: {
        groupId: rowString(row, "private_group_id")!,
        policyVersion: rowInteger(row, "private_group_policy_version"),
        policyHash: rowString(row, "private_group_policy_hash") as `sha256:${string}`,
        allowlistHash: rowString(row, "group_allowlist_hash") as `sha256:${string}`,
        allowlistStatus: rowString(row, "group_allowlist_status") as "allowed" | "excluded",
      },
      cohort: {
        cohortId: rowString(row, "cohort_id")!,
        hash: rowString(row, "cohort_binding_hash") as `sha256:${string}`,
      },
    },
    artifacts: {
      sourceArtifactId: rowString(row, "source_artifact_id")!,
      suggestionArtifactId: rowString(row, "suggestion_artifact_id")!,
    },
    responseWindowSeconds: rowInteger(row, "response_window_seconds"),
    responseDeadline: new Date(String(row.response_deadline)).toISOString(),
  };
}

async function existingRequest(integrationId: string, idempotencyKey: string) {
  const result = await dbClient.execute({
    sql: `SELECT * FROM tokenless_private_review_requests
          WHERE integration_id = ? AND idempotency_key = ? LIMIT 1`,
    args: [integrationId, idempotencyKey],
  });
  return result.rows[0] as QueryRow | undefined;
}

async function loadCallerAuthorization(input: {
  classification: HumanAssurancePrivateReviewCreateRequest["dataClassification"];
  integrationId: string;
  principal: PrivateReviewPrincipal;
  profile: HumanAssurancePrivateReviewCreateRequest["requestProfile"];
  projectId: string;
  now: Date;
}) {
  const result = await dbClient.execute({
    sql: `SELECT i.integration_id, i.workspace_id, i.agent_id, i.agent_version_id,
                 i.api_key_id, i.token_family_id, i.activation_mode, i.granted_scopes_json,
                 i.publishing_policy_id, i.publishing_policy_version,
                 c.status AS connection_status,
                 b.request_profile_id, b.request_profile_version, b.request_profile_hash,
                 b.enabled AS binding_enabled, b.approved_at AS binding_approved_at,
                 b.superseded_at AS binding_superseded_at,
                 p.enabled AS publishing_enabled, p.effective_at AS publishing_effective_at,
                 p.expires_at AS publishing_expires_at, p.revoked_at AS publishing_revoked_at,
                 p.allowed_project_ids_json, p.allowed_data_classifications_json,
                 p.max_retention_days, project.retention_days
          FROM tokenless_agent_integrations i
          JOIN tokenless_agent_human_review_bindings b
            ON b.workspace_id = i.workspace_id
           AND b.binding_id = i.human_review_binding_id
           AND b.version = i.human_review_binding_version
           AND b.agent_id = i.agent_id
           AND b.agent_version_id = i.agent_version_id
          JOIN tokenless_assurance_projects project
            ON project.workspace_id = i.workspace_id AND project.project_id = ?
          LEFT JOIN tokenless_agent_connection_intents c ON c.intent_id = i.connection_intent_id
          LEFT JOIN tokenless_agent_publishing_policies p
            ON p.workspace_id = i.workspace_id
           AND p.policy_id = i.publishing_policy_id
           AND p.version = i.publishing_policy_version
          WHERE i.workspace_id = ? AND i.integration_id = ? AND i.status = 'active'
            AND b.request_profile_id = ? AND b.request_profile_version = ? AND b.request_profile_hash = ?
          LIMIT 1`,
    args: [
      input.projectId,
      input.principal.workspaceId,
      input.integrationId,
      input.profile.id,
      input.profile.version,
      input.profile.hash,
    ],
  });
  const row = result.rows[0] as QueryRow | undefined;
  if (!row || !rowBoolean(row, "binding_enabled") || !row.binding_approved_at || row.binding_superseded_at) {
    throw new TokenlessServiceError(
      "The agent integration is not bound to this exact private-review profile.",
      409,
      "private_review_integration_binding_mismatch",
    );
  }
  const { callerCredentialId, callerCredentialKind } = resolveCallerCredential(row, input.principal.apiKeyId);

  const retentionDays = rowInteger(row, "retention_days");
  if (callerCredentialKind === "api_key") {
    const access = await authorizeProjectSubject({
      action: "write",
      projectId: input.projectId,
      subjectKind: "api_key",
      subjectReference: callerCredentialId,
      workspaceId: input.principal.workspaceId,
      now: input.now,
    });
    assertCredentialDataPolicy({
      classification: input.classification,
      credentialHomeRegion: input.principal.credentialHomeRegion ?? "eu",
      homeRegion: input.principal.workspaceHomeRegion ?? "eu",
      maxClassification: input.principal.maxDataClassification ?? "confidential",
      permittedDataUses: input.principal.permittedDataUses ?? ["service_delivery"],
    });
    return {
      agentId: rowString(row, "agent_id")!,
      agentVersionId: rowString(row, "agent_version_id")!,
      callerCredentialId,
      callerCredentialKind,
      retentionDays: access.retentionDays,
    };
  }

  const effectiveAt = new Date(String(row.publishing_effective_at));
  const expiresAt = row.publishing_expires_at ? new Date(String(row.publishing_expires_at)) : null;
  const allowedProjects = parseArray(row.allowed_project_ids_json, "publishing project allowlist");
  const allowedClassifications = parseArray(row.allowed_data_classifications_json, "publishing data classifications");
  const scopes = parseArray(row.granted_scopes_json, "integration scopes");
  const maxRetentionDays =
    row.max_retention_days === null || row.max_retention_days === undefined
      ? null
      : rowInteger(row, "max_retention_days");
  if (
    rowString(row, "activation_mode") !== "owner_approved" ||
    rowString(row, "connection_status") !== "connected" ||
    !rowBoolean(row, "publishing_enabled") ||
    row.publishing_revoked_at ||
    !Number.isFinite(effectiveAt.getTime()) ||
    effectiveAt > input.now ||
    (expiresAt !== null && expiresAt <= input.now) ||
    (allowedProjects.length > 0 && !allowedProjects.includes(input.projectId)) ||
    !allowedClassifications.includes(input.classification) ||
    !scopes.includes("panel:publish") ||
    (maxRetentionDays !== null && retentionDays > maxRetentionDays)
  ) {
    throw new TokenlessServiceError(
      "The OAuth integration is not authorized for this private-review project.",
      403,
      "private_review_integration_not_authorized",
    );
  }
  return {
    agentId: rowString(row, "agent_id")!,
    agentVersionId: rowString(row, "agent_version_id")!,
    callerCredentialId,
    callerCredentialKind,
    retentionDays,
  };
}

async function loadBinding(input: {
  cohortId: string;
  profileHash: string;
  profileId: string;
  profileVersion: number;
  projectId: string;
  workspaceId: string;
}) {
  const result = await dbClient.execute({
    sql: `SELECT p.project_id, p.workspace_id, p.status AS project_status, p.visibility,
                 p.data_classification, p.private_sensitivity AS project_private_sensitivity,
                 p.retention_days, p.home_region, p.retention_policy_id, p.data_use_policy_version,
                 r.profile_id, r.version AS profile_version, r.profile_hash, r.agent_id, r.agent_version_id,
                 r.criterion, r.positive_label, r.negative_label, r.rationale_mode, r.audience,
                 r.content_boundary, r.private_sensitivity AS profile_private_sensitivity,
                 r.private_group_id, r.private_group_policy_version, r.private_group_policy_hash,
                 r.response_window_seconds, r.required_expertise_keys_json,
                 r.configuration_status, r.approved_at, r.superseded_at,
                 g.workspace_id AS group_workspace_id, g.status AS group_status,
                 gp.allowed_project_ids_json, gp.data_classifications_json, gp.max_private_sensitivity,
                 c.cohort_id, c.source AS cohort_source, c.selection AS cohort_selection,
                 c.capacity AS cohort_capacity, c.qualification_rules_json, c.status AS cohort_status,
                 c.private_group_id AS cohort_private_group_id
          FROM tokenless_assurance_projects p
          JOIN tokenless_agent_review_request_profiles r
            ON r.workspace_id = p.workspace_id AND r.profile_id = ? AND r.version = ?
          JOIN tokenless_private_groups g ON g.group_id = r.private_group_id
          JOIN tokenless_private_group_policy_versions gp
            ON gp.group_id = r.private_group_id
           AND gp.version = r.private_group_policy_version
           AND gp.policy_hash = r.private_group_policy_hash
          JOIN tokenless_assurance_cohorts c
            ON c.project_id = p.project_id AND c.cohort_id = ?
          WHERE p.workspace_id = ? AND p.project_id = ? AND r.profile_hash = ? LIMIT 1`,
    args: [
      input.profileId,
      input.profileVersion,
      input.cohortId,
      input.workspaceId,
      input.projectId,
      input.profileHash,
    ],
  });
  const row = result.rows[0] as QueryRow | undefined;
  if (!row)
    throw new TokenlessServiceError("Private review bindings were not found.", 404, "private_review_binding_not_found");
  return row;
}

function assertBinding(input: {
  agentId: string;
  agentVersionId: string;
  classification: HumanAssurancePrivateReviewCreateRequest["dataClassification"];
  row: QueryRow;
  workspaceId: string;
}) {
  const row = input.row;
  if (
    rowString(row, "project_status") !== "active" ||
    rowString(row, "visibility") !== "private" ||
    rowString(row, "project_private_sensitivity") !== input.classification ||
    rowString(row, "data_classification") !== input.classification ||
    rowString(row, "configuration_status") !== "ready" ||
    !row.approved_at ||
    row.superseded_at ||
    rowString(row, "audience") !== "private_invited" ||
    rowString(row, "content_boundary") !== "private_workspace" ||
    rowString(row, "profile_private_sensitivity") !== input.classification ||
    rowString(row, "agent_id") !== input.agentId ||
    rowString(row, "agent_version_id") !== input.agentVersionId ||
    rowString(row, "group_workspace_id") !== input.workspaceId ||
    rowString(row, "group_status") !== "active" ||
    rowString(row, "cohort_status") !== "active" ||
    rowString(row, "cohort_source") !== "customer_invited" ||
    rowString(row, "cohort_selection") !== "customer_named" ||
    rowString(row, "cohort_private_group_id") !== rowString(row, "private_group_id")
  ) {
    throw new TokenlessServiceError(
      "The private review profile, project, group, or cohort is not assignment-ready.",
      409,
      "private_review_binding_mismatch",
    );
  }
  const classifications = parseArray(row.data_classifications_json, "private group classifications");
  if (!classifications.includes(input.classification)) {
    throw new TokenlessServiceError(
      "The private group does not permit this data classification.",
      409,
      "private_group_classification_mismatch",
    );
  }
  const maximum = rowString(row, "max_private_sensitivity");
  if (!PRIVATE_SENSITIVITIES.includes(maximum as (typeof PRIVATE_SENSITIVITIES)[number])) {
    throw new Error("Database returned an invalid private-group sensitivity.");
  }
  effectiveCohortQualificationRules(row);
}

async function claimExistingPreparation(input: {
  existing: QueryRow;
  leaseId: string;
  now: Date;
  requestHash: string;
}) {
  if (rowString(input.existing, "request_hash") !== input.requestHash) {
    throw new TokenlessServiceError(
      "The idempotency key is already bound to another private review.",
      409,
      "private_review_idempotency_conflict",
    );
  }
  const status = rowString(input.existing, "foundation_status");
  if (status === "ready_for_assignment" || status === "awaiting_owner_rebind") {
    return { ownsLease: false, row: input.existing };
  }
  const leaseExpiresAt = input.existing.preparation_lease_expires_at
    ? new Date(String(input.existing.preparation_lease_expires_at))
    : null;
  if (status === "preparing" && leaseExpiresAt && leaseExpiresAt > input.now) {
    throw new TokenlessServiceError(
      "The private review is already preparing. Retry the same idempotent request.",
      409,
      "private_review_preparing",
    );
  }
  if (status !== "preparing" && status !== "failed_recoverable") {
    throw new Error("Database returned an invalid private-review foundation status.");
  }
  const uploadIds = parseArray(input.existing.preparation_upload_ids_json, "private-review preparation upload ids");
  const claimed = await dbClient.execute({
    sql: `UPDATE tokenless_private_review_requests
          SET foundation_status = 'preparing', preparation_lease_id = ?, preparation_lease_expires_at = ?,
              preparation_attempt_count = preparation_attempt_count + 1,
              preparation_upload_ids_json = ?,
              last_preparation_error_code = NULL, updated_at = ?
          WHERE private_review_id = ?
            AND foundation_status IN ('preparing', 'failed_recoverable')
            AND (preparation_lease_expires_at IS NULL OR preparation_lease_expires_at <= ?)`,
    args: [
      input.leaseId,
      new Date(input.now.getTime() + PREPARATION_LEASE_MS),
      JSON.stringify([...uploadIds, input.leaseId]),
      input.now,
      rowString(input.existing, "private_review_id"),
      input.now,
    ],
  });
  if (claimed.rowCount !== 1) {
    throw new TokenlessServiceError(
      "The private review is already preparing. Retry the same idempotent request.",
      409,
      "private_review_preparing",
    );
  }
  return {
    ownsLease: true,
    row: { ...input.existing, foundation_status: "preparing", preparation_lease_id: input.leaseId },
  };
}

function safePreparationErrorCode(error: unknown) {
  return error instanceof TokenlessServiceError ? error.code : "private_review_preparation_failed";
}

export async function preparePrivateReviewFoundation(input: {
  principal: PrivateReviewPrincipal;
  request: HumanAssurancePrivateReviewCreateRequest;
  externalContentCommitments?: ExternalPrivateReviewContentCommitments;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const externalCommitments = externalContentCommitments(input.externalContentCommitments);
  const caller = await loadCallerAuthorization({
    classification: input.request.dataClassification,
    integrationId: input.request.integrationId,
    now,
    principal: input.principal,
    profile: input.request.requestProfile,
    projectId: input.request.projectId,
  });
  assertDataIngressPolicy({
    classification: input.request.dataClassification,
    visibility: "private",
    regulatedModeEnabled:
      input.principal.maxDataClassification === "regulated" || caller.callerCredentialKind === "oauth_token_family",
  });

  const sourceBytes = decodeArtifact(input.request.source.bytesBase64, "source.bytesBase64");
  const suggestionBytes = decodeArtifact(input.request.suggestion.bytesBase64, "suggestion.bytesBase64");
  const requestReference = `${input.request.integrationId}:${caller.callerCredentialKind}:${caller.callerCredentialId}:${input.request.idempotencyKey}`;
  const sourceCommitment = commitPrivateReviewArtifact({
    bytes: sourceBytes,
    kind: "source",
    requestReference,
    workspaceId: input.principal.workspaceId,
  });
  const suggestionCommitment = commitPrivateReviewArtifact({
    bytes: suggestionBytes,
    kind: "suggestion",
    requestReference,
    workspaceId: input.principal.workspaceId,
  });
  const requestHash = hashHumanAssuranceDocument({
    callerCredentialId: caller.callerCredentialId,
    callerCredentialKind: caller.callerCredentialKind,
    cohortId: input.request.cohortId,
    dataClassification: input.request.dataClassification,
    integrationId: input.request.integrationId,
    projectId: input.request.projectId,
    requestProfile: input.request.requestProfile,
    source: { contentType: input.request.source.contentType, commitment: sourceCommitment },
    suggestion: { contentType: input.request.suggestion.contentType, commitment: suggestionCommitment },
    ...(externalCommitments ? { externalContentCommitments: externalCommitments } : {}),
  });

  const binding = await loadBinding({
    cohortId: input.request.cohortId,
    profileHash: input.request.requestProfile.hash,
    profileId: input.request.requestProfile.id,
    profileVersion: input.request.requestProfile.version,
    projectId: input.request.projectId,
    workspaceId: input.principal.workspaceId,
  });
  assertBinding({
    agentId: caller.agentId,
    agentVersionId: caller.agentVersionId,
    classification: input.request.dataClassification,
    row: binding,
    workspaceId: input.principal.workspaceId,
  });
  const allowedProjectIds = parseArray(binding.allowed_project_ids_json, "private group project allowlist");
  const allowlistStatus =
    allowedProjectIds.length === 0 || allowedProjectIds.includes(input.request.projectId) ? "allowed" : "excluded";
  const terminalStatus = allowlistStatus === "allowed" ? "ready_for_assignment" : "awaiting_owner_rebind";
  const responseWindowSeconds = rowInteger(binding, "response_window_seconds");
  const responseDeadline = new Date(now.getTime() + responseWindowSeconds * 1_000);
  const allowlistHash = hashHumanAssuranceDocument(allowedProjectIds);
  const projectBindingHash = hashHumanAssuranceDocument({
    projectId: input.request.projectId,
    workspaceId: input.principal.workspaceId,
    visibility: "private",
    privateSensitivity: input.request.dataClassification,
    retentionDays: rowInteger(binding, "retention_days"),
    homeRegion: rowString(binding, "home_region"),
    retentionPolicyId: rowString(binding, "retention_policy_id"),
    dataUsePolicyVersion: rowString(binding, "data_use_policy_version"),
  });
  const cohortBindingHash = hashHumanAssuranceDocument({
    cohortId: input.request.cohortId,
    projectId: input.request.projectId,
    privateGroupId: rowString(binding, "private_group_id"),
    source: rowString(binding, "cohort_source"),
    selection: rowString(binding, "cohort_selection"),
    capacity: rowInteger(binding, "cohort_capacity"),
    qualificationRules: effectiveCohortQualificationRules(binding),
  });
  const taskCommitment = hashHumanAssuranceDocument({
    kind: "binary_review",
    criterion: rowString(binding, "criterion"),
    positiveLabel: rowString(binding, "positive_label"),
    negativeLabel: rowString(binding, "negative_label"),
    rationaleMode: rowString(binding, "rationale_mode"),
    sourceCommitment,
    suggestionCommitment,
  });
  const bindingHash = hashHumanAssuranceDocument({
    callerCredentialId: caller.callerCredentialId,
    callerCredentialKind: caller.callerCredentialKind,
    integrationId: input.request.integrationId,
    lane: "private",
    taskKind: "binary_review",
    taskCommitment,
    project: { id: input.request.projectId, hash: projectBindingHash },
    requestProfile: input.request.requestProfile,
    privateGroup: {
      id: rowString(binding, "private_group_id"),
      policyVersion: rowInteger(binding, "private_group_policy_version"),
      policyHash: rowString(binding, "private_group_policy_hash"),
      allowlistHash,
      allowlistStatus,
    },
    cohort: { id: input.request.cohortId, hash: cohortBindingHash },
    ...(externalCommitments ? { externalContentCommitments: externalCommitments } : {}),
    responseWindowSeconds,
    responseDeadline: responseDeadline.toISOString(),
  });

  const privateReviewId = `hpr_${randomUUID().replaceAll("-", "")}`;
  const leaseId = `hpl_${randomUUID().replaceAll("-", "")}`;
  const planned = {
    sourceArtifactId: `art_${randomUUID().replaceAll("-", "")}`,
    sourceObjectId: `obj_${randomUUID().replaceAll("-", "")}`,
    suggestionArtifactId: `art_${randomUUID().replaceAll("-", "")}`,
    suggestionObjectId: `obj_${randomUUID().replaceAll("-", "")}`,
  };
  let reservation: { ownsLease: boolean; row: QueryRow };
  try {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_private_review_requests
            (private_review_id, workspace_id, project_id, integration_id,
             caller_credential_kind, caller_credential_id, idempotency_key, request_hash,
             external_source_evidence_hash, external_suggestion_commitment,
             request_profile_id, request_profile_version, request_profile_hash,
             private_group_id, private_group_policy_version, private_group_policy_hash,
             group_allowlist_hash, group_allowlist_status, cohort_id, cohort_binding_hash,
             project_binding_hash, lane, task_kind, task_commitment, private_sensitivity,
             planned_source_artifact_id, planned_source_object_id,
             planned_suggestion_artifact_id, planned_suggestion_object_id,
             source_artifact_id, suggestion_artifact_id, response_window_seconds, response_deadline,
             binding_hash, foundation_status, preparation_lease_id, preparation_lease_expires_at,
             preparation_attempt_count, preparation_upload_ids_json, last_preparation_error_code,
             created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private', 'binary_review',
                    ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, 'preparing', ?, ?, 1, ?, NULL, ?, ?)`,
      args: [
        privateReviewId,
        input.principal.workspaceId,
        input.request.projectId,
        input.request.integrationId,
        caller.callerCredentialKind,
        caller.callerCredentialId,
        input.request.idempotencyKey,
        requestHash,
        externalCommitments?.sourceEvidenceHash ?? null,
        externalCommitments?.suggestionCommitment ?? null,
        input.request.requestProfile.id,
        input.request.requestProfile.version,
        input.request.requestProfile.hash,
        rowString(binding, "private_group_id"),
        rowInteger(binding, "private_group_policy_version"),
        rowString(binding, "private_group_policy_hash"),
        allowlistHash,
        allowlistStatus,
        input.request.cohortId,
        cohortBindingHash,
        projectBindingHash,
        taskCommitment,
        input.request.dataClassification,
        planned.sourceArtifactId,
        planned.sourceObjectId,
        planned.suggestionArtifactId,
        planned.suggestionObjectId,
        responseWindowSeconds,
        responseDeadline,
        bindingHash,
        leaseId,
        new Date(now.getTime() + PREPARATION_LEASE_MS),
        JSON.stringify([leaseId]),
        now,
        now,
      ],
    });
    reservation = {
      ownsLease: true,
      row: {
        private_review_id: privateReviewId,
        planned_source_artifact_id: planned.sourceArtifactId,
        planned_source_object_id: planned.sourceObjectId,
        planned_suggestion_artifact_id: planned.suggestionArtifactId,
        planned_suggestion_object_id: planned.suggestionObjectId,
      },
    };
  } catch (error) {
    const existing = await existingRequest(input.request.integrationId, input.request.idempotencyKey);
    if (!existing) throw error;
    reservation = await claimExistingPreparation({ existing, leaseId, now, requestHash });
  }
  if (!reservation.ownsLease) return responseFromRow(reservation.row);

  const reservedReviewId = rowString(reservation.row, "private_review_id")!;
  const reservedPlan = {
    sourceArtifactId: rowString(reservation.row, "planned_source_artifact_id")!,
    sourceObjectId: rowString(reservation.row, "planned_source_object_id")!,
    suggestionArtifactId: rowString(reservation.row, "planned_suggestion_artifact_id")!,
    suggestionObjectId: rowString(reservation.row, "planned_suggestion_object_id")!,
  };
  try {
    const artifacts = await storeEncryptedPrivateReviewArtifacts({
      callerCredentialId: caller.callerCredentialId,
      callerCredentialKind: caller.callerCredentialKind,
      integrationId: input.request.integrationId,
      privateReviewId: reservedReviewId,
      planned: reservedPlan,
      projectId: input.request.projectId,
      requestReference,
      retentionDays: caller.retentionDays,
      source: { bytes: sourceBytes, contentType: input.request.source.contentType },
      suggestion: { bytes: suggestionBytes, contentType: input.request.suggestion.contentType },
      uploadId: leaseId,
      workspaceId: input.principal.workspaceId,
      now,
    });
    if (artifacts.source.digest !== sourceCommitment || artifacts.suggestion.digest !== suggestionCommitment) {
      throw new Error("Private review artifact commitments changed during encryption.");
    }
    const finalized = await dbClient.execute({
      sql: `UPDATE tokenless_private_review_requests
            SET source_artifact_id = planned_source_artifact_id,
                suggestion_artifact_id = planned_suggestion_artifact_id,
                foundation_status = ?, preparation_lease_id = NULL,
                preparation_lease_expires_at = NULL, last_preparation_error_code = NULL, updated_at = ?
            WHERE private_review_id = ? AND foundation_status = 'preparing' AND preparation_lease_id = ?`,
      args: [terminalStatus, now, reservedReviewId, leaseId],
    });
    if (finalized.rowCount !== 1) {
      throw new TokenlessServiceError(
        "Private review preparation lost its durable lease.",
        409,
        "private_review_preparation_lease_lost",
      );
    }
  } catch (error) {
    await dbClient.execute({
      sql: `UPDATE tokenless_private_review_requests
            SET foundation_status = 'failed_recoverable', preparation_lease_id = NULL,
                preparation_lease_expires_at = NULL, last_preparation_error_code = ?, updated_at = ?
            WHERE private_review_id = ? AND foundation_status = 'preparing' AND preparation_lease_id = ?`,
      args: [safePreparationErrorCode(error), now, reservedReviewId, leaseId],
    });
    throw error;
  }

  await appendAuditEvent({
    action: "private_review.foundation_created",
    actorKind: caller.callerCredentialKind,
    actorReference: caller.callerCredentialId,
    assuranceMethod:
      caller.callerCredentialKind === "api_key" ? "workspace_api_key_project_assignment" : "agent_oauth_integration",
    metadata: {
      bindingHash,
      callerCredentialKind: caller.callerCredentialKind,
      foundationStatus: terminalStatus,
      integrationId: input.request.integrationId,
      projectId: input.request.projectId,
    },
    purpose: "private_review_prepare",
    reason: allowlistStatus === "allowed" ? "exact_bindings_frozen" : "owner_rebind_required",
    requestCorrelation: reservedReviewId,
    result: "success",
    targetId: reservedReviewId,
    targetKind: "private_review",
    workspaceId: input.principal.workspaceId,
  });
  const completed = await existingRequest(input.request.integrationId, input.request.idempotencyKey);
  if (!completed) throw new Error("Private review foundation disappeared after finalization.");
  return responseFromRow(completed);
}

export const __privateReviewFoundationTestUtils = { resolveCallerCredential };
