import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import sharp from "sharp";
import { dbClient, dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const PUBLIC_QUESTION_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const PUBLIC_QUESTION_IMAGE_MAX_PIXELS = 28_000_000;
export const PUBLIC_QUESTION_IMAGE_MAX_DIMENSION = 2_560;
export const PUBLIC_QUESTION_MEDIA_DAILY_UPLOADS = 20;
export const PUBLIC_QUESTION_MEDIA_DAILY_BYTES = 100 * 1024 * 1024;
export const PUBLIC_QUESTION_MEDIA_STAGING_TTL_MS = 24 * 60 * 60 * 1_000;

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
  if (!assetId || !digest || !width || !height || !sizeBytes) {
    throw new TokenlessServiceError("Stored image metadata is invalid.", 500, "invalid_public_media_state");
  }
  return {
    assetId,
    contentType: "image/webp" as const,
    digest: digest as `sha256:${string}`,
    height,
    previewUrl: `/api/public-media/images/${encodeURIComponent(assetId)}`,
    sizeBytes,
    width,
  };
}

async function findIdempotentUpload(input: { accountAddress: string; clientRequestId: string; workspaceId: string }) {
  const result = await dbClient.execute({
    sql: `SELECT asset_id, digest, width, height, size_bytes
          FROM tokenless_public_question_media
          WHERE workspace_id = ? AND owner_account_address = ? AND client_request_id = ?
            AND technical_status = 'ready'
          LIMIT 1`,
    args: [input.workspaceId, input.accountAddress.toLowerCase(), input.clientRequestId],
  });
  return result.rows[0] as Row | undefined;
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
  accountAddress: string;
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
  if (
    !input.workspaceId.trim() ||
    input.bytes.byteLength < 1 ||
    input.bytes.byteLength > PUBLIC_QUESTION_IMAGE_MAX_BYTES
  ) {
    throw new TokenlessServiceError("Image uploads must contain 1 byte to 10 MB.", 400, "invalid_public_media_size");
  }
  const accountAddress = input.accountAddress.toLowerCase();
  const idempotent = await findIdempotentUpload({ ...input, accountAddress });
  if (idempotent) return responseFromRow(idempotent);

  const normalized = await normalizeImage(input.bytes);
  const digest = `sha256:${createHash("sha256").update(normalized.bytes).digest("hex")}`;
  const now = input.now ?? new Date();
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
    const member = await client.query(
      `SELECT m.role FROM tokenless_workspace_members m
       JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id AND w.status = 'active'
       WHERE m.workspace_id = $1 AND m.account_address = $2
       FOR UPDATE`,
      [input.workspaceId, accountAddress],
    );
    if (member.rowCount !== 1) {
      throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
    }
    const dayKey = now.toISOString().slice(0, 10);
    const currentQuota = await client.query(
      `SELECT upload_count, upload_bytes FROM tokenless_public_media_daily_quotas
       WHERE workspace_id = $1 AND owner_account_address = $2 AND day_key = $3
       FOR UPDATE`,
      [input.workspaceId, accountAddress, dayKey],
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
      [input.workspaceId, accountAddress, dayKey, normalized.bytes.byteLength, now],
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
        accountAddress,
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
    questionId: string;
    workspaceId: string;
  },
) {
  if (!input.accountAddress) {
    throw new TokenlessServiceError(
      "Image questions must be completed through an authenticated browser handoff.",
      409,
      "public_media_browser_handoff_required",
    );
  }
  for (const item of input.items) {
    const locked = await client.query(
      `SELECT asset_id, digest, question_id, expires_at
       FROM tokenless_public_question_media
       WHERE asset_id = $1 AND workspace_id = $2 AND owner_account_address = $3
         AND technical_status = 'ready'
       FOR UPDATE`,
      [item.assetId, input.workspaceId, input.accountAddress.toLowerCase()],
    );
    const row = locked.rows[0] as Row | undefined;
    const existingQuestionId = rowString(row, "question_id");
    if (
      rowString(row, "asset_id") !== item.assetId ||
      rowString(row, "digest") !== item.digest ||
      (existingQuestionId && existingQuestionId !== input.questionId) ||
      (!existingQuestionId && new Date(String(row?.expires_at)).getTime() <= input.now.getTime())
    ) {
      throw new TokenlessServiceError(
        "One or more staged images are unavailable, expired, or changed.",
        409,
        "public_media_asset_unavailable",
      );
    }
    await client.query(
      `UPDATE tokenless_public_question_media
       SET question_id = $1, bound_at = COALESCE(bound_at, $2), updated_at = $2
       WHERE asset_id = $3 AND (question_id IS NULL OR question_id = $1)`,
      [input.questionId, input.now, item.assetId],
    );
  }
}

export async function readPublicQuestionImage(input: { accountAddress?: string | null; assetId: string }) {
  if (!ASSET_ID_PATTERN.test(input.assetId)) {
    throw new TokenlessServiceError("Image asset not found.", 404, "public_media_not_found");
  }
  const result = await dbClient.execute({
    sql: `SELECT m.storage_ref, m.content_type, m.owner_account_address,
                 m.technical_status, m.moderation_status AS media_moderation_status,
                 q.visibility, q.moderation_status AS question_moderation_status,
                 c.moderation_status AS content_moderation_status
          FROM tokenless_public_question_media m
          LEFT JOIN tokenless_question_records q ON q.question_id = m.question_id
          LEFT JOIN tokenless_content_records c ON c.content_id = q.content_id
          WHERE m.asset_id = ? LIMIT 1`,
    args: [input.assetId],
  });
  const row = result.rows[0] as Row | undefined;
  const isOwner =
    Boolean(input.accountAddress) && rowString(row, "owner_account_address") === input.accountAddress?.toLowerCase();
  const isPublic =
    rowString(row, "visibility") === "public" &&
    rowString(row, "media_moderation_status") === "approved" &&
    rowString(row, "question_moderation_status") === "approved" &&
    rowString(row, "content_moderation_status") === "approved";
  const storageRef = rowString(row, "storage_ref");
  if (rowString(row, "technical_status") !== "ready" || !storageRef || (!isOwner && !isPublic)) {
    throw new TokenlessServiceError("Image asset not found.", 404, "public_media_not_found");
  }
  return {
    bytes: await runtime().store.get(storageRef),
    contentType: "image/webp" as const,
    public: isPublic,
  };
}

export const __publicQuestionMediaTestUtils = { normalizeImage };

export function __setPublicQuestionMediaRuntimeForTests(value: PublicQuestionMediaRuntime | null) {
  runtimeOverride = value;
}
