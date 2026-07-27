import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbClient } from "~~/lib/db";
import { isResendConfigured, sendWorkspaceReviewerInvitationEmail } from "~~/lib/notifications/resend";

type Row = Record<string, unknown>;
type DeliveryState = "dead" | "delivered" | "parked" | "retry" | "suppressed";

const MAX_ATTEMPTS = 8;
const STALE_CLAIM_MS = 10 * 60_000;
const DEV_ONLY_KEY = createHash("sha256").update("rateloop-invitation-email-development-only").digest();

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function deliveryId(invitationId: string) {
  return `wried_${digest(invitationId).slice(0, 40)}`;
}

function bounded(value: number | undefined) {
  if (value === undefined) return 20;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invitation email worker limit is invalid.");
  return Math.min(value, 50);
}

function retryAt(now: Date, attempt: number) {
  const delayMs = Math.min(30_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 7), 3_600_000);
  return new Date(now.getTime() + delayMs);
}

function decodeRootKey(value: string | undefined, env: NodeJS.ProcessEnv) {
  const normalized = value?.trim();
  if (!normalized) {
    if (env.NODE_ENV === "production" || env.VERCEL === "1") {
      throw new Error("TOKENLESS_ARTIFACT_MASTER_KEY is required for invitation email encryption.");
    }
    return DEV_ONLY_KEY;
  }
  const decoded = /^[0-9a-fA-F]{64}$/u.test(normalized)
    ? Buffer.from(normalized, "hex")
    : Buffer.from(normalized, "base64url");
  if (decoded.byteLength !== 32) {
    throw new Error("TOKENLESS_ARTIFACT_MASTER_KEY must encode exactly 32 bytes.");
  }
  return decoded;
}

function payloadKey(env: NodeJS.ProcessEnv = process.env) {
  return createHash("sha256")
    .update("rateloop-workspace-reviewer-invitation-email-v1\0")
    .update(decodeRootKey(env.TOKENLESS_ARTIFACT_MASTER_KEY, env))
    .digest();
}

function payloadKeyVersion(env: NodeJS.ProcessEnv = process.env) {
  return `invitation-email-v1:${env.TOKENLESS_ARTIFACT_KEY_VERSION?.trim() || "artifact-v1"}`;
}

function payloadAad(workspaceId: string, invitationId: string) {
  return Buffer.from(`workspace-reviewer-invitation-email:v1:${workspaceId}:${invitationId}`);
}

function encryptPayload(
  input: { email: string; invitationId: string; token: string; workspaceId: string },
  env: NodeJS.ProcessEnv = process.env,
) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", payloadKey(env), nonce);
  cipher.setAAD(payloadAad(input.workspaceId, input.invitationId));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ email: input.email, token: input.token }), "utf8"),
    cipher.final(),
  ]);
  return `v1.${nonce.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString(
    "base64url",
  )}`;
}

function decryptPayload(
  ciphertext: string,
  input: { invitationId: string; workspaceId: string },
  env: NodeJS.ProcessEnv = process.env,
) {
  const [version, nonce, authTag, content] = ciphertext.split(".");
  if (version !== "v1" || !nonce || !authTag || !content) throw new Error("Invitation email payload is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", payloadKey(env), Buffer.from(nonce, "base64url"));
  decipher.setAAD(payloadAad(input.workspaceId, input.invitationId));
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));
  const parsed = JSON.parse(
    Buffer.concat([decipher.update(Buffer.from(content, "base64url")), decipher.final()]).toString("utf8"),
  ) as { email?: unknown; token?: unknown };
  if (typeof parsed.email !== "string" || typeof parsed.token !== "string") {
    throw new Error("Invitation email payload is invalid.");
  }
  return { email: parsed.email, token: parsed.token };
}

function appOrigin(value: string) {
  const parsed = new URL(value);
  const isLocalHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !isLocalHttp) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Invitation email app origin is invalid.");
  }
  return parsed.origin;
}

function configuration(input: {
  appOrigin: string;
  env?: NodeJS.ProcessEnv;
  send?: typeof sendWorkspaceReviewerInvitationEmail;
}) {
  const env = input.env ?? process.env;
  try {
    const origin = appOrigin(input.appOrigin);
    payloadKey(env);
    if (!input.send && !isResendConfigured()) throw new Error("Resend is not configured");
    return { error: null, origin };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Invitation email configuration is invalid.",
      origin: null,
    };
  }
}

/** See delivery.ts: only locally detectable configuration may park, or the unpark sweep loops. */
function isConfigurationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message === "Resend is not configured" ||
    message.startsWith("TOKENLESS_ARTIFACT_MASTER_KEY ") ||
    message === "Invitation email app origin is invalid." ||
    message === "Invitation email payload key version is unavailable."
  );
}

function destinationUrl(token: string, origin: string) {
  const destination = new URL("/human", origin);
  destination.searchParams.set("tab", "discover");
  destination.searchParams.set("invite", "1");
  destination.hash = `invite=${encodeURIComponent(token)}`;
  return destination;
}

export async function enqueueWorkspaceReviewerInvitationEmailInTransaction(
  client: PoolClient,
  input: {
    email: string;
    invitationId: string;
    now: Date;
    token: string;
    workspaceId: string;
  },
) {
  const id = deliveryId(input.invitationId);
  const ciphertext = encryptPayload(input);
  await client.query(
    `INSERT INTO tokenless_workspace_reviewer_invitation_email_deliveries
     (delivery_id,workspace_id,invitation_id,payload_ciphertext,payload_key_version,state,attempt_count,
      next_attempt_at,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,'pending',0,$6,$6,$6)
     ON CONFLICT (invitation_id) DO NOTHING`,
    [id, input.workspaceId, input.invitationId, ciphertext, payloadKeyVersion(), input.now],
  );
  return { deliveryId: id, status: "queued" as const };
}

export async function deliverPendingWorkspaceReviewerInvitationEmails(input: {
  appOrigin: string;
  env?: NodeJS.ProcessEnv;
  limit?: number;
  now?: Date;
  send?: typeof sendWorkspaceReviewerInvitationEmail;
}) {
  const now = input.now ?? new Date();
  const limit = bounded(input.limit);
  const configured = configuration(input);
  if (!configured.error) {
    await dbClient.execute({
      sql: `UPDATE tokenless_workspace_reviewer_invitation_email_deliveries
            SET state='retry',next_attempt_at=?,last_error=NULL,parked_at=NULL,updated_at=?
            WHERE state='parked'`,
      args: [now, now],
    });
  }
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_reviewer_invitation_email_deliveries
          SET state='retry',next_attempt_at=?,last_error='stale invitation email claim recovered',updated_at=?
          WHERE state='delivering' AND updated_at <= ?`,
    args: [now, now, new Date(now.getTime() - STALE_CLAIM_MS)],
  });
  const outcomes: Array<{ deliveryId: string; state: DeliveryState }> = [];
  const unavailable = await dbClient.execute({
    sql: `SELECT d.delivery_id
          FROM tokenless_workspace_reviewer_invitation_email_deliveries d
          JOIN tokenless_workspace_reviewer_invitations i ON i.invitation_id=d.invitation_id
          WHERE d.state IN ('pending','retry','parked')
            AND (i.revoked_at IS NOT NULL OR i.expires_at <= ? OR i.redemption_count >= i.maximum_redemptions)
          ORDER BY d.created_at,d.delivery_id LIMIT ?`,
    args: [now, limit],
  });
  for (const value of unavailable.rows) {
    const id = rowString(value as Row, "delivery_id")!;
    const suppressed = await dbClient.execute({
      sql: `UPDATE tokenless_workspace_reviewer_invitation_email_deliveries
            SET state='suppressed',payload_ciphertext=NULL,payload_key_version=NULL,next_attempt_at=NULL,
                last_error=NULL,parked_at=NULL,suppressed_at=?,updated_at=?
            WHERE delivery_id=? AND state IN ('pending','retry','parked')`,
      args: [now, now, id],
    });
    if (suppressed.rowCount === 1) outcomes.push({ deliveryId: id, state: "suppressed" });
  }
  const due = await dbClient.execute({
    sql: `SELECT d.delivery_id,d.workspace_id,d.invitation_id,d.payload_ciphertext,d.payload_key_version,
                 d.attempt_count,i.token_hash,i.intended_email_hash,i.expires_at,i.revoked_at,
                 i.redemption_count,i.maximum_redemptions
          FROM tokenless_workspace_reviewer_invitation_email_deliveries d
          JOIN tokenless_workspace_reviewer_invitations i ON i.invitation_id=d.invitation_id
          WHERE d.state IN ('pending','retry') AND d.next_attempt_at <= ?
          ORDER BY d.next_attempt_at,d.created_at,d.delivery_id LIMIT ?`,
    args: [now, limit],
  });
  for (const value of due.rows) {
    const row = value as Row;
    const id = rowString(row, "delivery_id")!;
    const claimed = await dbClient.execute({
      sql: `UPDATE tokenless_workspace_reviewer_invitation_email_deliveries
            SET state='delivering',next_attempt_at=NULL,updated_at=?
            WHERE delivery_id=? AND state IN ('pending','retry') AND next_attempt_at <= ?`,
      args: [now, id, now],
    });
    if (claimed.rowCount !== 1) continue;
    const invitationUnavailable =
      row.revoked_at !== null ||
      new Date(String(row.expires_at)).getTime() <= now.getTime() ||
      Number(row.redemption_count) >= Number(row.maximum_redemptions);
    if (invitationUnavailable) {
      await dbClient.execute({
        sql: `UPDATE tokenless_workspace_reviewer_invitation_email_deliveries
              SET state='suppressed',payload_ciphertext=NULL,payload_key_version=NULL,
                  last_error=NULL,suppressed_at=?,updated_at=?
              WHERE delivery_id=? AND state='delivering'`,
        args: [now, now, id],
      });
      outcomes.push({ deliveryId: id, state: "suppressed" });
      continue;
    }
    if (configured.error) {
      await dbClient.execute({
        sql: `UPDATE tokenless_workspace_reviewer_invitation_email_deliveries
              SET state='parked',last_error=?,parked_at=?,updated_at=?
              WHERE delivery_id=? AND state='delivering'`,
        args: [configured.error.slice(0, 500), now, now, id],
      });
      outcomes.push({ deliveryId: id, state: "parked" });
      continue;
    }
    const attempt = Number(row.attempt_count) + 1;
    try {
      if (rowString(row, "payload_key_version") !== payloadKeyVersion(input.env)) {
        throw new Error("Invitation email payload key version is unavailable.");
      }
      const payload = decryptPayload(
        rowString(row, "payload_ciphertext")!,
        { invitationId: rowString(row, "invitation_id")!, workspaceId: rowString(row, "workspace_id")! },
        input.env,
      );
      const destination = destinationUrl(payload.token, configured.origin!);
      const token = payload.token;
      const email = payload.email.trim().toLowerCase();
      if (
        !token ||
        digest(token) !== rowString(row, "token_hash") ||
        digest(`${token}\0${email}`) !== rowString(row, "intended_email_hash")
      ) {
        throw new Error("Invitation email payload no longer matches its invitation.");
      }
      const sent = await (input.send ?? sendWorkspaceReviewerInvitationEmail)({
        destinationUrl: destination.toString(),
        email,
        invitationId: rowString(row, "invitation_id")!,
      });
      await dbClient.execute({
        sql: `UPDATE tokenless_workspace_reviewer_invitation_email_deliveries
              SET state='delivered',attempt_count=?,payload_ciphertext=NULL,payload_key_version=NULL,
                  provider_message_id=?,last_error=NULL,delivered_at=?,updated_at=?
              WHERE delivery_id=? AND state='delivering'`,
        args: [attempt, sent.id, now, now, id],
      });
      outcomes.push({ deliveryId: id, state: "delivered" });
    } catch (error) {
      if (isConfigurationError(error)) {
        const message = error instanceof Error ? error.message : "Invitation email configuration is invalid.";
        await dbClient.execute({
          sql: `UPDATE tokenless_workspace_reviewer_invitation_email_deliveries
                SET state='parked',last_error=?,parked_at=?,updated_at=?
                WHERE delivery_id=? AND state='delivering'`,
          args: [message.slice(0, 500), now, now, id],
        });
        outcomes.push({ deliveryId: id, state: "parked" });
        continue;
      }
      const dead = attempt >= MAX_ATTEMPTS;
      const message = error instanceof Error ? error.message : "Invitation email delivery failed.";
      await dbClient.execute({
        sql: `UPDATE tokenless_workspace_reviewer_invitation_email_deliveries
              SET state=?,attempt_count=?,next_attempt_at=?,last_error=?,dead_at=?,updated_at=?
              WHERE delivery_id=? AND state='delivering'`,
        args: [
          dead ? "dead" : "retry",
          attempt,
          dead ? null : retryAt(now, attempt),
          message.slice(0, 500),
          dead ? now : null,
          now,
          id,
        ],
      });
      const state = dead ? "dead" : "retry";
      outcomes.push({ deliveryId: id, state });
    }
  }
  return outcomes;
}

export const __workspaceReviewerInvitationEmailTestUtils = {
  decryptPayload,
  deliveryId,
  encryptPayload,
  payloadKeyVersion,
  retryAt,
};
