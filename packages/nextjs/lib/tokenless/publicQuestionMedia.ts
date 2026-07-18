import type { TokenlessQuestionImagePreviewGrant } from "@rateloop/sdk";
import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import sharp from "sharp";
import { dbClient, dbPool } from "~~/lib/db";
import {
  PUBLIC_QUESTION_MEDIA_PREVIEW_MAX_TTL_MS,
  issuePublicQuestionMediaPreviewCapability,
  validatePublicQuestionMediaPreviewCapability,
} from "~~/lib/tokenless/publicQuestionMediaPreview";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const PUBLIC_QUESTION_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const PUBLIC_QUESTION_IMAGE_MAX_PIXELS = 28_000_000;
export const PUBLIC_QUESTION_IMAGE_MAX_DIMENSION = 2_560;
export const PUBLIC_QUESTION_MEDIA_DAILY_UPLOADS = 20;
export const PUBLIC_QUESTION_MEDIA_DAILY_BYTES = 100 * 1024 * 1024;
export const PUBLIC_QUESTION_MEDIA_STAGING_TTL_MS = PUBLIC_QUESTION_MEDIA_PREVIEW_MAX_TTL_MS;

const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/;
const ASSET_ID_PATTERN = /^pqm_[A-Za-z0-9_-]{24,80}$/;
const acceptedFormats = new Set(["jpeg", "png", "webp"]);

type Row = Record<string, unknown>;

export interface PublicQuestionMediaStore {
  delete(reference: string): Promise<void>;
  get(reference: string): Promise<Uint8Array>;
  put(pathname: string, body: Uint8Array, contentType: string): Promise<string>;
}

type PublicQuestionMediaRuntime = {
  randomAssetId(): string;
  store: PublicQuestionMediaStore;
};

let runtimeOverride: PublicQuestionMediaRuntime | null = null;

function createVercelBlobStore(): PublicQuestionMediaStore {
  return {
    async delete(reference) {
      const { del } = await import("@vercel/blob");
      await del(reference);
    },
    async get(reference) {
      const { get } = await import("@vercel/blob");
      const result = await get(reference, { access: "private", useCache: false });
      if (!result || result.statusCode !== 200 || !result.stream) {
        throw new TokenlessServiceError("The image object is unavailable.", 404, "public_media_not_found");
      }
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    },
    async put(pathname, body, contentType) {
      const { put } = await import("@vercel/blob");
      const result = await put(pathname, Buffer.from(body), {
        access: "private",
        addRandomSuffix: false,
        contentType,
      });
      return result.url;
    },
  };
}

function runtime(): PublicQuestionMediaRuntime {
  return (
    runtimeOverride ?? {
      randomAssetId: () => `pqm_${randomBytes(24).toString("base64url")}`,
      store: createVercelBlobStore(),
    }
  );
}

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowNumber(row: Row | undefined, key: string) {
  const value = Number(row?.[key]);
  return Number.isSafeInteger(value) ? value : null;
}

function cleanFilename(value: string) {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 180);
  return normalized || "image";
}

function responseFromRow(row: Row) {
  const assetId = rowString(row, "asset_id");
  const digest = rowString(row, "digest");
  const width = rowNumber(row, "width");
  const height = rowNumber(row, "height");
  const sizeBytes = rowNumber(row, "size_bytes");
  const expiresAt = new Date(String(row.expires_at));
  if (!assetId || !digest || !width || !height || !sizeBytes || !Number.isFinite(expiresAt.getTime())) {
    throw new TokenlessServiceError("Stored image metadata is invalid.", 500, "invalid_public_media_state");
  }
  const previewCapability = issuePublicQuestionMediaPreviewCapability({ assetId, digest, expiresAt });
  const query = new URLSearchParams({ digest, preview: previewCapability });
  return {
    assetId,
    contentType: "image/webp" as const,
    digest: digest as `sha256:${string}`,
    height,
    previewCapability,
    previewExpiresAt: expiresAt.toISOString(),
    previewUrl: `/api/public-media/images/${encodeURIComponent(assetId)}?${query}`,
    sizeBytes,
    width,
  };
}

export async function authorizePublicQuestionMediaOwner(input: {
  accountAddress?: string;
  apiKeyId?: string;
  now?: Date;
  workspaceId: string;
}) {
  if (Boolean(input.accountAddress) === Boolean(input.apiKeyId)) {
    throw new TokenlessServiceError(
      "Exactly one authenticated media owner is required.",
      401,
      "invalid_public_media_owner",
    );
  }
  const result = input.apiKeyId
    ? await dbClient.execute({
        sql: `SELECT k.key_id FROM tokenless_workspace_api_keys k
              JOIN tokenless_workspaces w ON w.workspace_id = k.workspace_id AND w.status = 'active'
              WHERE k.workspace_id = ? AND k.key_id = ? AND k.revoked_at IS NULL
                AND (k.expires_at IS NULL OR k.expires_at > ?)
              LIMIT 1`,
        args: [input.workspaceId, input.apiKeyId, input.now ?? new Date()],
      })
    : await dbClient.execute({
        sql: `SELECT m.account_address FROM tokenless_workspace_members m
              JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id AND w.status = 'active'
              WHERE m.workspace_id = ? AND m.account_address = ? LIMIT 1`,
        args: [input.workspaceId, input.accountAddress!.toLowerCase()],
      });
  if (result.rowCount !== 1) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
}

async function findIdempotentUpload(input: {
  clientRequestId: string;
  now: Date;
  ownerReference: string;
  workspaceId: string;
}) {
  const result = await dbClient.execute({
    sql: `SELECT asset_id, digest, width, height, size_bytes, expires_at, technical_status
          FROM tokenless_public_question_media
          WHERE workspace_id = ? AND owner_account_address = ? AND client_request_id = ?
          LIMIT 1`,
    args: [input.workspaceId, input.ownerReference, input.clientRequestId],
  });
  const row = result.rows[0] as Row | undefined;
  if (
    row &&
    (rowString(row, "technical_status") !== "ready" ||
      new Date(String(row.expires_at)).getTime() <= input.now.getTime())
  ) {
    throw new TokenlessServiceError(
      "This upload idempotency key expired; stage the file with a new clientRequestId.",
      409,
      "public_media_idempotency_expired",
    );
  }
  return row;
}

async function normalizeImage(bytes: Uint8Array) {
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(bytes, { failOn: "error", limitInputPixels: PUBLIC_QUESTION_IMAGE_MAX_PIXELS }).metadata();
  } catch {
    throw new TokenlessServiceError(
      "Image bytes must be a readable JPG, PNG, or WEBP within the pixel limit.",
      400,
      "invalid_public_media_image",
    );
  }
  if (!metadata.format || !acceptedFormats.has(metadata.format) || (metadata.pages ?? 1) !== 1) {
    throw new TokenlessServiceError(
      "Only still JPG, PNG, and WEBP images are supported.",
      400,
      "unsupported_public_media_image",
    );
  }
  const normalized = await sharp(bytes, { failOn: "error", limitInputPixels: PUBLIC_QUESTION_IMAGE_MAX_PIXELS })
    .rotate()
    .resize({
      fit: "inside",
      height: PUBLIC_QUESTION_IMAGE_MAX_DIMENSION,
      width: PUBLIC_QUESTION_IMAGE_MAX_DIMENSION,
      withoutEnlargement: true,
    })
    .webp({ effort: 4, quality: 88 })
    .toBuffer({ resolveWithObject: true });
  if (!normalized.info.width || !normalized.info.height) {
    throw new TokenlessServiceError("The normalized image has invalid dimensions.", 400, "invalid_public_media_image");
  }
  return {
    bytes: new Uint8Array(normalized.data),
    height: normalized.info.height,
    width: normalized.info.width,
  };
}

export async function stagePublicQuestionImage(input: {
  accountAddress?: string;
  apiKeyId?: string;
  bytes: Uint8Array;
  clientRequestId: string;
  filename: string;
  now?: Date;
  workspaceId: string;
}) {
  if (!CLIENT_REQUEST_ID_PATTERN.test(input.clientRequestId)) {
    throw new TokenlessServiceError(
      "clientRequestId must be 8-160 safe idempotency characters.",
      400,
      "invalid_public_media_request",
    );
  }
  if (Boolean(input.accountAddress) === Boolean(input.apiKeyId)) {
    throw new TokenlessServiceError(
      "Exactly one authenticated media owner is required.",
      401,
      "invalid_public_media_owner",
    );
  }
  if (
    !input.workspaceId.trim() ||
    input.bytes.byteLength < 1 ||
    input.bytes.byteLength > PUBLIC_QUESTION_IMAGE_MAX_BYTES
  ) {
    throw new TokenlessServiceError("Image uploads must contain 1 byte to 10 MB.", 400, "invalid_public_media_size");
  }
  const ownerReference = input.apiKeyId ? `api_key:${input.apiKeyId}` : input.accountAddress!.toLowerCase();
  const now = input.now ?? new Date();
  const idempotent = await findIdempotentUpload({ ...input, now, ownerReference });
  if (idempotent) return responseFromRow(idempotent);

  const normalized = await normalizeImage(input.bytes);
  const digest = `sha256:${createHash("sha256").update(normalized.bytes).digest("hex")}`;
  const expiresAt = new Date(now.getTime() + PUBLIC_QUESTION_MEDIA_STAGING_TTL_MS);
  const assetId = runtime().randomAssetId();
  if (!ASSET_ID_PATTERN.test(assetId)) {
    throw new TokenlessServiceError("Image asset generation failed.", 500, "invalid_public_media_asset_id");
  }
  const storageRef = await runtime().store.put(
    `tokenless/public-question-media/${input.workspaceId}/${assetId}.webp`,
    normalized.bytes,
    "image/webp",
  );
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const member = input.apiKeyId
      ? await client.query(
          `SELECT k.role FROM tokenless_workspace_api_keys k
           JOIN tokenless_workspaces w ON w.workspace_id = k.workspace_id AND w.status = 'active'
           WHERE k.workspace_id = $1 AND k.key_id = $2 AND k.revoked_at IS NULL
             AND (k.expires_at IS NULL OR k.expires_at > $3)
           FOR UPDATE`,
          [input.workspaceId, input.apiKeyId, now],
        )
      : await client.query(
          `SELECT m.role FROM tokenless_workspace_members m
           JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id AND w.status = 'active'
           WHERE m.workspace_id = $1 AND m.account_address = $2
           FOR UPDATE`,
          [input.workspaceId, ownerReference],
        );
    if (member.rowCount !== 1) {
      throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
    }
    const dayKey = now.toISOString().slice(0, 10);
    const currentQuota = await client.query(
      `SELECT upload_count, upload_bytes FROM tokenless_public_media_daily_quotas
       WHERE workspace_id = $1 AND owner_account_address = $2 AND day_key = $3
       FOR UPDATE`,
      [input.workspaceId, ownerReference, dayKey],
    );
    const currentQuotaRow = currentQuota.rows[0] as Row | undefined;
    if (
      (rowNumber(currentQuotaRow, "upload_count") ?? 0) + 1 > PUBLIC_QUESTION_MEDIA_DAILY_UPLOADS ||
      (rowNumber(currentQuotaRow, "upload_bytes") ?? 0) + normalized.bytes.byteLength >
        PUBLIC_QUESTION_MEDIA_DAILY_BYTES
    ) {
      throw new TokenlessServiceError(
        "The daily public image upload quota is exhausted.",
        429,
        "public_media_quota_exceeded",
      );
    }
    const quota = await client.query(
      `INSERT INTO tokenless_public_media_daily_quotas
         (workspace_id, owner_account_address, day_key, upload_count, upload_bytes, updated_at)
       VALUES ($1, $2, $3, 1, $4, $5)
       ON CONFLICT (workspace_id, owner_account_address, day_key) DO UPDATE
       SET upload_count = tokenless_public_media_daily_quotas.upload_count + 1,
           upload_bytes = tokenless_public_media_daily_quotas.upload_bytes + EXCLUDED.upload_bytes,
           updated_at = EXCLUDED.updated_at
       RETURNING upload_count, upload_bytes`,
      [input.workspaceId, ownerReference, dayKey, normalized.bytes.byteLength, now],
    );
    const quotaRow = quota.rows[0] as Row | undefined;
    if (
      quota.rowCount !== 1 ||
      (rowNumber(quotaRow, "upload_count") ?? Number.POSITIVE_INFINITY) > PUBLIC_QUESTION_MEDIA_DAILY_UPLOADS ||
      (rowNumber(quotaRow, "upload_bytes") ?? Number.POSITIVE_INFINITY) > PUBLIC_QUESTION_MEDIA_DAILY_BYTES
    ) {
      throw new TokenlessServiceError(
        "The daily public image upload quota is exhausted.",
        429,
        "public_media_quota_exceeded",
      );
    }
    await client.query(
      `INSERT INTO tokenless_public_question_media
         (asset_id, workspace_id, owner_account_address, client_request_id, digest, storage_ref, content_type,
          original_filename, size_bytes, width, height, technical_status, moderation_status, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'image/webp', $7, $8, $9, $10, 'ready', 'pending', $11, $12, $12)`,
      [
        assetId,
        input.workspaceId,
        ownerReference,
        input.clientRequestId,
        digest,
        storageRef,
        cleanFilename(input.filename),
        normalized.bytes.byteLength,
        normalized.width,
        normalized.height,
        expiresAt,
        now,
      ],
    );
    await client.query("COMMIT");
    return responseFromRow({
      asset_id: assetId,
      digest,
      expires_at: expiresAt,
      height: normalized.height,
      size_bytes: normalized.bytes.byteLength,
      width: normalized.width,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    await runtime()
      .store.delete(storageRef)
      .catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function sweepExpiredPublicQuestionMedia(input: { limit?: number; now?: Date } = {}) {
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new TokenlessServiceError("Media sweep limit is invalid.", 400, "invalid_public_media_sweep");
  }
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  const expired: Array<{ assetId: string; storageRef: string }> = [];
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT asset_id, storage_ref FROM tokenless_public_question_media
       WHERE question_id IS NULL AND technical_status = 'ready' AND expires_at <= $1
       ORDER BY expires_at ASC LIMIT $2 FOR UPDATE`,
      [now, limit],
    );
    for (const value of result.rows) {
      const row = value as Row;
      const assetId = rowString(row, "asset_id");
      const storageRef = rowString(row, "storage_ref");
      if (!assetId || !storageRef) continue;
      await client.query(
        `UPDATE tokenless_public_question_media SET technical_status = 'deleted', updated_at = $1
         WHERE asset_id = $2 AND question_id IS NULL AND technical_status = 'ready'`,
        [now, assetId],
      );
      expired.push({ assetId, storageRef });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const failed: string[] = [];
  for (const item of expired) {
    try {
      await runtime().store.delete(item.storageRef);
    } catch {
      failed.push(item.assetId);
    }
  }
  return { deleted: expired.length - failed.length, failed };
}

export async function processPublicQuestionMediaDeletionByAssetId(assetId: string, now = new Date()) {
  const result = await dbClient.execute({
    sql: `SELECT media.asset_id, media.workspace_id, media.storage_ref, media.technical_status,
                 media.deletion_requested_at
          FROM tokenless_public_question_media media
          WHERE media.asset_id = ? LIMIT 1`,
    args: [assetId],
  });
  const row = result.rows[0] as Row | undefined;
  if (!row || rowString(row, "technical_status") !== "ready") return true;
  if (!row.deletion_requested_at || new Date(String(row.deletion_requested_at)).getTime() > now.getTime()) {
    throw new TokenlessServiceError("Public media deletion is not due yet.", 409, "deletion_not_due", true);
  }
  const holds = await dbClient.execute({
    sql: `SELECT hold_id FROM tokenless_legal_holds
          WHERE workspace_id = ? AND status = 'active' LIMIT 1`,
    args: [rowString(row, "workspace_id")],
  });
  if ((holds.rowCount ?? 0) > 0) {
    throw new TokenlessServiceError(
      "Public media deletion is deferred by an active legal hold.",
      409,
      "deletion_blocked_by_hold",
      true,
    );
  }
  const storageRef = rowString(row, "storage_ref");
  if (!storageRef)
    throw new TokenlessServiceError("Stored public media is invalid.", 500, "invalid_public_media_state");
  await runtime().store.delete(storageRef);
  const deleted = await dbClient.execute({
    sql: `UPDATE tokenless_public_question_media
          SET technical_status = 'deleted', storage_ref = ?, original_filename = 'deleted', updated_at = ?
          WHERE asset_id = ? AND technical_status = 'ready'`,
    args: [`deleted://${assetId}`, now, assetId],
  });
  return deleted.rowCount === 1;
}

export async function deleteStagedPublicQuestionImage(input: {
  accountAddress: string;
  assetId: string;
  workspaceId: string;
}) {
  if (!ASSET_ID_PATTERN.test(input.assetId)) {
    throw new TokenlessServiceError("Image asset not found.", 404, "public_media_not_found");
  }
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_public_question_media
          SET technical_status = 'deleted', updated_at = ?
          WHERE asset_id = ? AND workspace_id = ? AND owner_account_address = ?
            AND question_id IS NULL AND technical_status = 'ready'
          RETURNING storage_ref`,
    args: [new Date(), input.assetId, input.workspaceId, input.accountAddress.toLowerCase()],
  });
  const storageRef = rowString(result.rows[0] as Row | undefined, "storage_ref");
  if (!storageRef) throw new TokenlessServiceError("Image asset not found.", 404, "public_media_not_found");
  await runtime().store.delete(storageRef);
  return { deleted: true as const };
}

export async function bindPublicQuestionMediaToQuestion(
  client: PoolClient,
  input: {
    accountAddress: string | null;
    items: Array<{ assetId: string; digest: string }>;
    now: Date;
    ownerReference?: string | null;
    previewGrants?: TokenlessQuestionImagePreviewGrant[];
    questionId: string;
    workspaceId: string;
  },
) {
  const ownerReference = input.ownerReference ?? input.accountAddress?.toLowerCase() ?? null;
  if (!ownerReference) {
    throw new TokenlessServiceError(
      "Image questions require an authenticated staged-media owner.",
      409,
      "public_media_owner_required",
    );
  }
  const previewGrants = input.previewGrants ?? [];
  const expected = new Map(input.items.map(item => [item.assetId, item.digest]));
  const grants = new Map<string, TokenlessQuestionImagePreviewGrant>();
  if (previewGrants.length > 0) {
    if (previewGrants.length !== input.items.length) {
      throw new TokenlessServiceError(
        "Media preview grants must match every exact image once.",
        409,
        "invalid_media_preview_capability",
      );
    }
    for (const grant of previewGrants) {
      if (expected.get(grant.assetId) !== grant.digest || grants.has(grant.assetId)) {
        throw new TokenlessServiceError(
          "Media preview grants must match every exact image once.",
          409,
          "invalid_media_preview_capability",
        );
      }
      grants.set(grant.assetId, grant);
    }
    if (!input.accountAddress) {
      throw new TokenlessServiceError(
        "Media preview grants are accepted only from a signed-in browser principal.",
        403,
        "media_preview_principal_required",
      );
    }
    const membership = await client.query(
      `SELECT wm.workspace_id
       FROM tokenless_workspace_members wm
       JOIN tokenless_workspaces w ON w.workspace_id = wm.workspace_id
       WHERE wm.workspace_id = $1 AND wm.account_address = $2
         AND wm.role IN ('owner', 'admin', 'member') AND w.status = 'active'
       FOR UPDATE`,
      [input.workspaceId, input.accountAddress.toLowerCase()],
    );
    if (membership.rowCount !== 1) {
      throw new TokenlessServiceError(
        "The signed-in account cannot claim staged media for this workspace.",
        403,
        "workspace_forbidden",
      );
    }
  }
  for (const item of input.items) {
    const locked = await client.query(
      `SELECT asset_id, digest, owner_account_address, question_id, expires_at
       FROM tokenless_public_question_media
       WHERE asset_id = $1 AND workspace_id = $2 AND technical_status = 'ready'
       FOR UPDATE`,
      [item.assetId, input.workspaceId],
    );
    const row = locked.rows[0] as Row | undefined;
    const existingQuestionId = rowString(row, "question_id");
    const currentOwner = rowString(row, "owner_account_address");
    const exactOwner = currentOwner === ownerReference;
    const grant = grants.get(item.assetId);
    const validBridge =
      !exactOwner &&
      !existingQuestionId &&
      Boolean(input.accountAddress) &&
      currentOwner?.startsWith("api_key:") === true &&
      Boolean(
        grant &&
          validatePublicQuestionMediaPreviewCapability({
            assetId: item.assetId,
            capability: grant.previewCapability,
            digest: item.digest,
            now: input.now,
          }),
      );
    if (
      rowString(row, "asset_id") !== item.assetId ||
      rowString(row, "digest") !== item.digest ||
      (!exactOwner && !validBridge) ||
      (existingQuestionId && existingQuestionId !== input.questionId) ||
      (!existingQuestionId && new Date(String(row?.expires_at)).getTime() <= input.now.getTime())
    ) {
      throw new TokenlessServiceError(
        "One or more staged images are unavailable, expired, or changed.",
        409,
        "public_media_asset_unavailable",
      );
    }
    if (existingQuestionId === input.questionId) continue;
    const updated = await client.query(
      `UPDATE tokenless_public_question_media
       SET owner_account_address = $1, question_id = $2, bound_at = COALESCE(bound_at, $3), updated_at = $3
       WHERE asset_id = $4 AND workspace_id = $5 AND digest = $6 AND owner_account_address = $7
         AND technical_status = 'ready' AND (question_id IS NULL OR question_id = $2)`,
      [
        validBridge ? input.accountAddress!.toLowerCase() : ownerReference,
        input.questionId,
        input.now,
        item.assetId,
        input.workspaceId,
        item.digest,
        currentOwner,
      ],
    );
    if (updated.rowCount !== 1) {
      throw new TokenlessServiceError(
        "One or more staged images are unavailable, expired, or changed.",
        409,
        "public_media_asset_unavailable",
      );
    }
  }
}

export async function readPublicQuestionImage(input: {
  accountAddress?: string | null;
  assetId: string;
  now?: Date;
  previewCapability?: string | null;
  previewDigest?: string | null;
}) {
  if (!ASSET_ID_PATTERN.test(input.assetId)) {
    throw new TokenlessServiceError("Image asset not found.", 404, "public_media_not_found");
  }
  const result = await dbClient.execute({
    sql: `SELECT m.storage_ref, m.content_type, m.owner_account_address, m.digest, m.question_id, m.expires_at,
                 m.technical_status, m.moderation_status AS media_moderation_status,
                 q.visibility, q.moderation_status AS question_moderation_status,
                 c.moderation_status AS content_moderation_status,
                 (pwm.role IN ('owner', 'admin', 'member') AND pw.workspace_id IS NOT NULL)
                   AS preview_workspace_member
          FROM tokenless_public_question_media m
          LEFT JOIN tokenless_question_records q ON q.question_id = m.question_id
          LEFT JOIN tokenless_content_records c ON c.content_id = q.content_id
          LEFT JOIN tokenless_workspace_members pwm
            ON pwm.workspace_id = m.workspace_id AND pwm.account_address = ?
          LEFT JOIN tokenless_workspaces pw ON pw.workspace_id = m.workspace_id AND pw.status = 'active'
          WHERE m.asset_id = ? LIMIT 1`,
    args: [input.accountAddress?.toLowerCase() ?? "", input.assetId],
  });
  const row = result.rows[0] as Row | undefined;
  const isOwner =
    Boolean(input.accountAddress) &&
    rowString(row, "owner_account_address") === input.accountAddress?.toLowerCase() &&
    (Boolean(rowString(row, "question_id")) ||
      new Date(String(row?.expires_at)).getTime() > (input.now ?? new Date()).getTime());
  const isPublic =
    rowString(row, "visibility") === "public" &&
    rowString(row, "media_moderation_status") === "approved" &&
    rowString(row, "question_moderation_status") === "approved" &&
    rowString(row, "content_moderation_status") === "approved";
  const capability =
    !rowString(row, "question_id") && input.previewCapability && input.previewDigest
      ? validatePublicQuestionMediaPreviewCapability({
          assetId: input.assetId,
          capability: input.previewCapability,
          digest: input.previewDigest,
          now: input.now,
        })
      : null;
  const isCapabilityPreview =
    Boolean(capability) &&
    row?.preview_workspace_member === true &&
    rowString(row, "digest") === input.previewDigest &&
    new Date(String(row?.expires_at)).getTime() > (input.now ?? new Date()).getTime();
  const storageRef = rowString(row, "storage_ref");
  if (
    rowString(row, "technical_status") !== "ready" ||
    !storageRef ||
    (!isOwner && !isPublic && !isCapabilityPreview)
  ) {
    throw new TokenlessServiceError("Image asset not found.", 404, "public_media_not_found");
  }
  return {
    bytes: await runtime().store.get(storageRef),
    contentType: "image/webp" as const,
    digest: rowString(row, "digest")!,
    public: isPublic,
  };
}

export const __publicQuestionMediaTestUtils = { normalizeImage };

export function __setPublicQuestionMediaRuntimeForTests(value: PublicQuestionMediaRuntime | null) {
  runtimeOverride = value;
}
