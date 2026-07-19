import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import { appendSecurityAuditEvent } from "~~/lib/privacy/audit";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const ACTION = "account_deletion" as const;
const AUTH_MAX_AGE_MS = 5 * 60_000;
const PROOF_TTL_MS = 5 * 60_000;
const FUTURE_CLOCK_SKEW_MS = 60_000;
const PROOF_PATTERN = /^rap_[A-Za-z0-9_-]{43}$/;

function proofHash(proof: string) {
  return `sha256:${createHash("sha256").update(proof).digest("hex")}`;
}

function recentAuthenticationRequired(): never {
  throw new TokenlessServiceError("Sign in again before deleting this account.", 401, "recent_authentication_required");
}

export async function issueAccountDeletionProof(input: {
  authenticatedAt: Date;
  authenticationMethod?: string | null;
  betterAuthUserId: string;
  now?: Date;
  principalId: string;
}) {
  const now = input.now ?? new Date();
  const authenticatedAt = input.authenticatedAt;
  if (
    !Number.isFinite(authenticatedAt.getTime()) ||
    authenticatedAt.getTime() < now.getTime() - AUTH_MAX_AGE_MS ||
    authenticatedAt.getTime() > now.getTime() + FUTURE_CLOCK_SKEW_MS
  ) {
    recentAuthenticationRequired();
  }
  const proof = `rap_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(now.getTime() + PROOF_TTL_MS);
  const authenticationMethod = input.authenticationMethod?.trim().slice(0, 120) || null;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const principal = await client.query(
      `SELECT principal_id FROM tokenless_principals
       WHERE principal_id = $1 AND status = 'active' FOR UPDATE`,
      [input.principalId],
    );
    const binding = await client.query(
      `SELECT binding_id FROM tokenless_identity_bindings
       WHERE principal_id = $1 AND provider = 'better_auth' AND provider_subject = $2
         AND status = 'active' LIMIT 1`,
      [input.principalId, input.betterAuthUserId],
    );
    if (principal.rowCount !== 1 || binding.rowCount !== 1) recentAuthenticationRequired();
    await client.query(
      `DELETE FROM tokenless_recent_account_action_proofs
       WHERE principal_id = $1 AND action = 'account_deletion'`,
      [input.principalId],
    );
    await client.query(
      `INSERT INTO tokenless_recent_account_action_proofs
       (proof_hash, principal_id, action, better_auth_user_id, authentication_method,
        expires_at, consumed_at, created_at)
       VALUES ($1, $2, 'account_deletion', $3, $4, $5, NULL, $6)`,
      [proofHash(proof), input.principalId, input.betterAuthUserId, authenticationMethod, expiresAt, now],
    );
    await client.query("COMMIT");
    return { expiresAt, proof };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function parsedProof(value: unknown) {
  if (typeof value !== "string" || !PROOF_PATTERN.test(value)) recentAuthenticationRequired();
  return value;
}

export async function lockAccountDeletionProof(
  input: { now?: Date; principalId: string; proof: unknown },
  client: PoolClient,
) {
  const now = input.now ?? new Date();
  const proof = parsedProof(input.proof);
  const locked = await client.query(
    `SELECT better_auth_user_id, authentication_method
     FROM tokenless_recent_account_action_proofs
     WHERE proof_hash = $1 AND principal_id = $2 AND action = 'account_deletion'
       AND consumed_at IS NULL AND expires_at > $3
     FOR UPDATE`,
    [proofHash(proof), input.principalId, now],
  );
  if (locked.rowCount !== 1) recentAuthenticationRequired();
  const row = locked.rows[0] as Record<string, unknown> | undefined;
  const betterAuthUserId = typeof row?.better_auth_user_id === "string" ? row.better_auth_user_id : "";
  if (!betterAuthUserId) recentAuthenticationRequired();
  return {
    authenticationMethod: typeof row?.authentication_method === "string" ? row.authentication_method : "better_auth",
    betterAuthUserId,
    proof,
  };
}

export async function consumeLockedAccountDeletionProof(
  input: {
    authenticationMethod: string;
    betterAuthUserId: string;
    now?: Date;
    principalId: string;
    proof: string;
  },
  client: PoolClient,
) {
  const now = input.now ?? new Date();
  const consumed = await client.query(
    `UPDATE tokenless_recent_account_action_proofs SET consumed_at = $1
     WHERE proof_hash = $2 AND principal_id = $3 AND action = 'account_deletion'
       AND better_auth_user_id = $4 AND consumed_at IS NULL AND expires_at > $5
     RETURNING proof_hash`,
    [now, proofHash(parsedProof(input.proof)), input.principalId, input.betterAuthUserId, now],
  );
  if (consumed.rowCount !== 1) recentAuthenticationRequired();
  await appendSecurityAuditEvent(
    {
      action: "account.deletion_recent_auth_consumed",
      actorKind: "principal",
      actorReference: input.principalId,
      assuranceMethod: input.authenticationMethod,
      metadata: { action: ACTION },
      purpose: "account_deletion",
      reason: "one_time_proof_consumed",
      result: "success",
      scopeId: input.principalId,
      scopeKind: "identity",
      targetId: input.principalId,
      targetKind: "principal",
    },
    client,
  );
  return { betterAuthUserId: input.betterAuthUserId };
}

export async function consumeAccountDeletionProof(input: { now?: Date; principalId: string; proof: unknown }) {
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const locked = await lockAccountDeletionProof({ ...input, now }, client);
    const consumed = await consumeLockedAccountDeletionProof(
      { ...locked, now, principalId: input.principalId },
      client,
    );
    await client.query("COMMIT");
    return consumed;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const __recentAccountActionProofInternals = { AUTH_MAX_AGE_MS, PROOF_TTL_MS, proofHash };
