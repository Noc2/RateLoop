import { createHash } from "node:crypto";
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
  verifyAssuranceDsseEnvelope,
} from "~~/lib/tokenless/assuranceAttestations";
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
  publish(input: { envelope: DsseEnvelope; statement: AssuranceAttestationStatement }): Promise<{
    entryUuid: string;
    logIndex: string;
    inclusionBundle: Record<string, unknown>;
  }>;
};

export type Rfc3161TimestampAuthority = {
  timestamp(input: { artifactDigest: string; boundaryAt: string }): Promise<{ token: Buffer }>;
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
    if (canonicalAttestationJson(statement) !== String(value)) throw new Error();
    return statement;
  } catch {
    throw new TokenlessServiceError(
      "Stored attestation statement is invalid.",
      500,
      "stored_assurance_attestation_invalid",
    );
  }
}

function jsonObject(value: unknown, field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError(`${field} is invalid.`, 502, "invalid_external_attestation_receipt");
  }
  return value as Record<string, unknown>;
}

export async function enqueueAssuranceAttestation(input: {
  workspaceId: string;
  kind: AssuranceAttestationKind;
  artifactDigest: string;
  artifactSchemaVersion: string;
  boundaryAt: Date;
  now?: Date;
}) {
  const boundaryAt = validDate(input.boundaryAt, "Attestation boundary");
  const now = validDate(input.now ?? new Date(), "Attestation queue time");
  const statement = createAssuranceAttestationStatement({
    kind: input.kind,
    artifactDigest: input.artifactDigest,
    artifactSchemaVersion: input.artifactSchemaVersion,
    boundaryAt,
  });
  const statementJson = canonicalAttestationJson(statement);
  const jobId = deterministicJobId({ workspaceId: input.workspaceId, kind: input.kind, digest: input.artifactDigest });
  const replayCandidate = await dbClient.execute({
    sql: `SELECT job_id,statement_json FROM tokenless_assurance_attestation_jobs
          WHERE workspace_id=? AND artifact_kind=? AND artifact_digest=? LIMIT 1`,
    args: [input.workspaceId, input.kind, input.artifactDigest],
  });
  const replayRow = replayCandidate.rows[0] as Row | undefined;
  if (replayRow) {
    if (text(replayRow, "job_id") !== jobId || text(replayRow, "statement_json") !== statementJson) {
      throw new TokenlessServiceError(
        "The artifact digest is already bound to different attestation metadata.",
        409,
        "assurance_attestation_conflict",
      );
    }
    return { jobId, replay: true };
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
      jobId,
      input.workspaceId,
      input.kind,
      input.artifactSchemaVersion,
      input.artifactDigest,
      boundaryAt,
      statementJson,
      now,
      now,
      now,
      input.workspaceId,
    ],
  });
  if (inserted.rows.length === 1) return { jobId, replay: false };
  const existing = await dbClient.execute({
    sql: `SELECT job_id,statement_json FROM tokenless_assurance_attestation_jobs
          WHERE workspace_id=? AND artifact_kind=? AND artifact_digest=? LIMIT 1`,
    args: [input.workspaceId, input.kind, input.artifactDigest],
  });
  const row = existing.rows[0] as Row | undefined;
  if (!row) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  if (text(row, "job_id") !== jobId || text(row, "statement_json") !== statementJson) {
    throw new TokenlessServiceError(
      "The artifact digest is already bound to different attestation metadata.",
      409,
      "assurance_attestation_conflict",
    );
  }
  return { jobId, replay: true };
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

export async function countDueAssuranceAttestationJobs(now = new Date()) {
  const due = await dbClient.execute({
    sql: `SELECT COUNT(*) AS count FROM tokenless_assurance_attestation_jobs
          WHERE ((state IN ('pending','retry') AND next_attempt_at<=?)
                 OR (state='processing' AND lease_expires_at<=?))`,
    args: [validDate(now, "Attestation queue time"), now],
  });
  const count = Number((due.rows[0] as Row | undefined)?.count ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Database returned an invalid attestation job count.");
  return count;
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
      canonicalAttestationJson(envelope) !== text(row, "dsse_envelope_json") ||
      canonicalAttestationJson(rekorBundle) !== text(row, "rekor_bundle_json")
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

async function publishClaimedAttestation(input: {
  row: Row;
  signerKeyId: string;
  envelope: DsseEnvelope;
  statement: AssuranceAttestationStatement;
  rekor: RekorPublisher;
  tsa: Rfc3161TimestampAuthority;
  now: Date;
}) {
  const jobId = text(input.row, "job_id")!;
  const leaseGeneration = storedInteger(input.row, "lease_generation");
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const fence = await client.query(
      `SELECT job_id FROM tokenless_assurance_attestation_jobs
       WHERE job_id=$1 AND state='processing' AND lease_generation=$2 AND claim_signer_key_id=$3
       FOR UPDATE`,
      [jobId, leaseGeneration, input.signerKeyId],
    );
    if (fence.rows.length !== 1) {
      await client.query("COMMIT");
      return false;
    }
    // Keep the exact job generation locked through public witness calls. An
    // expired worker can finish signing, but it cannot publish after a newer
    // generation has reclaimed the job.
    const rekor = validateRekorReceipt(
      await input.rekor.publish({ envelope: input.envelope, statement: input.statement }),
    );
    const isExport = text(input.row, "artifact_kind") !== "decision_packet";
    const timestamp = isExport
      ? await input.tsa.timestamp({
          artifactDigest: text(input.row, "artifact_digest")!,
          boundaryAt: new Date(String(input.row.boundary_at)).toISOString(),
        })
      : null;
    if (timestamp && (!Buffer.isBuffer(timestamp.token) || timestamp.token.byteLength < 32)) {
      throw new TokenlessServiceError("RFC 3161 token is invalid.", 502, "invalid_external_attestation_receipt");
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
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
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

export async function processAssuranceAttestationJobs(input: {
  signer: ManagedAttestationSigner;
  rekor: RekorPublisher;
  tsa: Rfc3161TimestampAuthority;
  now?: Date;
  limit?: number;
  workspaceId?: string;
}) {
  validateManagedSigner(input.signer);
  const now = validDate(input.now ?? new Date(), "Attestation processing time");
  const workspaceFilter = input.workspaceId ? "AND workspace_id=?" : "";
  const due = await dbClient.execute({
    sql: `SELECT job_id
          FROM tokenless_assurance_attestation_jobs
          WHERE ((state IN ('pending','retry') AND next_attempt_at<=?)
                 OR (state='processing' AND lease_expires_at<=?))
            AND attempt_count<? AND lease_generation<2147483647
          ${workspaceFilter}
          ORDER BY next_attempt_at ASC,job_id ASC LIMIT ?`,
    args: [
      now,
      now,
      MAX_ATTEMPTS,
      ...(input.workspaceId ? [input.workspaceId] : []),
      Math.min(Math.max(input.limit ?? 25, 1), 100),
    ],
  });
  const outcomes: Array<{ jobId: string; state: "completed" | "retry" | "dead" }> = [];
  for (const value of due.rows) {
    const jobId = text(value as Row, "job_id")!;
    const claimed = await dbClient.execute({
      sql: `UPDATE tokenless_assurance_attestation_jobs
            SET state='processing',lease_expires_at=?,lease_generation=lease_generation+1,
                claim_signer_key_id=?,attempt_count=attempt_count+1,updated_at=?
            WHERE job_id=? AND ((state IN ('pending','retry') AND next_attempt_at<=?)
              OR (state='processing' AND lease_expires_at<=?))
              AND attempt_count<? AND lease_generation<2147483647
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
