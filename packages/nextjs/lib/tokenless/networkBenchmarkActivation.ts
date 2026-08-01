import { canonicalizeRfc8785 } from "@rateloop/node-utils/jcs";
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const DEPLOYMENT_KEY = /^tokenless-v4:[A-Za-z0-9:._-]{1,239}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const MAX_ACTIVATION_SECONDS = 30 * 24 * 60 * 60;

type PoolLike = Pick<Pool, "connect">;
type Row = Record<string, unknown>;

export type NetworkBenchmarkEvidenceType =
  | "audit_partner_method_acceptance"
  | "provider_pilot_acceptance"
  | "hosted_end_to_end_exercise"
  | "keeper_recovery_exercise"
  | "indexer_recovery_exercise"
  | "paid_eligibility_payout_tax_dac7_readiness"
  | "sanctions_screening_readiness"
  | "reviewer_contract_worker_information_appeal_readiness"
  | "worker_data_privacy_governance_readiness";

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
}>;

export type BuiltNetworkBenchmarkActivation = ReturnType<typeof buildNetworkBenchmarkActivation>;

function invalid(message: string, field?: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_network_benchmark_activation", false, field);
}

function identifier(value: string, field: string) {
  if (!IDENTIFIER.test(value)) invalid(`${field} is invalid.`, field);
  return value;
}

function digest(value: string, field: string) {
  if (!DIGEST.test(value)) invalid(`${field} is invalid.`, field);
  return value as `sha256:${string}`;
}

function deploymentKey(value: string) {
  if (!DEPLOYMENT_KEY.test(value)) invalid("Deployment key must be a complete tokenless-v4 key.", "deploymentKey");
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

function outcomeFor(type: NetworkBenchmarkEvidenceType) {
  if (type === "audit_partner_method_acceptance" || type === "provider_pilot_acceptance") return "accepted" as const;
  if (
    type === "hosted_end_to_end_exercise" ||
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
  return {
    workspaceId: identifier(input.workspaceId, "workspaceId"),
    projectId: identifier(input.projectId, "projectId"),
    benchmarkId: identifier(input.benchmarkId, "benchmarkId"),
    activationReference: identifier(input.activationReference, "activationReference"),
    evidenceWindowStart: evidenceWindowStart.toISOString(),
    evidenceWindowEnd: evidenceWindowEnd.toISOString(),
    methodVersion: identifier(input.methodVersion, "methodVersion"),
    deploymentKey: deploymentKey(input.deploymentKey),
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
}

export function buildNetworkBenchmarkActivation(
  input: NetworkBenchmarkActivationBoundary & {
    activatedBy: string;
    activatedAt: string;
    authorizationDurationSeconds: number;
    evidence: readonly NetworkBenchmarkEvidence[];
    opportunities: readonly NetworkBenchmarkOpportunityIdentity[];
  },
) {
  const boundary = exactBoundary(input);
  const activatedAt = instant(input.activatedAt, "activatedAt");
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
  if (
    (counts.get("audit_partner_method_acceptance") ?? 0) < 1 ||
    providerCounterparties.size < 2 ||
    (counts.get("hosted_end_to_end_exercise") ?? 0) < 1 ||
    (counts.get("keeper_recovery_exercise") ?? 0) < 1 ||
    (counts.get("indexer_recovery_exercise") ?? 0) < 1 ||
    (counts.get("paid_eligibility_payout_tax_dac7_readiness") ?? 0) < 1 ||
    (counts.get("sanctions_screening_readiness") ?? 0) < 1 ||
    (counts.get("reviewer_contract_worker_information_appeal_readiness") ?? 0) < 1 ||
    (counts.get("worker_data_privacy_governance_readiness") ?? 0) < 1
  ) {
    invalid(
      "Activation requires audit acceptance, two distinct accepted provider pilots, hosted recovery exercises, and every paid-work legal-readiness evidence type.",
      "evidence",
    );
  }
  const recordedBy = identifier(input.activatedBy, "activatedBy");
  const recordedAt = activatedAt.toISOString();
  const evidenceEntries = [...input.evidence]
    .sort((left, right) =>
      codeUnitCompare(`${left.evidenceType}:${left.evidenceId}`, `${right.evidenceType}:${right.evidenceId}`),
    )
    .map((item, index) => {
      const artifact = {
        schemaVersion: "rateloop.network-benchmark-activation-evidence.v1",
        ...boundary,
        evidenceId: item.evidenceId,
        evidenceType: item.evidenceType,
        evidenceOutcome: outcomeFor(item.evidenceType),
        counterpartyReferenceHash: item.counterpartyReferenceHash,
        artifactDigest: item.artifactDigest,
        completedAt: instant(item.completedAt, "completedAt").toISOString(),
        recordedBy,
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
        schemaVersion: "rateloop.network-benchmark-opportunity-authorization.v1",
        ...boundary,
        opportunityId: item.opportunityId,
        requestProfileId: item.requestProfileId,
        requestProfileVersion: item.requestProfileVersion,
        requestProfileHash: item.requestProfileHash,
        sourceEvidenceHash: item.sourceEvidenceHash,
        suggestionCommitment: item.suggestionCommitment,
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
    schemaVersion: "rateloop.network-benchmark-activation.v1",
    ...boundary,
    status: "active",
    activationScope: "exact_public_safe_benchmark_network_execution",
    publicSafeOnly: true,
    unrelatedOpportunityAuthority: "none",
    expectedEvidenceCount: evidenceEntries.length,
    evidenceManifestRoot,
    expectedOpportunityCount: opportunityEntries.length,
    opportunityManifestRoot,
    authorizationDurationSeconds: input.authorizationDurationSeconds,
    authorizationNotBefore: activatedAt.toISOString(),
    authorizationExpiresAt: authorizationExpiresAt.toISOString(),
    activatedBy: recordedBy,
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
    input.deploymentKey !== input.activation.deploymentKey
  ) {
    return { allowed: false as const, reason: "scope_mismatch" as const };
  }
  if (!input.activation.opportunities.some(item => item.opportunityId === input.opportunityId)) {
    return { allowed: false as const, reason: "opportunity_not_authorized" as const };
  }
  return { allowed: true as const, reason: "authorized" as const };
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

async function requireManager(
  client: PoolClient,
  input: {
    authenticatedManagerPrincipalId: string;
    workspaceId: string;
    projectId: string;
  },
) {
  const result = await client.query(
    `SELECT w.status AS workspace_status,p.status AS project_status,m.role,principal.status AS principal_status
     FROM tokenless_workspaces w
     JOIN tokenless_assurance_projects p ON p.workspace_id=w.workspace_id AND p.project_id=$2
     JOIN tokenless_workspace_members m ON m.workspace_id=w.workspace_id AND m.account_address=$3
     JOIN tokenless_principals principal ON principal.principal_id=m.account_address
     WHERE w.workspace_id=$1
     FOR UPDATE OF w,p,m,principal`,
    [input.workspaceId, input.projectId, input.authenticatedManagerPrincipalId],
  );
  const row = result.rows[0] as Row | undefined;
  if (
    !row ||
    rowString(row, "workspace_status") !== "active" ||
    rowString(row, "project_status") !== "active" ||
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

export function createNetworkBenchmarkActivationService(input?: { pool?: PoolLike }) {
  const pool = input?.pool ?? dbPool;
  return {
    async activate(
      activationInput: NetworkBenchmarkActivationBoundary & {
        authenticatedManagerPrincipalId: string;
        authorizationDurationSeconds: number;
        evidence: readonly NetworkBenchmarkEvidence[];
        opportunityIds: readonly string[];
      },
    ) {
      return withSerializable(pool, async client => {
        await requireManager(client, activationInput);
        const activatedAt = await transactionTime(client);
        if (!activationInput.opportunityIds.length)
          invalid("At least one exact opportunity is required.", "opportunityIds");
        const uniqueIds = [...new Set(activationInput.opportunityIds.map(value => identifier(value, "opportunityId")))];
        if (uniqueIds.length !== activationInput.opportunityIds.length) {
          invalid("An opportunity may be authorized only once.", "opportunityIds");
        }
        const result = await client.query(
          `SELECT opportunity_id,request_profile_id,request_profile_version,request_profile_hash,
                  source_evidence_hash,suggestion_commitment,status
           FROM tokenless_agent_review_opportunities
           WHERE workspace_id=$1 AND opportunity_id=ANY($2::text[])
           ORDER BY opportunity_id FOR SHARE`,
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
          activatedBy: activationInput.authenticatedManagerPrincipalId,
          activatedAt: activatedAt.toISOString(),
          opportunities,
        });
        for (const evidence of built.evidence) {
          await client.query(
            `INSERT INTO tokenless_network_benchmark_activation_evidence
             (workspace_id,project_id,benchmark_id,activation_reference,evidence_window_start,evidence_window_end,method_version,
              deployment_key,evidence_id,evidence_type,evidence_outcome,counterparty_reference_hash,
              artifact_digest,completed_at,evidence_json,evidence_hash,recorded_by,recorded_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
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
              evidence.recordedBy,
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
            activation_hash,activated_by,activated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active','exact_public_safe_benchmark_network_execution',true,'none',
                   $9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
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
            built.activatedBy,
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
              authorization_json,authorization_hash)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
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
            ],
          );
        }
        return built;
      });
    },

    async deactivate(deactivationInput: {
      authenticatedManagerPrincipalId: string;
      workspaceId: string;
      projectId: string;
      activationReference: string;
      reason: "manual_deactivation" | "release_gate_failure" | "superseded";
      supersededByActivationReference?: string;
    }) {
      return withSerializable(pool, async client => {
        await requireManager(client, deactivationInput);
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
        const replacement = deactivationInput.supersededByActivationReference
          ? identifier(deactivationInput.supersededByActivationReference, "supersededByActivationReference")
          : null;
        if ((deactivationInput.reason === "superseded") !== Boolean(replacement)) {
          invalid("Supersession requires exactly one replacement activation.", "supersededByActivationReference");
        }
        const artifact = {
          schemaVersion: "rateloop.network-benchmark-activation-deactivation.v1",
          workspaceId: rowString(row, "workspace_id"),
          projectId: rowString(row, "project_id"),
          benchmarkId: rowString(row, "benchmark_id"),
          activationReference: rowString(row, "activation_reference"),
          activationHash: rowString(row, "activation_hash"),
          reason: deactivationInput.reason,
          supersededByActivationReference: replacement,
          deactivatedBy: identifier(
            deactivationInput.authenticatedManagerPrincipalId,
            "authenticatedManagerPrincipalId",
          ),
          deactivatedAt: deactivatedAt.toISOString(),
        } as const;
        const deactivationJson = canonicalizeRfc8785(artifact);
        const deactivationHash = rawSha256(deactivationJson);
        await client.query(
          `INSERT INTO tokenless_network_benchmark_activation_deactivations
           (workspace_id,project_id,benchmark_id,activation_reference,evidence_window_start,evidence_window_end,
            method_version,deployment_key,activation_status,activation_hash,reason,
            superseded_by_activation_reference,deactivation_json,deactivation_hash,deactivated_by,deactivated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10,$11,$12,$13,$14,$15)`,
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
            artifact.deactivatedBy,
            artifact.deactivatedAt,
          ],
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
  codeUnitCompare,
  maxActivationSeconds: MAX_ACTIVATION_SECONDS,
  rawSha256,
};
