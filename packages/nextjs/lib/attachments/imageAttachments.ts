import { del as deleteBlob, get as getBlob, put as putBlob } from "@vercel/blob";
import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import "server-only";
import sharp from "sharp";
import { parseAttachmentIdFromUploadedImageUrl } from "~~/lib/attachments/imageAttachmentUrls";
import { db } from "~~/lib/db";
import { type QuestionImageAttachment, questionImageAttachments } from "~~/lib/db/schema";

const IMAGE_ATTACHMENT_ROUTE_PREFIX = "/api/attachments/images";
const IMAGE_ATTACHMENT_PUBLIC_EXTENSION = "webp";
const LOCAL_IMAGE_ATTACHMENT_URI_PREFIX = "local://";
const LOCAL_IMAGE_ATTACHMENT_STORAGE_PREFIX = "question-attachments";

type ImageAttachmentStatus = "uploading" | "processing" | "approved" | "blocked" | "failed" | "deleted";

type UploaderIdentity =
  | {
      kind: "wallet";
      ownerWalletAddress: `0x${string}`;
      agentId?: null;
    }
  | {
      kind: "agent";
      ownerWalletAddress: string | null;
      agentId: string;
    };

type CreatePendingImageAttachmentParams = {
  attachmentId: string;
  clientRequestId?: string | null;
  filename: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  uploader: UploaderIdentity;
};

type ModerationDecision = {
  provider: string;
  result: unknown;
  status: "approved" | "blocked" | "review_required";
};

type ImageAttachmentUploadModeEnv = {
  BLOB_READ_WRITE_TOKEN?: string;
  NODE_ENV?: string;
};

type ImageAttachmentBlobDependencies = {
  deleteBlob: typeof deleteBlob;
  getBlob: typeof getBlob;
  putBlob: typeof putBlob;
};

let imageAttachmentBlobTestOverrides: Partial<ImageAttachmentBlobDependencies> | null = null;

function getImageAttachmentBlobDependencies(): ImageAttachmentBlobDependencies {
  return {
    deleteBlob: imageAttachmentBlobTestOverrides?.deleteBlob ?? deleteBlob,
    getBlob: imageAttachmentBlobTestOverrides?.getBlob ?? getBlob,
    putBlob: imageAttachmentBlobTestOverrides?.putBlob ?? putBlob,
  };
}

export function __setImageAttachmentBlobTestOverridesForTests(
  overrides: Partial<ImageAttachmentBlobDependencies> | null,
) {
  imageAttachmentBlobTestOverrides = overrides;
}

const OPENAI_MODERATION_MODEL = "omni-moderation-latest";
const MAX_INPUT_PIXELS = 28_000_000;
const NORMALIZED_IMAGE_QUALITY = 88;
const BLOCKED_MODERATION_CATEGORIES = new Set([
  "sexual/minors",
  "sexual",
  "violence/graphic",
  "self-harm/instructions",
  "hate/threatening",
  "harassment/threatening",
  "illicit/violent",
]);

function nowDate() {
  return new Date();
}

function hasOpenAiModerationKey() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function isDevelopmentModerationExplicitlyDisabled() {
  return process.env.NODE_ENV !== "production" && process.env.RATELOOP_IMAGE_MODERATION_MODE === "disabled";
}

function isDevModerationSkipAllowed() {
  return process.env.NODE_ENV !== "production" && !hasOpenAiModerationKey();
}

function assertSupportedImageSignature(buffer: Buffer, mimeType: string) {
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp =
    buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";

  if (mimeType === "image/png" && isPng) return;
  if (mimeType === "image/jpeg" && isJpeg) return;
  if (mimeType === "image/webp" && isWebp) return;

  throw new Error("Image signature does not match the declared content type.");
}

function getAttachmentImagePath(attachmentId: string) {
  return `${IMAGE_ATTACHMENT_ROUTE_PREFIX}/${attachmentId}.${IMAGE_ATTACHMENT_PUBLIC_EXTENSION}`;
}

function getConfiguredAttachmentBaseUrl() {
  const rawValue =
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL?.trim() ? `https://${process.env.VERCEL_URL.trim()}` : "");
  if (!rawValue) return null;

  try {
    const parsed = new URL(rawValue);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString().replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

function hasBlobReadWriteToken(env: ImageAttachmentUploadModeEnv = process.env) {
  return Boolean(env.BLOB_READ_WRITE_TOKEN?.trim());
}

function getLocalImageAttachmentStorageRoot() {
  return path.resolve(
    process.env.RATELOOP_LOCAL_IMAGE_ATTACHMENT_DIR?.trim() || path.join(process.cwd(), ".local", "image-attachments"),
  );
}

function getLocalImageAttachmentPathname(attachmentId: string) {
  return `${LOCAL_IMAGE_ATTACHMENT_URI_PREFIX}${LOCAL_IMAGE_ATTACHMENT_STORAGE_PREFIX}/${attachmentId}/image.webp`;
}

function resolveLocalImageAttachmentPathname(pathname: string) {
  if (!pathname.startsWith(LOCAL_IMAGE_ATTACHMENT_URI_PREFIX)) {
    return null;
  }

  const root = getLocalImageAttachmentStorageRoot();
  const relativePath = pathname.slice(LOCAL_IMAGE_ATTACHMENT_URI_PREFIX.length);
  const resolved = path.resolve(root, relativePath);
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

  if (resolved !== root && !resolved.startsWith(rootPrefix)) {
    throw new Error("Invalid local image attachment path.");
  }

  return resolved;
}

export function getAttachmentImageUrl(requestUrl: string, attachmentId: string) {
  return new URL(getAttachmentImagePath(attachmentId), getConfiguredAttachmentBaseUrl() ?? requestUrl).toString();
}

export function getImageAttachmentUploadMode(env: ImageAttachmentUploadModeEnv = process.env): "blob" | "local" {
  return env.NODE_ENV !== "production" && !hasBlobReadWriteToken(env) ? "local" : "blob";
}

export function parseAttachmentIdFromImageUrl(value: string): string | null {
  return parseAttachmentIdFromUploadedImageUrl(value);
}

export function isLocalImageAttachmentPathname(pathname: string | null | undefined) {
  return Boolean(pathname?.startsWith(LOCAL_IMAGE_ATTACHMENT_URI_PREFIX));
}

export async function readLocalImageAttachment(pathname: string) {
  const filePath = resolveLocalImageAttachmentPathname(pathname);
  if (!filePath) return null;

  try {
    const buffer = await readFile(filePath);
    return {
      buffer,
      etag: createHash("sha256").update(buffer).digest("hex"),
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function getImageAttachment(id: string): Promise<QuestionImageAttachment | null> {
  const [attachment] = await db
    .select()
    .from(questionImageAttachments)
    .where(eq(questionImageAttachments.id, id))
    .limit(1);
  return attachment ?? null;
}

export async function createPendingImageAttachment(params: CreatePendingImageAttachmentParams) {
  const createdAt = nowDate();
  const [created] = await db
    .insert(questionImageAttachments)
    .values({
      id: params.attachmentId,
      uploaderKind: params.uploader.kind,
      ownerWalletAddress: params.uploader.ownerWalletAddress,
      agentId: params.uploader.kind === "agent" ? params.uploader.agentId : null,
      clientRequestId: params.clientRequestId ?? null,
      originalFilename: params.filename,
      mimeType: params.mimeType,
      sizeBytes: params.sizeBytes,
      sha256: params.sha256,
      status: "uploading",
      moderationStatus: "pending",
      createdAt,
      updatedAt: createdAt,
    })
    .onConflictDoNothing()
    .returning({ id: questionImageAttachments.id });

  if (!created) {
    throw new Error("Image attachment already exists.");
  }
}

async function readBlobBuffer(pathname: string) {
  const { getBlob: readBlob } = getImageAttachmentBlobDependencies();
  const result = await readBlob(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error("Uploaded image blob was not found.");
  }

  return {
    blob: result.blob,
    buffer: Buffer.from(await new Response(result.stream).arrayBuffer()),
  };
}

async function putLocalNormalizedImage(attachmentId: string, buffer: Buffer) {
  const pathname = getLocalImageAttachmentPathname(attachmentId);
  const filePath = resolveLocalImageAttachmentPathname(pathname);
  if (!filePath) {
    throw new Error("Invalid local image attachment path.");
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
  return {
    pathname,
    url: null,
  };
}

async function moderateImage(buffer: Buffer): Promise<ModerationDecision> {
  if (isDevelopmentModerationExplicitlyDisabled()) {
    return { provider: "disabled", status: "approved", result: { skipped: true, reason: "explicitly_disabled" } };
  }

  if (isDevModerationSkipAllowed()) {
    return { provider: "dev-skip", status: "approved", result: { skipped: true, reason: "missing_dev_key" } };
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { provider: "openai", status: "review_required", result: { error: "OPENAI_API_KEY is not configured" } };
  }

  const response = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODERATION_MODEL,
      input: [
        {
          type: "image_url",
          image_url: {
            url: `data:image/webp;base64,${buffer.toString("base64")}`,
          },
        },
      ],
    }),
  });

  const result = (await response.json().catch(() => null)) as {
    results?: Array<{
      categories?: Record<string, boolean>;
      flagged?: boolean;
    }>;
  } | null;

  if (!response.ok) {
    return {
      provider: "openai",
      status: "review_required",
      result: result ?? { error: `OpenAI moderation failed with ${response.status}` },
    };
  }

  const categories = result?.results?.[0]?.categories ?? {};
  const flagged = Boolean(result?.results?.[0]?.flagged);
  const shouldBlock = Object.entries(categories).some(
    ([category, flagged]) => flagged && BLOCKED_MODERATION_CATEGORIES.has(category),
  );
  return {
    provider: "openai",
    status: flagged || shouldBlock ? "blocked" : "approved",
    result,
  };
}

async function markImageAttachmentProcessing(params: {
  attachmentId: string;
  blobPathname: string;
  blobUrl: string | null;
  contentType: string;
}) {
  const processingAt = nowDate();
  const [attachment] = await db
    .update(questionImageAttachments)
    .set({
      originalBlobPathname: params.blobPathname,
      originalBlobUrl: params.blobUrl,
      mimeType: params.contentType,
      status: "processing",
      updatedAt: processingAt,
    })
    .where(and(eq(questionImageAttachments.id, params.attachmentId), eq(questionImageAttachments.status, "uploading")))
    .returning({
      id: questionImageAttachments.id,
      sha256: questionImageAttachments.sha256,
    });

  return attachment ?? null;
}

function isCompletedImageUploadAlreadyAccepted(attachment: QuestionImageAttachment, blobPathname: string) {
  return attachment.status !== "uploading" && attachment.originalBlobPathname === blobPathname;
}

async function processImageAttachmentBuffer(params: {
  attachmentId: string;
  buffer: Buffer;
  contentType: string;
  expectedSha256: string | null;
  originalBlobPathname: string;
  saveNormalizedImage: (buffer: Buffer) => Promise<{ pathname: string; url: string | null }>;
}) {
  try {
    assertSupportedImageSignature(params.buffer, params.contentType);

    const actualSha256 = createHash("sha256").update(params.buffer).digest("hex");
    if (params.expectedSha256 && params.expectedSha256 !== actualSha256) {
      throw new Error("Image hash does not match the signed upload challenge.");
    }

    const normalized = await sharp(params.buffer, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .webp({ quality: NORMALIZED_IMAGE_QUALITY })
      .toBuffer({ resolveWithObject: true });
    const normalizedBlob = await params.saveNormalizedImage(normalized.data);
    const moderation = await moderateImage(normalized.data);
    const status: ImageAttachmentStatus = moderation.status === "approved" ? "approved" : "blocked";
    const completedAt = nowDate();

    const updated = await db
      .update(questionImageAttachments)
      .set({
        normalizedBlobPathname: normalizedBlob.pathname,
        normalizedBlobUrl: normalizedBlob.url,
        mimeType: "image/webp",
        sizeBytes: normalized.data.length,
        width: normalized.info.width,
        height: normalized.info.height,
        sha256: actualSha256,
        status,
        moderationStatus: moderation.status,
        moderationProvider: moderation.provider,
        moderationResult: JSON.stringify(moderation.result),
        approvedAt: moderation.status === "approved" ? completedAt : null,
        error: moderation.status === "review_required" ? "Image requires moderation review before publication." : null,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(questionImageAttachments.id, params.attachmentId),
          eq(questionImageAttachments.status, "processing"),
          eq(questionImageAttachments.originalBlobPathname, params.originalBlobPathname),
        ),
      )
      .returning({ id: questionImageAttachments.id });

    if (updated.length === 0) {
      await deleteStoredImage(normalizedBlob.pathname);
      throw new Error("Image attachment changed while processing.");
    }

    return true;
  } catch (error) {
    const failedAt = nowDate();
    await db
      .update(questionImageAttachments)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : "Image processing failed.",
        updatedAt: failedAt,
      })
      .where(
        and(
          eq(questionImageAttachments.id, params.attachmentId),
          eq(questionImageAttachments.status, "processing"),
          eq(questionImageAttachments.originalBlobPathname, params.originalBlobPathname),
        ),
      );

    return false;
  }
}

async function markImageAttachmentProcessingFailed(params: {
  attachmentId: string;
  error: unknown;
  originalBlobPathname: string;
}) {
  const failedAt = nowDate();
  await db
    .update(questionImageAttachments)
    .set({
      status: "failed",
      error: params.error instanceof Error ? params.error.message : "Image processing failed.",
      updatedAt: failedAt,
    })
    .where(
      and(
        eq(questionImageAttachments.id, params.attachmentId),
        eq(questionImageAttachments.status, "processing"),
        eq(questionImageAttachments.originalBlobPathname, params.originalBlobPathname),
      ),
    );
}

async function deleteStoredImage(pathname: string) {
  if (isLocalImageAttachmentPathname(pathname)) {
    const filePath = resolveLocalImageAttachmentPathname(pathname);
    if (filePath) await unlink(filePath).catch(() => undefined);
    return;
  }

  const { deleteBlob: removeBlob } = getImageAttachmentBlobDependencies();
  await removeBlob(pathname).catch(() => undefined);
}

export async function processCompletedImageUpload(params: {
  attachmentId: string;
  blobPathname: string;
  blobUrl: string;
  contentType: string;
}) {
  const existing = await getImageAttachment(params.attachmentId);
  if (!existing) {
    throw new Error("Image attachment is no longer accepting uploads.");
  }
  if (isCompletedImageUploadAlreadyAccepted(existing, params.blobPathname)) {
    return;
  }
  if (existing.status !== "uploading") {
    throw new Error("Image attachment is no longer accepting uploads.");
  }

  const { buffer } = await readBlobBuffer(params.blobPathname);
  const attachment = await markImageAttachmentProcessing(params);

  if (!attachment) {
    const latest = await getImageAttachment(params.attachmentId);
    if (latest && isCompletedImageUploadAlreadyAccepted(latest, params.blobPathname)) {
      return;
    }
    throw new Error("Image attachment is no longer accepting uploads.");
  }

  const { deleteBlob: removeBlob, putBlob: writeBlob } = getImageAttachmentBlobDependencies();
  let completed = false;
  try {
    completed = await processImageAttachmentBuffer({
      attachmentId: params.attachmentId,
      buffer,
      contentType: params.contentType,
      expectedSha256: attachment.sha256,
      originalBlobPathname: params.blobPathname,
      saveNormalizedImage: normalizedBuffer =>
        writeBlob(`question-attachments/${params.attachmentId}/image.webp`, normalizedBuffer, {
          access: "private",
          allowOverwrite: true,
          cacheControlMaxAge: 60 * 60 * 24 * 30,
          contentType: "image/webp",
        }),
    });
  } catch (error) {
    await markImageAttachmentProcessingFailed({
      attachmentId: params.attachmentId,
      error,
      originalBlobPathname: params.blobPathname,
    });
    throw error;
  } finally {
    if (completed) {
      await removeBlob(params.blobPathname).catch(() => undefined);
    }
  }
}

export async function processCompletedLocalImageUpload(params: {
  attachmentId: string;
  buffer: Buffer;
  contentType: string;
}) {
  const localOriginalPathname = `${LOCAL_IMAGE_ATTACHMENT_URI_PREFIX}${LOCAL_IMAGE_ATTACHMENT_STORAGE_PREFIX}/${params.attachmentId}/original`;
  const attachment = await markImageAttachmentProcessing({
    attachmentId: params.attachmentId,
    blobPathname: localOriginalPathname,
    blobUrl: null,
    contentType: params.contentType,
  });

  if (!attachment) {
    throw new Error("Image attachment is no longer accepting uploads.");
  }

  await processImageAttachmentBuffer({
    attachmentId: params.attachmentId,
    buffer: params.buffer,
    contentType: params.contentType,
    expectedSha256: attachment.sha256,
    originalBlobPathname: localOriginalPathname,
    saveNormalizedImage: normalizedBuffer => putLocalNormalizedImage(params.attachmentId, normalizedBuffer),
  });
}

export async function getImageAttachmentSubmissionValidationError(params: {
  agentId?: string | null;
  imageUrls: readonly string[];
  ownerWalletAddress?: string | null;
}): Promise<string | null> {
  if (params.imageUrls.length === 0) return null;

  const parsedAttachmentIds = params.imageUrls.map(parseAttachmentIdFromImageUrl);
  if (parsedAttachmentIds.some(id => !id)) {
    return "imageUrls must reference approved RateLoop-hosted uploads.";
  }
  const attachmentIds = [...new Set(parsedAttachmentIds as string[])];

  const ownerWalletAddress = params.ownerWalletAddress?.trim().toLowerCase() || null;
  const agentId = params.agentId?.trim() || null;

  for (const attachmentId of attachmentIds) {
    const attachment = await getImageAttachment(attachmentId);
    if (!attachment || attachment.status !== "approved") {
      return "imageUrls must reference approved RateLoop-hosted uploads.";
    }

    const ownedByAgent = agentId !== null && attachment.agentId === agentId;
    const ownedByWallet =
      ownerWalletAddress !== null && attachment.ownerWalletAddress?.trim().toLowerCase() === ownerWalletAddress;

    if (!ownedByAgent && !ownedByWallet) {
      return "imageUrls RateLoop-hosted uploads must belong to the submitting wallet or agent.";
    }
  }

  return null;
}

export async function attachImagesToOperation(params: {
  imageUrls: readonly string[];
  operationKey: string;
  clientRequestId: string;
  ownerWalletAddress?: string | null;
  agentId?: string | null;
}) {
  const attachmentIds = params.imageUrls.map(parseAttachmentIdFromImageUrl).filter((id): id is string => Boolean(id));
  if (attachmentIds.length === 0) return;

  const updatedAt = nowDate();
  for (const attachmentId of attachmentIds) {
    await db
      .update(questionImageAttachments)
      .set({
        operationKey: params.operationKey,
        clientRequestId: params.clientRequestId,
        updatedAt,
      })
      .where(
        and(
          eq(questionImageAttachments.id, attachmentId),
          params.agentId
            ? eq(questionImageAttachments.agentId, params.agentId)
            : eq(questionImageAttachments.ownerWalletAddress, params.ownerWalletAddress ?? ""),
        ),
      );
  }
}
