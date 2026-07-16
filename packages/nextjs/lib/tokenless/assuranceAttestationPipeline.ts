import { createHash } from "node:crypto";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient } from "~~/lib/db";
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

const KEY_ID = /^[A-Za-z0-9:._/-]{1,200}$/u;
const REKOR_UUID = /^[A-Za-z0-9._:-]{1,200}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const MAX_ATTEMPTS = 8;
const LEASE_MS = 60_000;

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
    };
  });
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
    sql: `SELECT job_id,workspace_id,artifact_kind,artifact_schema_version,artifact_digest,boundary_at,
                 statement_json,attempt_count
          FROM tokenless_assurance_attestation_jobs
          WHERE ((state IN ('pending','retry') AND next_attempt_at<=?)
                 OR (state='processing' AND lease_expires_at<=?))
          ${workspaceFilter}
          ORDER BY next_attempt_at ASC,job_id ASC LIMIT ?`,
    args: [now, now, ...(input.workspaceId ? [input.workspaceId] : []), Math.min(Math.max(input.limit ?? 25, 1), 100)],
  });
  const outcomes: Array<{ jobId: string; state: "completed" | "retry" | "dead" }> = [];
  for (const value of due.rows) {
    const row = value as Row;
    const jobId = text(row, "job_id")!;
    const attempt = Number(row.attempt_count) + 1;
    const claimed = await dbClient.execute({
      sql: `UPDATE tokenless_assurance_attestation_jobs
            SET state='processing',lease_expires_at=?,updated_at=?
            WHERE job_id=? AND ((state IN ('pending','retry') AND next_attempt_at<=?)
              OR (state='processing' AND lease_expires_at<=?))`,
      args: [new Date(now.getTime() + LEASE_MS), now, jobId, now, now],
    });
    if (claimed.rowCount !== 1) continue;
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
      const rekor = validateRekorReceipt(await input.rekor.publish({ envelope, statement }));
      const isExport = text(row, "artifact_kind") !== "decision_packet";
      const timestamp = isExport
        ? await input.tsa.timestamp({
            artifactDigest: text(row, "artifact_digest")!,
            boundaryAt: new Date(String(row.boundary_at)).toISOString(),
          })
        : null;
      if (timestamp && (!Buffer.isBuffer(timestamp.token) || timestamp.token.byteLength < 32)) {
        throw new TokenlessServiceError("RFC 3161 token is invalid.", 502, "invalid_external_attestation_receipt");
      }
      const updated = await dbClient.execute({
        sql: `UPDATE tokenless_assurance_attestation_jobs
              SET state='completed',signer_key_id=?,dsse_envelope_json=?,rekor_entry_uuid=?,
                  rekor_log_index=?,rekor_bundle_json=?,tsa_token_base64=?,attempt_count=?,
                  last_error=NULL,lease_expires_at=NULL,completed_at=?,updated_at=?
              WHERE job_id=? AND state='processing'`,
        args: [
          input.signer.keyId,
          canonicalAttestationJson(envelope),
          rekor.entryUuid,
          rekor.logIndex,
          canonicalAttestationJson(rekor.inclusionBundle),
          timestamp?.token.toString("base64") ?? null,
          attempt,
          now,
          now,
          jobId,
        ],
      });
      if (updated.rowCount !== 1) throw new Error("Attestation job lease was lost.");
      outcomes.push({ jobId, state: "completed" });
    } catch (error) {
      const dead = attempt >= MAX_ATTEMPTS;
      await dbClient.execute({
        sql: `UPDATE tokenless_assurance_attestation_jobs
              SET state=?,attempt_count=?,next_attempt_at=?,lease_expires_at=NULL,last_error=?,updated_at=?
              WHERE job_id=? AND state='processing'`,
        args: [
          dead ? "dead" : "retry",
          attempt,
          new Date(now.getTime() + Math.min(30_000 * 2 ** (attempt - 1), 3_600_000)),
          error instanceof Error ? error.message.slice(0, 500) : "Attestation failed",
          now,
          jobId,
        ],
      });
      outcomes.push({ jobId, state: dead ? "dead" : "retry" });
    }
  }
  return outcomes;
}

export const __assuranceAttestationPipelineTestUtils = { deterministicJobId };
