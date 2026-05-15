import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  createPendingImageAttachment,
  getAttachmentImageUrl,
  getImageAttachment,
  getImageAttachmentSubmissionValidationError,
  getImageAttachmentUploadMode,
  isLocalImageAttachmentPathname,
  parseAttachmentIdFromImageUrl,
  processCompletedLocalImageUpload,
  readLocalImageAttachment,
} from "~~/lib/attachments/imageAttachments";
import { __setDatabaseResourcesForTests, db } from "~~/lib/db";
import { questionImageAttachments } from "~~/lib/db/schema";
import { createMemoryDatabaseResources } from "~~/lib/db/testMemory";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

test("builds Curyo upload image URLs with a webp extension", () => {
  assert.equal(
    getAttachmentImageUrl("https://www.curyo.xyz/ask", "att_abcdefghijklmnop"),
    "https://www.curyo.xyz/api/attachments/images/att_abcdefghijklmnop.webp",
  );
});

test("parses Curyo attachment ids from public upload image URLs", () => {
  assert.equal(
    parseAttachmentIdFromImageUrl("https://www.curyo.xyz/api/attachments/images/att_abcdefghijklmnop.webp"),
    "att_abcdefghijklmnop",
  );
  assert.equal(parseAttachmentIdFromImageUrl("https://www.curyo.xyz/api/attachments/images/nope.png"), null);
});

test("uses local image upload mode in development when Vercel Blob is not configured", () => {
  assert.equal(getImageAttachmentUploadMode({ NODE_ENV: "development" }), "local");
  assert.equal(
    getImageAttachmentUploadMode({
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_store_secret",
      NODE_ENV: "development",
    }),
    "blob",
  );
  assert.equal(getImageAttachmentUploadMode({ NODE_ENV: "production" }), "blob");
});

test("processes local development image uploads without Vercel Blob", async () => {
  const originalLocalImageDir = process.env.CURYO_LOCAL_IMAGE_ATTACHMENT_DIR;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalModerationMode = process.env.CURYO_IMAGE_MODERATION_MODE;
  const tempDir = await mkdtemp(path.join(tmpdir(), "rateloop-local-images-"));
  const attachmentId = "att_localuploadimage01";

  try {
    process.env.CURYO_LOCAL_IMAGE_ATTACHMENT_DIR = tempDir;
    delete process.env.OPENAI_API_KEY;
    process.env.CURYO_IMAGE_MODERATION_MODE = "disabled";

    await createPendingImageAttachment({
      attachmentId,
      filename: "mockup.png",
      mimeType: "image/png",
      sha256: createHash("sha256").update(ONE_PIXEL_PNG).digest("hex"),
      sizeBytes: ONE_PIXEL_PNG.length,
      uploader: {
        kind: "wallet",
        ownerWalletAddress: "0x00000000000000000000000000000000000000aa",
      },
    });

    await processCompletedLocalImageUpload({
      attachmentId,
      buffer: ONE_PIXEL_PNG,
      contentType: "image/png",
    });

    const attachment = await getImageAttachment(attachmentId);
    assert.equal(attachment?.status, "approved");
    assert.equal(attachment?.mimeType, "image/webp");
    assert.equal(isLocalImageAttachmentPathname(attachment?.normalizedBlobPathname), true);

    const stored = await readLocalImageAttachment(attachment?.normalizedBlobPathname ?? "");
    assert.ok(stored?.buffer.length);
    assert.match(stored?.etag ?? "", /^[a-f0-9]{64}$/);
  } finally {
    if (originalLocalImageDir === undefined) {
      delete process.env.CURYO_LOCAL_IMAGE_ATTACHMENT_DIR;
    } else {
      process.env.CURYO_LOCAL_IMAGE_ATTACHMENT_DIR = originalLocalImageDir;
    }
    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
    if (originalModerationMode === undefined) {
      delete process.env.CURYO_IMAGE_MODERATION_MODE;
    } else {
      process.env.CURYO_IMAGE_MODERATION_MODE = originalModerationMode;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("rejects arbitrary HTTPS image URLs before submission", async () => {
  assert.equal(
    await getImageAttachmentSubmissionValidationError({
      imageUrls: ["https://example.com/mockup.png"],
      ownerWalletAddress: "0x00000000000000000000000000000000000000aa",
    }),
    "imageUrls must reference approved RateLoop-hosted uploads.",
  );
});

test("rejects reused pending image attachment ids", async () => {
  const params = {
    attachmentId: "att_uniqueuploadid01",
    filename: "mockup.png",
    mimeType: "image/png",
    sha256: "a".repeat(64),
    sizeBytes: 1024,
    uploader: {
      kind: "wallet" as const,
      ownerWalletAddress: "0x00000000000000000000000000000000000000aa" as const,
    },
  };

  await createPendingImageAttachment(params);
  await assert.rejects(() => createPendingImageAttachment(params), /Image attachment already exists/);
});

test("validates approved RateLoop-hosted image ownership before submission", async () => {
  const now = new Date();
  await db.insert(questionImageAttachments).values({
    id: "att_abcdefghijklmnop",
    uploaderKind: "wallet",
    ownerWalletAddress: "0x00000000000000000000000000000000000000aa",
    originalFilename: "mockup.png",
    mimeType: "image/webp",
    sizeBytes: 1024,
    status: "approved",
    moderationStatus: "approved",
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(
    await getImageAttachmentSubmissionValidationError({
      imageUrls: ["https://www.curyo.xyz/api/attachments/images/att_abcdefghijklmnop.webp"],
      ownerWalletAddress: "0x00000000000000000000000000000000000000AA",
    }),
    null,
  );
  assert.equal(
    await getImageAttachmentSubmissionValidationError({
      imageUrls: ["https://www.curyo.xyz/api/attachments/images/att_abcdefghijklmnop.webp"],
      ownerWalletAddress: "0x00000000000000000000000000000000000000bb",
    }),
    "imageUrls RateLoop-hosted uploads must belong to the submitting wallet or agent.",
  );
});

test("allows approved RateLoop-hosted images owned by the submitting agent", async () => {
  const now = new Date();
  await db.insert(questionImageAttachments).values({
    id: "att_agentownedupload",
    agentId: "agent-123",
    uploaderKind: "agent",
    ownerWalletAddress: null,
    originalFilename: "mockup.png",
    mimeType: "image/webp",
    sizeBytes: 1024,
    status: "approved",
    moderationStatus: "approved",
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(
    await getImageAttachmentSubmissionValidationError({
      agentId: "agent-123",
      imageUrls: ["https://www.curyo.xyz/api/attachments/images/att_agentownedupload.webp"],
    }),
    null,
  );
  assert.equal(
    await getImageAttachmentSubmissionValidationError({
      agentId: "agent-456",
      imageUrls: ["https://www.curyo.xyz/api/attachments/images/att_agentownedupload.webp"],
    }),
    "imageUrls RateLoop-hosted uploads must belong to the submitting wallet or agent.",
  );
});
