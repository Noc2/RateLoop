import { canonicalizeRfc8785 } from "@rateloop/node-utils/jcs";
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import { type AuditEventInput, appendAuditEvent } from "~~/lib/privacy/audit";
import { PUBLIC_NETWORK_LEGAL_RESIDENCE_POLICY } from "~~/lib/tokenless/publicNetworkLegalResidence";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const DEPLOYMENT_KEY = /^tokenless-v4:84532:[A-Za-z0-9:._-]{1,233}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const MAX_ACTIVATION_SECONDS = 30 * 24 * 60 * 60;

export const NETWORK_BENCHMARK_ACTIVATION_SCOPE = "testnet_network_benchmark_exercise" as const;

type PoolLike = Pick<Pool, "connect">;
type Row = Record<string, unknown>;

export const NETWORK_BENCHMARK_EVIDENCE_TYPES = [
  "audit_partner_method_acceptance",
  "provider_pilot_acceptance",
  "network_supply_demand_confirmation",
  "hosted_paid_core_testnet_exercise",
  "keeper_recovery_exercise",
  "indexer_recovery_exercise",
  "paid_eligibility_payout_tax_dac7_readiness",
  "sanctions_screening_readiness",
  "reviewer_contract_worker_information_appeal_readiness",
  "algorithmic_management_human_review_readiness",
  "private_worker_communication_readiness",
  "worker_data_privacy_governance_readiness",
] as const;

export type NetworkBenchmarkEvidenceType = (typeof NETWORK_BENCHMARK_EVIDENCE_TYPES)[number];

export const NETWORK_BENCHMARK_DEACTIVATION_REASONS = [
  "manual_deactivation",
  "release_gate_failure",
  "superseded",
] as const;
export type NetworkBenchmarkDeactivationReason = (typeof NETWORK_BENCHMARK_DEACTIVATION_REASONS)[number];

export type NetworkBenchmarkEvidence = Readonly<{
  workspaceId: string;
  projectId: string;
  benchmarkId: string;
  evidenceWindowStart: string;
  evidenceWindowEnd: string;
  methodVersion: string;
  deploymentKey: string;
  evidenceId: string;
  evidenceType: NetworkBenchmarkEvidenceType;
  counterpartyReferenceHash: `sha256:${string}`;
  artifactDigest: `sha256:${string}`;
  completedAt: string;
}>;

export type NetworkBenchmarkOpportunityIdentity = Readonly<{
  opportunityId: string;
  requestProfileId: string;
  requestProfileVersion: number;
  requestProfileHash: `sha256:${string}`;
  sourceEvidenceHash: `sha256:${string}`;
  suggestionCommitment: `sha256:${string}`;
}>;

export type NetworkBenchmarkActivationBoundary = Readonly<{
  workspaceId: string;
  projectId: string;
  benchmarkId: string;
  activationReference: string;
  evidenceWindowStart: string;
  evidenceWindowEnd: string;
  methodVersion: string;
  deploymentKey: string;
  activationScope: typeof NETWORK_BENCHMARK_ACTIVATION_SCOPE;
  permittedWorkerJurisdictions: readonly string[];
}>;

export type BuiltNetworkBenchmarkActivation = ReturnType<typeof buildNetworkBenchmarkActivation>;

function invalid(message: string, field?: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_network_benchmark_activation", false, field);
}

function identifier(value: string, field: string) {
  if (!IDENTIFIER.test(value)) invalid(`${field} is invalid.`, field);
  return value;
}

function operatorKeyVersion(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value)) {
    invalid("Compliance operator key version is invalid.", "complianceOperatorKeyVersion");
  }
  return value;
}

function activationAuditInput(input: {
  activation: BuiltNetworkBenchmarkActivation;
  workspaceManagerReferencePrincipalId: string;
  operatorKeyVersion: string;
  occurredAt: Date;
}): AuditEventInput {
  const keyVersion = operatorKeyVersion(input.operatorKeyVersion);
  return {
    workspaceId: input.activation.workspaceId,
    actorKind: "operator",
    actorReference: `tokenless_compliance_operator:${keyVersion}`,
    assuranceMethod: "dedicated_compliance_operator_bearer",
    action: "network_benchmark_activated",
    targetKind: "network_benchmark_activation",
    targetId: input.activation.activationReference,
    purpose: "closed_public_safe_network_benchmark_release_control",
    reason: "operator_attested_release_evidence_with_active_workspace_manager_reference",
    requestCorrelation: input.activation.activationReference,
    result: "success",
    occurredAt: input.occurredAt,
    idempotencyKey: `network-benchmark-activation:${input.activation.activationHash.slice("sha256:".length)}`,
    metadata: {
      activationHash: input.activation.activationHash,
      authorityKind: "compliance_operator_shared_secret",
      evidenceManifestRoot: input.activation.evidenceManifestRoot,
      workspaceManagerReferencePrincipalId: input.workspaceManagerReferencePrincipalId,
      opportunityManifestRoot: input.activation.opportunityManifestRoot,
      operatorKeyVersion: keyVersion,
      activationScope: input.activation.activationScope,
      permittedWorkerJurisdictionsHash: input.activation.permittedWorkerJurisdictionsHash,
    },
  };
}

function deactivationAuditInput(input: {
  workspaceId: string;
  activationReference: string;
  activationHash: string;
  deactivationHash: string;
  workspaceManagerReferencePrincipalId: string;
  operatorKeyVersion: string;
  occurredAt: Date;
  reason: NetworkBenchmarkDeactivationReason;
  supersededByActivationReference: string | null;
}): AuditEventInput {
  const keyVersion = operatorKeyVersion(input.operatorKeyVersion);
  return {
    workspaceId: input.workspaceId,
    actorKind: "operator",
    actorReference: `tokenless_compliance_operator:${keyVersion}`,
    assuranceMethod: "dedicated_compliance_operator_bearer",
    action: "network_benchmark_deactivated",
    targetKind: "network_benchmark_activation",
    targetId: input.activationReference,
    purpose: "closed_public_safe_network_benchmark_release_control",
    reason: input.reason,
    requestCorrelation: input.activationReference,
    result: "success",
    occurredAt: input.occurredAt,
    idempotencyKey: `network-benchmark-deactivation:${input.deactivationHash.slice("sha256:".length)}`,
    metadata: {
      activationHash: input.activationHash,
      authorityKind: "compliance_operator_shared_secret",
      deactivationHash: input.deactivationHash,
      workspaceManagerReferencePrincipalId: input.workspaceManagerReferencePrincipalId,
      operatorKeyVersion: keyVersion,
      supersededByActivationReference: input.supersededByActivationReference,
    },
  };
}

function digest(value: string, field: string) {
  if (!DIGEST.test(value)) invalid(`${field} is invalid.`, field);
  return value as `sha256:${string}`;
}

function deploymentKey(value: string) {
  if (!DEPLOYMENT_KEY.test(value)) {
    invalid("Deployment key must be a complete tokenless-v4 Base Sepolia key.", "deploymentKey");
  }
  return value;
}

function instant(value: string, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalid(`${field} is invalid.`, field);
  return parsed;
}

function rawSha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
}

function codeUnitCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactPermittedWorkerJurisdictions(value: readonly string[]) {
  const supported = new Set<string>(PUBLIC_NETWORK_LEGAL_RESIDENCE_POLICY.supportedCountryCodes);
  if (!Array.isArray(value) || value.length < 1 || value.length > supported.size) {
    invalid("At least one supported worker jurisdiction is required.", "permittedWorkerJurisdictions");
  }
  const jurisdictions = [...value];
  if (
    jurisdictions.some((country, index) => {
      return (
        typeof country !== "string" ||
        !/^[A-Z]{2}$/u.test(country) ||
        !supported.has(country) ||
        (index > 0 && codeUnitCompare(jurisdictions[index - 1]!, country) >= 0)
      );
    })
  ) {
    invalid(
      "Permitted worker jurisdictions must be a nonempty, unique, bytewise-sorted set of supported ISO alpha-2 codes.",
      "permittedWorkerJurisdictions",
    );
  }
  return Object.freeze(jurisdictions);
}

function outcomeFor(type: NetworkBenchmarkEvidenceType) {
  if (
    type === "audit_partner_method_acceptance" ||
    type === "provider_pilot_acceptance" ||
    type === "network_supply_demand_confirmation"
  ) {
    return "accepted" as const;
  }
  if (
    type === "hosted_paid_core_testnet_exercise" ||
    type === "keeper_recovery_exercise" ||
    type === "indexer_recovery_exercise"
  ) {
    return "passed" as const;
  }
  return "documented_ready" as const;
}

function exactBoundary(input: NetworkBenchmarkActivationBoundary) {
  const evidenceWindowStart = instant(input.evidenceWindowStart, "evidenceWindowStart");
  const evidenceWindowEnd = instant(input.evidenceWindowEnd, "evidenceWindowEnd");
  if (evidenceWindowEnd <= evidenceWindowStart) {
    invalid("Evidence window end must follow its start.", "evidenceWindowEnd");
  }
  if (input.activationScope !== NETWORK_BENCHMARK_ACTIVATION_SCOPE) {
    invalid("Activation scope is restricted to the testnet network benchmark exercise.", "activationScope");
  }
  const permittedWorkerJurisdictions = exactPermittedWorkerJurisdictions(input.permittedWorkerJurisdictions);
  const permittedWorkerJurisdictionsJson = canonicalizeRfc8785(permittedWorkerJurisdictions);
  return {
    workspaceId: identifier(input.workspaceId, "workspaceId"),
    projectId: identifier(input.projectId, "projectId"),
    benchmarkId: identifier(input.benchmarkId, "benchmarkId"),
    activationReference: identifier(input.activationReference, "activationReference"),
    evidenceWindowStart: evidenceWindowStart.toISOString(),
    evidenceWindowEnd: evidenceWindowEnd.toISOString(),
    methodVersion: identifier(input.methodVersion, "methodVersion"),
    deploymentKey: deploymentKey(input.deploymentKey),
    activationScope: NETWORK_BENCHMARK_ACTIVATION_SCOPE,
    permittedWorkerJurisdictions,
    permittedWorkerJurisdictionsHash: rawSha256(permittedWorkerJurisdictionsJson),
  };
}

function assertEvidenceBoundary(
  evidence: NetworkBenchmarkEvidence,
  boundary: ReturnType<typeof exactBoundary>,
  activatedAt: Date,
) {
  const expected = [
    boundary.workspaceId,
    boundary.projectId,
    boundary.benchmarkId,
    boundary.evidenceWindowStart,
    boundary.evidenceWindowEnd,
    boundary.methodVersion,
    boundary.deploymentKey,
  ];
  const actual = [
    evidence.workspaceId,
    evidence.projectId,
    evidence.benchmarkId,
    instant(evidence.evidenceWindowStart, "evidenceWindowStart").toISOString(),
    instant(evidence.evidenceWindowEnd, "evidenceWindowEnd").toISOString(),
    evidence.methodVersion,
    evidence.deploymentKey,
  ];
  if (expected.some((value, index) => value !== actual[index])) {
    invalid("Activation evidence is not bound to the exact benchmark boundary.", "evidence");
  }
  if (instant(evidence.completedAt, "completedAt") > activatedAt) {
    invalid("Activation evidence cannot complete in the future.", "completedAt");
  }
  const completedAt = instant(evidence.completedAt, "completedAt");
  if (
    completedAt < instant(boundary.evidenceWindowStart, "evidenceWindowStart") ||
    completedAt > instant(boundary.evidenceWindowEnd, "evidenceWindowEnd")
  ) {
    invalid("Activation evidence must complete inside the closed evidence window.", "completedAt");
  }
}

export function buildNetworkBenchmarkActivation(
  input: NetworkBenchmarkActivationBoundary & {
    workspaceManagerReferencePrincipalId: string;
    complianceOperatorKeyVersion: string;
    activatedAt: string;
    authorizationDurationSeconds: number;
    evidence: readonly NetworkBenchmarkEvidence[];
    opportunities: readonly NetworkBenchmarkOpportunityIdentity[];
  },
) {
  const boundary = exactBoundary(input);
  const activatedAt = instant(input.activatedAt, "activatedAt");
  if (instant(boundary.evidenceWindowEnd, "evidenceWindowEnd") > activatedAt) {
    invalid("The evidence window must be closed before activation.", "evidenceWindowEnd");
  }
  if (
    !Number.isSafeInteger(input.authorizationDurationSeconds) ||
    input.authorizationDurationSeconds < 1 ||
    input.authorizationDurationSeconds > MAX_ACTIVATION_SECONDS
  ) {
    invalid("Activation lifetime must be positive and no longer than 30 days.", "authorizationDurationSeconds");
  }
  if (!input.evidence.length || !input.opportunities.length) {
    invalid("Activation evidence and exact opportunities are required.");
  }
  const evidenceIds = new Set<string>();
  for (const item of input.evidence) {
    if (!(NETWORK_BENCHMARK_EVIDENCE_TYPES as readonly string[]).includes(item.evidenceType)) {
      invalid("Activation evidence type is unsupported.", "evidenceType");
    }
    identifier(item.evidenceId, "evidenceId");
    digest(item.counterpartyReferenceHash, "counterpartyReferenceHash");
    digest(item.artifactDigest, "artifactDigest");
    assertEvidenceBoundary(item, boundary, activatedAt);
    if (evidenceIds.has(item.evidenceId)) invalid("Activation evidence may be bound only once.", "evidenceId");
    evidenceIds.add(item.evidenceId);
  }
  const counts = new Map<NetworkBenchmarkEvidenceType, number>();
  for (const item of input.evidence) counts.set(item.evidenceType, (counts.get(item.evidenceType) ?? 0) + 1);
  const providerCounterparties = new Set(
    input.evidence
      .filter(item => item.evidenceType === "provider_pilot_acceptance")
      .map(item => item.counterpartyReferenceHash),
  );
  const demandCounterparties = new Set(
    input.evidence
      .filter(item => item.evidenceType === "network_supply_demand_confirmation")
      .map(item => item.counterpartyReferenceHash),
  );
  const auditCounterparties = new Set(
    input.evidence
      .filter(item => item.evidenceType === "audit_partner_method_acceptance")
      .map(item => item.counterpartyReferenceHash),
  );
  if (
    auditCounterparties.size !== 1 ||
    [...auditCounterparties].some(
      counterparty => providerCounterparties.has(counterparty) || demandCounterparties.has(counterparty),
    ) ||
    providerCounterparties.size < 2 ||
    demandCounterparties.size < 2 ||
    [...demandCounterparties].some(counterparty => !providerCounterparties.has(counterparty)) ||
    (counts.get("hosted_paid_core_testnet_exercise") ?? 0) < 1 ||
    (counts.get("keeper_recovery_exercise") ?? 0) < 1 ||
    (counts.get("indexer_recovery_exercise") ?? 0) < 1 ||
    (counts.get("paid_eligibility_payout_tax_dac7_readiness") ?? 0) < 1 ||
    (counts.get("sanctions_screening_readiness") ?? 0) < 1 ||
    (counts.get("reviewer_contract_worker_information_appeal_readiness") ?? 0) < 1 ||
    (counts.get("algorithmic_management_human_review_readiness") ?? 0) < 1 ||
    (counts.get("private_worker_communication_readiness") ?? 0) < 1 ||
    (counts.get("worker_data_privacy_governance_readiness") ?? 0) < 1
  ) {
    invalid(
      "Activation requires one distinct method-review counterparty, two distinct accepted provider pilots, network-supply demand confirmation from two of those providers, a hosted paid-core Base Sepolia exercise, hosted recovery exercises, algorithmic-management human-review readiness, a private unmonitored worker-communication channel, and every other paid-work legal-readiness evidence type.",
      "evidence",
    );
  }
  const workspaceManagerReferencePrincipalId = identifier(
    input.workspaceManagerReferencePrincipalId,
    "workspaceManagerReferencePrincipalId",
  );
  const complianceOperatorKeyVersion = operatorKeyVersion(input.complianceOperatorKeyVersion);
  const attestedBy = `tokenless_compliance_operator:${complianceOperatorKeyVersion}` as const;
  const recordedAt = activatedAt.toISOString();
  const evidenceEntries = [...input.evidence]
    .sort((left, right) =>
      codeUnitCompare(`${left.evidenceType}:${left.evidenceId}`, `${right.evidenceType}:${right.evidenceId}`),
    )
    .map((item, index) => {
      const artifact = {
        schemaVersion: "rateloop.network-benchmark-activation-evidence.v2",
        ...boundary,
        evidenceId: item.evidenceId,
        evidenceType: item.evidenceType,
        evidenceOutcome: outcomeFor(item.evidenceType),
        counterpartyReferenceHash: item.counterpartyReferenceHash,
        artifactDigest: item.artifactDigest,
        completedAt: instant(item.completedAt, "completedAt").toISOString(),
        attestedBy,
        complianceOperatorKeyVersion,
        workspaceManagerReferencePrincipalId,
        recordedAt,
      } as const;
      const evidenceJson = canonicalizeRfc8785(artifact);
      return {
        ...artifact,
        manifestPosition: index + 1,
        evidenceJson,
        evidenceHash: rawSha256(evidenceJson),
      };
    });
  const opportunityIds = new Set<string>();
  const opportunityEntries = [...input.opportunities]
    .sort((left, right) => codeUnitCompare(left.opportunityId, right.opportunityId))
    .map((item, index) => {
      identifier(item.opportunityId, "opportunityId");
      identifier(item.requestProfileId, "requestProfileId");
      if (!Number.isSafeInteger(item.requestProfileVersion) || item.requestProfileVersion < 1) {
        invalid("Request profile version is invalid.", "requestProfileVersion");
      }
      digest(item.requestProfileHash, "requestProfileHash");
      digest(item.sourceEvidenceHash, "sourceEvidenceHash");
      digest(item.suggestionCommitment, "suggestionCommitment");
      if (opportunityIds.has(item.opportunityId)) {
        invalid("An opportunity may be authorized only once.", "opportunityId");
      }
      opportunityIds.add(item.opportunityId);
      const authorization = {
        schemaVersion: "rateloop.network-benchmark-opportunity-authorization.v2",
        ...boundary,
        opportunityId: item.opportunityId,
        requestProfileId: item.requestProfileId,
        requestProfileVersion: item.requestProfileVersion,
        requestProfileHash: item.requestProfileHash,
        sourceEvidenceHash: item.sourceEvidenceHash,
        suggestionCommitment: item.suggestionCommitment,
        attestedBy,
        complianceOperatorKeyVersion,
        workspaceManagerReferencePrincipalId,
      } as const;
      const authorizationJson = canonicalizeRfc8785(authorization);
      return {
        ...authorization,
        manifestPosition: index + 1,
        authorizationJson,
        authorizationHash: rawSha256(authorizationJson),
      };
    });
  const evidenceManifestRoot = rawSha256(
    evidenceEntries
      .map(item => `${item.manifestPosition}|${item.evidenceType}|${item.evidenceId}|${item.evidenceHash}`)
      .join("\n"),
  );
  const opportunityManifestRoot = rawSha256(
    opportunityEntries
      .map(item => `${item.manifestPosition}|${item.opportunityId}|${item.authorizationHash}`)
      .join("\n"),
  );
  const authorizationExpiresAt = new Date(activatedAt.getTime() + input.authorizationDurationSeconds * 1_000);
  const artifact = {
    schemaVersion: "rateloop.network-benchmark-activation.v2",
    ...boundary,
    status: "active",
    publicSafeOnly: true,
    unrelatedOpportunityAuthority: "none",
    expectedEvidenceCount: evidenceEntries.length,
    evidenceManifestRoot,
    expectedOpportunityCount: opportunityEntries.length,
    opportunityManifestRoot,
    authorizationDurationSeconds: input.authorizationDurationSeconds,
    authorizationNotBefore: activatedAt.toISOString(),
    authorizationExpiresAt: authorizationExpiresAt.toISOString(),
    attestedBy,
    complianceOperatorKeyVersion,
    workspaceManagerReferencePrincipalId,
    activatedAt: activatedAt.toISOString(),
  } as const;
  const activationJson = canonicalizeRfc8785(artifact);
  return {
    ...artifact,
    activationJson,
    activationHash: rawSha256(activationJson),
    evidence: evidenceEntries,
    opportunities: opportunityEntries,
  };
}

export function evaluateNetworkBenchmarkExecutionAuthorization(input: {
  activation: Pick<
    BuiltNetworkBenchmarkActivation,
    | "workspaceId"
    | "projectId"
    | "benchmarkId"
    | "methodVersion"
    | "deploymentKey"
    | "activationScope"
    | "permittedWorkerJurisdictions"
    | "authorizationNotBefore"
    | "authorizationExpiresAt"
    | "opportunities"
  >;
  workspaceId: string;
  projectId: string;
  benchmarkId: string;
  methodVersion: string;
  deploymentKey: string;
  opportunityId: string;
  residenceCountry: string;
  now: string;
  deactivated: boolean;
}) {
  if (input.deactivated) return { allowed: false as const, reason: "deactivated" as const };
  const now = instant(input.now, "now");
  if (now < instant(input.activation.authorizationNotBefore, "authorizationNotBefore")) {
    return { allowed: false as const, reason: "not_yet_active" as const };
  }
  if (now >= instant(input.activation.authorizationExpiresAt, "authorizationExpiresAt")) {
    return { allowed: false as const, reason: "expired" as const };
  }
  if (
    input.workspaceId !== input.activation.workspaceId ||
    input.projectId !== input.activation.projectId ||
    input.benchmarkId !== input.activation.benchmarkId ||
    input.methodVersion !== input.activation.methodVersion ||
    input.deploymentKey !== input.activation.deploymentKey ||
    input.activation.activationScope !== NETWORK_BENCHMARK_ACTIVATION_SCOPE
  ) {
    return { allowed: false as const, reason: "scope_mismatch" as const };
  }
  if (!input.activation.opportunities.some(item => item.opportunityId === input.opportunityId)) {
    return { allowed: false as const, reason: "opportunity_not_authorized" as const };
  }
  if (!input.activation.permittedWorkerJurisdictions.includes(input.residenceCountry)) {
    return { allowed: false as const, reason: "worker_jurisdiction_not_permitted" as const };
  }
  return { allowed: true as const, reason: "authorized" as const };
}

export async function requireActiveNetworkBenchmarkAssignmentAcceptance(
  client: Pick<PoolClient, "query">,
  input: {
    workspaceId: string;
    projectId: string;
    runId: string;
    residenceCountry: string;
  },
) {
  try {
    const result = await client.query(
      `SELECT tokenless_require_network_benchmark_assignment_acceptance($1,$2,$3,$4)
              AS activation_reference`,
      [input.workspaceId, input.projectId, input.runId, input.residenceCountry],
    );
    const activationReference = rowString((result.rows[0] as Row | undefined) ?? {}, "activation_reference");
    if (result.rowCount !== 1 || !activationReference) throw new Error("Missing active network benchmark activation.");
    return activationReference;
  } catch {
    throw new TokenlessServiceError(
      "The testnet network benchmark activation is no longer accepting this worker jurisdiction.",
      409,
      "network_benchmark_assignment_acceptance_blocked",
    );
  }
}

function rowString(row: Row, field: string) {
  const value = row[field];
  if (value === null || value === undefined) throw new Error(`Missing network activation field ${field}.`);
  return String(value);
}

async function transactionTime(client: PoolClient) {
  const result = await client.query("SELECT transaction_timestamp() AS transaction_time");
  const value = (result.rows[0] as Row | undefined)?.transaction_time;
  const parsed = value instanceof Date ? value : new Date(String(value ?? ""));
  if (!Number.isFinite(parsed.getTime())) throw new Error("Database transaction time is invalid.");
  return parsed;
}

async function requireWorkspaceManagerReference(
  client: PoolClient,
  input: {
    workspaceManagerReferencePrincipalId: string;
    workspaceId: string;
    projectId: string;
  },
) {
  const result = await client.query(
    `SELECT w.status AS workspace_status,p.status AS project_status,p.visibility AS project_visibility,
            p.data_classification AS project_data_classification,p.material_kind AS project_material_kind,
            m.role,principal.status AS principal_status
     FROM tokenless_workspaces w
     JOIN tokenless_assurance_projects p ON p.workspace_id=w.workspace_id AND p.project_id=$2
     JOIN tokenless_workspace_members m ON m.workspace_id=w.workspace_id AND m.account_address=$3
     JOIN tokenless_principals principal ON principal.principal_id=m.account_address
     WHERE w.workspace_id=$1
     FOR UPDATE OF w,p,m,principal`,
    [input.workspaceId, input.projectId, input.workspaceManagerReferencePrincipalId],
  );
  const row = result.rows[0] as Row | undefined;
  if (
    !row ||
    rowString(row, "workspace_status") !== "active" ||
    rowString(row, "project_status") !== "active" ||
    rowString(row, "project_visibility") !== "public" ||
    rowString(row, "project_data_classification") !== "public" ||
    !["public", "synthetic", "redacted"].includes(rowString(row, "project_material_kind")) ||
    rowString(row, "principal_status") !== "active" ||
    !["owner", "admin"].includes(rowString(row, "role"))
  ) {
    throw new TokenlessServiceError("Network benchmark project not found.", 404, "network_benchmark_project_not_found");
  }
}

async function withSerializable<T>(pool: PoolLike, work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function createNetworkBenchmarkActivationService(input?: {
  pool?: PoolLike;
  appendAudit?: typeof appendAuditEvent;
}) {
  const pool = input?.pool ?? dbPool;
  const appendAudit = input?.appendAudit ?? appendAuditEvent;
  return {
    async activate(
      activationInput: NetworkBenchmarkActivationBoundary & {
        workspaceManagerReferencePrincipalId: string;
        complianceOperatorKeyVersion: string;
        authorizationDurationSeconds: number;
        evidence: readonly NetworkBenchmarkEvidence[];
        opportunityIds: readonly string[];
      },
    ) {
      return withSerializable(pool, async client => {
        await requireWorkspaceManagerReference(client, activationInput);
        const activatedAt = await transactionTime(client);
        if (!activationInput.opportunityIds.length)
          invalid("At least one exact opportunity is required.", "opportunityIds");
        const uniqueIds = [...new Set(activationInput.opportunityIds.map(value => identifier(value, "opportunityId")))];
        if (uniqueIds.length !== activationInput.opportunityIds.length) {
          invalid("An opportunity may be authorized only once.", "opportunityIds");
        }
        const result = await client.query(
          `SELECT opportunity.opportunity_id,opportunity.request_profile_id,opportunity.request_profile_version,
                  opportunity.request_profile_hash,opportunity.source_evidence_hash,
                  opportunity.suggestion_commitment,opportunity.status
           FROM tokenless_agent_review_opportunities opportunity
           JOIN tokenless_agent_review_request_profiles profile
             ON profile.workspace_id=opportunity.workspace_id
            AND profile.profile_id=opportunity.request_profile_id
            AND profile.version=opportunity.request_profile_version
            AND profile.profile_hash=opportunity.request_profile_hash
            AND profile.audience='public_network'
            AND profile.content_boundary='public_or_test'
            AND profile.compensation_mode='usdc'
            AND profile.configuration_status='ready'
            AND profile.superseded_at IS NULL
           WHERE opportunity.workspace_id=$1 AND opportunity.opportunity_id=ANY($2::text[])
           ORDER BY opportunity.opportunity_id FOR SHARE OF opportunity,profile`,
          [activationInput.workspaceId, uniqueIds],
        );
        if (
          result.rowCount !== uniqueIds.length ||
          result.rows.some(row => !["decided", "review_requested"].includes(rowString(row as Row, "status")))
        ) {
          throw new TokenlessServiceError(
            "One or more network benchmark opportunities are unavailable.",
            409,
            "network_benchmark_opportunity_unavailable",
          );
        }
        const opportunities = result.rows.map(row => ({
          opportunityId: rowString(row as Row, "opportunity_id"),
          requestProfileId: rowString(row as Row, "request_profile_id"),
          requestProfileVersion: Number(rowString(row as Row, "request_profile_version")),
          requestProfileHash: rowString(row as Row, "request_profile_hash") as `sha256:${string}`,
          sourceEvidenceHash: rowString(row as Row, "source_evidence_hash") as `sha256:${string}`,
          suggestionCommitment: rowString(row as Row, "suggestion_commitment") as `sha256:${string}`,
        }));
        const built = buildNetworkBenchmarkActivation({
          ...activationInput,
          activatedAt: activatedAt.toISOString(),
          opportunities,
        });
        for (const evidence of built.evidence) {
          await client.query(
            `INSERT INTO tokenless_network_benchmark_activation_evidence
             (workspace_id,project_id,benchmark_id,activation_reference,evidence_window_start,evidence_window_end,method_version,
              deployment_key,evidence_id,evidence_type,evidence_outcome,counterparty_reference_hash,
              artifact_digest,completed_at,evidence_json,evidence_hash,compliance_operator_key_version,
              workspace_manager_reference_principal_id,activation_scope,permitted_worker_jurisdictions_json,
              permitted_worker_jurisdictions_hash,recorded_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
            [
              evidence.workspaceId,
              evidence.projectId,
              evidence.benchmarkId,
              evidence.activationReference,
              evidence.evidenceWindowStart,
              evidence.evidenceWindowEnd,
              evidence.methodVersion,
              evidence.deploymentKey,
              evidence.evidenceId,
              evidence.evidenceType,
              evidence.evidenceOutcome,
              evidence.counterpartyReferenceHash,
              evidence.artifactDigest,
              evidence.completedAt,
              evidence.evidenceJson,
              evidence.evidenceHash,
              built.complianceOperatorKeyVersion,
              built.workspaceManagerReferencePrincipalId,
              built.activationScope,
              canonicalizeRfc8785(built.permittedWorkerJurisdictions),
              built.permittedWorkerJurisdictionsHash,
              evidence.recordedAt,
            ],
          );
        }
        await client.query(
          `INSERT INTO tokenless_network_benchmark_activations
           (workspace_id,project_id,benchmark_id,activation_reference,evidence_window_start,evidence_window_end,
            method_version,deployment_key,status,activation_scope,public_safe_only,unrelated_opportunity_authority,
            expected_evidence_count,evidence_manifest_root,expected_opportunity_count,opportunity_manifest_root,
            authorization_duration_seconds,authorization_not_before,authorization_expires_at,activation_json,
            activation_hash,compliance_operator_key_version,workspace_manager_reference_principal_id,
            permitted_worker_jurisdictions_json,permitted_worker_jurisdictions_hash,activated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active','testnet_network_benchmark_exercise',true,'none',
                   $9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
          [
            built.workspaceId,
            built.projectId,
            built.benchmarkId,
            built.activationReference,
            built.evidenceWindowStart,
            built.evidenceWindowEnd,
            built.methodVersion,
            built.deploymentKey,
            built.expectedEvidenceCount,
            built.evidenceManifestRoot,
            built.expectedOpportunityCount,
            built.opportunityManifestRoot,
            built.authorizationDurationSeconds,
            built.authorizationNotBefore,
            built.authorizationExpiresAt,
            built.activationJson,
            built.activationHash,
            built.complianceOperatorKeyVersion,
            built.workspaceManagerReferencePrincipalId,
            canonicalizeRfc8785(built.permittedWorkerJurisdictions),
            built.permittedWorkerJurisdictionsHash,
            built.activatedAt,
          ],
        );
        for (const evidence of built.evidence) {
          await client.query(
            `INSERT INTO tokenless_network_benchmark_activation_evidence_bindings
             (workspace_id,project_id,benchmark_id,activation_reference,evidence_window_start,evidence_window_end,
              method_version,deployment_key,manifest_position,evidence_id,evidence_type,evidence_hash)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              built.workspaceId,
              built.projectId,
              built.benchmarkId,
              built.activationReference,
              built.evidenceWindowStart,
              built.evidenceWindowEnd,
              built.methodVersion,
              built.deploymentKey,
              evidence.manifestPosition,
              evidence.evidenceId,
              evidence.evidenceType,
              evidence.evidenceHash,
            ],
          );
        }
        for (const opportunity of built.opportunities) {
          await client.query(
            `INSERT INTO tokenless_network_benchmark_opportunity_authorizations
             (workspace_id,project_id,benchmark_id,activation_reference,evidence_window_start,evidence_window_end,
              method_version,deployment_key,manifest_position,opportunity_id,request_profile_id,
              request_profile_version,request_profile_hash,source_evidence_hash,suggestion_commitment,
              authorization_json,authorization_hash,compliance_operator_key_version,
              workspace_manager_reference_principal_id,activation_scope,permitted_worker_jurisdictions_json,
              permitted_worker_jurisdictions_hash)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
            [
              built.workspaceId,
              built.projectId,
              built.benchmarkId,
              built.activationReference,
              built.evidenceWindowStart,
              built.evidenceWindowEnd,
              built.methodVersion,
              built.deploymentKey,
              opportunity.manifestPosition,
              opportunity.opportunityId,
              opportunity.requestProfileId,
              opportunity.requestProfileVersion,
              opportunity.requestProfileHash,
              opportunity.sourceEvidenceHash,
              opportunity.suggestionCommitment,
              opportunity.authorizationJson,
              opportunity.authorizationHash,
              built.complianceOperatorKeyVersion,
              built.workspaceManagerReferencePrincipalId,
              built.activationScope,
              canonicalizeRfc8785(built.permittedWorkerJurisdictions),
              built.permittedWorkerJurisdictionsHash,
            ],
          );
        }
        await appendAudit(
          activationAuditInput({
            activation: built,
            workspaceManagerReferencePrincipalId: activationInput.workspaceManagerReferencePrincipalId,
            operatorKeyVersion: activationInput.complianceOperatorKeyVersion,
            occurredAt: activatedAt,
          }),
          client,
        );
        return built;
      });
    },

    async deactivate(deactivationInput: {
      complianceOperatorKeyVersion: string;
      workspaceId: string;
      projectId: string;
      activationReference: string;
      reason: NetworkBenchmarkDeactivationReason;
      supersededByActivationReference?: string;
    }) {
      return withSerializable(pool, async client => {
        const complianceOperatorKeyVersion = operatorKeyVersion(deactivationInput.complianceOperatorKeyVersion);
        const result = await client.query(
          `SELECT * FROM tokenless_network_benchmark_activations
           WHERE workspace_id=$1 AND project_id=$2 AND activation_reference=$3 FOR UPDATE`,
          [deactivationInput.workspaceId, deactivationInput.projectId, deactivationInput.activationReference],
        );
        const row = result.rows[0] as Row | undefined;
        if (!row) {
          throw new TokenlessServiceError(
            "Network benchmark activation not found.",
            404,
            "network_benchmark_activation_not_found",
          );
        }
        const deactivatedAt = await transactionTime(client);
        const workspaceManagerReferencePrincipalId = identifier(
          String(row.workspace_manager_reference_principal_id ?? ""),
          "workspaceManagerReferencePrincipalId",
        );
        if (!(NETWORK_BENCHMARK_DEACTIVATION_REASONS as readonly string[]).includes(deactivationInput.reason)) {
          invalid("Deactivation reason is unsupported.", "reason");
        }
        const replacement = deactivationInput.supersededByActivationReference
          ? identifier(deactivationInput.supersededByActivationReference, "supersededByActivationReference")
          : null;
        if ((deactivationInput.reason === "superseded") !== Boolean(replacement)) {
          invalid("Supersession requires exactly one replacement activation.", "supersededByActivationReference");
        }
        const artifact = {
          schemaVersion: "rateloop.network-benchmark-activation-deactivation.v2",
          workspaceId: rowString(row, "workspace_id"),
          projectId: rowString(row, "project_id"),
          benchmarkId: rowString(row, "benchmark_id"),
          activationReference: rowString(row, "activation_reference"),
          activationHash: rowString(row, "activation_hash"),
          attestedBy: `tokenless_compliance_operator:${complianceOperatorKeyVersion}` as const,
          complianceOperatorKeyVersion,
          workspaceManagerReferencePrincipalId,
          reason: deactivationInput.reason,
          supersededByActivationReference: replacement,
          deactivatedAt: deactivatedAt.toISOString(),
        } as const;
        const deactivationJson = canonicalizeRfc8785(artifact);
        const deactivationHash = rawSha256(deactivationJson);
        await client.query(
          `INSERT INTO tokenless_network_benchmark_activation_deactivations
           (workspace_id,project_id,benchmark_id,activation_reference,evidence_window_start,evidence_window_end,
            method_version,deployment_key,activation_status,activation_hash,reason,
            superseded_by_activation_reference,deactivation_json,deactivation_hash,compliance_operator_key_version,
            workspace_manager_reference_principal_id,deactivated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            artifact.workspaceId,
            artifact.projectId,
            artifact.benchmarkId,
            artifact.activationReference,
            rowString(row, "evidence_window_start"),
            rowString(row, "evidence_window_end"),
            rowString(row, "method_version"),
            rowString(row, "deployment_key"),
            artifact.activationHash,
            artifact.reason,
            artifact.supersededByActivationReference,
            deactivationJson,
            deactivationHash,
            complianceOperatorKeyVersion,
            workspaceManagerReferencePrincipalId,
            artifact.deactivatedAt,
          ],
        );
        await appendAudit(
          deactivationAuditInput({
            workspaceId: artifact.workspaceId,
            activationReference: artifact.activationReference,
            activationHash: artifact.activationHash,
            deactivationHash,
            workspaceManagerReferencePrincipalId,
            operatorKeyVersion: complianceOperatorKeyVersion,
            occurredAt: deactivatedAt,
            reason: artifact.reason,
            supersededByActivationReference: artifact.supersededByActivationReference,
          }),
          client,
        );
        return { ...artifact, deactivationHash };
      });
    },
  };
}

export async function requireActiveNetworkBenchmarkForRunInTransaction(
  client: PoolClient,
  input: { workspaceId: string; projectId: string; runId: string; deploymentKey: string },
) {
  const result = await client.query(
    "SELECT tokenless_require_active_network_benchmark_for_run($1,$2,$3,$4) AS activation_reference",
    [input.workspaceId, input.projectId, input.runId, input.deploymentKey],
  );
  return rowString(result.rows[0] as Row, "activation_reference");
}

export const networkBenchmarkActivationService = createNetworkBenchmarkActivationService();

export const __networkBenchmarkActivationTestUtils = {
  activationAuditInput,
  codeUnitCompare,
  maxActivationSeconds: MAX_ACTIVATION_SECONDS,
  rawSha256,
  deactivationAuditInput,
};
