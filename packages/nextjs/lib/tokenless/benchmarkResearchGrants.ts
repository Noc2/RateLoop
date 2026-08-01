import { PINNED_DRAND_CHAINS } from "@rateloop/node-utils/drand";
import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import "server-only";
import { isRateLoopPrincipalId } from "~~/lib/auth/accountSubject";
import {
  type FrozenReferenceSample,
  type ReferenceFrameCommitment,
  type ReferenceFrameUnit,
  verifyFrozenReferenceSample,
} from "~~/lib/tokenless/referenceSampling";
import { type TokenlessReferenceSampleBeacon } from "~~/lib/tokenless/referenceSamplingBeacon";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const LABEL_SET_ID = /^rsls_[0-9a-f]{40}$/u;
const HMAC_SHA256 = /^hmac-sha256:[0-9a-f]{64}$/u;
const GRANT_ID = /^brg_[A-Za-z0-9_-]{22}$/u;
const ACCESS_ID = /^bra_[A-Za-z0-9_-]{22}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;
const MAX_GRANT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_MANIFEST_ROWS = 50_000;
const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;
const RECIPIENT_BINDING_DOMAIN = "rateloop.benchmark-research-recipient-binding.v2";
const AUTHORIZATION_BINDING_DOMAIN = "rateloop.benchmark-research-authorization.v1";
const METHODOLOGY_PROJECTION_DOMAIN = "rateloop.benchmark-research-public-methodology.v1";
const REVOCATION_REASONS = ["recipient_request", "scope_withdrawn", "security_response", "grant_replaced"] as const;

export const BENCHMARK_RESEARCH_PURPOSE_SCOPES = {
  methodology_validation: ["methodology_summary"],
  sample_reproduction: ["methodology_summary", "reference_sample_evidence"],
  reference_label_analysis: ["methodology_summary", "reference_sample_evidence", "reference_labels"],
} as const;

export type BenchmarkResearchPurpose = keyof typeof BENCHMARK_RESEARCH_PURPOSE_SCOPES;
export type BenchmarkResearchScope = (typeof BENCHMARK_RESEARCH_PURPOSE_SCOPES)[BenchmarkResearchPurpose][number];

export type BenchmarkResearchReferenceProvenance = Readonly<{
  schemaVersion: "rateloop.benchmark-research-reference-provenance.v1";
  derivationSource: "independent_reference_panel" | "rateloop_network";
  labelSetId: string;
  labelSetHash: `sha256:${string}`;
  bridgeHash: `sha256:${string}`;
  reportingMode: "independent_reference_panel_research_only" | "descriptive_panel_vs_network_only";
  populationClaim: false;
  operationalRollupEligible: false;
  adaptiveReuseAllowed: false;
}>;

export type BenchmarkResearchApprovedExport = Readonly<{
  schemaVersion: "rateloop.approved-public-safe-reference-export.v1";
  exportId: string;
  workspaceId: string;
  projectId: string;
  benchmarkId: string;
  activationReference: string;
  approval: Readonly<{
    status: "approved_immutable";
    dataClassification: "public_safe";
    derivation: "verified_committed_and_frozen_reference_sample";
    commitmentDigest: `sha256:${string}`;
    sampleDigest: `sha256:${string}`;
    approvalId: string;
    approvedBy: string;
    approvedAt: string;
    auditBinding: Readonly<{
      eventId: string;
      eventDigest: `sha256:${string}`;
      /** Digest of the immutable approved public-safe reference artifact. */
      artifactDigest: `sha256:${string}`;
    }>;
    attestationBinding: Readonly<{
      jobId: string;
      kind: "audit_export_head";
      /** Existing audit-export pipeline semantics: must equal auditBinding.eventDigest. */
      artifactDigest: `sha256:${string}`;
    }>;
  }>;
  referenceCommitment: ReferenceFrameCommitment;
  frozenReferenceSample: FrozenReferenceSample;
  referenceProvenance: BenchmarkResearchReferenceProvenance;
  referenceLabels: readonly Readonly<{
    unitId: string;
    referenceLabel: "pass" | "fail" | "uncertain";
    agreement: boolean | null;
  }>[];
  exportDigest: `sha256:${string}`;
}>;

export type BenchmarkResearchGrantEvidence = Readonly<{
  schemaVersion: "rateloop.benchmark-research-grant-event.v2";
  eventType: "granted";
  grantId: string;
  workspaceId: string;
  projectId: string;
  benchmarkId: string;
  activationReference: string;
  deploymentKey: string;
  exportId: string;
  exportDigest: `sha256:${string}`;
  referenceEvidence: Readonly<{
    methodVersion: string;
    frameRoot: `sha256:${string}`;
    commitmentDigest: `sha256:${string}`;
    manifestRoot: `sha256:${string}`;
    sampleDigest: `sha256:${string}`;
  }>;
  recipientBindingKeyId: string;
  recipientBindingDigest: `hmac-sha256:${string}`;
  authorizationDigest: `hmac-sha256:${string}`;
  recipientAgreement: Readonly<{
    agreementId: string;
    version: number;
    acceptedAt: string;
    workspaceId: string;
    projectId: string;
    benchmarkId: string;
    purpose: BenchmarkResearchPurpose;
    dataClassification: "public_safe";
  }>;
  purpose: BenchmarkResearchPurpose;
  scopes: readonly BenchmarkResearchScope[];
  authorizedBy: string;
  issuedAt: string;
  expiresAt: string;
  disclosure: Readonly<{
    dataClassification: "public_safe";
    accessBasis: "accepted_contractual_public_safe_benchmark_agreement";
    dsaArticle40Status: "not_statutory_vetted_researcher_access";
    privateContent: "excluded";
    ciphertext: "excluded";
    reviewerIdentifiers: "excluded";
    sourceContentIdentifiers: "excluded";
    publicSamplingPseudonyms: "excluded" | "included_for_reproduction";
    digestSemantics: "content_address_only_not_authenticity_proof";
  }>;
  eventDigest: `sha256:${string}`;
}>;

export type BenchmarkResearchGrantRevocationEvidence = Readonly<{
  schemaVersion: "rateloop.benchmark-research-grant-event.v2";
  eventType: "revoked";
  grantId: string;
  grantEventDigest: `sha256:${string}`;
  workspaceId: string;
  projectId: string;
  revokedBy: string;
  revokedAt: string;
  reason: (typeof REVOCATION_REASONS)[number];
  digestSemantics: "content_address_only_not_authenticity_proof";
  eventDigest: `sha256:${string}`;
}>;

export type BenchmarkResearchGrantAccessAudit = Readonly<{
  schemaVersion: "rateloop.benchmark-research-access-audit.v1";
  action: "read";
  result: "success";
  accessId: string;
  idempotencyKey: string;
  grantId: string;
  grantEventDigest: `sha256:${string}`;
  workspaceId: string;
  projectId: string;
  benchmarkId: string;
  exportId: string;
  exportDigest: `sha256:${string}`;
  recipientBindingDigest: `hmac-sha256:${string}`;
  authorizationDigest: `hmac-sha256:${string}`;
  purpose: BenchmarkResearchPurpose;
  scopes: readonly BenchmarkResearchScope[];
  requestBindingDigest: `sha256:${string}`;
  components: readonly Readonly<{
    component: "reference_sample_manifest" | "reference_labels";
    offset: number;
    limit: number;
    total: number;
    nextOffset: number | null;
    rowsDigest: `sha256:${string}`;
  }>[];
  viewSchemaVersion: "rateloop.benchmark-research-view.v2";
  projection: BenchmarkResearchScope;
  viewDigest: `sha256:${string}`;
  accessedAt: string;
  digestSemantics: "content_address_only_not_authenticity_proof";
  auditDigest: `sha256:${string}`;
}>;

export type BenchmarkResearchGrantAccessAuditReceipt = Readonly<{
  schemaVersion: "rateloop.benchmark-research-access-audit-receipt.v1";
  persistenceState: "staged_not_committed";
  accessId: string;
  idempotencyKey: string;
  auditDigest: `sha256:${string}`;
  auditEventId: string;
  auditEventDigest: `sha256:${string}`;
  previousEventDigest: `sha256:${string}` | null;
  chainHeadDigest: `sha256:${string}`;
}>;

export type BenchmarkResearchGrantDeniedAccessAudit = Readonly<{
  schemaVersion: "rateloop.benchmark-research-denied-access-audit.v1";
  action: "read";
  result: "denied";
  accessId: string;
  idempotencyKey: string;
  requestLookupDigest: `sha256:${string}`;
  grantLookupDigest: `sha256:${string}`;
  recipientLookupDigest: `sha256:${string}`;
  page: Readonly<{ offset: number; limit: number }>;
  reason:
    | "not_found"
    | "inactive"
    | "binding_rejected"
    | "authorization_rejected"
    | "projection_rejected"
    | "idempotency_conflict";
  digestSemantics: "content_address_only_not_authenticity_proof";
  denialDigest: `sha256:${string}`;
}>;

export type BenchmarkResearchGrantDeniedAccessAuditReceipt = Readonly<{
  schemaVersion: "rateloop.benchmark-research-denied-access-audit-receipt.v1";
  persistenceState: "staged_not_committed";
  accessId: string;
  idempotencyKey: string;
  denialDigest: `sha256:${string}`;
  denialEventId: string;
  denialEventDigest: `sha256:${string}`;
  previousEventDigest: `sha256:${string}` | null;
  chainHeadDigest: `sha256:${string}`;
}>;

export type BenchmarkResearchGrantAccessRequestBinding = Readonly<{
  schemaVersion: "rateloop.benchmark-research-access-request-binding.v1";
  accessId: string;
  idempotencyKey: string;
  grantId: string;
  recipientLookupDigest: `sha256:${string}`;
  purpose: BenchmarkResearchPurpose;
  projection: BenchmarkResearchScope;
  page: Readonly<{ offset: number; limit: number }>;
}>;

export type BenchmarkResearchGrantAccessSnapshot = Readonly<{
  schemaVersion: "rateloop.benchmark-research-access-snapshot.v1";
  binding: BenchmarkResearchGrantAccessRequestBinding;
  requestBindingDigest: `sha256:${string}`;
  accessedAt: string;
  viewDigest: `sha256:${string}`;
  bytesDigest: `sha256:${string}`;
  bytes: Uint8Array;
  auditReceipt: BenchmarkResearchGrantAccessAuditReceipt;
}>;

export type BenchmarkResearchGrantAccessReplayLookup =
  | Readonly<{ result: "exact_replay"; snapshot: BenchmarkResearchGrantAccessSnapshot }>
  | Readonly<{
      result: "conflict";
      existingRequestBindingDigest: `sha256:${string}`;
    }>;

export type BenchmarkResearchGrantTransactionCommitReceipt = Readonly<{
  schemaVersion: "rateloop.benchmark-research-transaction-commit-receipt.v1";
  status: "committed";
  transactionId: string;
  committedAt: string;
  stagedEventDigest: `sha256:${string}` | null;
}>;

export type BenchmarkResearchAuthoritativeGrantState = Readonly<{
  grant: BenchmarkResearchGrantEvidence;
  revocation: BenchmarkResearchGrantRevocationEvidence | null;
}>;

type ActiveManager = Readonly<{
  principalId: string;
  workspaceId: string;
  status: "active";
  role: "owner" | "admin";
}>;

type ActiveRecipient = Readonly<{
  principalId: string;
  status: "active";
  agreement: Readonly<{
    agreementId: string;
    version: number;
    status: "accepted";
    acceptedAt: string;
    workspaceId: string;
    projectId: string;
    benchmarkId: string;
    purpose: BenchmarkResearchPurpose;
    dataClassification: "public_safe";
  }>;
}>;

type ActiveWorkspace = Readonly<{ workspaceId: string; status: "active" }>;
type ActiveProject = Readonly<{ projectId: string; workspaceId: string; status: "active" }>;
type ActiveBenchmarkActivation = Readonly<{
  activationReference: string;
  workspaceId: string;
  projectId: string;
  benchmarkId: string;
  deploymentKey: string;
  status: "active";
  publicSafeOnly: true;
}>;

export type BenchmarkResearchGrantCreationContext = Readonly<{
  transactionTime: Date;
  manager: ActiveManager;
  recipient: ActiveRecipient;
  workspace: ActiveWorkspace;
  project: ActiveProject;
  activation: ActiveBenchmarkActivation;
  export: BenchmarkResearchApprovedExport;
}>;

export type BenchmarkResearchGrantRevocationContext = Readonly<{
  transactionTime: Date;
  manager: ActiveManager;
  workspace: ActiveWorkspace;
  project: ActiveProject;
  state: BenchmarkResearchAuthoritativeGrantState;
}>;

export type BenchmarkResearchGrantAccessContext = Readonly<{
  transactionTime: Date;
  recipient: ActiveRecipient;
  workspace: ActiveWorkspace;
  project: ActiveProject;
  activation: ActiveBenchmarkActivation;
  export: BenchmarkResearchApprovedExport;
  state: BenchmarkResearchAuthoritativeGrantState;
}>;

/**
 * The adapter owns one active database transaction. Its authorization queries must lock or
 * otherwise atomically bind the active principals, accepted agreement, tenant, project,
 * governed benchmark activation and immutable approved export returned here. The timestamp
 * must come from that transaction's database clock, never from a request body.
 */
export type BenchmarkResearchGrantWriteTransaction = Readonly<{
  authorizeGrantCreationForUpdate(input: {
    authenticatedManagerPrincipalId: string;
    recipientPrincipalId: string;
    exportId: string;
    purpose: BenchmarkResearchPurpose;
  }): Promise<BenchmarkResearchGrantCreationContext | null>;
  appendGrant(grant: BenchmarkResearchGrantEvidence): Promise<void>;
  authorizeGrantRevocationForUpdate(input: {
    authenticatedManagerPrincipalId: string;
    grantId: string;
  }): Promise<BenchmarkResearchGrantRevocationContext | null>;
  appendRevocation(revocation: BenchmarkResearchGrantRevocationEvidence): Promise<void>;
}>;

/**
 * The adapter owns the complete read transaction. It must atomically load the active access
 * context at the returned database time and append the success audit before the caller can
 * commit. It must serialize and stage the immutable first-access snapshot while revocation remains
 * locked, then COMMIT before exposing any returned bytes. There is intentionally no caller-supplied
 * access time or export payload.
 *
 * This module is a route-unreachable foundation: no HTTP, agent, or public-tool route may call it
 * until a durable adapter enforces that commit-before-disclosure boundary. That adapter should
 * validate and admit an immutable export once and page already-bound rows; repeatedly loading and
 * verifying a 50,000-row manifest on every read is not an acceptable persistence implementation.
 */
export type BenchmarkResearchGrantReadTransaction = Readonly<{
  /**
   * Both accessId and idempotencyKey are unique. Return exact_replay only when both identifiers,
   * grant, recipient lookup, projection recorded in the snapshot, and normalized page match the
   * committed first access. Any collision is a conflict. The adapter must load the persisted bytes
   * and original accessedAt; it must never regenerate a replay from current source rows.
   */
  loadCommittedAccessReplayForUpdate(input: {
    accessId: string;
    idempotencyKey: string;
    grantId: string;
    recipientLookupDigest: `sha256:${string}`;
    page: Readonly<{ offset: number; limit: number }>;
  }): Promise<BenchmarkResearchGrantAccessReplayLookup | null>;
  loadActiveGrantAccessContext(input: {
    accessId: string;
    idempotencyKey: string;
    grantId: string;
    authenticatedRecipientPrincipalId: string;
  }): Promise<BenchmarkResearchGrantAccessContext | null>;
  recheckActiveGrantAccessContextForUpdate(input: {
    accessId: string;
    idempotencyKey: string;
    grantId: string;
    authenticatedRecipientPrincipalId: string;
    expectedGrantEventDigest: `sha256:${string}`;
    expectedExportDigest: `sha256:${string}`;
    expectedAuthorizationDigest: `hmac-sha256:${string}`;
  }): Promise<BenchmarkResearchGrantAccessContext | null>;
  appendSuccessfulAccessAudit(
    audit: BenchmarkResearchGrantAccessAudit,
    /** Atomically staged with the audit; the adapter attaches the returned receipt before commit. */
    snapshot: Omit<BenchmarkResearchGrantAccessSnapshot, "auditReceipt">,
  ): Promise<BenchmarkResearchGrantAccessAuditReceipt>;
  appendDeniedAccessAudit(
    audit: BenchmarkResearchGrantDeniedAccessAudit,
  ): Promise<BenchmarkResearchGrantDeniedAccessAuditReceipt>;
}>;

export type BenchmarkResearchGrantCommittedTransactionExecutor = Readonly<{
  /**
   * The adapter must persist the staged outcome and COMMIT before resolving. TypeScript cannot
   * prove that contract; the durable adapter requires database failure-injection conformance tests.
   */
  withCommittedTransaction<T>(
    work: (transaction: BenchmarkResearchGrantReadTransaction) => Promise<T>,
  ): Promise<Readonly<{ value: T; commitReceipt: BenchmarkResearchGrantTransactionCommitReceipt }>>;
}>;

/**
 * Persistence boundary for a future durable adapter. The interface describes the required
 * outcome; it cannot prove that an implementation committed. Implementations must lock the
 * grant/revocation state, load the approval audit and attestation rows identified by the export
 * and verify the approval artifact digest plus the attested audit-event digest, repeat the
 * active-state check using database time,
 * serialize the allowlisted view while revocation remains serialized by that transaction, append
 * an idempotent hash-only success audit, COMMIT, and only then return bytes. Every denial must be
 * durably audited before returning the uniform not-found response. This contract cannot enforce
 * database durability; conformance and failure-injection tests are required of the adapter. The
 * exported pure coordinator is not a durable adapter, and no route may call it until that adapter
 * and its schema exist.
 */
export type BenchmarkResearchGrantPersistenceFacade = Readonly<{
  readAfterCommittedAudit(input: {
    accessId: string;
    idempotencyKey: string;
    grantId: string;
    authenticatedRecipientPrincipalId: string;
    page?: { offset?: number; limit?: number };
  }): Promise<
    Readonly<{
      schemaVersion: "rateloop.benchmark-research-committed-read.v1";
      accessId: string;
      idempotencyKey: string;
      accessedAt: string;
      replayed: boolean;
      contentType: "application/json; charset=utf-8";
      bytes: Uint8Array;
      commitReceipt: Readonly<{
        status: "committed";
        transactionId: string;
        committedAt: string;
        auditEventId: string;
        auditEventDigest: `sha256:${string}`;
        chainHeadDigest: `sha256:${string}`;
      }>;
    }>
  >;
}>;

export type BenchmarkResearchRecipientBindingKey = Readonly<{
  keyId: string;
  secret: Uint8Array;
}>;

function invalid(message: string, field?: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_benchmark_research_grant", false, field);
}

function publicNotFound(): never {
  throw new TokenlessServiceError("Research grant not found.", 404, "benchmark_research_grant_not_found");
}

function idempotencyConflict(): never {
  throw new TokenlessServiceError(
    "Research access idempotency key conflicts with an earlier request.",
    409,
    "benchmark_research_access_idempotency_conflict",
  );
}

function projectNotFound(): never {
  throw new TokenlessServiceError("Project not found.", 404, "project_not_found");
}

function exactKeys(value: unknown, allowed: readonly string[], field: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${field} is invalid.`);
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid(`${field} contains unsupported fields.`);
  }
}

function requiredIdentifier(value: unknown, field: string) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) invalid(`${field} is invalid.`, field);
  return value;
}

function principalId(value: unknown, field: string) {
  if (typeof value !== "string" || !isRateLoopPrincipalId(value)) invalid(`${field} is invalid.`, field);
  return value;
}

function strictDigest(value: unknown, field: string) {
  if (typeof value !== "string" || !SHA256.test(value)) invalid(`${field} is invalid.`, field);
  return value as `sha256:${string}`;
}

function strictBindingDigest(value: unknown) {
  if (typeof value !== "string" || !HMAC_SHA256.test(value)) invalid("Recipient binding is invalid.");
  return value as `hmac-sha256:${string}`;
}

function accessId(value: unknown) {
  if (typeof value !== "string" || !ACCESS_ID.test(value)) invalid("Research access ID is invalid.", "accessId");
  return value;
}

function idempotencyKey(value: unknown) {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY.test(value)) {
    invalid("Research access idempotency key is invalid.", "idempotencyKey");
  }
  return value;
}

function canonicalTimestamp(value: unknown, field: string) {
  if (typeof value !== "string") invalid(`${field} is invalid.`, field);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(`${field} is invalid.`, field);
  return parsed;
}

function transactionTime(value: unknown) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Benchmark research transaction time must come from the database clock.");
  }
  return new Date(value.getTime());
}

function exactScopes(purpose: BenchmarkResearchPurpose) {
  if (!Object.hasOwn(BENCHMARK_RESEARCH_PURPOSE_SCOPES, purpose)) {
    invalid("Research purpose is unsupported.", "purpose");
  }
  return [...BENCHMARK_RESEARCH_PURPOSE_SCOPES[purpose]] as BenchmarkResearchScope[];
}

function withoutField<T extends Record<string, unknown>>(value: T, field: keyof T) {
  const payload = { ...value } as Record<string, unknown>;
  delete payload[field as string];
  return payload;
}

function bindingKey(value: BenchmarkResearchRecipientBindingKey) {
  exactKeys(value, ["keyId", "secret"], "Recipient binding key");
  const keyId = requiredIdentifier(value.keyId, "recipientBindingKey.keyId");
  if (!(value.secret instanceof Uint8Array) || value.secret.byteLength < 32) {
    throw new Error("Benchmark research recipient binding keys must contain at least 32 bytes.");
  }
  return { keyId, secret: new Uint8Array(value.secret) };
}

function recipientBindingDigest(input: {
  grantId: string;
  recipientPrincipalId: string;
  bindingKey: BenchmarkResearchRecipientBindingKey;
  workspaceId: string;
  projectId: string;
  benchmarkId: string;
  exportId: string;
  deploymentKey: string;
}) {
  const key = bindingKey(input.bindingKey);
  const payload = canonicalizeRfc8785({
    domain: RECIPIENT_BINDING_DOMAIN,
    grantId: input.grantId,
    bindingKeyId: key.keyId,
    recipientPrincipalId: principalId(input.recipientPrincipalId, "Recipient principal"),
    workspaceId: requiredIdentifier(input.workspaceId, "Workspace"),
    projectId: requiredIdentifier(input.projectId, "Project"),
    benchmarkId: requiredIdentifier(input.benchmarkId, "Benchmark"),
    exportId: requiredIdentifier(input.exportId, "Approved export"),
    deploymentKey: requiredIdentifier(input.deploymentKey, "Deployment key"),
  });
  return `hmac-sha256:${createHmac("sha256", key.secret).update(payload).digest("hex")}` as const;
}

function recipientBindingsEqual(left: `hmac-sha256:${string}`, right: `hmac-sha256:${string}`) {
  return timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function referenceEvidenceFor(source: BenchmarkResearchApprovedExport) {
  return {
    methodVersion: source.referenceCommitment.methodVersion,
    frameRoot: source.referenceCommitment.frameRoot,
    commitmentDigest: source.referenceCommitment.commitmentDigest,
    manifestRoot: source.frozenReferenceSample.manifestRoot,
    sampleDigest: source.frozenReferenceSample.sampleDigest,
  };
}

function approvedArtifactDigest(source: BenchmarkResearchApprovedExport) {
  return sha256Rfc8785({
    domain: "rateloop.approved-public-safe-reference-artifact.v1",
    schemaVersion: source.schemaVersion,
    exportId: source.exportId,
    workspaceId: source.workspaceId,
    projectId: source.projectId,
    benchmarkId: source.benchmarkId,
    activationReference: source.activationReference,
    referenceCommitment: source.referenceCommitment,
    frozenReferenceSample: source.frozenReferenceSample,
    referenceProvenance: source.referenceProvenance,
    referenceLabels: source.referenceLabels,
  });
}

function validateReferenceProvenance(provenance: BenchmarkResearchReferenceProvenance) {
  exactKeys(
    provenance,
    [
      "adaptiveReuseAllowed",
      "bridgeHash",
      "derivationSource",
      "labelSetHash",
      "labelSetId",
      "operationalRollupEligible",
      "populationClaim",
      "reportingMode",
      "schemaVersion",
    ],
    "Reference provenance",
  );
  if (
    provenance.schemaVersion !== "rateloop.benchmark-research-reference-provenance.v1" ||
    !LABEL_SET_ID.test(provenance.labelSetId) ||
    !SHA256.test(provenance.labelSetHash) ||
    !SHA256.test(provenance.bridgeHash) ||
    provenance.populationClaim !== false ||
    provenance.operationalRollupEligible !== false ||
    provenance.adaptiveReuseAllowed !== false ||
    (provenance.derivationSource === "independent_reference_panel" &&
      provenance.reportingMode !== "independent_reference_panel_research_only") ||
    (provenance.derivationSource === "rateloop_network" &&
      provenance.reportingMode !== "descriptive_panel_vs_network_only") ||
    !["independent_reference_panel", "rateloop_network"].includes(provenance.derivationSource)
  ) {
    invalid("Reference provenance is invalid.");
  }
}

function authorizationPayload(input: {
  grant: Omit<BenchmarkResearchGrantEvidence, "authorizationDigest" | "eventDigest">;
  recipientPrincipalId: string;
}) {
  return {
    domain: AUTHORIZATION_BINDING_DOMAIN,
    ...input.grant,
    recipientPrincipalId: principalId(input.recipientPrincipalId, "Recipient principal"),
  };
}

function authorizationDigest(input: {
  grant: Omit<BenchmarkResearchGrantEvidence, "authorizationDigest" | "eventDigest">;
  recipientPrincipalId: string;
  bindingKey: BenchmarkResearchRecipientBindingKey;
}) {
  const key = bindingKey(input.bindingKey);
  const payload = canonicalizeRfc8785(
    authorizationPayload({ grant: input.grant, recipientPrincipalId: input.recipientPrincipalId }),
  );
  return `hmac-sha256:${createHmac("sha256", key.secret).update(payload).digest("hex")}` as const;
}

export function verifyBenchmarkResearchGrantAuthorization(input: {
  grant: BenchmarkResearchGrantEvidence;
  recipientPrincipalId: string;
  bindingKey: BenchmarkResearchRecipientBindingKey;
}): void {
  validateGrantEvidence(input.grant);
  const presented = input.grant.authorizationDigest;
  const grant = withoutField(
    withoutField(input.grant as unknown as Record<string, unknown>, "eventDigest"),
    "authorizationDigest",
  ) as Omit<BenchmarkResearchGrantEvidence, "authorizationDigest" | "eventDigest">;
  const expected = authorizationDigest({
    grant,
    recipientPrincipalId: input.recipientPrincipalId,
    bindingKey: input.bindingKey,
  });
  if (!recipientBindingsEqual(strictBindingDigest(presented), expected)) {
    invalid("Research grant authorization is invalid.");
  }
}

function pinnedBeacon(sample: FrozenReferenceSample): TokenlessReferenceSampleBeacon {
  const network = sample.beacon.network;
  if (network !== "quicknet" && network !== "quicknet-t") invalid("Approved reference beacon is invalid.");
  const chain = PINNED_DRAND_CHAINS[network];
  if (sample.beacon.chainHash !== chain.chainHash || sample.beacon.round <= 0) {
    invalid("Approved reference beacon is invalid.");
  }
  return {
    network,
    chainInfo: {
      public_key: chain.publicKey,
      period: chain.period,
      genesis_time: chain.genesisTime,
      hash: chain.chainHash,
      groupHash: chain.groupHash,
      schemeID: chain.schemeId,
      metadata: { beaconID: chain.beaconId },
    },
    evidence: {
      round: sample.beacon.round,
      randomness: sample.beacon.randomness.replace(/^0x/u, ""),
      signature: sample.beacon.signature.replace(/^0x/u, ""),
    },
    expectedRound: sample.beacon.round,
  };
}

function compactSample(sample: FrozenReferenceSample) {
  return {
    schemaVersion: sample.schemaVersion,
    commitmentDigest: sample.commitmentDigest,
    beacon: sample.beacon,
    seedDigest: sample.seedDigest,
    strata: sample.strata,
    manifestRoot: sample.manifestRoot,
    frozenWitness: sample.frozenWitness,
    sampleDigest: sample.sampleDigest,
  };
}

function validateApprovedExport(source: BenchmarkResearchApprovedExport) {
  exactKeys(
    source,
    [
      "schemaVersion",
      "exportId",
      "workspaceId",
      "projectId",
      "benchmarkId",
      "activationReference",
      "approval",
      "referenceCommitment",
      "frozenReferenceSample",
      "referenceProvenance",
      "referenceLabels",
      "exportDigest",
    ],
    "Approved benchmark export",
  );
  if (source.schemaVersion !== "rateloop.approved-public-safe-reference-export.v1") {
    invalid("Approved benchmark export schema is unsupported.");
  }
  requiredIdentifier(source.exportId, "Approved export");
  requiredIdentifier(source.workspaceId, "Workspace");
  requiredIdentifier(source.projectId, "Project");
  requiredIdentifier(source.benchmarkId, "Benchmark");
  requiredIdentifier(source.activationReference, "Benchmark activation");
  strictDigest(source.exportDigest, "Approved export digest");
  const expectedDigest = sha256Rfc8785(withoutField(source as unknown as Record<string, unknown>, "exportDigest"));
  if (source.exportDigest !== expectedDigest) invalid("Approved export digest does not match its content.");
  exactKeys(
    source.approval,
    [
      "status",
      "dataClassification",
      "derivation",
      "commitmentDigest",
      "sampleDigest",
      "approvalId",
      "approvedBy",
      "approvedAt",
      "auditBinding",
      "attestationBinding",
    ],
    "Approved export approval",
  );
  if (
    source.approval.status !== "approved_immutable" ||
    source.approval.dataClassification !== "public_safe" ||
    source.approval.derivation !== "verified_committed_and_frozen_reference_sample"
  ) {
    invalid("Benchmark export is not an immutable approved public-safe reference export.");
  }
  const approvedAt = canonicalTimestamp(source.approval.approvedAt, "approval.approvedAt");
  requiredIdentifier(source.approval.approvalId, "Approval");
  principalId(source.approval.approvedBy, "Approving principal");
  strictDigest(source.approval.commitmentDigest, "Approved commitment digest");
  strictDigest(source.approval.sampleDigest, "Approved sample digest");
  exactKeys(source.approval.auditBinding, ["eventId", "eventDigest", "artifactDigest"], "Approval audit binding");
  requiredIdentifier(source.approval.auditBinding.eventId, "Approval audit event");
  strictDigest(source.approval.auditBinding.eventDigest, "Approval audit event digest");
  strictDigest(source.approval.auditBinding.artifactDigest, "Approval audit artifact digest");
  exactKeys(source.approval.attestationBinding, ["jobId", "kind", "artifactDigest"], "Approval attestation binding");
  requiredIdentifier(source.approval.attestationBinding.jobId, "Approval attestation job");
  if (source.approval.attestationBinding.kind !== "audit_export_head") {
    invalid("Approval attestation binding is invalid.");
  }
  strictDigest(source.approval.attestationBinding.artifactDigest, "Approval attestation artifact digest");
  if (!Array.isArray(source.referenceLabels)) invalid("Approved reference labels are invalid.");
  validateReferenceProvenance(source.referenceProvenance);
  const sample = source.frozenReferenceSample;
  if (!sample || typeof sample !== "object" || !Array.isArray(sample.manifest)) {
    invalid("Approved frozen reference sample is invalid.");
  }
  if (sample.manifest.length === 0 || sample.manifest.length > MAX_MANIFEST_ROWS) {
    invalid(`Approved reference manifests must contain between 1 and ${MAX_MANIFEST_ROWS} rows.`);
  }
  const units: ReferenceFrameUnit[] = sample.manifest.map(row => ({
    unitId: row.unitId,
    sourceDecisionBinding: row.sourceDecisionBinding,
    sourceEvaluationBinding: row.sourceEvaluationBinding,
    sourceEvaluationHash: row.sourceEvaluationHash,
    decidedAt: row.decidedAt,
    automationProcessing: row.automationProcessing,
    systemIdentity: row.systemIdentity,
    systemId: row.systemId,
    systemVersion: row.systemVersion,
    machineClass: row.machineClass,
    publicDesignation: row.publicDesignation,
    automatedOutcome: row.automatedOutcome,
    referenceLabelState: "unlabeled",
  }));
  let recomputed: FrozenReferenceSample;
  try {
    recomputed = verifyFrozenReferenceSample({
      expected: sample,
      commitment: source.referenceCommitment,
      units,
      beacon: pinnedBeacon(sample),
      frozenWitness: sample.frozenWitness,
    });
  } catch {
    invalid("Approved export does not reproduce its committed reference sample.");
  }
  if (
    canonicalizeRfc8785(compactSample(sample)) !== canonicalizeRfc8785(compactSample(recomputed)) ||
    sample.manifest.length !== recomputed.manifest.length ||
    sample.manifest.some((row, index) => canonicalizeRfc8785(row) !== canonicalizeRfc8785(recomputed.manifest[index]))
  ) {
    invalid("Approved export does not reproduce its committed reference sample.");
  }
  const commitment = source.referenceCommitment;
  if (
    commitment.source.workspaceId !== source.workspaceId ||
    commitment.source.projectId !== source.projectId ||
    commitment.source.benchmarkId !== source.benchmarkId ||
    commitment.source.activationReference !== source.activationReference ||
    commitment.commitmentDigest !== source.approval.commitmentDigest ||
    sample.commitmentDigest !== commitment.commitmentDigest ||
    sample.sampleDigest !== source.approval.sampleDigest
  ) {
    invalid("Approved export identity does not match its reference evidence.");
  }
  if (approvedAt < canonicalTimestamp(sample.frozenWitness.frozenAt, "frozenReferenceSample.frozenWitness.frozenAt")) {
    invalid("Approved export approval must follow the frozen reference sample.");
  }
  const selected = new Map(sample.manifest.filter(row => row.selected).map(row => [row.unitId, row]));
  const labels = new Set<string>();
  for (const label of source.referenceLabels) {
    exactKeys(label, ["unitId", "referenceLabel", "agreement"], "Approved reference label");
    const row = selected.get(label.unitId);
    if (!row || labels.has(label.unitId))
      invalid("Approved reference labels must bind each selected public unit once.");
    labels.add(label.unitId);
    if (label.referenceLabel !== "pass" && label.referenceLabel !== "fail" && label.referenceLabel !== "uncertain") {
      invalid("Approved reference label is invalid.");
    }
    const expectedAgreement =
      label.referenceLabel === "uncertain" ? null : label.referenceLabel === row.automatedOutcome;
    if (label.agreement !== expectedAgreement) invalid("Approved reference label agreement is invalid.");
  }
  if (labels.size !== selected.size) invalid("Approved reference labels must cover every selected public unit.");
  const artifactDigest = approvedArtifactDigest(source);
  if (
    source.approval.auditBinding.artifactDigest !== artifactDigest ||
    source.approval.attestationBinding.artifactDigest !== source.approval.auditBinding.eventDigest
  ) {
    invalid("Approved export approval and audit-head attestation do not bind the exact audit chain.");
  }
}

function validateGrantEvidence(grant: BenchmarkResearchGrantEvidence) {
  exactKeys(
    grant,
    [
      "schemaVersion",
      "eventType",
      "grantId",
      "workspaceId",
      "projectId",
      "benchmarkId",
      "activationReference",
      "deploymentKey",
      "exportId",
      "exportDigest",
      "referenceEvidence",
      "recipientBindingKeyId",
      "recipientBindingDigest",
      "authorizationDigest",
      "recipientAgreement",
      "purpose",
      "scopes",
      "authorizedBy",
      "issuedAt",
      "expiresAt",
      "disclosure",
      "eventDigest",
    ],
    "Research grant evidence",
  );
  if (
    grant.schemaVersion !== "rateloop.benchmark-research-grant-event.v2" ||
    grant.eventType !== "granted" ||
    !GRANT_ID.test(grant.grantId)
  ) {
    invalid("Research grant evidence is invalid.");
  }
  requiredIdentifier(grant.workspaceId, "Workspace");
  requiredIdentifier(grant.projectId, "Project");
  requiredIdentifier(grant.benchmarkId, "Benchmark");
  requiredIdentifier(grant.activationReference, "Benchmark activation");
  requiredIdentifier(grant.deploymentKey, "Deployment key");
  requiredIdentifier(grant.exportId, "Approved export");
  strictDigest(grant.exportDigest, "Approved export digest");
  requiredIdentifier(grant.recipientBindingKeyId, "Recipient binding key ID");
  strictBindingDigest(grant.recipientBindingDigest);
  strictBindingDigest(grant.authorizationDigest);
  principalId(grant.authorizedBy, "Authorizing manager");
  exactKeys(
    grant.referenceEvidence,
    ["methodVersion", "frameRoot", "commitmentDigest", "manifestRoot", "sampleDigest"],
    "Reference evidence",
  );
  requiredIdentifier(grant.referenceEvidence.methodVersion, "Reference sampling method");
  strictDigest(grant.referenceEvidence.frameRoot, "Reference frame root");
  strictDigest(grant.referenceEvidence.commitmentDigest, "Reference commitment digest");
  strictDigest(grant.referenceEvidence.manifestRoot, "Reference manifest root");
  strictDigest(grant.referenceEvidence.sampleDigest, "Reference sample digest");
  exactKeys(
    grant.recipientAgreement,
    [
      "agreementId",
      "version",
      "acceptedAt",
      "workspaceId",
      "projectId",
      "benchmarkId",
      "purpose",
      "dataClassification",
    ],
    "Recipient agreement",
  );
  requiredIdentifier(grant.recipientAgreement.agreementId, "Recipient agreement");
  requiredIdentifier(grant.recipientAgreement.workspaceId, "Recipient agreement workspace");
  requiredIdentifier(grant.recipientAgreement.projectId, "Recipient agreement project");
  requiredIdentifier(grant.recipientAgreement.benchmarkId, "Recipient agreement benchmark");
  if (!Number.isSafeInteger(grant.recipientAgreement.version) || grant.recipientAgreement.version <= 0) {
    invalid("Recipient agreement version is invalid.");
  }
  const acceptedAt = canonicalTimestamp(grant.recipientAgreement.acceptedAt, "recipientAgreement.acceptedAt");
  const issuedAt = canonicalTimestamp(grant.issuedAt, "issuedAt");
  const expiresAt = canonicalTimestamp(grant.expiresAt, "expiresAt");
  if (
    acceptedAt > issuedAt ||
    expiresAt <= issuedAt ||
    expiresAt.getTime() - issuedAt.getTime() > MAX_GRANT_LIFETIME_MS ||
    canonicalizeRfc8785(grant.scopes) !== canonicalizeRfc8785(exactScopes(grant.purpose)) ||
    grant.recipientAgreement.workspaceId !== grant.workspaceId ||
    grant.recipientAgreement.projectId !== grant.projectId ||
    grant.recipientAgreement.benchmarkId !== grant.benchmarkId ||
    grant.recipientAgreement.purpose !== grant.purpose ||
    grant.recipientAgreement.dataClassification !== "public_safe"
  ) {
    invalid("Research grant evidence is invalid.");
  }
  exactKeys(
    grant.disclosure,
    [
      "dataClassification",
      "accessBasis",
      "dsaArticle40Status",
      "privateContent",
      "ciphertext",
      "reviewerIdentifiers",
      "sourceContentIdentifiers",
      "publicSamplingPseudonyms",
      "digestSemantics",
    ],
    "Research grant disclosure",
  );
  const expectedDisclosure = {
    dataClassification: "public_safe",
    accessBasis: "accepted_contractual_public_safe_benchmark_agreement",
    dsaArticle40Status: "not_statutory_vetted_researcher_access",
    privateContent: "excluded",
    ciphertext: "excluded",
    reviewerIdentifiers: "excluded",
    sourceContentIdentifiers: "excluded",
    publicSamplingPseudonyms: grant.purpose === "methodology_validation" ? "excluded" : "included_for_reproduction",
    digestSemantics: "content_address_only_not_authenticity_proof",
  };
  if (
    canonicalizeRfc8785(grant.disclosure) !== canonicalizeRfc8785(expectedDisclosure) ||
    grant.eventDigest !== sha256Rfc8785(withoutField(grant as unknown as Record<string, unknown>, "eventDigest"))
  ) {
    invalid("Research grant evidence is invalid.");
  }
}

function validateRevocationEvidence(revocation: BenchmarkResearchGrantRevocationEvidence) {
  exactKeys(
    revocation,
    [
      "schemaVersion",
      "eventType",
      "grantId",
      "grantEventDigest",
      "workspaceId",
      "projectId",
      "revokedBy",
      "revokedAt",
      "reason",
      "digestSemantics",
      "eventDigest",
    ],
    "Research grant revocation evidence",
  );
  if (
    revocation.schemaVersion !== "rateloop.benchmark-research-grant-event.v2" ||
    revocation.eventType !== "revoked" ||
    !GRANT_ID.test(revocation.grantId) ||
    !REVOCATION_REASONS.includes(revocation.reason) ||
    revocation.digestSemantics !== "content_address_only_not_authenticity_proof"
  ) {
    invalid("Research grant revocation evidence is invalid.");
  }
  strictDigest(revocation.grantEventDigest, "Grant event digest");
  requiredIdentifier(revocation.workspaceId, "Workspace");
  requiredIdentifier(revocation.projectId, "Project");
  principalId(revocation.revokedBy, "Revoking manager");
  canonicalTimestamp(revocation.revokedAt, "revokedAt");
  if (
    revocation.eventDigest !==
    sha256Rfc8785(withoutField(revocation as unknown as Record<string, unknown>, "eventDigest"))
  ) {
    invalid("Research grant revocation evidence is invalid.");
  }
}

function validateAuthoritativeState(state: BenchmarkResearchAuthoritativeGrantState) {
  exactKeys(state, ["grant", "revocation"], "Authoritative research grant state");
  validateGrantEvidence(state.grant);
  if (state.revocation === null) return;
  validateRevocationEvidence(state.revocation);
  if (
    state.revocation.grantId !== state.grant.grantId ||
    state.revocation.grantEventDigest !== state.grant.eventDigest ||
    state.revocation.workspaceId !== state.grant.workspaceId ||
    state.revocation.projectId !== state.grant.projectId ||
    canonicalTimestamp(state.revocation.revokedAt, "revokedAt") < canonicalTimestamp(state.grant.issuedAt, "issuedAt")
  ) {
    invalid("Research grant revocation does not bind to the authoritative grant.");
  }
}

function validateActiveTenant(input: {
  workspace: ActiveWorkspace;
  project: ActiveProject;
  activation?: ActiveBenchmarkActivation;
}) {
  exactKeys(input.workspace, ["workspaceId", "status"], "Active workspace");
  exactKeys(input.project, ["projectId", "workspaceId", "status"], "Active project");
  if (
    input.workspace.status !== "active" ||
    input.project.status !== "active" ||
    input.project.workspaceId !== input.workspace.workspaceId
  ) {
    invalid("Active tenant context is invalid.");
  }
  requiredIdentifier(input.workspace.workspaceId, "Workspace");
  requiredIdentifier(input.project.projectId, "Project");
  if (!input.activation) return;
  exactKeys(
    input.activation,
    ["activationReference", "workspaceId", "projectId", "benchmarkId", "deploymentKey", "status", "publicSafeOnly"],
    "Active benchmark activation",
  );
  if (
    input.activation.status !== "active" ||
    input.activation.publicSafeOnly !== true ||
    input.activation.workspaceId !== input.workspace.workspaceId ||
    input.activation.projectId !== input.project.projectId
  ) {
    invalid("Active benchmark activation is invalid.");
  }
  requiredIdentifier(input.activation.activationReference, "Benchmark activation");
  requiredIdentifier(input.activation.benchmarkId, "Benchmark");
  requiredIdentifier(input.activation.deploymentKey, "Deployment key");
}

function validateRecipient(recipient: ActiveRecipient, now: Date) {
  exactKeys(recipient, ["principalId", "status", "agreement"], "Active recipient");
  if (recipient.status !== "active") invalid("Active recipient is invalid.");
  principalId(recipient.principalId, "Recipient principal");
  exactKeys(
    recipient.agreement,
    [
      "agreementId",
      "version",
      "status",
      "acceptedAt",
      "workspaceId",
      "projectId",
      "benchmarkId",
      "purpose",
      "dataClassification",
    ],
    "Recipient agreement",
  );
  if (
    recipient.agreement.status !== "accepted" ||
    !Number.isSafeInteger(recipient.agreement.version) ||
    recipient.agreement.version <= 0 ||
    canonicalTimestamp(recipient.agreement.acceptedAt, "recipient.agreement.acceptedAt") > now ||
    recipient.agreement.dataClassification !== "public_safe" ||
    !Object.hasOwn(BENCHMARK_RESEARCH_PURPOSE_SCOPES, recipient.agreement.purpose)
  ) {
    invalid("Recipient agreement is invalid.");
  }
  requiredIdentifier(recipient.agreement.agreementId, "Recipient agreement");
  requiredIdentifier(recipient.agreement.workspaceId, "Recipient agreement workspace");
  requiredIdentifier(recipient.agreement.projectId, "Recipient agreement project");
  requiredIdentifier(recipient.agreement.benchmarkId, "Recipient agreement benchmark");
}

function validateManager(manager: ActiveManager, expectedPrincipalId: string, expectedWorkspaceId: string) {
  exactKeys(manager, ["principalId", "workspaceId", "status", "role"], "Active manager");
  if (
    manager.status !== "active" ||
    (manager.role !== "owner" && manager.role !== "admin") ||
    principalId(manager.principalId, "Manager principal") !== expectedPrincipalId ||
    manager.workspaceId !== expectedWorkspaceId
  ) {
    invalid("Active manager authorization is invalid.");
  }
}

function validateCreationContext(
  context: BenchmarkResearchGrantCreationContext,
  expected: {
    managerPrincipalId: string;
    recipientPrincipalId: string;
    exportId: string;
    purpose: BenchmarkResearchPurpose;
  },
) {
  exactKeys(
    context,
    ["transactionTime", "manager", "recipient", "workspace", "project", "activation", "export"],
    "Grant creation context",
  );
  const now = transactionTime(context.transactionTime);
  validateActiveTenant(context);
  validateManager(context.manager, expected.managerPrincipalId, context.workspace.workspaceId);
  validateRecipient(context.recipient, now);
  validateApprovedExport(context.export);
  if (
    context.recipient.principalId !== expected.recipientPrincipalId ||
    context.export.exportId !== expected.exportId ||
    context.export.workspaceId !== context.workspace.workspaceId ||
    context.export.projectId !== context.project.projectId ||
    context.export.benchmarkId !== context.activation.benchmarkId ||
    context.export.activationReference !== context.activation.activationReference ||
    context.export.referenceCommitment.source.deploymentKey !== context.activation.deploymentKey ||
    context.recipient.agreement.workspaceId !== context.workspace.workspaceId ||
    context.recipient.agreement.projectId !== context.project.projectId ||
    context.recipient.agreement.benchmarkId !== context.activation.benchmarkId ||
    context.recipient.agreement.purpose !== expected.purpose ||
    context.recipient.agreement.dataClassification !== "public_safe" ||
    canonicalTimestamp(context.export.approval.approvedAt, "approval.approvedAt") > now
  ) {
    invalid("Grant creation context does not bind the requested approved export.");
  }
  return now;
}

function validateRevocationContext(
  context: BenchmarkResearchGrantRevocationContext,
  expected: { managerPrincipalId: string; grantId: string },
) {
  exactKeys(context, ["transactionTime", "manager", "workspace", "project", "state"], "Grant revocation context");
  const now = transactionTime(context.transactionTime);
  validateActiveTenant(context);
  validateManager(context.manager, expected.managerPrincipalId, context.workspace.workspaceId);
  validateAuthoritativeState(context.state);
  if (
    context.state.grant.grantId !== expected.grantId ||
    context.state.grant.workspaceId !== context.workspace.workspaceId ||
    context.state.grant.projectId !== context.project.projectId ||
    canonicalTimestamp(context.state.grant.issuedAt, "issuedAt") > now
  ) {
    invalid("Grant revocation context is invalid.");
  }
  return now;
}

function validateAccessContext(
  context: BenchmarkResearchGrantAccessContext,
  expected: { recipientPrincipalId: string; grantId: string },
) {
  exactKeys(
    context,
    ["transactionTime", "recipient", "workspace", "project", "activation", "export", "state"],
    "Grant access context",
  );
  const now = transactionTime(context.transactionTime);
  validateRecipient(context.recipient, now);
  validateActiveTenant(context);
  validateApprovedExport(context.export);
  validateAuthoritativeState(context.state);
  const grant = context.state.grant;
  if (
    context.recipient.principalId !== expected.recipientPrincipalId ||
    grant.grantId !== expected.grantId ||
    grant.workspaceId !== context.workspace.workspaceId ||
    grant.projectId !== context.project.projectId ||
    grant.benchmarkId !== context.activation.benchmarkId ||
    grant.activationReference !== context.activation.activationReference ||
    grant.deploymentKey !== context.activation.deploymentKey ||
    grant.exportId !== context.export.exportId ||
    grant.exportDigest !== context.export.exportDigest ||
    context.export.workspaceId !== grant.workspaceId ||
    context.export.projectId !== grant.projectId ||
    context.export.benchmarkId !== grant.benchmarkId ||
    context.export.activationReference !== grant.activationReference ||
    context.export.referenceCommitment.source.deploymentKey !== context.activation.deploymentKey ||
    canonicalizeRfc8785(grant.referenceEvidence) !== canonicalizeRfc8785(referenceEvidenceFor(context.export)) ||
    context.recipient.agreement.agreementId !== grant.recipientAgreement.agreementId ||
    context.recipient.agreement.version !== grant.recipientAgreement.version ||
    context.recipient.agreement.acceptedAt !== grant.recipientAgreement.acceptedAt ||
    context.recipient.agreement.workspaceId !== grant.workspaceId ||
    context.recipient.agreement.projectId !== grant.projectId ||
    context.recipient.agreement.benchmarkId !== grant.benchmarkId ||
    context.recipient.agreement.purpose !== grant.purpose ||
    context.recipient.agreement.dataClassification !== "public_safe"
  ) {
    invalid("Grant access context is invalid.");
  }
  const issuedAt = canonicalTimestamp(grant.issuedAt, "issuedAt");
  const expiresAt = canonicalTimestamp(grant.expiresAt, "expiresAt");
  if (now < issuedAt || now >= expiresAt || context.state.revocation !== null) invalid("Grant is inactive.");
  return now;
}

export async function createBenchmarkResearchGrantInTransaction(input: {
  transaction: BenchmarkResearchGrantWriteTransaction;
  authenticatedManagerPrincipalId: string;
  recipientPrincipalId: string;
  exportId: string;
  grantId: string;
  purpose: BenchmarkResearchPurpose;
  durationMs: number;
  recipientBindingKey: BenchmarkResearchRecipientBindingKey;
}): Promise<BenchmarkResearchGrantEvidence> {
  if (!GRANT_ID.test(input.grantId)) invalid("Research grant ID is invalid.", "grantId");
  const managerPrincipalId = principalId(input.authenticatedManagerPrincipalId, "Authenticated manager principal");
  const recipient = principalId(input.recipientPrincipalId, "Recipient principal");
  const exportId = requiredIdentifier(input.exportId, "Approved export");
  const scopes = exactScopes(input.purpose);
  if (!Number.isSafeInteger(input.durationMs) || input.durationMs <= 0 || input.durationMs > MAX_GRANT_LIFETIME_MS) {
    invalid("Research grant duration must be positive and no longer than 30 days.", "durationMs");
  }
  const key = bindingKey(input.recipientBindingKey);
  const loadedContext = await input.transaction.authorizeGrantCreationForUpdate({
    authenticatedManagerPrincipalId: managerPrincipalId,
    recipientPrincipalId: recipient,
    exportId,
    purpose: input.purpose,
  });
  if (!loadedContext) projectNotFound();
  const context = structuredClone(loadedContext);
  let now: Date;
  try {
    now = validateCreationContext(context, {
      managerPrincipalId,
      recipientPrincipalId: recipient,
      exportId,
      purpose: input.purpose,
    });
  } catch {
    projectNotFound();
  }
  const expiresAt = new Date(now.getTime() + input.durationMs);
  if (!Number.isFinite(expiresAt.getTime())) invalid("Research grant expiry is invalid.");
  const source = context.export;
  const event = {
    schemaVersion: "rateloop.benchmark-research-grant-event.v2" as const,
    eventType: "granted" as const,
    grantId: input.grantId,
    workspaceId: source.workspaceId,
    projectId: source.projectId,
    benchmarkId: source.benchmarkId,
    activationReference: source.activationReference,
    deploymentKey: context.activation.deploymentKey,
    exportId: source.exportId,
    exportDigest: source.exportDigest,
    referenceEvidence: referenceEvidenceFor(source),
    recipientBindingKeyId: key.keyId,
    recipientBindingDigest: recipientBindingDigest({
      grantId: input.grantId,
      recipientPrincipalId: recipient,
      bindingKey: key,
      workspaceId: source.workspaceId,
      projectId: source.projectId,
      benchmarkId: source.benchmarkId,
      exportId: source.exportId,
      deploymentKey: context.activation.deploymentKey,
    }),
    recipientAgreement: {
      agreementId: context.recipient.agreement.agreementId,
      version: context.recipient.agreement.version,
      acceptedAt: context.recipient.agreement.acceptedAt,
      workspaceId: context.recipient.agreement.workspaceId,
      projectId: context.recipient.agreement.projectId,
      benchmarkId: context.recipient.agreement.benchmarkId,
      purpose: context.recipient.agreement.purpose,
      dataClassification: context.recipient.agreement.dataClassification,
    },
    purpose: input.purpose,
    scopes,
    authorizedBy: context.manager.principalId,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    disclosure: {
      dataClassification: "public_safe" as const,
      accessBasis: "accepted_contractual_public_safe_benchmark_agreement" as const,
      dsaArticle40Status: "not_statutory_vetted_researcher_access" as const,
      privateContent: "excluded" as const,
      ciphertext: "excluded" as const,
      reviewerIdentifiers: "excluded" as const,
      sourceContentIdentifiers: "excluded" as const,
      publicSamplingPseudonyms:
        input.purpose === "methodology_validation" ? ("excluded" as const) : ("included_for_reproduction" as const),
      digestSemantics: "content_address_only_not_authenticity_proof" as const,
    },
  };
  const eventWithAuthorization = {
    ...event,
    authorizationDigest: authorizationDigest({
      grant: event,
      recipientPrincipalId: recipient,
      bindingKey: key,
    }),
  };
  const grant = { ...eventWithAuthorization, eventDigest: sha256Rfc8785(eventWithAuthorization) };
  await input.transaction.appendGrant(structuredClone(grant));
  return structuredClone(grant);
}

export async function revokeBenchmarkResearchGrantInTransaction(input: {
  transaction: BenchmarkResearchGrantWriteTransaction;
  authenticatedManagerPrincipalId: string;
  grantId: string;
  reason: BenchmarkResearchGrantRevocationEvidence["reason"];
}): Promise<BenchmarkResearchGrantRevocationEvidence> {
  if (!GRANT_ID.test(input.grantId)) publicNotFound();
  const managerPrincipalId = principalId(input.authenticatedManagerPrincipalId, "Authenticated manager principal");
  if (!REVOCATION_REASONS.includes(input.reason)) invalid("Research grant revocation reason is invalid.", "reason");
  const loadedContext = await input.transaction.authorizeGrantRevocationForUpdate({
    authenticatedManagerPrincipalId: managerPrincipalId,
    grantId: input.grantId,
  });
  if (!loadedContext) publicNotFound();
  const context = structuredClone(loadedContext);
  let now: Date;
  try {
    now = validateRevocationContext(context, { managerPrincipalId, grantId: input.grantId });
  } catch {
    publicNotFound();
  }
  if (context.state.revocation !== null) publicNotFound();
  const event = {
    schemaVersion: "rateloop.benchmark-research-grant-event.v2" as const,
    eventType: "revoked" as const,
    grantId: context.state.grant.grantId,
    grantEventDigest: context.state.grant.eventDigest,
    workspaceId: context.state.grant.workspaceId,
    projectId: context.state.grant.projectId,
    revokedBy: context.manager.principalId,
    revokedAt: now.toISOString(),
    reason: input.reason,
    digestSemantics: "content_address_only_not_authenticity_proof" as const,
  };
  const revocation = { ...event, eventDigest: sha256Rfc8785(event) };
  await input.transaction.appendRevocation(structuredClone(revocation));
  return structuredClone(revocation);
}

function page(input: { offset?: number; limit?: number } | undefined) {
  const offset = input?.offset ?? 0;
  const limit = input?.limit ?? DEFAULT_PAGE_SIZE;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_PAGE_SIZE
  ) {
    invalid(`Research manifest pages require a non-negative offset and a limit from 1 to ${MAX_PAGE_SIZE}.`, "page");
  }
  return { offset, limit };
}

function pageResult<T>(rows: readonly T[], pagination: { offset: number; limit: number }) {
  const values = rows.slice(pagination.offset, pagination.offset + pagination.limit);
  const nextOffset = pagination.offset + values.length < rows.length ? pagination.offset + values.length : null;
  return { offset: pagination.offset, limit: pagination.limit, total: rows.length, nextOffset, rows: values };
}

function byteDigest(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
}

function lookupDigest(domain: string, value: string) {
  return sha256Rfc8785({ domain, value });
}

function requestLookup(input: {
  accessId: string;
  idempotencyKey: string;
  grantId: string;
  authenticatedRecipientPrincipalId: string;
  pagination: { offset: number; limit: number };
}) {
  const grantLookupDigest = lookupDigest("rateloop.benchmark-research-grant-lookup.v1", input.grantId);
  const recipientLookupDigest = lookupDigest(
    "rateloop.benchmark-research-recipient-lookup.v1",
    input.authenticatedRecipientPrincipalId,
  );
  return {
    grantLookupDigest,
    recipientLookupDigest,
    requestLookupDigest: sha256Rfc8785({
      domain: "rateloop.benchmark-research-access-request-lookup.v1",
      accessId: input.accessId,
      idempotencyKey: input.idempotencyKey,
      grantLookupDigest,
      recipientLookupDigest,
      page: input.pagination,
    }),
  };
}

function requestBinding(input: {
  accessId: string;
  idempotencyKey: string;
  grantId: string;
  recipientLookupDigest: `sha256:${string}`;
  purpose: BenchmarkResearchPurpose;
  projection: BenchmarkResearchScope;
  pagination: { offset: number; limit: number };
}): BenchmarkResearchGrantAccessRequestBinding {
  return {
    schemaVersion: "rateloop.benchmark-research-access-request-binding.v1",
    accessId: input.accessId,
    idempotencyKey: input.idempotencyKey,
    grantId: input.grantId,
    recipientLookupDigest: input.recipientLookupDigest,
    purpose: input.purpose,
    projection: input.projection,
    page: input.pagination,
  };
}

const FORBIDDEN_PUBLIC_PROJECTION_KEYS = new Set([
  "workspaceId",
  "projectId",
  "benchmarkId",
  "activationReference",
  "deploymentKey",
  "populationId",
  "populationVersion",
  "populationContractHash",
  "populationRoot",
  "frameId",
  "planId",
  "witnessId",
  "auditHeadDigest",
  "sourceDecisionBinding",
  "sourceEvaluationBinding",
  "sourceEvaluationHash",
  "decidedAt",
  "automatedOutcome",
  "manifestRoot",
  "sampleDigest",
  "exportId",
  "exportDigest",
  "grantId",
]);

/** Defense-in-depth guard used on every projected view and safe for adapter conformance tests. */
export function assertBenchmarkResearchPublicProjectionSafe(value: unknown): void {
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    for (const [key, nested] of Object.entries(candidate)) {
      if (FORBIDDEN_PUBLIC_PROJECTION_KEYS.has(key)) {
        invalid(`Public benchmark research projection contains forbidden field ${key}.`);
      }
      visit(nested);
    }
  };
  visit(value);
}

function publicProjectionRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${field} is invalid.`);
  return value as Record<string, unknown>;
}

function publicProjectionRows(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${field} is invalid.`);
  return value;
}

function assertStrictBenchmarkResearchPublicView(value: unknown): void {
  assertBenchmarkResearchPublicProjectionSafe(value);
  const view = publicProjectionRecord(value, "Public benchmark research view");
  const purpose = view.purpose;
  if (typeof purpose !== "string" || !Object.hasOwn(BENCHMARK_RESEARCH_PURPOSE_SCOPES, purpose)) {
    invalid("Public benchmark research purpose is invalid.");
  }
  const scopes = exactScopes(purpose as BenchmarkResearchPurpose);
  const topLevelFields = ["schemaVersion", "purpose", "accessedAt", "methodology", "referenceProvenance", "disclosure"];
  if (scopes.includes("reference_sample_evidence")) topLevelFields.push("referenceSample");
  if (scopes.includes("reference_labels")) topLevelFields.push("referenceLabelsPage");
  exactKeys(view, topLevelFields, "Public benchmark research view");

  const methodology = publicProjectionRecord(view.methodology, "Public methodology projection");
  exactKeys(
    methodology,
    ["methodVersion", "sampleSizePlan", "reportingWindow", "methodologyDigest"],
    "Public methodology projection",
  );
  exactKeys(
    publicProjectionRecord(methodology.sampleSizePlan, "Public methodology sample-size plan"),
    ["version", "methodReviewStatus", "adequacy", "intendedEstimands", "limitations"],
    "Public methodology sample-size plan",
  );
  exactKeys(
    publicProjectionRecord(methodology.reportingWindow, "Public methodology reporting window"),
    ["startInclusive", "endExclusive"],
    "Public methodology reporting window",
  );

  if (scopes.includes("reference_sample_evidence")) {
    const sample = publicProjectionRecord(view.referenceSample, "Public reference sample");
    exactKeys(
      sample,
      ["methodVersion", "commitmentDigest", "beacon", "seedDigest", "strata", "manifestPage"],
      "Public reference sample",
    );
    exactKeys(
      publicProjectionRecord(sample.beacon, "Public beacon"),
      ["network", "chainHash", "round", "randomness", "signature"],
      "Public beacon",
    );
    publicProjectionRows(sample.strata, "Public sample strata").forEach(row =>
      exactKeys(
        publicProjectionRecord(row, "Public sample stratum"),
        ["stratumIdentity", "systemIdentity", "eligibleCount", "selectedCount", "gap"],
        "Public sample stratum",
      ),
    );
    const manifestPage = publicProjectionRecord(sample.manifestPage, "Public sample page");
    exactKeys(manifestPage, ["offset", "limit", "total", "nextOffset", "rows"], "Public sample page");
    publicProjectionRows(manifestPage.rows, "Public sample rows").forEach(value => {
      const row = publicProjectionRecord(value, "Public sample unit");
      exactKeys(
        row,
        ["unitId", "stratumIdentity", "systemIdentity", "selected", "selectionRank", "inclusionProbability"],
        "Public sample unit",
      );
      exactKeys(
        publicProjectionRecord(row.inclusionProbability, "Public inclusion probability"),
        ["numerator", "denominator"],
        "Public inclusion probability",
      );
    });
  }

  if (scopes.includes("reference_labels")) {
    const labelsPage = publicProjectionRecord(view.referenceLabelsPage, "Public label page");
    exactKeys(labelsPage, ["offset", "limit", "total", "nextOffset", "rows"], "Public label page");
    publicProjectionRows(labelsPage.rows, "Public label rows").forEach(row =>
      exactKeys(
        publicProjectionRecord(row, "Public reference label"),
        ["unitId", "referenceLabel", "agreement"],
        "Public reference label",
      ),
    );
  }

  exactKeys(
    publicProjectionRecord(view.referenceProvenance, "Public reference provenance"),
    [
      "adaptiveReuseAllowed",
      "bridgeHash",
      "derivationSource",
      "labelSetHash",
      "labelSetId",
      "operationalRollupEligible",
      "populationClaim",
      "reportingMode",
      "schemaVersion",
    ],
    "Public reference provenance",
  );
  validateReferenceProvenance(view.referenceProvenance as BenchmarkResearchReferenceProvenance);

  exactKeys(
    publicProjectionRecord(view.disclosure, "Public disclosure"),
    [
      "dataClassification",
      "accessBasis",
      "dsaArticle40Status",
      "privateContent",
      "ciphertext",
      "reviewerIdentifiers",
      "sourceContentIdentifiers",
      "publicSamplingPseudonyms",
      "digestSemantics",
    ],
    "Public disclosure",
  );
}

function projectView(input: {
  grant: BenchmarkResearchGrantEvidence;
  source: BenchmarkResearchApprovedExport;
  accessedAt: Date;
  pagination: { offset: number; limit: number };
}) {
  const commitment = input.source.referenceCommitment;
  const sample = input.source.frozenReferenceSample;
  const methodologyPayload = {
    methodVersion: commitment.methodVersion,
    sampleSizePlan: {
      version: commitment.sampleSizePlan.version,
      methodReviewStatus: commitment.sampleSizePlan.methodReviewStatus,
      adequacy: commitment.sampleSizePlan.adequacy,
      intendedEstimands: commitment.sampleSizePlan.intendedEstimands,
      limitations: commitment.sampleSizePlan.limitations,
    },
    reportingWindow: commitment.source.reportingWindow,
  };
  const methodology = {
    ...methodologyPayload,
    methodologyDigest: sha256Rfc8785({
      domain: METHODOLOGY_PROJECTION_DOMAIN,
      purpose: input.grant.purpose,
      methodology: methodologyPayload,
    }),
  };
  const scopes = new Set(input.grant.scopes);
  const stratumIdentity = (systemIdentity: string, automatedOutcome: "pass" | "fail") =>
    sha256Rfc8785({ systemIdentity, automatedOutcome });
  const publicStrata = sample.strata.map(row => ({
    stratumIdentity: stratumIdentity(row.systemIdentity, row.automatedOutcome),
    systemIdentity: row.systemIdentity,
    eligibleCount: row.eligibleCount,
    selectedCount: row.selectedCount,
    gap: row.gap,
  }));
  const publicManifest = sample.manifest.map(row => ({
    unitId: row.unitId,
    stratumIdentity: stratumIdentity(row.systemIdentity, row.automatedOutcome),
    systemIdentity: row.systemIdentity,
    selected: row.selected,
    selectionRank: row.selectionRank,
    inclusionProbability: row.inclusionProbability,
  }));
  const selectedLabels = scopes.has("reference_labels")
    ? (() => {
        const labelByUnit = new Map(input.source.referenceLabels.map(label => [label.unitId, label]));
        return sample.manifest.filter(row => row.selected).map(row => labelByUnit.get(row.unitId)!);
      })()
    : [];
  const view = {
    schemaVersion: "rateloop.benchmark-research-view.v2" as const,
    purpose: input.grant.purpose,
    accessedAt: input.accessedAt.toISOString(),
    methodology,
    referenceProvenance: input.source.referenceProvenance,
    ...(scopes.has("reference_sample_evidence")
      ? {
          referenceSample: {
            methodVersion: commitment.methodVersion,
            commitmentDigest: commitment.commitmentDigest,
            beacon: sample.beacon,
            seedDigest: sample.seedDigest,
            strata: publicStrata,
            manifestPage: pageResult(publicManifest, input.pagination),
          },
        }
      : {}),
    ...(scopes.has("reference_labels") ? { referenceLabelsPage: pageResult(selectedLabels, input.pagination) } : {}),
    disclosure: input.grant.disclosure,
  };
  assertStrictBenchmarkResearchPublicView(view);
  return view;
}

function validateReplaySnapshot(input: {
  snapshot: BenchmarkResearchGrantAccessSnapshot;
  accessId: string;
  idempotencyKey: string;
  grantId: string;
  recipientLookupDigest: `sha256:${string}`;
  pagination: { offset: number; limit: number };
}) {
  const snapshot = structuredClone(input.snapshot);
  exactKeys(
    snapshot,
    [
      "schemaVersion",
      "binding",
      "requestBindingDigest",
      "accessedAt",
      "viewDigest",
      "bytesDigest",
      "bytes",
      "auditReceipt",
    ],
    "Research access replay snapshot",
  );
  if (snapshot.schemaVersion !== "rateloop.benchmark-research-access-snapshot.v1") {
    invalid("Research access replay snapshot is invalid.");
  }
  exactKeys(
    snapshot.binding,
    [
      "schemaVersion",
      "accessId",
      "idempotencyKey",
      "grantId",
      "recipientLookupDigest",
      "purpose",
      "projection",
      "page",
    ],
    "Research access replay binding",
  );
  exactKeys(snapshot.binding.page, ["offset", "limit"], "Research access replay page");
  const expectedProjection = exactScopes(snapshot.binding.purpose).at(-1)!;
  if (
    snapshot.binding.schemaVersion !== "rateloop.benchmark-research-access-request-binding.v1" ||
    snapshot.binding.accessId !== input.accessId ||
    snapshot.binding.idempotencyKey !== input.idempotencyKey ||
    snapshot.binding.grantId !== input.grantId ||
    snapshot.binding.recipientLookupDigest !== input.recipientLookupDigest ||
    snapshot.binding.projection !== expectedProjection ||
    canonicalizeRfc8785(snapshot.binding.page) !== canonicalizeRfc8785(input.pagination) ||
    snapshot.requestBindingDigest !== sha256Rfc8785(snapshot.binding)
  ) {
    invalid("Research access replay conflicts with the requested access binding.");
  }
  canonicalTimestamp(snapshot.accessedAt, "accessSnapshot.accessedAt");
  strictDigest(snapshot.viewDigest, "Access snapshot view digest");
  strictDigest(snapshot.bytesDigest, "Access snapshot bytes digest");
  if (!(snapshot.bytes instanceof Uint8Array) || snapshot.bytesDigest !== byteDigest(snapshot.bytes)) {
    invalid("Research access replay bytes are invalid.");
  }
  let view: unknown;
  try {
    view = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes));
  } catch {
    invalid("Research access replay bytes are invalid.");
  }
  assertStrictBenchmarkResearchPublicView(view);
  if (
    !view ||
    typeof view !== "object" ||
    Array.isArray(view) ||
    (view as { schemaVersion?: unknown }).schemaVersion !== "rateloop.benchmark-research-view.v2" ||
    (view as { purpose?: unknown }).purpose !== snapshot.binding.purpose ||
    (view as { accessedAt?: unknown }).accessedAt !== snapshot.accessedAt ||
    snapshot.viewDigest !== sha256Rfc8785(view) ||
    new TextDecoder().decode(snapshot.bytes) !== canonicalizeRfc8785(view)
  ) {
    invalid("Research access replay does not contain the persisted canonical view.");
  }
  validateAccessAuditReceiptIdentity(snapshot.auditReceipt, {
    accessId: input.accessId,
    idempotencyKey: input.idempotencyKey,
  });
  return snapshot;
}

function componentAuditDescriptor(
  component: "reference_sample_manifest" | "reference_labels",
  result: ReturnType<typeof pageResult>,
) {
  return {
    component,
    offset: result.offset,
    limit: result.limit,
    total: result.total,
    nextOffset: result.nextOffset,
    rowsDigest: sha256Rfc8785({
      domain: "rateloop.benchmark-research-public-page.v1",
      component,
      rows: result.rows,
    }),
  };
}

function validateAccessAuditReceiptIdentity(
  receipt: BenchmarkResearchGrantAccessAuditReceipt,
  expected: { accessId: string; idempotencyKey: string; auditDigest?: `sha256:${string}` },
) {
  exactKeys(
    receipt,
    [
      "schemaVersion",
      "persistenceState",
      "accessId",
      "idempotencyKey",
      "auditDigest",
      "auditEventId",
      "auditEventDigest",
      "previousEventDigest",
      "chainHeadDigest",
    ],
    "Research access audit receipt",
  );
  if (
    receipt.schemaVersion !== "rateloop.benchmark-research-access-audit-receipt.v1" ||
    receipt.persistenceState !== "staged_not_committed" ||
    receipt.accessId !== expected.accessId ||
    receipt.idempotencyKey !== expected.idempotencyKey ||
    (expected.auditDigest !== undefined && receipt.auditDigest !== expected.auditDigest)
  ) {
    throw new Error("Research access audit receipt does not bind the staged audit.");
  }
  requiredIdentifier(receipt.auditEventId, "Research access audit event");
  strictDigest(receipt.auditEventDigest, "Research access audit event digest");
  if (receipt.previousEventDigest !== null) strictDigest(receipt.previousEventDigest, "Previous audit event digest");
  strictDigest(receipt.chainHeadDigest, "Research access audit chain head");
}

function validateAccessAuditReceipt(
  receipt: BenchmarkResearchGrantAccessAuditReceipt,
  audit: BenchmarkResearchGrantAccessAudit,
) {
  validateAccessAuditReceiptIdentity(receipt, {
    accessId: audit.accessId,
    idempotencyKey: audit.idempotencyKey,
    auditDigest: audit.auditDigest,
  });
}

function validateDeniedAccessAuditReceipt(
  receipt: BenchmarkResearchGrantDeniedAccessAuditReceipt,
  audit: BenchmarkResearchGrantDeniedAccessAudit,
) {
  exactKeys(
    receipt,
    [
      "schemaVersion",
      "persistenceState",
      "accessId",
      "idempotencyKey",
      "denialDigest",
      "denialEventId",
      "denialEventDigest",
      "previousEventDigest",
      "chainHeadDigest",
    ],
    "Research denied-access audit receipt",
  );
  if (
    receipt.schemaVersion !== "rateloop.benchmark-research-denied-access-audit-receipt.v1" ||
    receipt.persistenceState !== "staged_not_committed" ||
    receipt.accessId !== audit.accessId ||
    receipt.idempotencyKey !== audit.idempotencyKey ||
    receipt.denialDigest !== audit.denialDigest
  ) {
    throw new Error("Research denied-access audit receipt does not bind the staged denial.");
  }
  requiredIdentifier(receipt.denialEventId, "Research denied-access audit event");
  strictDigest(receipt.denialEventDigest, "Research denied-access audit event digest");
  if (receipt.previousEventDigest !== null) strictDigest(receipt.previousEventDigest, "Previous audit event digest");
  strictDigest(receipt.chainHeadDigest, "Research denied-access audit chain head");
}

export type BenchmarkResearchGrantStagedAccessOutcome =
  | Readonly<{ kind: "staged_success"; snapshot: BenchmarkResearchGrantAccessSnapshot }>
  | Readonly<{
      kind: "staged_denial";
      response: "uniform_not_found" | "idempotency_conflict";
      audit: BenchmarkResearchGrantDeniedAccessAudit;
      receipt: BenchmarkResearchGrantDeniedAccessAuditReceipt;
    }>
  | Readonly<{ kind: "exact_replay"; snapshot: BenchmarkResearchGrantAccessSnapshot }>;

async function stageDeniedAccess(input: {
  transaction: BenchmarkResearchGrantReadTransaction;
  accessId: string;
  idempotencyKey: string;
  lookup: ReturnType<typeof requestLookup>;
  pagination: { offset: number; limit: number };
  reason: BenchmarkResearchGrantDeniedAccessAudit["reason"];
}): Promise<BenchmarkResearchGrantStagedAccessOutcome> {
  const payload = {
    schemaVersion: "rateloop.benchmark-research-denied-access-audit.v1" as const,
    action: "read" as const,
    result: "denied" as const,
    accessId: input.accessId,
    idempotencyKey: input.idempotencyKey,
    requestLookupDigest: input.lookup.requestLookupDigest,
    grantLookupDigest: input.lookup.grantLookupDigest,
    recipientLookupDigest: input.lookup.recipientLookupDigest,
    page: input.pagination,
    reason: input.reason,
    digestSemantics: "content_address_only_not_authenticity_proof" as const,
  };
  const audit = { ...payload, denialDigest: sha256Rfc8785(payload) };
  const receipt = await input.transaction.appendDeniedAccessAudit(structuredClone(audit));
  validateDeniedAccessAuditReceipt(receipt, audit);
  return {
    kind: "staged_denial",
    response: input.reason === "idempotency_conflict" ? "idempotency_conflict" : "uniform_not_found",
    audit: structuredClone(audit),
    receipt: structuredClone(receipt),
  };
}

async function loadBenchmarkResearchViewForAuthenticatedRecipientInTransaction(input: {
  transaction: BenchmarkResearchGrantReadTransaction;
  accessId: string;
  idempotencyKey: string;
  grantId: string;
  authenticatedRecipientPrincipalId: string;
  resolveRecipientBindingKey(keyId: string): Promise<Uint8Array | null> | Uint8Array | null;
  page?: { offset?: number; limit?: number };
}): Promise<BenchmarkResearchGrantStagedAccessOutcome> {
  const requestedAccessId = accessId(input.accessId);
  const requestedIdempotencyKey = idempotencyKey(input.idempotencyKey);
  const pagination = page(input.page);
  const lookup = requestLookup({
    accessId: requestedAccessId,
    idempotencyKey: requestedIdempotencyKey,
    grantId: input.grantId,
    authenticatedRecipientPrincipalId: input.authenticatedRecipientPrincipalId,
    pagination,
  });
  const deny = (reason: BenchmarkResearchGrantDeniedAccessAudit["reason"]) =>
    stageDeniedAccess({
      transaction: input.transaction,
      accessId: requestedAccessId,
      idempotencyKey: requestedIdempotencyKey,
      lookup,
      pagination,
      reason,
    });
  const replayLookup = await input.transaction.loadCommittedAccessReplayForUpdate({
    accessId: requestedAccessId,
    idempotencyKey: requestedIdempotencyKey,
    grantId: input.grantId,
    recipientLookupDigest: lookup.recipientLookupDigest,
    page: pagination,
  });
  if (replayLookup?.result === "conflict") return deny("idempotency_conflict");
  if (replayLookup?.result === "exact_replay") {
    try {
      return {
        kind: "exact_replay",
        snapshot: validateReplaySnapshot({
          snapshot: replayLookup.snapshot,
          accessId: requestedAccessId,
          idempotencyKey: requestedIdempotencyKey,
          grantId: input.grantId,
          recipientLookupDigest: lookup.recipientLookupDigest,
          pagination,
        }),
      };
    } catch {
      return deny("idempotency_conflict");
    }
  }
  if (!GRANT_ID.test(input.grantId) || !isRateLoopPrincipalId(input.authenticatedRecipientPrincipalId)) {
    return deny("not_found");
  }
  const recipient = input.authenticatedRecipientPrincipalId;
  const loadedContext = await input.transaction.loadActiveGrantAccessContext({
    accessId: requestedAccessId,
    idempotencyKey: requestedIdempotencyKey,
    grantId: input.grantId,
    authenticatedRecipientPrincipalId: recipient,
  });
  if (!loadedContext) return deny("not_found");
  const context = structuredClone(loadedContext);
  let now: Date;
  try {
    now = validateAccessContext(context, { recipientPrincipalId: recipient, grantId: input.grantId });
  } catch {
    return deny("inactive");
  }
  const grant = context.state.grant;
  let secret: Uint8Array | null;
  try {
    secret = await input.resolveRecipientBindingKey(grant.recipientBindingKeyId);
  } catch {
    return deny("binding_rejected");
  }
  if (!(secret instanceof Uint8Array)) return deny("binding_rejected");
  let presentedBinding: `hmac-sha256:${string}`;
  try {
    presentedBinding = recipientBindingDigest({
      grantId: grant.grantId,
      recipientPrincipalId: recipient,
      bindingKey: { keyId: grant.recipientBindingKeyId, secret },
      workspaceId: grant.workspaceId,
      projectId: grant.projectId,
      benchmarkId: grant.benchmarkId,
      exportId: grant.exportId,
      deploymentKey: context.activation.deploymentKey,
    });
  } catch {
    return deny("binding_rejected");
  }
  if (!recipientBindingsEqual(strictBindingDigest(grant.recipientBindingDigest), presentedBinding)) {
    return deny("binding_rejected");
  }
  try {
    verifyBenchmarkResearchGrantAuthorization({
      grant,
      recipientPrincipalId: recipient,
      bindingKey: { keyId: grant.recipientBindingKeyId, secret },
    });
  } catch {
    return deny("authorization_rejected");
  }
  const reloadedContext = await input.transaction.recheckActiveGrantAccessContextForUpdate({
    accessId: requestedAccessId,
    idempotencyKey: requestedIdempotencyKey,
    grantId: grant.grantId,
    authenticatedRecipientPrincipalId: recipient,
    expectedGrantEventDigest: grant.eventDigest,
    expectedExportDigest: grant.exportDigest,
    expectedAuthorizationDigest: grant.authorizationDigest,
  });
  if (!reloadedContext) return deny("inactive");
  const rechecked = structuredClone(reloadedContext);
  try {
    now = validateAccessContext(rechecked, { recipientPrincipalId: recipient, grantId: input.grantId });
  } catch {
    return deny("inactive");
  }
  if (
    rechecked.state.grant.eventDigest !== grant.eventDigest ||
    rechecked.state.grant.authorizationDigest !== grant.authorizationDigest ||
    rechecked.export.exportDigest !== grant.exportDigest
  ) {
    return deny("authorization_rejected");
  }
  const activeGrant = rechecked.state.grant;
  let view: ReturnType<typeof projectView>;
  try {
    view = structuredClone(projectView({ grant: activeGrant, source: rechecked.export, accessedAt: now, pagination }));
  } catch {
    return deny("projection_rejected");
  }
  const components: Array<BenchmarkResearchGrantAccessAudit["components"][number]> = [];
  const samplePage = "referenceSample" in view ? view.referenceSample?.manifestPage : undefined;
  if (activeGrant.scopes.includes("reference_sample_evidence") && samplePage) {
    components.push(componentAuditDescriptor("reference_sample_manifest", samplePage));
  }
  const labelsPage = "referenceLabelsPage" in view ? view.referenceLabelsPage : undefined;
  if (activeGrant.scopes.includes("reference_labels") && labelsPage) {
    components.push(componentAuditDescriptor("reference_labels", labelsPage));
  }
  const projection = activeGrant.scopes.at(-1)!;
  const binding = requestBinding({
    accessId: requestedAccessId,
    idempotencyKey: requestedIdempotencyKey,
    grantId: activeGrant.grantId,
    recipientLookupDigest: lookup.recipientLookupDigest,
    purpose: activeGrant.purpose,
    projection,
    pagination,
  });
  const requestBindingDigest = sha256Rfc8785(binding);
  const bytes = new TextEncoder().encode(canonicalizeRfc8785(view));
  const viewDigest = sha256Rfc8785(view);
  const auditPayload = {
    schemaVersion: "rateloop.benchmark-research-access-audit.v1" as const,
    action: "read" as const,
    result: "success" as const,
    accessId: requestedAccessId,
    idempotencyKey: requestedIdempotencyKey,
    grantId: activeGrant.grantId,
    grantEventDigest: activeGrant.eventDigest,
    workspaceId: activeGrant.workspaceId,
    projectId: activeGrant.projectId,
    benchmarkId: activeGrant.benchmarkId,
    exportId: activeGrant.exportId,
    exportDigest: activeGrant.exportDigest,
    recipientBindingDigest: activeGrant.recipientBindingDigest,
    authorizationDigest: activeGrant.authorizationDigest,
    purpose: activeGrant.purpose,
    scopes: activeGrant.scopes,
    requestBindingDigest,
    components,
    viewSchemaVersion: view.schemaVersion,
    projection,
    viewDigest,
    accessedAt: now.toISOString(),
    digestSemantics: "content_address_only_not_authenticity_proof" as const,
  };
  const audit = structuredClone({ ...auditPayload, auditDigest: sha256Rfc8785(auditPayload) });
  const snapshotWithoutReceipt: Omit<BenchmarkResearchGrantAccessSnapshot, "auditReceipt"> = {
    schemaVersion: "rateloop.benchmark-research-access-snapshot.v1",
    binding,
    requestBindingDigest,
    accessedAt: now.toISOString(),
    viewDigest,
    bytesDigest: byteDigest(bytes),
    bytes,
  };
  const receipt = await input.transaction.appendSuccessfulAccessAudit(audit, structuredClone(snapshotWithoutReceipt));
  validateAccessAuditReceipt(receipt, audit);
  return {
    kind: "staged_success",
    snapshot: structuredClone({ ...snapshotWithoutReceipt, auditReceipt: receipt }),
  };
}

function validateCommitReceipt(
  receipt: BenchmarkResearchGrantTransactionCommitReceipt,
  expectedStagedEventDigest: `sha256:${string}` | null,
) {
  exactKeys(
    receipt,
    ["schemaVersion", "status", "transactionId", "committedAt", "stagedEventDigest"],
    "Research access transaction commit receipt",
  );
  if (
    receipt.schemaVersion !== "rateloop.benchmark-research-transaction-commit-receipt.v1" ||
    receipt.status !== "committed" ||
    receipt.stagedEventDigest !== expectedStagedEventDigest
  ) {
    throw new Error("Research access transaction commit receipt does not bind the staged outcome.");
  }
  requiredIdentifier(receipt.transactionId, "Research access transaction");
  canonicalTimestamp(receipt.committedAt, "commitReceipt.committedAt");
}

export function createBenchmarkResearchGrantPersistenceFacade(input: {
  executor: BenchmarkResearchGrantCommittedTransactionExecutor;
  resolveRecipientBindingKey(keyId: string): Promise<Uint8Array | null> | Uint8Array | null;
}): BenchmarkResearchGrantPersistenceFacade {
  return {
    async readAfterCommittedAudit(request) {
      const committed = await input.executor.withCommittedTransaction(transaction =>
        loadBenchmarkResearchViewForAuthenticatedRecipientInTransaction({
          transaction,
          ...request,
          resolveRecipientBindingKey: input.resolveRecipientBindingKey,
        }),
      );
      const outcome = committed.value;
      const stagedEventDigest =
        outcome.kind === "staged_success"
          ? outcome.snapshot.auditReceipt.auditEventDigest
          : outcome.kind === "staged_denial"
            ? outcome.receipt.denialEventDigest
            : null;
      validateCommitReceipt(committed.commitReceipt, stagedEventDigest);
      if (outcome.kind === "staged_denial") {
        if (outcome.response === "idempotency_conflict") idempotencyConflict();
        publicNotFound();
      }
      const snapshot = outcome.snapshot;
      return {
        schemaVersion: "rateloop.benchmark-research-committed-read.v1",
        accessId: snapshot.binding.accessId,
        idempotencyKey: snapshot.binding.idempotencyKey,
        accessedAt: snapshot.accessedAt,
        replayed: outcome.kind === "exact_replay",
        contentType: "application/json; charset=utf-8",
        bytes: new Uint8Array(snapshot.bytes),
        commitReceipt: {
          status: "committed",
          transactionId: committed.commitReceipt.transactionId,
          committedAt: committed.commitReceipt.committedAt,
          auditEventId: snapshot.auditReceipt.auditEventId,
          auditEventDigest: snapshot.auditReceipt.auditEventDigest,
          chainHeadDigest: snapshot.auditReceipt.chainHeadDigest,
        },
      };
    },
  };
}

export const __benchmarkResearchGrantsTestUtils = {
  maxGrantLifetimeMs: MAX_GRANT_LIFETIME_MS,
  maxManifestRows: MAX_MANIFEST_ROWS,
  maxPageSize: MAX_PAGE_SIZE,
  recipientBindingDomain: RECIPIENT_BINDING_DOMAIN,
};
