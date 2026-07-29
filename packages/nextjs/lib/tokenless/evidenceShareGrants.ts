import { createHash, randomBytes, randomUUID } from "node:crypto";
import "server-only";
import { isRateLoopPrincipalId } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { loadRunAccess } from "~~/lib/tokenless/evidencePackets";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type QueryRow = Record<string, unknown>;

const GRANT_ID_PATTERN = /^esh_[A-Za-z0-9_-]{22}$/u;
const BEARER_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAX_SHARE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_ACTIVE_SHARES_PER_RUN = 20;

export type EvidenceShareGrant = {
  grantId: string;
  packetId: string;
  runId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  accessCount: number;
  lastAccessedAt: string | null;
  status: "active" | "expired" | "revoked";
};

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowDate(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error(`Stored evidence share ${key} is invalid.`);
  return date;
}

function rowCount(row: QueryRow | undefined, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Stored evidence share ${key} is invalid.`);
  }
  return value;
}

function publicGrant(row: QueryRow, now: Date): EvidenceShareGrant {
  const createdAt = rowDate(row, "created_at");
  const expiresAt = rowDate(row, "expires_at");
  const revokedAt = rowDate(row, "revoked_at");
  const lastAccessedAt = rowDate(row, "last_accessed_at");
  if (!createdAt || !expiresAt) throw new Error("Stored evidence share timestamps are invalid.");
  return {
    grantId: rowString(row, "grant_id")!,
    packetId: rowString(row, "packet_id")!,
    runId: rowString(row, "run_id")!,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    revokedAt: revokedAt?.toISOString() ?? null,
    accessCount: rowCount(row, "access_count"),
    lastAccessedAt: lastAccessedAt?.toISOString() ?? null,
    status: revokedAt ? "revoked" : expiresAt <= now ? "expired" : "active",
  };
}

function publicNotFound(): never {
  throw new TokenlessServiceError("Shared evidence packet not found.", 404, "evidence_share_not_found");
}

function tokenHash(secret: string) {
  return `sha256:${createHash("sha256").update(secret).digest("hex")}`;
}

function grantId() {
  return `esh_${randomBytes(16).toString("base64url")}`;
}

function bearerSecret() {
  return randomBytes(32).toString("base64url");
}

async function appendShareAccessLog(
  client: { query: (text: string, values?: unknown[]) => Promise<unknown> },
  input: {
    action: "share_create" | "share_revoke" | "read";
    actorKind: string;
    actorReference: string;
    grantId: string;
    projectId: string;
    runId: string;
    workspaceId: string;
    occurredAt: Date;
  },
) {
  await client.query(
    `INSERT INTO tokenless_assurance_access_logs
     (log_id,workspace_id,project_id,artifact_id,lease_id,actor_kind,actor_reference,
      action,purpose,request_reference,occurred_at)
     VALUES ($1,$2,$3,NULL,NULL,$4,$5,$6,'evidence_share',$7,$8)`,
    [
      `log_${randomUUID().replaceAll("-", "")}`,
      input.workspaceId,
      input.projectId,
      input.actorKind,
      input.actorReference,
      input.action,
      `${input.grantId}:${input.runId}`,
      input.occurredAt,
    ],
  );
}

function actorKind(value: string) {
  return isRateLoopPrincipalId(value) ? "principal" : "base_account";
}

export async function createEvidenceShareGrant(input: {
  accountAddress: string;
  workspaceId: string;
  runId: string;
  expiresAt: Date;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (
    !Number.isFinite(input.expiresAt.getTime()) ||
    input.expiresAt <= now ||
    input.expiresAt.getTime() - now.getTime() > MAX_SHARE_LIFETIME_MS
  ) {
    throw new TokenlessServiceError(
      "Evidence share expiry must be in the future and within 30 days.",
      400,
      "invalid_evidence_share_expiry",
      false,
      "expiresAt",
    );
  }

  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const { address, row: run } = await loadRunAccess(client, input, { action: "export", lock: true });
    const projectId = rowString(run, "project_id");
    if (!projectId) throw new Error("Stored assurance run project is invalid.");
    const packet = await client.query(
      `SELECT ep.packet_id
       FROM tokenless_assurance_evidence_packets ep
       JOIN tokenless_assurance_runs r ON r.run_id=ep.run_id
       JOIN tokenless_assurance_projects p
         ON p.project_id=r.project_id AND p.workspace_id=$1
       WHERE ep.run_id=$2 AND r.project_id=$3
       LIMIT 1`,
      [input.workspaceId, input.runId, projectId],
    );
    const packetId = rowString(packet.rows[0], "packet_id");
    if (!packetId) publicNotFound();
    const active = await client.query(
      `SELECT COUNT(*) AS active_count
       FROM tokenless_assurance_evidence_share_grants
       WHERE workspace_id=$1 AND project_id=$2 AND run_id=$3
         AND revoked_at IS NULL AND expires_at>$4`,
      [input.workspaceId, projectId, input.runId, now],
    );
    if (rowCount(active.rows[0], "active_count") >= MAX_ACTIVE_SHARES_PER_RUN) {
      throw new TokenlessServiceError(
        "Revoke an active evidence share before creating another.",
        409,
        "evidence_share_limit_reached",
      );
    }

    const id = grantId();
    const secret = bearerSecret();
    await client.query(
      `INSERT INTO tokenless_assurance_evidence_share_grants
       (grant_id,token_hash,workspace_id,project_id,run_id,packet_id,created_by,created_at,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, tokenHash(secret), input.workspaceId, projectId, input.runId, packetId, address, now, input.expiresAt],
    );
    await appendShareAccessLog(client, {
      action: "share_create",
      actorKind: actorKind(address),
      actorReference: address,
      grantId: id,
      projectId,
      runId: input.runId,
      workspaceId: input.workspaceId,
      occurredAt: now,
    });
    await client.query("COMMIT");
    return {
      grant: {
        grantId: id,
        packetId,
        runId: input.runId,
        createdAt: now.toISOString(),
        expiresAt: input.expiresAt.toISOString(),
        revokedAt: null,
        accessCount: 0,
        lastAccessedAt: null,
        status: "active" as const,
      },
      bearerSecret: secret,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listEvidenceShareGrants(input: {
  accountAddress: string;
  workspaceId: string;
  runId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    const { row: run } = await loadRunAccess(client, input, { action: "export" });
    const projectId = rowString(run, "project_id");
    if (!projectId) throw new Error("Stored assurance run project is invalid.");
    const result = await client.query(
      `SELECT grant_id,packet_id,run_id,created_at,expires_at,revoked_at,access_count,last_accessed_at
       FROM tokenless_assurance_evidence_share_grants
       WHERE workspace_id=$1 AND project_id=$2 AND run_id=$3
       ORDER BY created_at DESC,grant_id DESC`,
      [input.workspaceId, projectId, input.runId],
    );
    return result.rows.map(row => publicGrant(row, now));
  } finally {
    client.release();
  }
}

export async function revokeEvidenceShareGrant(input: {
  accountAddress: string;
  workspaceId: string;
  runId: string;
  grantId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const { address, row: run } = await loadRunAccess(client, input, { action: "export", lock: true });
    const projectId = rowString(run, "project_id");
    if (!projectId) throw new Error("Stored assurance run project is invalid.");
    const updated = await client.query(
      `UPDATE tokenless_assurance_evidence_share_grants
       SET revoked_at=$1
       WHERE grant_id=$2 AND workspace_id=$3 AND project_id=$4 AND run_id=$5
         AND revoked_at IS NULL
       RETURNING grant_id`,
      [now, input.grantId, input.workspaceId, projectId, input.runId],
    );
    if (!updated.rows[0]) {
      throw new TokenlessServiceError("Evidence share not found.", 404, "evidence_share_not_found");
    }
    await appendShareAccessLog(client, {
      action: "share_revoke",
      actorKind: actorKind(address),
      actorReference: address,
      grantId: input.grantId,
      projectId,
      runId: input.runId,
      workspaceId: input.workspaceId,
      occurredAt: now,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function redeemEvidenceShareGrant(input: { grantId: string; bearerSecret: string; now?: Date }) {
  if (!GRANT_ID_PATTERN.test(input.grantId) || !BEARER_SECRET_PATTERN.test(input.bearerSecret)) {
    publicNotFound();
  }
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT g.workspace_id,g.project_id,g.run_id,g.packet_id,ep.packet_digest,ep.packet_json
       FROM tokenless_assurance_evidence_share_grants g
       JOIN tokenless_workspaces w
         ON w.workspace_id=g.workspace_id AND w.status='active'
       JOIN tokenless_assurance_projects p
         ON p.workspace_id=g.workspace_id AND p.project_id=g.project_id AND p.status<>'deleted'
       JOIN tokenless_assurance_runs r
         ON r.project_id=g.project_id AND r.run_id=g.run_id
       JOIN tokenless_assurance_evidence_packets ep
         ON ep.run_id=g.run_id AND ep.packet_id=g.packet_id
       WHERE g.grant_id=$1 AND g.token_hash=$2
         AND g.revoked_at IS NULL AND g.expires_at>$3
       FOR UPDATE`,
      [input.grantId, tokenHash(input.bearerSecret), now],
    );
    const row = result.rows[0];
    if (!row) publicNotFound();
    const workspaceId = rowString(row, "workspace_id")!;
    const projectId = rowString(row, "project_id")!;
    const runId = rowString(row, "run_id")!;
    let packet: unknown;
    try {
      packet = JSON.parse(String(row.packet_json));
    } catch {
      throw new Error("Stored evidence packet JSON is invalid.");
    }
    const packetRecord =
      packet && typeof packet === "object" && !Array.isArray(packet) ? (packet as Record<string, unknown>) : null;
    const payload =
      packetRecord?.payload && typeof packetRecord.payload === "object" && !Array.isArray(packetRecord.payload)
        ? (packetRecord.payload as Record<string, unknown>)
        : null;
    if (
      !packetRecord ||
      !payload ||
      payload.runId !== runId ||
      payload.packetId !== rowString(row, "packet_id") ||
      packetRecord.packetDigest !== rowString(row, "packet_digest")
    ) {
      throw new Error("Stored evidence packet identity is invalid.");
    }
    await client.query(
      `UPDATE tokenless_assurance_evidence_share_grants
       SET access_count=access_count+1,last_accessed_at=$1
       WHERE grant_id=$2`,
      [now, input.grantId],
    );
    await appendShareAccessLog(client, {
      action: "read",
      actorKind: "public_share",
      actorReference: input.grantId,
      grantId: input.grantId,
      projectId,
      runId,
      workspaceId,
      occurredAt: now,
    });
    await client.query("COMMIT");
    return packet;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
