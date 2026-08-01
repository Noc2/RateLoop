import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import { createHash, createHmac, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import "server-only";
import { isRateLoopPrincipalId } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { appendAuditEvent, appendSecurityAuditEvent } from "~~/lib/privacy/audit";
import { canonicalAttestationJson, createAssuranceAttestationStatement } from "~~/lib/tokenless/assuranceAttestations";
import {
  type BenchmarkResearchApprovedExport,
  type BenchmarkResearchGrantAccessAudit,
  type BenchmarkResearchGrantAccessAuditReceipt,
  type BenchmarkResearchGrantAccessContext,
  type BenchmarkResearchGrantAccessReplayLookup,
  type BenchmarkResearchGrantAccessSnapshot,
  type BenchmarkResearchGrantDeniedAccessAuditReceipt,
  type BenchmarkResearchGrantEvidence,
  type BenchmarkResearchGrantReadTransaction,
  type BenchmarkResearchGrantRevocationEvidence,
  type BenchmarkResearchGrantWriteTransaction,
  type BenchmarkResearchPurpose,
  type BenchmarkResearchRecipientBindingKey,
  createBenchmarkResearchGrantInTransaction,
  createBenchmarkResearchGrantPersistenceFacade,
  revokeBenchmarkResearchGrantInTransaction,
} from "~~/lib/tokenless/benchmarkResearchGrants";
import { deriveCapabilityIssuanceIdempotency } from "~~/lib/tokenless/capabilityIssuanceIdempotency";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const HMAC_SHA256 = /^hmac-sha256:[0-9a-f]{64}$/u;
const TOKEN_LOOKUP_DOMAIN = "rateloop.benchmark-research-token-lookup.v1";
const GRANT_LOOKUP_DOMAIN = "rateloop.benchmark-research-grant-lookup.v1";
const RECIPIENT_LOOKUP_DOMAIN = "rateloop.benchmark-research-recipient-lookup.v1";
const GENESIS_DIGEST = `sha256:${"0".repeat(64)}` as const;

type Row = Record<string, unknown>;
type PoolLike = Pick<Pool, "connect">;

export type BenchmarkResearchTokenLookupKey = Readonly<{ keyId: string; secret: Uint8Array }>;

export type BenchmarkResearchPersistence = ReturnType<typeof createBenchmarkResearchPersistence>;

function invalid(message: string, field?: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_benchmark_research_persistence", false, field);
}

function requiredIdentifier(value: string, field: string) {
  if (!IDENTIFIER.test(value)) invalid(`${field} is invalid.`, field);
  return value;
}

function bindingKey<T extends BenchmarkResearchTokenLookupKey | BenchmarkResearchRecipientBindingKey>(key: T): T {
  requiredIdentifier(key.keyId, "keyId");
  if (!(key.secret instanceof Uint8Array) || key.secret.byteLength < 32) {
    invalid("Benchmark research HMAC keys must contain at least 32 bytes.", "key");
  }
  return key;
}

function rawSha256(bytes: string | Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
}

function lookupDigest(domain: string, value: string) {
  return sha256Rfc8785({ domain, value });
}

function withoutDigest<T extends object>(value: T, field: keyof T) {
  const copy = { ...value };
  delete copy[field];
  return copy;
}

function rowString(row: Row, key: string) {
  const value = row[key];
  if (value === null || value === undefined) throw new Error(`Missing persisted benchmark research field ${key}.`);
  return String(value);
}

function rowNullableString(row: Row, key: string) {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function rowDate(row: Row, key: string) {
  const stored = row[key];
  if (stored === null || stored === undefined) throw new Error(`Missing persisted benchmark research field ${key}.`);
  const value = stored instanceof Date ? new Date(stored.getTime()) : new Date(String(stored));
  if (!Number.isFinite(value.getTime())) throw new Error(`Invalid persisted benchmark research timestamp ${key}.`);
  return value;
}

function parseJson<T>(value: unknown, field: string): T {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    throw new Error(`Invalid persisted benchmark research JSON ${field}.`);
  }
}

function restoreDigest<T extends object, K extends string>(row: Row, jsonColumn: string, digestColumn: string, key: K) {
  const json = rowString(row, jsonColumn);
  const digest = rowString(row, digestColumn);
  if (rawSha256(json) !== digest) throw new Error(`Persisted ${jsonColumn} digest is invalid.`);
  return { ...parseJson<T>(json, jsonColumn), [key]: digest } as T & Record<K, string>;
}

async function transactionTime(client: PoolClient) {
  const result = await client.query("SELECT date_trunc('milliseconds', transaction_timestamp()) AS transaction_time");
  return rowDate(result.rows[0] as Row, "transaction_time");
}

async function withSerializable<T>(pool: PoolLike, work: (client: PoolClient) => Promise<T>): Promise<T> {
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

export function deriveBenchmarkResearchTokenLookupDigest(input: {
  token: string;
  key: BenchmarkResearchTokenLookupKey;
}) {
  const key = bindingKey(input.key);
  if (typeof input.token !== "string" || input.token.length < 32 || input.token.length > 512) {
    invalid("Benchmark research access token is invalid.", "token");
  }
  const payload = canonicalizeRfc8785({ domain: TOKEN_LOOKUP_DOMAIN, keyId: key.keyId, token: input.token });
  return `hmac-sha256:${createHmac("sha256", key.secret).update(payload).digest("hex")}` as const;
}

export function benchmarkResearchExportApprovalAuditMetadata(source: BenchmarkResearchApprovedExport) {
  return {
    schemaVersion: "rateloop.benchmark-research-export-approval-audit.v1",
    activationReference: source.activationReference,
    approvalId: source.approval.approvalId,
    benchmarkId: source.benchmarkId,
    dataClassification: "public_safe",
    exportArtifactDigest: source.approval.auditBinding.artifactDigest,
    exportId: source.exportId,
    exportSchemaVersion: source.schemaVersion,
    projectId: source.projectId,
    referenceBridgeHash: source.referenceProvenance.bridgeHash,
    referenceDerivationSource: source.referenceProvenance.derivationSource,
  } as const;
}

async function requireExactApprovedExportWitness(client: PoolClient, source: BenchmarkResearchApprovedExport) {
  const result = await client.query(
    `SELECT e.actor_kind,e.actor_reference,e.assurance_method,e.action,e.target_kind,e.target_id,e.purpose,e.reason,
            e.request_correlation,e.result,e.metadata_json,e.occurred_at,
            j.artifact_schema_version,j.boundary_at,j.statement_json
       FROM tokenless_audit_events e
       JOIN tokenless_assurance_attestation_jobs j
         ON j.workspace_id=e.workspace_id AND j.job_id=$4 AND j.artifact_kind='audit_export_head'
        AND j.artifact_digest=e.event_digest
      WHERE e.workspace_id=$1 AND e.event_id=$2 AND e.event_digest=$3
      FOR SHARE OF e,j`,
    [
      source.workspaceId,
      source.approval.auditBinding.eventId,
      source.approval.auditBinding.eventDigest,
      source.approval.attestationBinding.jobId,
    ],
  );
  const row = result.rows[0] as Row | undefined;
  const approvedAt = new Date(source.approval.approvedAt);
  const expectedMetadata = canonicalizeRfc8785(benchmarkResearchExportApprovalAuditMetadata(source));
  const expectedStatement = canonicalAttestationJson(
    createAssuranceAttestationStatement({
      kind: "audit_export_head",
      artifactDigest: source.approval.auditBinding.eventDigest,
      artifactSchemaVersion: "rateloop-audit-v1",
      boundaryAt: approvedAt,
    }),
  );
  if (
    !row ||
    rowString(row, "actor_kind") !== "principal" ||
    rowString(row, "actor_reference") !== source.approval.approvedBy ||
    rowString(row, "assurance_method") !== "authenticated_workspace_manager" ||
    rowString(row, "action") !== "benchmark_research_export_approved" ||
    rowString(row, "target_kind") !== "benchmark_research_approved_export" ||
    rowString(row, "target_id") !== source.exportId ||
    rowString(row, "purpose") !== "contractual_public_safe_benchmark_research" ||
    rowString(row, "reason") !== "immutable_public_safe_export_approval" ||
    rowNullableString(row, "request_correlation") !== source.approval.approvalId ||
    rowString(row, "result") !== "success" ||
    canonicalizeRfc8785(parseJson(row.metadata_json, "approval audit metadata")) !== expectedMetadata ||
    rowDate(row, "occurred_at").toISOString() !== approvedAt.toISOString() ||
    rowString(row, "artifact_schema_version") !== "rateloop-audit-v1" ||
    rowDate(row, "boundary_at").toISOString() !== approvedAt.toISOString() ||
    rowString(row, "statement_json") !== expectedStatement
  ) {
    invalid("Approved export audit or attestation does not bind the exact approval.", "export");
  }
}

async function requireActiveManager(
  client: PoolClient,
  input: { authenticatedManagerPrincipalId: string; workspaceId: string; projectId: string },
) {
  if (!isRateLoopPrincipalId(input.authenticatedManagerPrincipalId)) {
    throw new TokenlessServiceError(
      "Benchmark research project not found.",
      404,
      "benchmark_research_project_not_found",
    );
  }
  const result = await client.query(
    `SELECT w.status AS workspace_status,p.status AS project_status,m.role,pr.status AS principal_status
       FROM tokenless_workspaces w
       JOIN tokenless_assurance_projects p ON p.workspace_id=w.workspace_id AND p.project_id=$2
       JOIN tokenless_workspace_members m ON m.workspace_id=w.workspace_id AND m.account_address=$3
       JOIN tokenless_principals pr ON pr.principal_id=m.account_address
      WHERE w.workspace_id=$1
      FOR UPDATE OF w,p,m,pr`,
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
    throw new TokenlessServiceError(
      "Benchmark research project not found.",
      404,
      "benchmark_research_project_not_found",
    );
  }
  return rowString(row, "role") as "owner" | "admin";
}

async function approvedExportValidationProbe(input: {
  export: BenchmarkResearchApprovedExport;
  deploymentKey: string;
  transactionTime: Date;
}) {
  const principalId = input.export.approval.approvedBy;
  await createBenchmarkResearchGrantInTransaction({
    authenticatedManagerPrincipalId: principalId,
    recipientPrincipalId: principalId,
    exportId: input.export.exportId,
    grantId: `brg_${Buffer.alloc(16).toString("base64url")}`,
    purpose: "methodology_validation",
    durationMs: 1,
    recipientBindingKey: { keyId: "approval-validation", secret: new Uint8Array(32) },
    transaction: {
      async authorizeGrantCreationForUpdate() {
        return {
          transactionTime: input.transactionTime,
          manager: {
            principalId,
            workspaceId: input.export.workspaceId,
            status: "active" as const,
            role: "admin" as const,
          },
          recipient: {
            principalId,
            status: "active" as const,
            agreement: {
              agreementId: "approval-validation",
              version: 1,
              status: "accepted" as const,
              acceptedAt: input.export.approval.approvedAt,
              workspaceId: input.export.workspaceId,
              projectId: input.export.projectId,
              benchmarkId: input.export.benchmarkId,
              purpose: "methodology_validation" as const,
              dataClassification: "public_safe" as const,
            },
          },
          workspace: { workspaceId: input.export.workspaceId, status: "active" as const },
          project: {
            projectId: input.export.projectId,
            workspaceId: input.export.workspaceId,
            status: "active" as const,
          },
          activation: {
            activationReference: input.export.activationReference,
            workspaceId: input.export.workspaceId,
            projectId: input.export.projectId,
            benchmarkId: input.export.benchmarkId,
            deploymentKey: input.deploymentKey,
            status: "active" as const,
            publicSafeOnly: true as const,
          },
          export: input.export,
        };
      },
      async appendGrant() {},
      async authorizeGrantRevocationForUpdate() {
        return null;
      },
      async appendRevocation() {},
    },
  });
}

function grantFromRow(row: Row): BenchmarkResearchGrantEvidence {
  return restoreDigest<BenchmarkResearchGrantEvidence, "eventDigest">(row, "grant_json", "event_digest", "eventDigest");
}

function exportFromRow(row: Row): BenchmarkResearchApprovedExport {
  return restoreDigest<BenchmarkResearchApprovedExport, "exportDigest">(
    row,
    "export_json",
    "export_digest",
    "exportDigest",
  );
}

function revocationFromRow(row: Row): BenchmarkResearchGrantRevocationEvidence | null {
  if (row.revocation_json === null || row.revocation_json === undefined) return null;
  return restoreDigest<BenchmarkResearchGrantRevocationEvidence, "eventDigest">(
    row,
    "revocation_json",
    "revocation_event_digest",
    "eventDigest",
  );
}

export function createBenchmarkResearchPersistence(input?: {
  pool?: PoolLike;
  tokenLookupKeys?: readonly BenchmarkResearchTokenLookupKey[];
  recipientBindingKeys?: readonly BenchmarkResearchRecipientBindingKey[];
}) {
  const pool = input?.pool ?? dbPool;
  const tokenLookupKeys = new Map((input?.tokenLookupKeys ?? []).map(key => [bindingKey(key).keyId, key]));
  const recipientBindingKeys = new Map((input?.recipientBindingKeys ?? []).map(key => [bindingKey(key).keyId, key]));

  return {
    async activateBenchmark(activationInput: {
      authenticatedManagerPrincipalId: string;
      workspaceId: string;
      projectId: string;
      benchmarkId: string;
      activationReference: string;
      deploymentKey: string;
    }) {
      return withSerializable(pool, async client => {
        await requireActiveManager(client, activationInput);
        const now = await transactionTime(client);
        const artifact = {
          schemaVersion: "rateloop.benchmark-research-activation.v1",
          workspaceId: requiredIdentifier(activationInput.workspaceId, "workspaceId"),
          projectId: requiredIdentifier(activationInput.projectId, "projectId"),
          benchmarkId: requiredIdentifier(activationInput.benchmarkId, "benchmarkId"),
          activationReference: requiredIdentifier(activationInput.activationReference, "activationReference"),
          deploymentKey: requiredIdentifier(activationInput.deploymentKey, "deploymentKey"),
          status: "active",
          publicSafeOnly: true,
          accessClass: "contractual_public_safe_benchmark_research",
          activationScope: "research_export_only",
          networkReleaseAuthority: "none",
          activatedBy: activationInput.authenticatedManagerPrincipalId,
          activatedAt: now.toISOString(),
        } as const;
        const json = canonicalizeRfc8785(artifact);
        const hash = rawSha256(json);
        await client.query(
          `INSERT INTO tokenless_benchmark_activations
           (workspace_id,project_id,benchmark_id,activation_reference,deployment_key,status,public_safe_only,
            access_class,activation_scope,network_release_authority,activation_json,activation_hash,activated_by,activated_at)
           VALUES ($1,$2,$3,$4,$5,'active',true,'contractual_public_safe_benchmark_research',
                   'research_export_only','none',$6,$7,$8,$9)`,
          [
            artifact.workspaceId,
            artifact.projectId,
            artifact.benchmarkId,
            artifact.activationReference,
            artifact.deploymentKey,
            json,
            hash,
            artifact.activatedBy,
            now,
          ],
        );
        return { ...artifact, activationHash: hash };
      });
    },

    async offerAgreement(offerInput: {
      authenticatedManagerPrincipalId: string;
      recipientPrincipalId: string;
      workspaceId: string;
      projectId: string;
      benchmarkId: string;
      agreementId: string;
      agreementVersion: number;
      purpose: BenchmarkResearchPurpose;
      expiresInMs: number;
    }) {
      return withSerializable(pool, async client => {
        await requireActiveManager(client, offerInput);
        if (!isRateLoopPrincipalId(offerInput.recipientPrincipalId)) {
          throw new TokenlessServiceError(
            "Benchmark research recipient not found.",
            404,
            "benchmark_research_recipient_not_found",
          );
        }
        const recipient = await client.query(
          "SELECT status FROM tokenless_principals WHERE principal_id=$1 FOR UPDATE",
          [offerInput.recipientPrincipalId],
        );
        const recipientRow = recipient.rows[0] as Row | undefined;
        if (!recipientRow || rowString(recipientRow, "status") !== "active") {
          throw new TokenlessServiceError(
            "Benchmark research recipient not found.",
            404,
            "benchmark_research_recipient_not_found",
          );
        }
        if (!Number.isSafeInteger(offerInput.agreementVersion) || offerInput.agreementVersion < 1) {
          invalid("Agreement version is invalid.", "agreementVersion");
        }
        if (
          !Number.isSafeInteger(offerInput.expiresInMs) ||
          offerInput.expiresInMs <= 0 ||
          offerInput.expiresInMs > 30 * 24 * 60 * 60 * 1_000
        ) {
          invalid("Agreement offer lifetime must be positive and no longer than 30 days.", "expiresInMs");
        }
        const now = await transactionTime(client);
        const expiresAt = new Date(now.getTime() + offerInput.expiresInMs);
        const artifact = {
          schemaVersion: "rateloop.benchmark-research-agreement-offer.v1",
          agreementId: requiredIdentifier(offerInput.agreementId, "agreementId"),
          version: offerInput.agreementVersion,
          recipientPrincipalId: offerInput.recipientPrincipalId,
          workspaceId: requiredIdentifier(offerInput.workspaceId, "workspaceId"),
          projectId: requiredIdentifier(offerInput.projectId, "projectId"),
          benchmarkId: requiredIdentifier(offerInput.benchmarkId, "benchmarkId"),
          purpose: offerInput.purpose,
          dataClassification: "public_safe",
          status: "offered",
          accessBasis: "accepted_contractual_public_safe_benchmark_agreement",
          offeredBy: offerInput.authenticatedManagerPrincipalId,
          offeredAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
        } as const;
        const json = canonicalizeRfc8785(artifact);
        const hash = rawSha256(json);
        await client.query(
          `INSERT INTO tokenless_benchmark_research_agreement_offers
           (workspace_id,project_id,benchmark_id,agreement_id,agreement_version,recipient_principal_id,purpose,
            data_classification,status,access_basis,offer_json,offer_hash,offered_by,offered_at,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'public_safe','offered',
                   'accepted_contractual_public_safe_benchmark_agreement',$8,$9,$10,$11,$12)`,
          [
            artifact.workspaceId,
            artifact.projectId,
            artifact.benchmarkId,
            artifact.agreementId,
            artifact.version,
            artifact.recipientPrincipalId,
            artifact.purpose,
            json,
            hash,
            artifact.offeredBy,
            now,
            expiresAt,
          ],
        );
        return { ...artifact, offerHash: hash };
      });
    },

    async acceptAgreement(agreementInput: {
      authenticatedRecipientPrincipalId: string;
      workspaceId: string;
      projectId: string;
      benchmarkId: string;
      agreementId: string;
      agreementVersion: number;
      purpose: BenchmarkResearchPurpose;
    }) {
      return withSerializable(pool, async client => {
        if (!isRateLoopPrincipalId(agreementInput.authenticatedRecipientPrincipalId)) {
          throw new TokenlessServiceError(
            "Benchmark research project not found.",
            404,
            "benchmark_research_project_not_found",
          );
        }
        const auth = await client.query(
          `SELECT w.status AS workspace_status,p.status AS project_status,pr.status AS principal_status,
                  o.offer_hash,o.expires_at
             FROM tokenless_workspaces w
             JOIN tokenless_assurance_projects p ON p.workspace_id=w.workspace_id AND p.project_id=$2
             JOIN tokenless_principals pr ON pr.principal_id=$3
             JOIN tokenless_benchmark_research_agreement_offers o
               ON o.workspace_id=w.workspace_id AND o.project_id=p.project_id AND o.benchmark_id=$4
              AND o.agreement_id=$5 AND o.agreement_version=$6 AND o.recipient_principal_id=pr.principal_id
              AND o.purpose=$7 AND o.status='offered' AND o.data_classification='public_safe'
            WHERE w.workspace_id=$1
            FOR UPDATE OF w,p,pr,o`,
          [
            agreementInput.workspaceId,
            agreementInput.projectId,
            agreementInput.authenticatedRecipientPrincipalId,
            agreementInput.benchmarkId,
            agreementInput.agreementId,
            agreementInput.agreementVersion,
            agreementInput.purpose,
          ],
        );
        const authRow = auth.rows[0] as Row | undefined;
        if (
          !authRow ||
          rowString(authRow, "workspace_status") !== "active" ||
          rowString(authRow, "project_status") !== "active" ||
          rowString(authRow, "principal_status") !== "active"
        ) {
          throw new TokenlessServiceError(
            "Benchmark research project not found.",
            404,
            "benchmark_research_project_not_found",
          );
        }
        const now = await transactionTime(client);
        if (rowDate(authRow, "expires_at") <= now) {
          throw new TokenlessServiceError(
            "Benchmark research agreement offer not found.",
            404,
            "benchmark_research_offer_not_found",
          );
        }
        if (!Number.isSafeInteger(agreementInput.agreementVersion) || agreementInput.agreementVersion < 1) {
          invalid("Agreement version is invalid.", "agreementVersion");
        }
        const artifact = {
          schemaVersion: "rateloop.benchmark-research-agreement-acceptance.v1",
          agreementId: requiredIdentifier(agreementInput.agreementId, "agreementId"),
          version: agreementInput.agreementVersion,
          recipientPrincipalId: agreementInput.authenticatedRecipientPrincipalId,
          workspaceId: requiredIdentifier(agreementInput.workspaceId, "workspaceId"),
          projectId: requiredIdentifier(agreementInput.projectId, "projectId"),
          benchmarkId: requiredIdentifier(agreementInput.benchmarkId, "benchmarkId"),
          purpose: agreementInput.purpose,
          dataClassification: "public_safe",
          status: "accepted",
          accessBasis: "accepted_contractual_public_safe_benchmark_agreement",
          acceptedAt: now.toISOString(),
        } as const;
        const json = canonicalizeRfc8785(artifact);
        const hash = rawSha256(json);
        await client.query(
          `INSERT INTO tokenless_benchmark_research_agreement_acceptances
           (workspace_id,project_id,benchmark_id,agreement_id,agreement_version,recipient_principal_id,purpose,
            data_classification,status,access_basis,offer_status,offer_hash,agreement_json,agreement_hash,accepted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'public_safe','accepted',
                   'accepted_contractual_public_safe_benchmark_agreement','offered',$8,$9,$10,$11)`,
          [
            artifact.workspaceId,
            artifact.projectId,
            artifact.benchmarkId,
            artifact.agreementId,
            artifact.version,
            artifact.recipientPrincipalId,
            artifact.purpose,
            rowString(authRow, "offer_hash"),
            json,
            hash,
            now,
          ],
        );
        return { ...artifact, agreementHash: hash };
      });
    },

    async approveExport(exportInput: {
      authenticatedManagerPrincipalId: string;
      epochId: string;
      labelSetId: string;
      export: BenchmarkResearchApprovedExport;
    }) {
      return withSerializable(pool, async client => {
        const source = structuredClone(exportInput.export);
        if (source.approval.approvedBy !== exportInput.authenticatedManagerPrincipalId) {
          throw new TokenlessServiceError(
            "Benchmark research project not found.",
            404,
            "benchmark_research_project_not_found",
          );
        }
        await requireActiveManager(client, {
          authenticatedManagerPrincipalId: exportInput.authenticatedManagerPrincipalId,
          workspaceId: source.workspaceId,
          projectId: source.projectId,
        });
        const now = await transactionTime(client);
        const deploymentKey = source.referenceCommitment.source.deploymentKey;
        await approvedExportValidationProbe({ export: source, deploymentKey, transactionTime: now });
        await requireExactApprovedExportWitness(client, source);
        const labelSet = await client.query(
          `SELECT labels.label_root,labels.set_hash,labels.derivation_source,
                  COALESCE(network.bridge_hash,panel.bridge_hash) AS bridge_hash,
                  COALESCE(network.reporting_mode,panel.reporting_mode) AS reporting_mode,
                  COALESCE(network.population_claim,panel.population_claim) AS population_claim,
                  COALESCE(network.operational_rollup_eligible,panel.operational_rollup_eligible)
                    AS operational_rollup_eligible,
                  COALESCE(network.adaptive_reuse_allowed,panel.adaptive_reuse_allowed) AS adaptive_reuse_allowed
             FROM tokenless_dsa_reference_label_sets labels
             LEFT JOIN tokenless_dsa_reference_network_label_set_bridges network
               ON network.workspace_id=labels.workspace_id AND network.label_set_id=labels.label_set_id
              AND labels.derivation_source='rateloop_network'
             LEFT JOIN tokenless_dsa_named_panel_label_set_bridges panel
               ON panel.workspace_id=labels.workspace_id AND panel.label_set_id=labels.label_set_id
              AND labels.derivation_source='independent_reference_panel'
            WHERE labels.workspace_id=$1 AND labels.label_set_id=$2 AND labels.epoch_id=$3
            FOR SHARE OF labels`,
          [source.workspaceId, exportInput.labelSetId, exportInput.epochId],
        );
        const labelRow = labelSet.rows[0] as Row | undefined;
        if (!labelRow) invalid("Approved reference label set was not found.", "labelSetId");
        if (
          labelRow.bridge_hash === null ||
          labelRow.bridge_hash === undefined ||
          labelRow.reporting_mode === null ||
          labelRow.reporting_mode === undefined ||
          typeof labelRow.population_claim !== "boolean" ||
          typeof labelRow.operational_rollup_eligible !== "boolean" ||
          typeof labelRow.adaptive_reuse_allowed !== "boolean"
        ) {
          invalid("Approved reference derivation bridge was not found.", "labelSetId");
        }
        const expectedReferenceProvenance = {
          schemaVersion: "rateloop.benchmark-research-reference-provenance.v1",
          derivationSource: rowString(labelRow, "derivation_source"),
          labelSetId: exportInput.labelSetId,
          labelSetHash: rowString(labelRow, "set_hash"),
          bridgeHash: rowString(labelRow, "bridge_hash"),
          reportingMode: rowString(labelRow, "reporting_mode"),
          populationClaim: labelRow.population_claim,
          operationalRollupEligible: labelRow.operational_rollup_eligible,
          adaptiveReuseAllowed: labelRow.adaptive_reuse_allowed,
        };
        if (canonicalizeRfc8785(source.referenceProvenance) !== canonicalizeRfc8785(expectedReferenceProvenance)) {
          invalid("Approved export reference provenance does not bind the exact label derivation.", "export");
        }
        const referenceProvenanceJson = canonicalizeRfc8785(source.referenceProvenance);
        const referenceProvenanceHash = rawSha256(referenceProvenanceJson);
        const exportJson = canonicalizeRfc8785(withoutDigest(source, "exportDigest"));
        if (rawSha256(exportJson) !== source.exportDigest) invalid("Approved export digest is invalid.", "export");
        await client.query(
          `INSERT INTO tokenless_benchmark_research_approved_exports
           (workspace_id,project_id,benchmark_id,activation_reference,deployment_key,export_id,schema_version,
            approval_id,approval_status,data_classification,activation_status,public_safe_only,derivation,epoch_id,
            commitment_digest,sample_digest,manifest_root,label_set_id,label_root,label_set_hash,
            reference_derivation_source,reference_bridge_hash,reference_network_bridge_hash,
            reference_named_panel_bridge_hash,reference_reporting_mode,reference_population_claim,
            reference_operational_rollup_eligible,reference_adaptive_reuse_allowed,reference_provenance_json,
            reference_provenance_hash,audit_event_id,audit_event_digest,attestation_job_id,
            attestation_artifact_kind,attestation_artifact_digest,export_json,export_digest,approved_by,approved_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'approved_immutable','public_safe','active',true,
                   'verified_committed_and_frozen_reference_sample',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                   $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,'audit_export_head',$27,$29,$30,$31,$32)`,
          [
            source.workspaceId,
            source.projectId,
            source.benchmarkId,
            source.activationReference,
            deploymentKey,
            source.exportId,
            source.schemaVersion,
            source.approval.approvalId,
            exportInput.epochId,
            source.approval.commitmentDigest,
            source.approval.sampleDigest,
            source.frozenReferenceSample.manifestRoot,
            exportInput.labelSetId,
            rowString(labelRow, "label_root"),
            rowString(labelRow, "set_hash"),
            source.referenceProvenance.derivationSource,
            source.referenceProvenance.bridgeHash,
            source.referenceProvenance.derivationSource === "rateloop_network"
              ? source.referenceProvenance.bridgeHash
              : null,
            source.referenceProvenance.derivationSource === "independent_reference_panel"
              ? source.referenceProvenance.bridgeHash
              : null,
            source.referenceProvenance.reportingMode,
            source.referenceProvenance.populationClaim,
            source.referenceProvenance.operationalRollupEligible,
            source.referenceProvenance.adaptiveReuseAllowed,
            referenceProvenanceJson,
            referenceProvenanceHash,
            source.approval.auditBinding.eventId,
            source.approval.auditBinding.eventDigest,
            source.approval.attestationBinding.jobId,
            exportJson,
            source.exportDigest,
            source.approval.approvedBy,
            new Date(source.approval.approvedAt),
          ],
        );
        return source;
      });
    },

    async issueGrant(grantInput: {
      authenticatedManagerPrincipalId: string;
      workspaceId: string;
      projectId: string;
      recipientPrincipalId: string;
      exportId: string;
      purpose: BenchmarkResearchPurpose;
      durationMs: number;
      idempotencyKey: string;
      tokenLookupKeyId: string;
      recipientBindingKeyId: string;
    }) {
      return withSerializable(pool, async client => {
        await requireActiveManager(client, grantInput);
        const issuance = deriveCapabilityIssuanceIdempotency({
          capabilityKind: "benchmark_research_grant",
          actorPrincipalId: grantInput.authenticatedManagerPrincipalId,
          workspaceId: grantInput.workspaceId,
          projectId: grantInput.projectId,
          idempotencyKey: grantInput.idempotencyKey,
          request: {
            recipientPrincipalId: grantInput.recipientPrincipalId,
            exportId: grantInput.exportId,
            purpose: grantInput.purpose,
            durationMs: grantInput.durationMs,
          },
        });
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [issuance.idempotencyKeyDigest]);
        const existingResult = await client.query(
          `SELECT i.request_binding_hash,g.grant_json,g.event_digest,g.token_lookup_key_id
             FROM tokenless_benchmark_research_grant_issuances i
             JOIN tokenless_benchmark_research_grants g
               ON g.workspace_id=i.workspace_id AND g.project_id=i.project_id AND g.grant_id=i.grant_id
              AND g.event_digest=i.grant_event_digest AND g.authorized_by=i.authorized_by
              AND g.issued_at=i.issued_at
            WHERE i.workspace_id=$1 AND i.project_id=$2 AND i.authorized_by=$3
              AND i.idempotency_key_digest=$4
            FOR UPDATE OF i,g`,
          [
            grantInput.workspaceId,
            grantInput.projectId,
            grantInput.authenticatedManagerPrincipalId,
            issuance.idempotencyKeyDigest,
          ],
        );
        const existing = existingResult.rows[0] as Row | undefined;
        if (existing) {
          if (rowString(existing, "request_binding_hash") !== issuance.requestBindingHash) {
            throw new TokenlessServiceError(
              "This issuance idempotency key is already bound to a different request.",
              409,
              "benchmark_research_grant_issuance_conflict",
            );
          }
          return {
            grant: grantFromRow(existing),
            token: null,
            tokenLookupKeyId: rowString(existing, "token_lookup_key_id"),
            idempotent: true,
            recoveryRequired: true,
          } as const;
        }
        const scopedExport = await client.query(
          `SELECT 1 FROM tokenless_benchmark_research_approved_exports
            WHERE workspace_id=$1 AND project_id=$2 AND export_id=$3 FOR SHARE`,
          [grantInput.workspaceId, grantInput.projectId, grantInput.exportId],
        );
        if (scopedExport.rowCount !== 1) {
          throw new TokenlessServiceError(
            "Benchmark research project not found.",
            404,
            "benchmark_research_project_not_found",
          );
        }
        const tokenLookupKey = tokenLookupKeys.get(grantInput.tokenLookupKeyId);
        const recipientBindingKey = recipientBindingKeys.get(grantInput.recipientBindingKeyId);
        if (!tokenLookupKey || !recipientBindingKey) invalid("Benchmark research HMAC key is unavailable.", "keyId");
        const token = randomBytes(32).toString("base64url");
        const tokenLookupDigest = deriveBenchmarkResearchTokenLookupDigest({ token, key: tokenLookupKey });
        const grantId = `brg_${randomBytes(16).toString("base64url")}`;
        const grant = await createBenchmarkResearchGrantInTransaction({
          authenticatedManagerPrincipalId: grantInput.authenticatedManagerPrincipalId,
          recipientPrincipalId: grantInput.recipientPrincipalId,
          exportId: grantInput.exportId,
          grantId,
          purpose: grantInput.purpose,
          durationMs: grantInput.durationMs,
          recipientBindingKey,
          transaction: createPostgresGrantWriteTransaction(client, {
            recipientPrincipalId: grantInput.recipientPrincipalId,
            tokenLookupKeyId: tokenLookupKey.keyId,
            tokenLookupDigest,
          }),
        });
        await client.query(
          `INSERT INTO tokenless_benchmark_research_grant_issuances
           (workspace_id,project_id,authorized_by,idempotency_key_digest,request_binding_hash,grant_id,
            grant_event_digest,issued_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            grantInput.workspaceId,
            grantInput.projectId,
            grantInput.authenticatedManagerPrincipalId,
            issuance.idempotencyKeyDigest,
            issuance.requestBindingHash,
            grant.grantId,
            grant.eventDigest,
            new Date(grant.issuedAt),
          ],
        );
        return {
          grant,
          token,
          tokenLookupKeyId: tokenLookupKey.keyId,
          idempotent: false,
          recoveryRequired: false,
        } as const;
      });
    },

    async revokeGrant(revocationInput: {
      authenticatedManagerPrincipalId: string;
      workspaceId: string;
      projectId: string;
      grantId: string;
      reason: BenchmarkResearchGrantRevocationEvidence["reason"];
    }) {
      return withSerializable(pool, async client => {
        await requireActiveManager(client, revocationInput);
        const scopedGrant = await client.query(
          `SELECT 1 FROM tokenless_benchmark_research_grants
            WHERE workspace_id=$1 AND project_id=$2 AND grant_id=$3 FOR SHARE`,
          [revocationInput.workspaceId, revocationInput.projectId, revocationInput.grantId],
        );
        if (scopedGrant.rowCount !== 1) {
          throw new TokenlessServiceError(
            "Benchmark research project not found.",
            404,
            "benchmark_research_project_not_found",
          );
        }
        return revokeBenchmarkResearchGrantInTransaction({
          authenticatedManagerPrincipalId: revocationInput.authenticatedManagerPrincipalId,
          grantId: revocationInput.grantId,
          reason: revocationInput.reason,
          transaction: createPostgresGrantWriteTransaction(client),
        });
      });
    },

    async readByToken(readInput: {
      accessId: string;
      idempotencyKey: string;
      token: string;
      tokenLookupKeyId: string;
      authenticatedRecipientPrincipalId: string;
      page?: { offset?: number; limit?: number };
    }) {
      const tokenLookupKey = tokenLookupKeys.get(readInput.tokenLookupKeyId);
      let grantId = "invalid";
      if (
        tokenLookupKey &&
        typeof readInput.token === "string" &&
        readInput.token.length >= 32 &&
        readInput.token.length <= 512
      ) {
        const tokenLookupDigest = deriveBenchmarkResearchTokenLookupDigest({
          token: readInput.token,
          key: tokenLookupKey,
        });
        const client = await pool.connect();
        try {
          const result = await client.query(
            `SELECT grant_id FROM tokenless_benchmark_research_grants
              WHERE token_lookup_key_id=$1 AND token_lookup_digest=$2`,
            [tokenLookupKey.keyId, tokenLookupDigest],
          );
          const row = result.rows[0] as Row | undefined;
          if (row) grantId = rowString(row, "grant_id");
        } finally {
          client.release();
        }
      }
      const facade = createBenchmarkResearchGrantPersistenceFacade({
        executor: createPostgresCommittedReadExecutor(pool),
        resolveRecipientBindingKey(keyId) {
          const key = recipientBindingKeys.get(keyId);
          return key ? new Uint8Array(key.secret) : null;
        },
      });
      return facade.readAfterCommittedAudit({
        accessId: readInput.accessId,
        idempotencyKey: readInput.idempotencyKey,
        grantId,
        authenticatedRecipientPrincipalId: readInput.authenticatedRecipientPrincipalId,
        page: readInput.page,
      });
    },
  };
}

function createPostgresGrantWriteTransaction(
  client: PoolClient,
  grantInsert?: {
    recipientPrincipalId: string;
    tokenLookupKeyId: string;
    tokenLookupDigest: `hmac-sha256:${string}`;
  },
): BenchmarkResearchGrantWriteTransaction {
  return {
    async authorizeGrantCreationForUpdate(request) {
      const result = await client.query(
        `SELECT transaction_timestamp() AS transaction_time,
                w.status AS workspace_status,p.status AS project_status,m.role AS manager_role,
                manager.status AS manager_status,recipient.status AS recipient_status,
                a.workspace_id,a.project_id,a.benchmark_id,a.agreement_id,a.agreement_version,
                a.purpose,a.data_classification,a.status AS agreement_status,a.accepted_at,
                x.export_json,x.export_digest,
                b.activation_reference,b.deployment_key,b.status AS activation_status,b.public_safe_only
           FROM tokenless_benchmark_research_approved_exports x
           JOIN tokenless_benchmark_activations b
             ON b.workspace_id=x.workspace_id AND b.project_id=x.project_id AND b.benchmark_id=x.benchmark_id
            AND b.activation_reference=x.activation_reference AND b.deployment_key=x.deployment_key
           JOIN tokenless_benchmark_research_agreement_acceptances a
             ON a.workspace_id=x.workspace_id AND a.project_id=x.project_id AND a.benchmark_id=x.benchmark_id
            AND a.recipient_principal_id=$2 AND a.purpose=$4
           JOIN tokenless_workspaces w ON w.workspace_id=x.workspace_id
           JOIN tokenless_assurance_projects p ON p.workspace_id=x.workspace_id AND p.project_id=x.project_id
           JOIN tokenless_workspace_members m
             ON m.workspace_id=x.workspace_id AND m.account_address=$1
           JOIN tokenless_principals manager ON manager.principal_id=m.account_address
           JOIN tokenless_principals recipient ON recipient.principal_id=a.recipient_principal_id
          WHERE x.export_id=$3
          ORDER BY a.accepted_at DESC,a.agreement_version DESC
          LIMIT 1
          FOR UPDATE OF x,b,a,w,p,m,manager,recipient`,
        [request.authenticatedManagerPrincipalId, request.recipientPrincipalId, request.exportId, request.purpose],
      );
      const row = result.rows[0] as Row | undefined;
      if (!row) return null;
      return {
        transactionTime: rowDate(row, "transaction_time"),
        manager: {
          principalId: request.authenticatedManagerPrincipalId,
          workspaceId: rowString(row, "workspace_id"),
          status: rowString(row, "manager_status") as "active",
          role: rowString(row, "manager_role") as "owner" | "admin",
        },
        recipient: {
          principalId: request.recipientPrincipalId,
          status: rowString(row, "recipient_status") as "active",
          agreement: {
            agreementId: rowString(row, "agreement_id"),
            version: Number(row.agreement_version),
            status: rowString(row, "agreement_status") as "accepted",
            acceptedAt: rowDate(row, "accepted_at").toISOString(),
            workspaceId: rowString(row, "workspace_id"),
            projectId: rowString(row, "project_id"),
            benchmarkId: rowString(row, "benchmark_id"),
            purpose: rowString(row, "purpose") as BenchmarkResearchPurpose,
            dataClassification: rowString(row, "data_classification") as "public_safe",
          },
        },
        workspace: {
          workspaceId: rowString(row, "workspace_id"),
          status: rowString(row, "workspace_status") as "active",
        },
        project: {
          projectId: rowString(row, "project_id"),
          workspaceId: rowString(row, "workspace_id"),
          status: rowString(row, "project_status") as "active",
        },
        activation: {
          activationReference: rowString(row, "activation_reference"),
          workspaceId: rowString(row, "workspace_id"),
          projectId: rowString(row, "project_id"),
          benchmarkId: rowString(row, "benchmark_id"),
          deploymentKey: rowString(row, "deployment_key"),
          status: rowString(row, "activation_status") as "active",
          publicSafeOnly: Boolean(row.public_safe_only) as true,
        },
        export: exportFromRow(row),
      };
    },

    async appendGrant(grant) {
      if (!grantInsert || grantInsert.recipientPrincipalId.length === 0) {
        throw new Error("Grant insert binding is unavailable.");
      }
      if (!HMAC_SHA256.test(grantInsert.tokenLookupDigest)) throw new Error("Token lookup digest is invalid.");
      const grantJson = canonicalizeRfc8785(withoutDigest(grant, "eventDigest"));
      if (rawSha256(grantJson) !== grant.eventDigest) throw new Error("Grant event digest does not bind stored JSON.");
      await client.query(
        `INSERT INTO tokenless_benchmark_research_grants
         (workspace_id,project_id,benchmark_id,activation_reference,deployment_key,grant_id,schema_version,
          export_id,export_digest,agreement_id,agreement_version,agreement_accepted_at,recipient_principal_id,
          purpose,scopes_json,data_classification,agreement_status,access_basis,access_class,token_lookup_key_id,
          token_lookup_digest,recipient_binding_key_id,recipient_binding_digest,authorization_digest,grant_json,
          event_digest,authorized_by,issued_at,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'public_safe','accepted',
                 'accepted_contractual_public_safe_benchmark_agreement','contractual_public_safe_benchmark_research',
                 $16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
        [
          grant.workspaceId,
          grant.projectId,
          grant.benchmarkId,
          grant.activationReference,
          grant.deploymentKey,
          grant.grantId,
          grant.schemaVersion,
          grant.exportId,
          grant.exportDigest,
          grant.recipientAgreement.agreementId,
          grant.recipientAgreement.version,
          new Date(grant.recipientAgreement.acceptedAt),
          grantInsert.recipientPrincipalId,
          grant.purpose,
          canonicalizeRfc8785(grant.scopes),
          grantInsert.tokenLookupKeyId,
          grantInsert.tokenLookupDigest,
          grant.recipientBindingKeyId,
          grant.recipientBindingDigest,
          grant.authorizationDigest,
          grantJson,
          grant.eventDigest,
          grant.authorizedBy,
          new Date(grant.issuedAt),
          new Date(grant.expiresAt),
        ],
      );
    },

    async authorizeGrantRevocationForUpdate(request) {
      const result = await client.query(
        `SELECT transaction_timestamp() AS transaction_time,g.workspace_id,g.project_id,g.grant_json,g.event_digest,
                r.revocation_json,r.event_digest AS revocation_event_digest,w.status AS workspace_status,
                p.status AS project_status,m.role AS manager_role,manager.status AS manager_status
           FROM tokenless_benchmark_research_grants g
           JOIN tokenless_workspaces w ON w.workspace_id=g.workspace_id
           JOIN tokenless_assurance_projects p ON p.workspace_id=g.workspace_id AND p.project_id=g.project_id
           JOIN tokenless_workspace_members m
             ON m.workspace_id=g.workspace_id AND m.account_address=$1
           JOIN tokenless_principals manager ON manager.principal_id=m.account_address
           LEFT JOIN tokenless_benchmark_research_revocations r ON r.grant_id=g.grant_id
          WHERE g.grant_id=$2
          FOR UPDATE OF g,w,p,m,manager`,
        [request.authenticatedManagerPrincipalId, request.grantId],
      );
      const row = result.rows[0] as Row | undefined;
      if (!row) return null;
      return {
        transactionTime: rowDate(row, "transaction_time"),
        manager: {
          principalId: request.authenticatedManagerPrincipalId,
          workspaceId: rowString(row, "workspace_id"),
          status: rowString(row, "manager_status") as "active",
          role: rowString(row, "manager_role") as "owner" | "admin",
        },
        workspace: {
          workspaceId: rowString(row, "workspace_id"),
          status: rowString(row, "workspace_status") as "active",
        },
        project: {
          projectId: rowString(row, "project_id"),
          workspaceId: rowString(row, "workspace_id"),
          status: rowString(row, "project_status") as "active",
        },
        state: { grant: grantFromRow(row), revocation: revocationFromRow(row) },
      };
    },

    async appendRevocation(revocation) {
      const revocationJson = canonicalizeRfc8785(withoutDigest(revocation, "eventDigest"));
      if (rawSha256(revocationJson) !== revocation.eventDigest) {
        throw new Error("Revocation event digest does not bind stored JSON.");
      }
      await client.query(
        `INSERT INTO tokenless_benchmark_research_revocations
         (workspace_id,project_id,grant_id,grant_event_digest,schema_version,reason,revocation_json,event_digest,
          revoked_by,revoked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          revocation.workspaceId,
          revocation.projectId,
          revocation.grantId,
          revocation.grantEventDigest,
          revocation.schemaVersion,
          revocation.reason,
          revocationJson,
          revocation.eventDigest,
          revocation.revokedBy,
          new Date(revocation.revokedAt),
        ],
      );
    },
  };
}

async function loadPostgresGrantAccessContext(
  client: PoolClient,
  request: {
    grantId: string;
    authenticatedRecipientPrincipalId: string;
    expectedGrantEventDigest?: string;
    expectedExportDigest?: string;
    expectedAuthorizationDigest?: string;
  },
  lock: boolean,
): Promise<BenchmarkResearchGrantAccessContext | null> {
  const result = await client.query(
    `SELECT transaction_timestamp() AS transaction_time,
            g.workspace_id,g.project_id,g.benchmark_id,g.grant_json,g.event_digest,g.authorization_digest,
            x.export_json,x.export_digest,b.activation_reference,b.deployment_key,
            b.status AS activation_status,b.public_safe_only,
            a.agreement_id,a.agreement_version,a.status AS agreement_status,a.accepted_at,a.purpose,
            a.data_classification,recipient.status AS recipient_status,w.status AS workspace_status,
            p.status AS project_status,r.revocation_json,r.event_digest AS revocation_event_digest
       FROM tokenless_benchmark_research_grants g
       JOIN tokenless_benchmark_research_approved_exports x
         ON x.workspace_id=g.workspace_id AND x.export_id=g.export_id AND x.export_digest=g.export_digest
       JOIN tokenless_benchmark_activations b
         ON b.workspace_id=g.workspace_id AND b.project_id=g.project_id AND b.benchmark_id=g.benchmark_id
        AND b.activation_reference=g.activation_reference AND b.deployment_key=g.deployment_key
       JOIN tokenless_benchmark_research_agreement_acceptances a
         ON a.workspace_id=g.workspace_id AND a.project_id=g.project_id AND a.benchmark_id=g.benchmark_id
        AND a.agreement_id=g.agreement_id AND a.agreement_version=g.agreement_version
        AND a.recipient_principal_id=g.recipient_principal_id AND a.purpose=g.purpose
        AND a.accepted_at=g.agreement_accepted_at
       JOIN tokenless_principals recipient ON recipient.principal_id=g.recipient_principal_id
       JOIN tokenless_workspaces w ON w.workspace_id=g.workspace_id
       JOIN tokenless_assurance_projects p ON p.workspace_id=g.workspace_id AND p.project_id=g.project_id
       LEFT JOIN tokenless_benchmark_research_revocations r ON r.grant_id=g.grant_id
      WHERE g.grant_id=$1 AND g.recipient_principal_id=$2
        AND ($3::text IS NULL OR g.event_digest=$3)
        AND ($4::text IS NULL OR g.export_digest=$4)
        AND ($5::text IS NULL OR g.authorization_digest=$5)
      ${lock ? "FOR UPDATE OF g,x,b,a,recipient,w,p" : ""}`,
    [
      request.grantId,
      request.authenticatedRecipientPrincipalId,
      request.expectedGrantEventDigest ?? null,
      request.expectedExportDigest ?? null,
      request.expectedAuthorizationDigest ?? null,
    ],
  );
  const row = result.rows[0] as Row | undefined;
  if (!row) return null;
  return {
    transactionTime: rowDate(row, "transaction_time"),
    recipient: {
      principalId: request.authenticatedRecipientPrincipalId,
      status: rowString(row, "recipient_status") as "active",
      agreement: {
        agreementId: rowString(row, "agreement_id"),
        version: Number(row.agreement_version),
        status: rowString(row, "agreement_status") as "accepted",
        acceptedAt: rowDate(row, "accepted_at").toISOString(),
        workspaceId: rowString(row, "workspace_id"),
        projectId: rowString(row, "project_id"),
        benchmarkId: rowString(row, "benchmark_id"),
        purpose: rowString(row, "purpose") as BenchmarkResearchPurpose,
        dataClassification: rowString(row, "data_classification") as "public_safe",
      },
    },
    workspace: {
      workspaceId: rowString(row, "workspace_id"),
      status: rowString(row, "workspace_status") as "active",
    },
    project: {
      projectId: rowString(row, "project_id"),
      workspaceId: rowString(row, "workspace_id"),
      status: rowString(row, "project_status") as "active",
    },
    activation: {
      activationReference: rowString(row, "activation_reference"),
      workspaceId: rowString(row, "workspace_id"),
      projectId: rowString(row, "project_id"),
      benchmarkId: rowString(row, "benchmark_id"),
      deploymentKey: rowString(row, "deployment_key"),
      status: rowString(row, "activation_status") as "active",
      publicSafeOnly: Boolean(row.public_safe_only) as true,
    },
    export: exportFromRow(row),
    state: { grant: grantFromRow(row), revocation: revocationFromRow(row) },
  };
}

function accessAuditReceiptFromRow(row: Row): BenchmarkResearchGrantAccessAuditReceipt {
  return {
    schemaVersion: "rateloop.benchmark-research-access-audit-receipt.v1",
    persistenceState: "staged_not_committed",
    accessId: rowString(row, "access_id"),
    idempotencyKey: rowString(row, "idempotency_key"),
    auditDigest: rowString(row, "audit_digest") as `sha256:${string}`,
    auditEventId: rowString(row, "audit_event_id"),
    auditEventDigest: rowString(row, "audit_event_digest") as `sha256:${string}`,
    previousEventDigest: rowString(row, "previous_event_digest") as `sha256:${string}`,
    chainHeadDigest: rowString(row, "chain_head_digest") as `sha256:${string}`,
  };
}

function replaySnapshotFromRow(row: Row): BenchmarkResearchGrantAccessSnapshot {
  const requestBindingJson = rowString(row, "request_binding_json");
  const requestBindingDigest = rowString(row, "request_binding_digest") as `sha256:${string}`;
  const auditJson = rowString(row, "audit_json");
  const auditDigest = rowString(row, "audit_digest") as `sha256:${string}`;
  const bytes = new Uint8Array(row.response_bytes as Uint8Array);
  const accessedAt = rowDate(row, "accessed_at").toISOString();
  if (
    rawSha256(requestBindingJson) !== requestBindingDigest ||
    rawSha256(auditJson) !== auditDigest ||
    rawSha256(bytes) !== rowString(row, "bytes_digest")
  ) {
    throw new Error("Persisted benchmark research replay evidence failed digest verification.");
  }
  const audit = {
    ...parseJson<Omit<BenchmarkResearchGrantAccessAudit, "auditDigest">>(auditJson, "access audit"),
    auditDigest,
  };
  if (
    audit.accessId !== rowString(row, "access_id") ||
    audit.idempotencyKey !== rowString(row, "idempotency_key") ||
    audit.requestBindingDigest !== requestBindingDigest ||
    audit.viewDigest !== rowString(row, "view_digest") ||
    audit.accessedAt !== accessedAt
  ) {
    throw new Error("Persisted benchmark research replay audit does not bind the original response.");
  }
  return {
    schemaVersion: "rateloop.benchmark-research-access-snapshot.v1",
    binding: parseJson(requestBindingJson, "request binding"),
    requestBindingDigest,
    accessedAt,
    viewDigest: rowString(row, "view_digest") as `sha256:${string}`,
    bytesDigest: rowString(row, "bytes_digest") as `sha256:${string}`,
    bytes,
    auditReceipt: accessAuditReceiptFromRow(row),
  };
}

function createPostgresGrantReadTransaction(client: PoolClient): BenchmarkResearchGrantReadTransaction {
  return {
    async loadCommittedAccessReplayForUpdate(request) {
      const grantLookupDigest = lookupDigest(GRANT_LOOKUP_DOMAIN, request.grantId);
      const result = await client.query(
        `SELECT s.*,a.audit_json,a.view_digest
           FROM tokenless_benchmark_research_access_snapshots s
           JOIN tokenless_benchmark_research_access_audits a ON a.access_id=s.access_id
          WHERE s.access_id=$1
             OR (s.grant_lookup_digest=$2 AND s.recipient_lookup_digest=$3 AND s.idempotency_key=$4)
          ORDER BY s.access_id
          FOR UPDATE OF s,a`,
        [request.accessId, grantLookupDigest, request.recipientLookupDigest, request.idempotencyKey],
      );
      const rows = result.rows as Row[];
      if (rows.length === 0) return null;
      const exact = rows.find(
        row =>
          rowString(row, "access_id") === request.accessId &&
          rowString(row, "grant_lookup_digest") === grantLookupDigest &&
          rowString(row, "recipient_lookup_digest") === request.recipientLookupDigest &&
          rowString(row, "idempotency_key") === request.idempotencyKey,
      );
      if (!exact || rows.length !== 1) {
        return {
          result: "conflict",
          existingRequestBindingDigest: rowString(rows[0], "request_binding_digest") as `sha256:${string}`,
        } satisfies BenchmarkResearchGrantAccessReplayLookup;
      }
      return { result: "exact_replay", snapshot: replaySnapshotFromRow(exact) };
    },

    async loadActiveGrantAccessContext(request) {
      return loadPostgresGrantAccessContext(client, request, false);
    },

    async recheckActiveGrantAccessContextForUpdate(request) {
      return loadPostgresGrantAccessContext(client, request, true);
    },

    async appendSuccessfulAccessAudit(audit, snapshot) {
      const auditJson = canonicalizeRfc8785(withoutDigest(audit, "auditDigest"));
      const requestBindingJson = canonicalizeRfc8785(snapshot.binding);
      if (
        rawSha256(auditJson) !== audit.auditDigest ||
        rawSha256(requestBindingJson) !== snapshot.requestBindingDigest ||
        rawSha256(snapshot.bytes) !== snapshot.bytesDigest
      ) {
        throw new Error("Benchmark research access evidence does not bind its persisted bytes.");
      }
      const grantResult = await client.query(
        "SELECT recipient_principal_id FROM tokenless_benchmark_research_grants WHERE grant_id=$1 FOR SHARE",
        [audit.grantId],
      );
      const grantRow = grantResult.rows[0] as Row | undefined;
      if (!grantRow) throw new Error("Benchmark research grant disappeared before audit append.");
      const recipientPrincipalId = rowString(grantRow, "recipient_principal_id");
      const grantLookupDigest = lookupDigest(GRANT_LOOKUP_DOMAIN, audit.grantId);
      const recipientLookupDigest = lookupDigest(RECIPIENT_LOOKUP_DOMAIN, recipientPrincipalId);
      const occurredAt = new Date(audit.accessedAt);
      const event = await appendAuditEvent(
        {
          workspaceId: audit.workspaceId,
          actorKind: "principal",
          actorReference: recipientPrincipalId,
          assuranceMethod: "authenticated_benchmark_research_recipient",
          action: "benchmark_research_export_read",
          targetKind: "benchmark_research_grant",
          targetId: audit.grantId,
          purpose: "contractual_public_safe_benchmark_research",
          reason: "authorized_public_safe_projection",
          requestCorrelation: audit.accessId,
          result: "success",
          metadata: {
            auditDigest: audit.auditDigest,
            projection: audit.projection,
            requestBindingDigest: audit.requestBindingDigest,
            viewDigest: audit.viewDigest,
          },
          occurredAt,
          idempotencyKey: `benchmark-research-access:${audit.accessId}`,
        },
        client,
      );
      const previousEventDigest = event.previousDigest as `sha256:${string}`;
      const eventDigest = event.eventDigest as `sha256:${string}`;
      await client.query(
        `INSERT INTO tokenless_benchmark_research_access_audits
         (access_id,idempotency_key,workspace_id,project_id,benchmark_id,grant_id,grant_event_digest,export_id,
          export_digest,recipient_principal_id,recipient_binding_digest,authorization_digest,grant_lookup_digest,
          recipient_lookup_digest,purpose,scopes_json,projection,request_binding_json,request_binding_digest,
          components_json,view_digest,accessed_at,audit_json,audit_digest,audit_event_id,audit_event_digest,
          previous_event_digest,chain_head_digest)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
                 $25,$26,$27,$26)`,
        [
          audit.accessId,
          audit.idempotencyKey,
          audit.workspaceId,
          audit.projectId,
          audit.benchmarkId,
          audit.grantId,
          audit.grantEventDigest,
          audit.exportId,
          audit.exportDigest,
          recipientPrincipalId,
          audit.recipientBindingDigest,
          audit.authorizationDigest,
          grantLookupDigest,
          recipientLookupDigest,
          audit.purpose,
          canonicalizeRfc8785(audit.scopes),
          audit.projection,
          requestBindingJson,
          audit.requestBindingDigest,
          canonicalizeRfc8785(audit.components),
          audit.viewDigest,
          occurredAt,
          auditJson,
          audit.auditDigest,
          event.eventId,
          eventDigest,
          previousEventDigest,
        ],
      );
      await client.query(
        `INSERT INTO tokenless_benchmark_research_access_snapshots
         (access_id,grant_lookup_digest,recipient_lookup_digest,idempotency_key,request_binding_json,
          request_binding_digest,accessed_at,view_digest,bytes_digest,response_bytes,audit_digest,audit_event_id,
          audit_event_digest,previous_event_digest,chain_head_digest)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$13)`,
        [
          audit.accessId,
          grantLookupDigest,
          recipientLookupDigest,
          audit.idempotencyKey,
          requestBindingJson,
          snapshot.requestBindingDigest,
          occurredAt,
          snapshot.viewDigest,
          snapshot.bytesDigest,
          Buffer.from(snapshot.bytes),
          audit.auditDigest,
          event.eventId,
          eventDigest,
          previousEventDigest,
        ],
      );
      return {
        schemaVersion: "rateloop.benchmark-research-access-audit-receipt.v1",
        persistenceState: "staged_not_committed",
        accessId: audit.accessId,
        idempotencyKey: audit.idempotencyKey,
        auditDigest: audit.auditDigest,
        auditEventId: event.eventId,
        auditEventDigest: eventDigest,
        previousEventDigest,
        chainHeadDigest: eventDigest,
      } satisfies BenchmarkResearchGrantAccessAuditReceipt;
    },

    async appendDeniedAccessAudit(audit) {
      const denialJson = canonicalizeRfc8785(withoutDigest(audit, "denialDigest"));
      if (rawSha256(denialJson) !== audit.denialDigest) {
        throw new Error("Benchmark research denial digest does not bind stored JSON.");
      }
      const occurredAt = await transactionTime(client);
      const event = await appendSecurityAuditEvent(
        {
          scopeKind: "system",
          scopeId: "benchmark-research-access",
          actorKind: "system",
          actorReference: "benchmark-research-access",
          assuranceMethod: "hash_only_access_probe",
          action: "benchmark_research_export_read_denied",
          targetKind: "benchmark_research_access_probe",
          targetId: audit.requestLookupDigest,
          purpose: "contractual_public_safe_benchmark_research",
          reason: audit.reason,
          requestCorrelation: audit.accessId,
          result: "denied",
          metadata: {
            denialDigest: audit.denialDigest,
            grantLookupDigest: audit.grantLookupDigest,
            recipientLookupDigest: audit.recipientLookupDigest,
          },
          occurredAt,
        },
        client,
      );
      const eventDigest = event.eventDigest as `sha256:${string}`;
      const previousEventDigest = event.previousDigest as `sha256:${string}`;
      const denialId = `brd_${createHash("sha256")
        .update(`${audit.denialDigest}\0${event.eventId}`)
        .digest("hex")
        .slice(0, 40)}`;
      await client.query(
        `INSERT INTO tokenless_benchmark_research_denied_access_audits
         (denial_id,workspace_id,access_id,idempotency_key,request_lookup_digest,grant_lookup_digest,
          recipient_lookup_digest,page_offset,page_limit,reason,denial_json,denial_digest,security_scope_kind,
          security_scope_id,security_event_id,security_event_digest,previous_event_digest,chain_head_digest,recorded_at)
         VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'system','benchmark-research-access',$12,$13,$14,$13,$15)`,
        [
          denialId,
          audit.accessId,
          audit.idempotencyKey,
          audit.requestLookupDigest,
          audit.grantLookupDigest,
          audit.recipientLookupDigest,
          audit.page.offset,
          audit.page.limit,
          audit.reason,
          denialJson,
          audit.denialDigest,
          event.eventId,
          eventDigest,
          previousEventDigest,
          occurredAt,
        ],
      );
      return {
        schemaVersion: "rateloop.benchmark-research-denied-access-audit-receipt.v1",
        persistenceState: "staged_not_committed",
        accessId: audit.accessId,
        idempotencyKey: audit.idempotencyKey,
        denialDigest: audit.denialDigest,
        denialEventId: event.eventId,
        denialEventDigest: eventDigest,
        previousEventDigest,
        chainHeadDigest: eventDigest,
      } satisfies BenchmarkResearchGrantDeniedAccessAuditReceipt;
    },
  };
}

async function withPostgresCommittedTransaction<T>(
  pool: PoolLike,
  work: (client: PoolClient) => Promise<{ value: T; stagedEventDigest: `sha256:${string}` | null }>,
) {
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const transactionIdentity = await client.query("SELECT txid_current()::text AS transaction_id");
    const staged = await work(client);
    await client.query("COMMIT");
    committed = true;
    const committedClock = await client.query("SELECT clock_timestamp() AS committed_at");
    return {
      value: staged.value,
      transactionId: `brtx_${rowString(transactionIdentity.rows[0] as Row, "transaction_id")}`,
      committedAt: rowDate(committedClock.rows[0] as Row, "committed_at").toISOString(),
      stagedEventDigest: staged.stagedEventDigest,
    };
  } catch (error) {
    if (!committed) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function createPostgresCommittedReadExecutor(pool: PoolLike) {
  return {
    async withCommittedTransaction<T>(work: (transaction: BenchmarkResearchGrantReadTransaction) => Promise<T>) {
      const committed = await withPostgresCommittedTransaction(pool, async client => {
        const value = await work(createPostgresGrantReadTransaction(client));
        const outcome = value as {
          kind?: string;
          snapshot?: BenchmarkResearchGrantAccessSnapshot;
          receipt?: BenchmarkResearchGrantDeniedAccessAuditReceipt;
        };
        return {
          value,
          stagedEventDigest:
            outcome.kind === "staged_success"
              ? (outcome.snapshot?.auditReceipt.auditEventDigest ?? null)
              : outcome.kind === "staged_denial"
                ? (outcome.receipt?.denialEventDigest ?? null)
                : null,
        };
      });
      return {
        value: committed.value,
        commitReceipt: {
          schemaVersion: "rateloop.benchmark-research-transaction-commit-receipt.v1" as const,
          status: "committed" as const,
          transactionId: committed.transactionId,
          committedAt: committed.committedAt,
          stagedEventDigest: committed.stagedEventDigest,
        },
      };
    },
  };
}

export const __benchmarkResearchPersistenceTestUtils = {
  deriveCapabilityIssuanceIdempotency,
  genesisDigest: GENESIS_DIGEST,
  grantLookupDomain: GRANT_LOOKUP_DOMAIN,
  recipientLookupDomain: RECIPIENT_LOOKUP_DOMAIN,
  requireExactApprovedExportWitness,
  tokenLookupDomain: TOKEN_LOOKUP_DOMAIN,
  withPostgresCommittedTransaction,
};
