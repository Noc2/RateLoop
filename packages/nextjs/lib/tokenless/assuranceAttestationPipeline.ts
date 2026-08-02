import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient, dbPool } from "~~/lib/db";
import {
  type AssuranceAttestationKind,
  type AssuranceAttestationStatement,
  type DsseEnvelope,
  canonicalAttestationJson,
  createAssuranceAttestationStatement,
  createAssuranceDsseEnvelope,
  isCanonicalAttestationJson,
  verifyAssuranceDsseEnvelope,
} from "~~/lib/tokenless/assuranceAttestations";
import { maintenanceCancellationRequested } from "~~/lib/tokenless/maintenanceCancellation";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import {
  EXTERNAL_WITNESS_SCHEMA_VERSION,
  rfc3161BoundaryDigestHex,
} from "~~/scripts/assurance-attestation-witness-core.mjs";

const KEY_ID = /^[A-Za-z0-9:._/-]{1,200}$/u;
const REKOR_UUID = /^[A-Za-z0-9._:-]{1,200}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const MAX_ATTEMPTS = 8;
const LEASE_MS = 60_000;
const JOB_ID = /^aat_[0-9a-f]{40}$/u;

type Row = Record<string, unknown>;

export type ManagedAttestationSigner = {
  custody: "managed";
  keyId: string;
  publicKeyDer: Buffer;
  sign(payload: Buffer): Promise<Buffer>;
};

export type RekorPublisher = {
  publish(input: { envelope: DsseEnvelope; statement: AssuranceAttestationStatement; signal?: AbortSignal }): Promise<{
    entryUuid: string;
    logIndex: string;
    inclusionBundle: Record<string, unknown>;
  }>;
};

export type Rfc3161TimestampAuthority = {
  timestamp(input: { artifactDigest: string; boundaryAt: string; signal?: AbortSignal }): Promise<{ token: Buffer }>;
};

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function storedInteger(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TokenlessServiceError(
      "Stored attestation claim is invalid.",
      500,
      "stored_assurance_attestation_invalid",
    );
  }
  return value;
}

function deterministicJobId(input: { workspaceId: string; kind: string; digest: string }) {
  return `aat_${createHash("sha256")
    .update([input.workspaceId, input.kind, input.digest].join("\0"))
    .digest("hex")
    .slice(0, 40)}`;
}

function validDate(value: Date, field: string) {
  if (!Number.isFinite(value.getTime())) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_assurance_attestation");
  }
  return value;
}

function parseStatement(value: unknown): AssuranceAttestationStatement {
  try {
    const statement = JSON.parse(String(value)) as AssuranceAttestationStatement;
    if (!isCanonicalAttestationJson(statement, String(value))) throw new Error();
    return statement;
  } catch {
    throw new TokenlessServiceError(
      "Stored attestation statement is invalid.",
      500,
      "stored_assurance_attestation_invalid",
    );
  }
}

type AssuranceAttestationEnqueueInput = {
  workspaceId: string;
  kind: AssuranceAttestationKind;
  artifactDigest: string;
  artifactSchemaVersion: string;
  boundaryAt: Date;
  now?: Date;
};

type NormalizedAssuranceAttestationEnqueue = AssuranceAttestationEnqueueInput & {
  boundaryAt: Date;
  now: Date;
  jobId: string;
  statementJson: string;
};

function normalizeAssuranceAttestationEnqueue(
  input: AssuranceAttestationEnqueueInput,
): NormalizedAssuranceAttestationEnqueue {
  const boundaryAt = validDate(input.boundaryAt, "Attestation boundary");
  const now = validDate(input.now ?? new Date(), "Attestation queue time");
  const statement = createAssuranceAttestationStatement({
    kind: input.kind,
    artifactDigest: input.artifactDigest,
    artifactSchemaVersion: input.artifactSchemaVersion,
    boundaryAt,
  });
  return {
    ...input,
    boundaryAt,
    now,
    jobId: deterministicJobId({ workspaceId: input.workspaceId, kind: input.kind, digest: input.artifactDigest }),
    statementJson: canonicalAttestationJson(statement),
  };
}

function validateExistingAssuranceAttestation(row: Row | undefined, expected: NormalizedAssuranceAttestationEnqueue) {
  if (!row) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  if (text(row, "job_id") !== expected.jobId || text(row, "statement_json") !== expected.statementJson) {
    throw new TokenlessServiceError(
      "The artifact digest is already bound to different attestation metadata.",
      409,
      "assurance_attestation_conflict",
    );
  }
  return { jobId: expected.jobId, replay: true as const };
}

function jsonObject(value: unknown, field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError(`${field} is invalid.`, 502, "invalid_external_attestation_receipt");
  }
  return value as Record<string, unknown>;
}

export async function enqueueAssuranceAttestation(input: AssuranceAttestationEnqueueInput) {
  const normalized = normalizeAssuranceAttestationEnqueue(input);
  const replayCandidate = await dbClient.execute({
    sql: `SELECT job_id,statement_json FROM tokenless_assurance_attestation_jobs
          WHERE workspace_id=? AND artifact_kind=? AND artifact_digest=? LIMIT 1`,
    args: [input.workspaceId, input.kind, input.artifactDigest],
  });
  const replayRow = replayCandidate.rows[0] as Row | undefined;
  if (replayRow) {
    return validateExistingAssuranceAttestation(replayRow, normalized);
  }
  const inserted = await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_attestation_jobs
          (job_id,workspace_id,artifact_kind,artifact_schema_version,artifact_digest,boundary_at,
           statement_json,state,attempt_count,next_attempt_at,created_at,updated_at)
          SELECT ?,?,?,?,?,CAST(? AS timestamptz),?,'pending',0,
                 CAST(? AS timestamptz),CAST(? AS timestamptz),CAST(? AS timestamptz)
          WHERE EXISTS (SELECT 1 FROM tokenless_workspaces WHERE workspace_id=? AND status='active')
          ON CONFLICT (workspace_id,artifact_kind,artifact_digest) DO NOTHING
          RETURNING job_id`,
    args: [
      normalized.jobId,
      normalized.workspaceId,
      normalized.kind,
      normalized.artifactSchemaVersion,
      normalized.artifactDigest,
      normalized.boundaryAt,
      normalized.statementJson,
      normalized.now,
      normalized.now,
      normalized.now,
      normalized.workspaceId,
    ],
  });
  if (inserted.rows.length === 1) return { jobId: normalized.jobId, replay: false as const };
  const existing = await dbClient.execute({
    sql: `SELECT job_id,statement_json FROM tokenless_assurance_attestation_jobs
          WHERE workspace_id=? AND artifact_kind=? AND artifact_digest=? LIMIT 1`,
    args: [normalized.workspaceId, normalized.kind, normalized.artifactDigest],
  });
  return validateExistingAssuranceAttestation(existing.rows[0] as Row | undefined, normalized);
}

export async function enqueueAssuranceAttestationInTransaction(
  input: AssuranceAttestationEnqueueInput & { now: Date },
  client: PoolClient,
) {
  const normalized = normalizeAssuranceAttestationEnqueue(input);
  const replayCandidate = await client.query(
    `SELECT job_id,statement_json FROM tokenless_assurance_attestation_jobs
     WHERE workspace_id=$1 AND artifact_kind=$2 AND artifact_digest=$3 LIMIT 1`,
    [normalized.workspaceId, normalized.kind, normalized.artifactDigest],
  );
  const replayRow = replayCandidate.rows[0] as Row | undefined;
  if (replayRow) return validateExistingAssuranceAttestation(replayRow, normalized);
  const inserted = await client.query(
    `INSERT INTO tokenless_assurance_attestation_jobs
     (job_id,workspace_id,artifact_kind,artifact_schema_version,artifact_digest,boundary_at,
      statement_json,state,attempt_count,next_attempt_at,created_at,updated_at)
     SELECT $1,$2,$3,$4,$5,CAST($6 AS timestamptz),$7,'pending',0,
            CAST($8 AS timestamptz),CAST($8 AS timestamptz),CAST($8 AS timestamptz)
     WHERE EXISTS (SELECT 1 FROM tokenless_workspaces WHERE workspace_id=$2 AND status='active')
     ON CONFLICT (workspace_id,artifact_kind,artifact_digest) DO NOTHING
     RETURNING job_id`,
    [
      normalized.jobId,
      normalized.workspaceId,
      normalized.kind,
      normalized.artifactSchemaVersion,
      normalized.artifactDigest,
      normalized.boundaryAt,
      normalized.statementJson,
      normalized.now,
    ],
  );
  if (inserted.rowCount === 1) return { jobId: normalized.jobId, replay: false as const };
  const existing = await client.query(
    `SELECT job_id,statement_json FROM tokenless_assurance_attestation_jobs
     WHERE workspace_id=$1 AND artifact_kind=$2 AND artifact_digest=$3 LIMIT 1`,
    [normalized.workspaceId, normalized.kind, normalized.artifactDigest],
  );
  return validateExistingAssuranceAttestation(existing.rows[0] as Row | undefined, normalized);
}

export async function requireAssuranceAttestationManagement(accountAddress: string, workspaceId: string) {
  let actor: string;
  try {
    actor = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("A valid signed-in account is required.", 401, "invalid_account");
  }
  const access = await dbClient.execute({
    sql: `SELECT m.role FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id AND w.status='active'
          WHERE m.workspace_id=? AND m.account_address=? AND m.role IN ('owner','admin') LIMIT 1`,
    args: [workspaceId, actor],
  });
  if (!access.rowCount) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return actor;
}

export async function listAssuranceAttestations(input: {
  accountAddress: string;
  workspaceId: string;
  limit?: number;
}) {
  await requireAssuranceAttestationManagement(input.accountAddress, input.workspaceId);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const result = await dbClient.execute({
    sql: `SELECT job_id,artifact_kind,artifact_schema_version,artifact_digest,boundary_at,state,
                 signer_key_id,rekor_entry_uuid,rekor_log_index,tsa_token_base64,attempt_count,
                 last_error,created_at,updated_at,completed_at
          FROM tokenless_assurance_attestation_jobs WHERE workspace_id=?
          ORDER BY boundary_at DESC,job_id DESC LIMIT ?`,
    args: [input.workspaceId, limit],
  });
  return result.rows.map(value => {
    const row = value as Row;
    return {
      jobId: text(row, "job_id")!,
      artifactKind: text(row, "artifact_kind")!,
      artifactSchemaVersion: text(row, "artifact_schema_version")!,
      artifactDigest: text(row, "artifact_digest")!,
      boundaryAt: new Date(String(row.boundary_at)).toISOString(),
      state: text(row, "state")!,
      signerKeyId: text(row, "signer_key_id"),
      rekor:
        text(row, "rekor_entry_uuid") && text(row, "rekor_log_index")
          ? { entryUuid: text(row, "rekor_entry_uuid")!, logIndex: text(row, "rekor_log_index")! }
          : null,
      rfc3161TimestampPresent: Boolean(text(row, "tsa_token_base64")),
      attemptCount: Number(row.attempt_count),
      lastError: text(row, "last_error"),
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
      completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
      publicPath:
        text(row, "state") === "completed" ? `/api/public/assurance/attestations/${text(row, "job_id")!}` : null,
    };
  });
}

export async function countDueAssuranceAttestationJobsByTimestampRequirement(now = new Date()) {
  const due = await dbClient.execute({
    sql: `SELECT COUNT(*) AS count,
                 COALESCE(SUM(CASE WHEN artifact_kind='decision_packet' THEN 1 ELSE 0 END),0) AS decision_packet_count
          FROM tokenless_assurance_attestation_jobs
          WHERE ((state IN ('pending','retry') AND next_attempt_at<=?)
                 OR (state='processing' AND lease_expires_at<=?))
            AND attempt_count<? AND lease_generation<2147483647`,
    args: [validDate(now, "Attestation queue time"), now, MAX_ATTEMPTS],
  });
  const row = due.rows[0] as Row | undefined;
  const total = Number(row?.count ?? 0);
  const decisionPackets = Number(row?.decision_packet_count ?? 0);
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !Number.isSafeInteger(decisionPackets) ||
    decisionPackets < 0 ||
    decisionPackets > total
  ) {
    throw new Error("Database returned invalid attestation job counts.");
  }
  return { total, decisionPackets, timestampedExports: total - decisionPackets };
}

export async function countDueAssuranceAttestationJobs(now = new Date()) {
  return (await countDueAssuranceAttestationJobsByTimestampRequirement(now)).total;
}

export async function getPublicAssuranceAttestationBundle(jobId: string) {
  if (!JOB_ID.test(jobId)) {
    throw new TokenlessServiceError("Attestation not found.", 404, "assurance_attestation_not_found");
  }
  const result = await dbClient.execute({
    sql: `SELECT job_id,artifact_kind,artifact_schema_version,artifact_digest,boundary_at,statement_json,
                 signer_key_id,dsse_envelope_json,rekor_entry_uuid,rekor_log_index,rekor_bundle_json,
                 tsa_token_base64,completed_at
          FROM tokenless_assurance_attestation_jobs WHERE job_id=? AND state='completed' LIMIT 1`,
    args: [jobId],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new TokenlessServiceError("Attestation not found.", 404, "assurance_attestation_not_found");
  const statement = parseStatement(row.statement_json);
  let envelope: DsseEnvelope;
  let rekorBundle: Record<string, unknown>;
  try {
    envelope = JSON.parse(text(row, "dsse_envelope_json") ?? "") as DsseEnvelope;
    rekorBundle = JSON.parse(text(row, "rekor_bundle_json") ?? "") as Record<string, unknown>;
    if (
      !isCanonicalAttestationJson(envelope, text(row, "dsse_envelope_json") ?? "") ||
      !isCanonicalAttestationJson(rekorBundle, text(row, "rekor_bundle_json") ?? "")
    ) {
      throw new Error();
    }
  } catch {
    throw new TokenlessServiceError(
      "Stored external witness bundle is invalid.",
      500,
      "stored_assurance_attestation_invalid",
    );
  }
  const boundaryAt = new Date(String(row.boundary_at)).toISOString();
  const artifactKind = text(row, "artifact_kind") as AssuranceAttestationKind;
  const artifactDigest = text(row, "artifact_digest")!;
  const timestamp = text(row, "tsa_token_base64");
  return {
    schemaVersion: EXTERNAL_WITNESS_SCHEMA_VERSION,
    jobId,
    artifact: {
      kind: artifactKind,
      schemaVersion: text(row, "artifact_schema_version")!,
      digest: artifactDigest,
      boundaryAt,
    },
    statement,
    dsse: { signerKeyId: text(row, "signer_key_id")!, envelope },
    rekor: {
      entryUuid: text(row, "rekor_entry_uuid")!,
      logIndex: text(row, "rekor_log_index")!,
      bundle: rekorBundle,
    },
    rfc3161:
      timestamp === null
        ? null
        : {
            messageImprint: {
              algorithm: "sha256" as const,
              digest: rfc3161BoundaryDigestHex({ artifactDigest, boundaryAt }),
            },
            tokenBase64: timestamp,
          },
    completedAt: new Date(String(row.completed_at)).toISOString(),
  };
}

function validateManagedSigner(signer: ManagedAttestationSigner) {
  if (signer.custody !== "managed" || !KEY_ID.test(signer.keyId) || !Buffer.isBuffer(signer.publicKeyDer)) {
    throw new TokenlessServiceError(
      "External attestation requires a managed signing key.",
      503,
      "managed_attestation_signer_required",
      true,
    );
  }
}

function validateRekorReceipt(receipt: {
  entryUuid: string;
  logIndex: string;
  inclusionBundle: Record<string, unknown>;
}) {
  if (!REKOR_UUID.test(receipt.entryUuid) || !DECIMAL.test(receipt.logIndex)) {
    throw new TokenlessServiceError("Rekor receipt is invalid.", 502, "invalid_external_attestation_receipt");
  }
  return {
    ...receipt,
    inclusionBundle: jsonObject(receipt.inclusionBundle, "Rekor inclusion bundle"),
  };
}

async function attestationClaimIsCurrent(input: { jobId: string; leaseGeneration: number; signerKeyId: string }) {
  const fence = await dbClient.execute({
    sql: `SELECT job_id FROM tokenless_assurance_attestation_jobs
          WHERE job_id=? AND state='processing' AND lease_generation=? AND claim_signer_key_id=?
          LIMIT 1`,
    args: [input.jobId, input.leaseGeneration, input.signerKeyId],
  });
  return fence.rows.length === 1;
}

async function publishClaimedAttestation(input: {
  row: Row;
  signerKeyId: string;
  envelope: DsseEnvelope;
  statement: AssuranceAttestationStatement;
  rekor: RekorPublisher;
  tsa?: Rfc3161TimestampAuthority;
  now: Date;
  signal?: AbortSignal;
}) {
  const jobId = text(input.row, "job_id")!;
  const leaseGeneration = storedInteger(input.row, "lease_generation");
  const claim = { jobId, leaseGeneration, signerKeyId: input.signerKeyId };
  if (!(await attestationClaimIsCurrent(claim))) return false;

  // Provider calls can outlive the claim lease, so they must never retain a
  // checked-out connection or row lock. Rekor publication is content-addressed
  // and its adapter resolves an existing-entry conflict as the same receipt.
  const rekor = validateRekorReceipt(
    await input.rekor.publish({
      envelope: input.envelope,
      statement: input.statement,
      signal: input.signal,
    }),
  );
  if (!(await attestationClaimIsCurrent(claim))) return false;

  const isExport = text(input.row, "artifact_kind") !== "decision_packet";
  if (isExport && !input.tsa) {
    throw new TokenlessServiceError(
      "RFC 3161 timestamping is unavailable for export attestations.",
      503,
      "attestation_timestamping_unavailable",
      true,
    );
  }
  const timestamp = isExport
    ? await input.tsa!.timestamp({
        artifactDigest: text(input.row, "artifact_digest")!,
        boundaryAt: new Date(String(input.row.boundary_at)).toISOString(),
        signal: input.signal,
      })
    : null;
  if (timestamp && (!Buffer.isBuffer(timestamp.token) || timestamp.token.byteLength < 32)) {
    throw new TokenlessServiceError("RFC 3161 token is invalid.", 502, "invalid_external_attestation_receipt");
  }

  const client = await dbPool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const fence = await client.query(
      `SELECT job_id FROM tokenless_assurance_attestation_jobs
       WHERE job_id=$1 AND state='processing' AND lease_generation=$2 AND claim_signer_key_id=$3
       FOR UPDATE`,
      [jobId, leaseGeneration, input.signerKeyId],
    );
    if (fence.rows.length !== 1) {
      await client.query("COMMIT");
      transactionOpen = false;
      return false;
    }
    const updated = await client.query(
      `UPDATE tokenless_assurance_attestation_jobs
       SET state='completed',signer_key_id=$1,dsse_envelope_json=$2,rekor_entry_uuid=$3,
           rekor_log_index=$4,rekor_bundle_json=$5,tsa_token_base64=$6,
           last_error=NULL,lease_expires_at=NULL,claim_signer_key_id=NULL,completed_at=$7,updated_at=$7
       WHERE job_id=$8 AND state='processing' AND lease_generation=$9 AND claim_signer_key_id=$1
       RETURNING job_id`,
      [
        input.signerKeyId,
        canonicalAttestationJson(input.envelope),
        rekor.entryUuid,
        rekor.logIndex,
        canonicalAttestationJson(rekor.inclusionBundle),
        timestamp?.token.toString("base64") ?? null,
        input.now,
        jobId,
        leaseGeneration,
      ],
    );
    if (updated.rows.length !== 1) throw new Error("Attestation job lease was lost.");
    await client.query("COMMIT");
    transactionOpen = false;
    return true;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function markAttestationClaimFailed(input: { row: Row; signerKeyId: string; error: unknown; now: Date }) {
  const attempt = storedInteger(input.row, "attempt_count");
  const dead = attempt >= MAX_ATTEMPTS;
  const failed = await dbClient.execute({
    sql: `UPDATE tokenless_assurance_attestation_jobs
          SET state=?,next_attempt_at=?,lease_expires_at=NULL,claim_signer_key_id=NULL,
              last_error=?,updated_at=?
          WHERE job_id=? AND state='processing' AND lease_generation=? AND claim_signer_key_id=?
          RETURNING job_id`,
    args: [
      dead ? "dead" : "retry",
      new Date(input.now.getTime() + Math.min(30_000 * 2 ** (attempt - 1), 3_600_000)),
      input.error instanceof Error ? input.error.message.slice(0, 500) : "Attestation failed",
      input.now,
      text(input.row, "job_id")!,
      storedInteger(input.row, "lease_generation"),
      input.signerKeyId,
    ],
  });
  return failed.rows.length === 1 ? (dead ? "dead" : "retry") : null;
}

type ProcessAssuranceAttestationJobsBase = {
  signer: ManagedAttestationSigner;
  rekor: RekorPublisher;
  now?: Date;
  limit?: number;
  workspaceId?: string;
  signal?: AbortSignal;
};

type ProcessAssuranceAttestationJobsInput = ProcessAssuranceAttestationJobsBase &
  ({ scope: "decision_packet"; tsa?: never } | { scope?: "all"; tsa: Rfc3161TimestampAuthority });

export async function processAssuranceAttestationJobs(input: ProcessAssuranceAttestationJobsInput) {
  validateManagedSigner(input.signer);
  const now = validDate(input.now ?? new Date(), "Attestation processing time");
  const workspaceFilter = input.workspaceId ? "AND workspace_id=?" : "";
  const scopeFilter = input.scope === "decision_packet" ? "AND artifact_kind='decision_packet'" : "";
  // A job killed mid-attempt on its final try can never be claimed again, because the claim
  // requires attempt_count below the cap, and can never be failed, because it never reaches the
  // failure path. It stayed due forever while the run reported healthy, since health keys off
  // retry/dead/unavailable and never off due. Retiring it here makes it counted and visible.
  const abandoned = await dbClient.execute({
    sql: `UPDATE tokenless_assurance_attestation_jobs
          SET state='dead',lease_expires_at=NULL,claim_signer_key_id=NULL,updated_at=?
          WHERE state='processing' AND lease_expires_at<=? AND attempt_count>=?
          ${workspaceFilter}
          RETURNING job_id`,
    args: [now, now, MAX_ATTEMPTS, ...(input.workspaceId ? [input.workspaceId] : [])],
  });
  const due = await dbClient.execute({
    sql: `SELECT job_id
          FROM tokenless_assurance_attestation_jobs
          WHERE ((state IN ('pending','retry') AND next_attempt_at<=?)
                 OR (state='processing' AND lease_expires_at<=?))
            AND attempt_count<? AND lease_generation<2147483647
          ${workspaceFilter}
          ${scopeFilter}
          ORDER BY next_attempt_at ASC,job_id ASC LIMIT ?`,
    args: [
      now,
      now,
      MAX_ATTEMPTS,
      ...(input.workspaceId ? [input.workspaceId] : []),
      Math.min(Math.max(input.limit ?? 25, 1), 100),
    ],
  });
  const outcomes: Array<{ jobId: string; state: "completed" | "retry" | "dead" }> = (abandoned.rows as Row[]).map(
    value => ({ jobId: text(value, "job_id")!, state: "dead" as const }),
  );
  for (const value of due.rows) {
    if (maintenanceCancellationRequested(input.signal)) break;
    const jobId = text(value as Row, "job_id")!;
    const claimed = await dbClient.execute({
      sql: `UPDATE tokenless_assurance_attestation_jobs
            SET state='processing',lease_expires_at=?,lease_generation=lease_generation+1,
                claim_signer_key_id=?,attempt_count=attempt_count+1,updated_at=?
            WHERE job_id=? AND ((state IN ('pending','retry') AND next_attempt_at<=?)
              OR (state='processing' AND lease_expires_at<=?))
              AND attempt_count<? AND lease_generation<2147483647
              ${scopeFilter}
            RETURNING job_id,workspace_id,artifact_kind,artifact_schema_version,artifact_digest,
                      boundary_at,statement_json,attempt_count,lease_generation,claim_signer_key_id`,
      args: [new Date(now.getTime() + LEASE_MS), input.signer.keyId, now, jobId, now, now, MAX_ATTEMPTS],
    });
    const row = claimed.rows[0] as Row | undefined;
    if (!row) continue;
    try {
      const statement = parseStatement(row.statement_json);
      const envelope = await createAssuranceDsseEnvelope({ statement, signer: input.signer });
      const verification = verifyAssuranceDsseEnvelope({
        envelope,
        publicKeyDer: input.signer.publicKeyDer,
        expectedKeyId: input.signer.keyId,
        expectedArtifactDigest: text(row, "artifact_digest")!,
        expectedArtifactKind: text(row, "artifact_kind") as AssuranceAttestationKind,
        expectedArtifactSchemaVersion: text(row, "artifact_schema_version")!,
      });
      if (!verification.valid) {
        throw new TokenlessServiceError("Managed signer produced invalid DSSE.", 502, "invalid_managed_signature");
      }
      const completed = await publishClaimedAttestation({
        row,
        signerKeyId: input.signer.keyId,
        envelope,
        statement,
        rekor: input.rekor,
        tsa: input.tsa,
        now,
        signal: input.signal,
      });
      if (completed) outcomes.push({ jobId, state: "completed" });
    } catch (error) {
      const failed = await markAttestationClaimFailed({
        row,
        signerKeyId: input.signer.keyId,
        error,
        now,
      });
      if (failed) outcomes.push({ jobId, state: failed });
    }
  }
  return outcomes;
}

export const __assuranceAttestationPipelineTestUtils = { deterministicJobId };
