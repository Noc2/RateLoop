import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import type { Hex } from "viem";
import { dbPool } from "~~/lib/db";
import {
  type CanonicalPublicRaterResponse,
  type PublicRaterRationaleRequirement,
  type PublicRaterResponseInput,
  normalizePublicRaterResponse,
} from "~~/lib/tokenless/rater/publicResponse";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const KEY_DOMAIN = "public_rater_response";
type Row = Record<string, unknown>;

export type PublicRaterResponseKeyring = { currentVersion: string; keys: Map<string, Buffer> };
let keyringOverride: PublicRaterResponseKeyring | null = null;

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function loadKeyring(): PublicRaterResponseKeyring {
  if (keyringOverride) return keyringOverride;
  const prefix = "TOKENLESS_PUBLIC_RATER_RESPONSE_VAULT";
  if (process.env[`NEXT_PUBLIC_${prefix}_KEYS`] || process.env[`NEXT_PUBLIC_${prefix}_KEY_VERSION`]) {
    throw new Error(`${prefix} keys must never use NEXT_PUBLIC variables.`);
  }
  const currentVersion = process.env[`${prefix}_KEY_VERSION`]?.trim();
  const encodedKeys = process.env[`${prefix}_KEYS`]?.trim();
  if (!currentVersion || !encodedKeys) {
    throw new TokenlessServiceError("The public response vault is unavailable.", 503, "response_vault_unavailable");
  }
  let source: Record<string, string>;
  try {
    source = JSON.parse(encodedKeys) as Record<string, string>;
  } catch {
    throw new Error(`${prefix}_KEYS must be a JSON object of base64url keys.`);
  }
  const keys = new Map<string, Buffer>();
  for (const [version, encoded] of Object.entries(source)) {
    const key = Buffer.from(encoded, "base64url");
    if (key.length !== 32) throw new Error(`${prefix} key ${version} must contain exactly 32 bytes.`);
    keys.set(version, key);
  }
  if (!keys.has(currentVersion)) throw new Error(`${prefix} current key version is missing.`);
  return { currentVersion, keys };
}

function payloadDigest(payload: CanonicalPublicRaterResponse) {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

function aad(input: { voucherId: string; operationKey: string; responseHash: string; digest: string }) {
  return `${KEY_DOMAIN}:${input.operationKey}:${input.voucherId}:${input.responseHash}:${input.digest}`;
}

function encryptPayload(
  payload: CanonicalPublicRaterResponse,
  binding: { voucherId: string; operationKey: string; responseHash: string; digest: string },
) {
  const keyring = loadKeyring();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyring.keys.get(keyring.currentVersion)!, nonce);
  cipher.setAAD(Buffer.from(aad(binding)));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return {
    ciphertext: `v1.${nonce.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`,
    keyRef: `${KEY_DOMAIN}:${keyring.currentVersion}`,
  };
}

function decryptPayload(row: Row): CanonicalPublicRaterResponse {
  const keyRef = rowString(row, "key_ref")!;
  const version = keyRef.startsWith(`${KEY_DOMAIN}:`) ? keyRef.slice(KEY_DOMAIN.length + 1) : "";
  const key = loadKeyring().keys.get(version);
  if (!key) throw new Error(`Public response vault key ${version} is unavailable.`);
  const parts = rowString(row, "payload_ciphertext")!.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Public response ciphertext is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
  decipher.setAAD(
    Buffer.from(
      aad({
        voucherId: rowString(row, "voucher_id")!,
        operationKey: rowString(row, "operation_key")!,
        responseHash: rowString(row, "response_hash")!,
        digest: rowString(row, "payload_digest")!,
      }),
    ),
  );
  decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
  return JSON.parse(
    Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8"),
  ) as CanonicalPublicRaterResponse;
}

/**
 * Resolve one already-authorized Feedback Bonus body without exposing a
 * general-purpose response-vault decrypt primitive. The opportunity join is
 * the tenant and lane binding; callers cannot use a response id from another
 * workspace, opportunity, or public operation.
 */
export async function readFeedbackBonusPublicRaterResponse(input: {
  responseId: string;
  workspaceId: string;
  opportunityId: string;
  expectedResponseHash: string;
}) {
  const result = await dbPool.query(
    `SELECT response.*
     FROM tokenless_public_rater_responses response
     JOIN tokenless_agent_review_opportunities opportunity
       ON opportunity.operation_key = response.operation_key
      AND opportunity.workspace_id = $2
      AND opportunity.opportunity_id = $3
     WHERE response.response_id = $1
       AND response.response_hash = $4
       AND response.hash_verified_at IS NOT NULL
       AND response.moderation_status = 'approved'
     LIMIT 2`,
    [input.responseId, input.workspaceId, input.opportunityId, input.expectedResponseHash.toLowerCase()],
  );
  if (result.rowCount !== 1) {
    throw new TokenlessServiceError(
      "The selected public feedback body is unavailable.",
      409,
      "feedback_bonus_body_unavailable",
    );
  }
  const feedback = decryptPayload(result.rows[0] as Row).feedback;
  const body = feedback?.body.trim() ?? "";
  if (!body) {
    throw new TokenlessServiceError(
      "The selected public response has no awardable written feedback.",
      409,
      "feedback_bonus_body_unavailable",
    );
  }
  return body;
}

export async function preparePublicRaterResponse(
  client: PoolClient,
  input: {
    voucherId: string;
    operationKey: string;
    questionId: string;
    roundId: string;
    contentId: Hex;
    voteKey: string;
    rationale?: PublicRaterRationaleRequirement;
    response: PublicRaterResponseInput;
    now: Date;
  },
) {
  let normalized: ReturnType<typeof normalizePublicRaterResponse>;
  try {
    normalized = normalizePublicRaterResponse(input, input.response);
  } catch (error) {
    throw new TokenlessServiceError(
      error instanceof Error ? error.message : "Feedback is invalid.",
      400,
      "invalid_public_rater_response",
    );
  }
  const digest = payloadDigest(normalized.canonical);
  const previous = await client.query(
    "SELECT * FROM tokenless_public_rater_responses WHERE voucher_id = $1 FOR UPDATE",
    [input.voucherId],
  );
  const previousRow = previous.rows[0] as Row | undefined;
  if (previousRow) {
    if (
      rowString(previousRow, "payload_digest") !== digest ||
      rowString(previousRow, "response_hash") !== normalized.responseHash
    ) {
      throw new TokenlessServiceError(
        "This voucher already has a different feedback record.",
        409,
        "public_rater_response_conflict",
      );
    }
    return { responseHash: normalized.responseHash, payloadDigest: digest };
  }
  const encrypted = encryptPayload(normalized.canonical, {
    voucherId: input.voucherId,
    operationKey: input.operationKey,
    responseHash: normalized.responseHash,
    digest,
  });
  await client.query(
    `INSERT INTO tokenless_public_rater_responses
      (response_id, voucher_id, operation_key, question_id, round_id, content_id, vote_key, response_hash,
       payload_digest, payload_ciphertext, key_ref, moderation_status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12, $12)`,
    [
      `rrs_${randomUUID().replaceAll("-", "")}`,
      input.voucherId,
      input.operationKey,
      input.questionId,
      input.roundId,
      input.contentId.toLowerCase(),
      input.voteKey.toLowerCase(),
      normalized.responseHash,
      digest,
      encrypted.ciphertext,
      encrypted.keyRef,
      input.now,
    ],
  );
  return { responseHash: normalized.responseHash, payloadDigest: digest };
}

export async function verifyPublicRaterResponseCommitments(input: {
  operationKey: string;
  reveals: Array<{ voteKey: string; responseHash: Hex }>;
  now?: Date;
}) {
  const reveals = new Map(input.reveals.map(value => [value.voteKey.toLowerCase(), value.responseHash.toLowerCase()]));
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const responses = await client.query(
      "SELECT response_id, vote_key, response_hash FROM tokenless_public_rater_responses WHERE operation_key = $1 FOR UPDATE",
      [input.operationKey],
    );
    let verified = 0;
    for (const row of responses.rows as Row[]) {
      if (reveals.get(rowString(row, "vote_key")!.toLowerCase()) !== rowString(row, "response_hash")!.toLowerCase()) {
        continue;
      }
      await client.query(
        "UPDATE tokenless_public_rater_responses SET hash_verified_at = $1, updated_at = $1 WHERE response_id = $2",
        [input.now ?? new Date(), rowString(row, "response_id")],
      );
      verified += 1;
    }
    await client.query("COMMIT");
    return verified;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listAuthorizedTerminalPublicFeedback(input: { operationKey: string; terminal: boolean }) {
  if (!input.terminal) return { items: [], redactedCount: 0 };
  const result = await dbPool.query(
    `SELECT r.* FROM tokenless_public_rater_responses r
     WHERE r.operation_key = $1
       AND r.hash_verified_at IS NOT NULL
     ORDER BY r.created_at ASC`,
    [input.operationKey],
  );
  const items: Array<{ category: string; body: string; sourceUrl: string | null }> = [];
  let redactedCount = 0;
  for (const row of result.rows as Row[]) {
    if (rowString(row, "moderation_status") !== "approved") {
      redactedCount += 1;
      continue;
    }
    try {
      const payload = decryptPayload(row);
      if (payload.feedback) items.push(payload.feedback);
    } catch {
      redactedCount += 1;
    }
  }
  return { items, redactedCount };
}

export async function listPendingPublicRaterResponses(limit = 50) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new TokenlessServiceError("Moderation limit is invalid.", 400, "invalid_moderation_limit");
  }
  const result = await dbPool.query(
    `SELECT * FROM tokenless_public_rater_responses
     WHERE moderation_status = 'pending' ORDER BY created_at ASC LIMIT $1`,
    [limit],
  );
  return (result.rows as Row[]).map(row => ({
    responseId: rowString(row, "response_id")!,
    operationKey: rowString(row, "operation_key")!,
    createdAt: new Date(String(row.created_at)).toISOString(),
    feedback: decryptPayload(row).feedback,
  }));
}

export function __setPublicRaterResponseKeyringForTests(value: PublicRaterResponseKeyring | null) {
  keyringOverride = value;
}
