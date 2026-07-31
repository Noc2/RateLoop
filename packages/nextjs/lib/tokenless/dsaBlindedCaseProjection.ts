import { sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import {
  type ReviewerExpertiseKey,
  normalizeReviewerExpertiseKeys,
  qualificationProvenanceSatisfiesExpertise,
} from "~~/lib/tokenless/reviewerExpertise";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const BLINDED_CASE_ID = /^dsa_case_[a-z0-9]{16,80}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const CONTENT_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const LANGUAGE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;
const PRIVATE_SENSITIVITIES = ["internal", "confidential", "restricted", "regulated"] as const;

type PrivateSensitivity = (typeof PRIVATE_SENSITIVITIES)[number];
type JsonRecord = Record<string, unknown>;

export type DsaBlindedCasePayload = {
  schemaVersion: "rateloop.dsa-blinded-case.v1";
  blindedCaseId: string;
  content: {
    artifactId: string;
    artifactVersion: number;
    contentHash: `sha256:${string}`;
    contentType: string;
    language: string;
  };
  policy: {
    categoryCode: string;
    policyHash: `sha256:${string}`;
    policyVersion: number;
    question: string;
  };
  reference: {
    populationId: string;
    populationVersion: number;
    frameId: string;
    frameVersion: number;
    sampleId: string;
    sampleVersion: number;
    position: number;
  };
};

export type DsaBlindedCaseMapping = Readonly<
  DsaBlindedCasePayload & {
    mappingCommitment: `sha256:${string}`;
  }
>;

export type DsaWithheldCaseValues = {
  providerIdentity: unknown;
  automatedOutcome: unknown;
  appealResult: unknown;
  internalSourceDecisionId: unknown;
  receiptIdentifiers: unknown;
  mutableMetadata?: unknown;
};

export type DsaReviewerAuthorizationSnapshot = {
  workspaceReviewerStatus: "active" | "inactive" | "removed";
  workspacePrincipalStatus: "active" | "disabled";
  privateGroupStatus: "active" | "inactive";
  accessGrant: {
    status: "active" | "revoked";
    revokedAt: string | null;
    validFrom: string;
    validUntil: string | null;
    projectScope: "all" | "selected";
    projectIds: readonly string[];
    maxPrivateSensitivity: PrivateSensitivity;
  };
  artifactLease: {
    status: "active" | "expired" | "revoked";
    artifactId: string;
    contentHash: `sha256:${string}`;
    expiresAt: string;
    revokedAt: string | null;
  };
  assignment: {
    assignmentId: string;
    status: "reserved" | "accepted" | "expired" | "released" | "completed";
    leaseState: "pending" | "issued" | "failed" | "expired";
    workspaceId: string;
    projectId: string;
    reviewerPrincipalId: string;
    blindedCaseId: string;
    mappingCommitment: `sha256:${string}`;
    frozenAt: string;
    expiresAt: string;
    confidentialityAcceptedAt: string;
    confidentialityTermsHash: `sha256:${string}`;
    privateSensitivity: PrivateSensitivity;
  };
  qualification: {
    provenanceJson: unknown;
    requiredExpertiseKeys: readonly ReviewerExpertiseKey[];
    expiresAt: string;
  };
  conflict: {
    status: "cleared" | "declared" | "pending";
    declarationHash: `sha256:${string}`;
    frozenAt: string;
    expiresAt: string;
  };
};

const ROOT_KEYS = ["blindedCaseId", "content", "policy", "reference", "schemaVersion"] as const;
const CONTENT_KEYS = ["artifactId", "artifactVersion", "contentHash", "contentType", "language"] as const;
const POLICY_KEYS = ["categoryCode", "policyHash", "policyVersion", "question"] as const;
const REFERENCE_KEYS = [
  "frameId",
  "frameVersion",
  "populationId",
  "populationVersion",
  "position",
  "sampleId",
  "sampleVersion",
] as const;
const MAPPING_KEYS = [...ROOT_KEYS, "mappingCommitment"].sort();
const FORBIDDEN_KEY_PARTS = [
  "appeal",
  "automatedoutcome",
  "createdat",
  "decisionid",
  "internaldecision",
  "lastmodified",
  "machineoutcome",
  "metadata",
  "provider",
  "receipt",
  "sourcedecision",
  "updatedat",
] as const;

function projectionError(message: string, code: string, status = 409): never {
  throw new TokenlessServiceError(message, status, code);
}

function record(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    projectionError(`${field} is invalid.`, "dsa_blinded_payload_invalid", 400);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    projectionError(`${field} is invalid.`, "dsa_blinded_payload_invalid", 400);
  }
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, expected: readonly string[], field: string) {
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== [...expected].sort()[index])) {
    projectionError(`${field} contains an unauthorized field.`, "dsa_blinded_payload_unblinded");
  }
}

function normalizedKey(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
}

function assertNoForbiddenKeys(value: unknown) {
  if (Array.isArray(value)) {
    value.forEach(assertNoForbiddenKeys);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    const normalized = normalizedKey(key);
    if (FORBIDDEN_KEY_PARTS.some(part => normalized.includes(part))) {
      projectionError("The reviewer payload contains an unblinded field.", "dsa_blinded_payload_unblinded");
    }
    assertNoForbiddenKeys(child);
  }
}

function collectStrings(value: unknown, output: Set<string>) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized) output.add(normalized);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(entry => collectStrings(entry, output));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value as JsonRecord).forEach(entry => collectStrings(entry, output));
  }
}

function visibleStrings(value: unknown) {
  const output = new Set<string>();
  collectStrings(value, output);
  return output;
}

function assertWithheldContext(withheld: DsaWithheldCaseValues) {
  const providerIdentity = new Set<string>();
  const internalSourceDecisionId = new Set<string>();
  collectStrings(withheld.providerIdentity, providerIdentity);
  collectStrings(withheld.internalSourceDecisionId, internalSourceDecisionId);
  if (
    providerIdentity.size === 0 ||
    internalSourceDecisionId.size === 0 ||
    withheld.automatedOutcome === undefined ||
    withheld.appealResult === undefined ||
    withheld.receiptIdentifiers === undefined
  ) {
    projectionError("The withheld source context is incomplete.", "dsa_blinded_withheld_context_invalid", 400);
  }
}

function assertNoWithheldValues(payload: unknown, withheld: DsaWithheldCaseValues) {
  const exact = new Set<string>();
  collectStrings(withheld.automatedOutcome, exact);
  collectStrings(withheld.appealResult, exact);

  const identifying = new Set<string>();
  collectStrings(withheld.providerIdentity, identifying);
  collectStrings(withheld.internalSourceDecisionId, identifying);
  collectStrings(withheld.receiptIdentifiers, identifying);
  collectStrings(withheld.mutableMetadata, identifying);

  for (const visible of visibleStrings(payload)) {
    if (exact.has(visible)) {
      projectionError("The reviewer payload contains an unblinded value.", "dsa_blinded_payload_unblinded");
    }
    for (const hidden of identifying) {
      if (visible === hidden || (hidden.length >= 4 && visible.includes(hidden))) {
        projectionError("The reviewer payload contains an unblinded value.", "dsa_blinded_payload_unblinded");
      }
    }
  }
}

function stringField(value: unknown, field: string, maximum = 160) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    projectionError(`${field} is invalid.`, "dsa_blinded_payload_invalid", 400);
  }
  return value;
}

function identifier(value: unknown, field: string) {
  const parsed = stringField(value, field);
  if (!IDENTIFIER.test(parsed)) projectionError(`${field} is invalid.`, "dsa_blinded_payload_invalid", 400);
  return parsed;
}

function hash(value: unknown, field: string) {
  const parsed = stringField(value, field, 71);
  if (!HASH.test(parsed)) projectionError(`${field} is invalid.`, "dsa_blinded_payload_invalid", 400);
  return parsed as `sha256:${string}`;
}

function positiveInteger(value: unknown, field: string, allowZero = false) {
  if (!Number.isSafeInteger(value) || (allowZero ? (value as number) < 0 : (value as number) < 1)) {
    projectionError(`${field} is invalid.`, "dsa_blinded_payload_invalid", 400);
  }
  return value as number;
}

function parsePayload(value: unknown, withheld: DsaWithheldCaseValues): DsaBlindedCasePayload {
  assertWithheldContext(withheld);
  assertNoForbiddenKeys(value);
  const root = record(value, "Reviewer payload");
  exactKeys(root, ROOT_KEYS, "Reviewer payload");
  if (root.schemaVersion !== "rateloop.dsa-blinded-case.v1") {
    projectionError("Reviewer payload schema is unsupported.", "dsa_blinded_payload_invalid", 400);
  }
  const blindedCaseId = stringField(root.blindedCaseId, "blindedCaseId");
  if (!BLINDED_CASE_ID.test(blindedCaseId)) {
    projectionError("blindedCaseId is invalid.", "dsa_blinded_payload_invalid", 400);
  }

  const content = record(root.content, "content");
  exactKeys(content, CONTENT_KEYS, "content");
  const contentType = stringField(content.contentType, "content.contentType", 255);
  const language = stringField(content.language, "content.language", 80);
  if (!CONTENT_TYPE.test(contentType) || !LANGUAGE.test(language)) {
    projectionError("Frozen content metadata is invalid.", "dsa_blinded_payload_invalid", 400);
  }

  const policy = record(root.policy, "policy");
  exactKeys(policy, POLICY_KEYS, "policy");
  const question = stringField(policy.question, "policy.question", 2_000).trim();
  if (!question) projectionError("policy.question is invalid.", "dsa_blinded_payload_invalid", 400);

  const reference = record(root.reference, "reference");
  exactKeys(reference, REFERENCE_KEYS, "reference");

  const parsed: DsaBlindedCasePayload = {
    schemaVersion: "rateloop.dsa-blinded-case.v1",
    blindedCaseId,
    content: {
      artifactId: identifier(content.artifactId, "content.artifactId"),
      artifactVersion: positiveInteger(content.artifactVersion, "content.artifactVersion"),
      contentHash: hash(content.contentHash, "content.contentHash"),
      contentType,
      language,
    },
    policy: {
      categoryCode: identifier(policy.categoryCode, "policy.categoryCode"),
      policyHash: hash(policy.policyHash, "policy.policyHash"),
      policyVersion: positiveInteger(policy.policyVersion, "policy.policyVersion"),
      question,
    },
    reference: {
      populationId: identifier(reference.populationId, "reference.populationId"),
      populationVersion: positiveInteger(reference.populationVersion, "reference.populationVersion"),
      frameId: identifier(reference.frameId, "reference.frameId"),
      frameVersion: positiveInteger(reference.frameVersion, "reference.frameVersion"),
      sampleId: identifier(reference.sampleId, "reference.sampleId"),
      sampleVersion: positiveInteger(reference.sampleVersion, "reference.sampleVersion"),
      position: positiveInteger(reference.position, "reference.position", true),
    },
  };
  assertNoWithheldValues(parsed, withheld);
  return parsed;
}

function commitment(payload: DsaBlindedCasePayload) {
  try {
    return sha256Rfc8785(payload);
  } catch {
    projectionError("Reviewer payload is not canonicalizable.", "dsa_blinded_payload_invalid", 400);
  }
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.values(value as JsonRecord).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export function freezeDsaBlindedCaseMapping(input: {
  payload: unknown;
  withheld: DsaWithheldCaseValues;
}): DsaBlindedCaseMapping {
  const payload = parsePayload(input.payload, input.withheld);
  return deepFreeze({ ...payload, mappingCommitment: commitment(payload) });
}

function date(value: string, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    projectionError(`${field} is invalid.`, "dsa_blinded_authorization_invalid");
  }
  return parsed;
}

function sensitivity(value: string) {
  const index = PRIVATE_SENSITIVITIES.indexOf(value as PrivateSensitivity);
  if (index < 0) projectionError("Private sensitivity is invalid.", "dsa_blinded_authorization_invalid");
  return index;
}

function notFound(): never {
  projectionError("Blinded case not found.", "dsa_blinded_case_not_found", 404);
}

function normalizePrincipalOrNotFound(value: string) {
  try {
    return normalizeAccountSubject(value);
  } catch {
    notFound();
  }
}

function assertPrincipalBoundary(principalId: string, authorization: DsaReviewerAuthorizationSnapshot) {
  const requestedPrincipal = normalizePrincipalOrNotFound(principalId);
  const assignedPrincipal = normalizePrincipalOrNotFound(authorization.assignment.reviewerPrincipalId);
  if (
    requestedPrincipal !== assignedPrincipal ||
    authorization.workspaceReviewerStatus !== "active" ||
    authorization.workspacePrincipalStatus !== "active" ||
    authorization.privateGroupStatus !== "active" ||
    authorization.accessGrant.status !== "active" ||
    authorization.accessGrant.revokedAt !== null ||
    authorization.assignment.status !== "accepted" ||
    authorization.assignment.leaseState !== "issued"
  ) {
    notFound();
  }
}

function parseCommittedMapping(value: unknown, withheld: DsaWithheldCaseValues) {
  const mapping = record(value, "Committed reviewer mapping");
  assertNoForbiddenKeys(mapping);
  exactKeys(mapping, MAPPING_KEYS, "Committed reviewer mapping");
  const payload = parsePayload(
    {
      schemaVersion: mapping.schemaVersion,
      blindedCaseId: mapping.blindedCaseId,
      content: mapping.content,
      policy: mapping.policy,
      reference: mapping.reference,
    },
    withheld,
  );
  const storedCommitment = hash(mapping.mappingCommitment, "mappingCommitment");
  const reproducedCommitment = commitment(payload);
  if (storedCommitment !== reproducedCommitment) {
    projectionError("The blinded case mapping conflicts with its commitment.", "dsa_blinded_mapping_conflict");
  }
  return { payload, mappingCommitment: reproducedCommitment };
}

function assertAuthorization(input: {
  principalId: string;
  now: Date;
  authorization: DsaReviewerAuthorizationSnapshot;
  blindedCaseId: string;
  contentArtifactId: string;
  contentHash: string;
  mappingCommitment: string;
}) {
  const { accessGrant, artifactLease, assignment, conflict, qualification } = input.authorization;
  const now = input.now;
  if (!Number.isFinite(now.getTime())) {
    projectionError("Authorization time is invalid.", "dsa_blinded_authorization_invalid");
  }
  const requestedPrincipal = normalizePrincipalOrNotFound(input.principalId);
  const assignedPrincipal = normalizePrincipalOrNotFound(assignment.reviewerPrincipalId);
  const frozenAt = date(assignment.frozenAt, "assignment.frozenAt");
  const expiresAt = date(assignment.expiresAt, "assignment.expiresAt");
  const grantValidFrom = date(accessGrant.validFrom, "accessGrant.validFrom");
  const grantValidUntil = accessGrant.validUntil ? date(accessGrant.validUntil, "accessGrant.validUntil") : null;
  const qualificationExpiresAt = date(qualification.expiresAt, "qualification.expiresAt");
  const conflictFrozenAt = date(conflict.frozenAt, "conflict.frozenAt");
  const conflictExpiresAt = date(conflict.expiresAt, "conflict.expiresAt");
  const artifactLeaseExpiresAt = date(artifactLease.expiresAt, "artifactLease.expiresAt");
  const confidentialityAcceptedAt = date(assignment.confidentialityAcceptedAt, "assignment.confidentialityAcceptedAt");
  let requiredExpertise: ReviewerExpertiseKey[];
  try {
    requiredExpertise = normalizeReviewerExpertiseKeys(qualification.requiredExpertiseKeys);
  } catch {
    notFound();
  }

  const scopeAllowsProject =
    accessGrant.projectScope === "all" ||
    (accessGrant.projectScope === "selected" && accessGrant.projectIds.includes(assignment.projectId));
  const assignmentIdentityValid =
    IDENTIFIER.test(assignment.assignmentId) &&
    IDENTIFIER.test(assignment.workspaceId) &&
    IDENTIFIER.test(assignment.projectId) &&
    BLINDED_CASE_ID.test(assignment.blindedCaseId) &&
    HASH.test(assignment.mappingCommitment) &&
    HASH.test(assignment.confidentialityTermsHash);
  if (
    requestedPrincipal !== assignedPrincipal ||
    input.authorization.workspaceReviewerStatus !== "active" ||
    input.authorization.workspacePrincipalStatus !== "active" ||
    input.authorization.privateGroupStatus !== "active" ||
    accessGrant.status !== "active" ||
    accessGrant.revokedAt !== null ||
    grantValidFrom > now ||
    grantValidFrom > frozenAt ||
    (grantValidUntil !== null && grantValidUntil < expiresAt) ||
    !scopeAllowsProject ||
    sensitivity(accessGrant.maxPrivateSensitivity) < sensitivity(assignment.privateSensitivity) ||
    assignment.status !== "accepted" ||
    assignment.leaseState !== "issued" ||
    !assignmentIdentityValid ||
    expiresAt <= now ||
    frozenAt > now ||
    frozenAt >= expiresAt ||
    confidentialityAcceptedAt > frozenAt ||
    assignment.blindedCaseId !== input.blindedCaseId ||
    assignment.mappingCommitment !== input.mappingCommitment ||
    artifactLease.status !== "active" ||
    artifactLease.revokedAt !== null ||
    artifactLease.artifactId !== input.contentArtifactId ||
    artifactLease.contentHash !== input.contentHash ||
    artifactLeaseExpiresAt < expiresAt ||
    qualificationExpiresAt < expiresAt ||
    !qualificationProvenanceSatisfiesExpertise(qualification.provenanceJson, requiredExpertise, expiresAt) ||
    conflict.status !== "cleared" ||
    !HASH.test(conflict.declarationHash) ||
    conflictFrozenAt.getTime() !== frozenAt.getTime() ||
    conflictExpiresAt < expiresAt
  ) {
    notFound();
  }
}

export function projectDsaBlindedReviewerCase(input: {
  principalId: string;
  now?: Date;
  authorization: DsaReviewerAuthorizationSnapshot;
  mapping: unknown;
  withheld: DsaWithheldCaseValues;
}): DsaBlindedCaseMapping {
  assertPrincipalBoundary(input.principalId, input.authorization);
  const reproduced = parseCommittedMapping(input.mapping, input.withheld);
  assertAuthorization({
    principalId: input.principalId,
    now: input.now ?? new Date(),
    authorization: input.authorization,
    blindedCaseId: reproduced.payload.blindedCaseId,
    contentArtifactId: reproduced.payload.content.artifactId,
    contentHash: reproduced.payload.content.contentHash,
    mappingCommitment: reproduced.mappingCommitment,
  });
  return deepFreeze({ ...reproduced.payload, mappingCommitment: reproduced.mappingCommitment });
}
