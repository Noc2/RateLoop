import { createHash, randomBytes } from "node:crypto";
import "server-only";
import { dbPool } from "~~/lib/db";
import { appendSecurityAuditEvent } from "~~/lib/privacy/audit";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const ACTION = "passkey_add" as const;
const PROOF_TTL_MS = 5 * 60_000;
const PROOF_PATTERN = /^pkp_[A-Za-z0-9_-]{43}$/u;

export const PASSKEY_ACTION_PROOF_HEADER = "x-rateloop-passkey-action-proof";

function proofHash(proof: string) {
  return `sha256:${createHash("sha256").update(proof).digest("hex")}`;
}

function actionProofRequired(): never {
  throw new TokenlessServiceError(
    "Verify your sign-in again before adding a passkey.",
    401,
    "passkey_action_proof_required",
  );
}

export async function issuePasskeyAddProof(input: {
  authenticationMethod?: string | null;
  betterAuthUserId: string;
  now?: Date;
  principalId: string;
}) {
  const now = input.now ?? new Date();
  const proof = `pkp_${randomBytes(32).toString("base64url")}`;
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
    if (principal.rowCount !== 1 || binding.rowCount !== 1) actionProofRequired();
    await client.query(
      `DELETE FROM tokenless_passkey_action_proofs
       WHERE principal_id = $1 AND action = 'passkey_add'`,
      [input.principalId],
    );
    await client.query(
      `INSERT INTO tokenless_passkey_action_proofs
       (proof_hash, principal_id, better_auth_user_id, action, authentication_method,
        expires_at, consumed_at, created_at)
       VALUES ($1, $2, $3, 'passkey_add', $4, $5, NULL, $6)`,
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

export async function consumePasskeyAddProof(input: { betterAuthUserId: string; now?: Date; proof: unknown }) {
  const now = input.now ?? new Date();
  if (typeof input.proof !== "string" || !PROOF_PATTERN.test(input.proof)) actionProofRequired();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const consumed = await client.query(
      `UPDATE tokenless_passkey_action_proofs SET consumed_at = $1
       WHERE proof_hash = $2 AND better_auth_user_id = $3 AND action = 'passkey_add'
         AND consumed_at IS NULL AND expires_at > $4
         AND principal_id IN (
           SELECT principal_id FROM tokenless_identity_bindings
           WHERE provider = 'better_auth' AND provider_subject = $5 AND status = 'active'
         )
       RETURNING principal_id, authentication_method`,
      [now, proofHash(input.proof), input.betterAuthUserId, now, input.betterAuthUserId],
    );
    if (consumed.rowCount !== 1) actionProofRequired();
    const principalId = String(consumed.rows[0]?.principal_id);
    const authenticationMethod =
      typeof consumed.rows[0]?.authentication_method === "string"
        ? consumed.rows[0].authentication_method
        : "better_auth";
    await appendSecurityAuditEvent(
      {
        action: "account.passkey_add_authorization_consumed",
        actorKind: "principal",
        actorReference: principalId,
        assuranceMethod: authenticationMethod,
        metadata: { action: ACTION },
        purpose: "passkey_management",
        reason: "one_time_proof_consumed",
        result: "success",
        scopeId: principalId,
        scopeKind: "identity",
        targetId: principalId,
        targetKind: "principal",
      },
      client,
    );
    await client.query("COMMIT");
    return { principalId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const __passkeyActionProofInternals = { PROOF_TTL_MS, proofHash };
