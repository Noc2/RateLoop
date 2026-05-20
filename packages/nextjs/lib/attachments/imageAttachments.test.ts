import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  __setImageAttachmentBlobTestOverridesForTests,
  createPendingImageAttachment,
  getAttachmentImageUrl,
  getImageAttachment,
  getImageAttachmentSubmissionValidationError,
  getImageAttachmentUploadMode,
  isLocalImageAttachmentPathname,
  parseAttachmentIdFromImageUrl,
  processCompletedImageUpload,
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
  __setImageAttachmentBlobTestOverridesForTests(null);
  __setDatabaseResourcesForTests(null);
});

function blobGetResult(buffer: Buffer) {
  return {
    blob: null,
    statusCode: 200,
    stream: new Response(buffer).body,
  } as unknown as Awaited<ReturnType<typeof import("@vercel/blob").get>>;
}

function missingBlobGetResult() {
  return {
    blob: null,
    statusCode: 404,
    stream: null,
  } as unknown as Awaited<ReturnType<typeof import("@vercel/blob").get>>;
}

test("builds RateLoop upload image URLs with a webp extension", () => {
  assert.equal(
    getAttachmentImageUrl("https://www.curyo.xyz/ask", "att_abcdefghijklmnop"),
    "https://www.curyo.xyz/api/attachments/images/att_abcdefghijklmnop.webp",
  );
});

test("parses RateLoop attachment ids from public upload image URLs", () => {
  assert.equal(
    parseAttachmentIdFromImageUrl("https://www.curyo.xyz/api/attachments/images/att_abcdefghijklmnop.webp"),
    "att_abcdefghijklmnop",
  );
  assert.equal(parseAttachmentIdFromImageUrl("https://www.curyo.xyz/api/attachments/images/nope.png"), null);
  assert.equal(
    parseAttachmentIdFromImageUrl("https://evil.example/api/attachments/images/att_abcdefghijklmnop.webp"),
    null,
  );
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

test("processes Vercel Blob image uploads without deleting duplicate completions", async () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalModerationMode = process.env.CURYO_IMAGE_MODERATION_MODE;
  const attachmentId = "att_blobuploadimage001";
  const originalPathname = `question-attachments/${attachmentId}/original.png`;
  const normalizedPathname = `question-attachments/${attachmentId}/image.webp`;
  let deleteCalls = 0;
  let getCalls = 0;
  let putCalls = 0;

  __setImageAttachmentBlobTestOverridesForTests({
    deleteBlob: async pathname => {
      assert.equal(pathname, originalPathname);
      deleteCalls += 1;
    },
    getBlob: async pathname => {
      assert.equal(pathname, originalPathname);
      getCalls += 1;
      return blobGetResult(ONE_PIXEL_PNG);
    },
    putBlob: async pathname => {
      assert.equal(pathname, normalizedPathname);
      putCalls += 1;
      return { pathname, url: null } as unknown as Awaited<ReturnType<typeof import("@vercel/blob").put>>;
    },
  });

  try {
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

    await processCompletedImageUpload({
      attachmentId,
      blobPathname: originalPathname,
      blobUrl: "https://blob.example/original.png",
      contentType: "image/png",
    });
    await processCompletedImageUpload({
      attachmentId,
      blobPathname: originalPathname,
      blobUrl: "https://blob.example/original.png",
      contentType: "image/png",
    });

    const attachment = await getImageAttachment(attachmentId);
    assert.equal(attachment?.status, "approved");
    assert.equal(attachment?.originalBlobPathname, originalPathname);
    assert.equal(attachment?.normalizedBlobPathname, normalizedPathname);
    assert.equal(getCalls, 1);
    assert.equal(putCalls, 1);
    assert.equal(deleteCalls, 1);
  } finally {
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
  }
});

test("leaves uploading image attachments retryable when the blob is missing", async () => {
  const attachmentId = "att_missingblobimage01";
  const originalPathname = `question-attachments/${attachmentId}/missing.png`;
  let deleteCalls = 0;
  let getCalls = 0;

  __setImageAttachmentBlobTestOverridesForTests({
    deleteBlob: async () => {
      deleteCalls += 1;
    },
    getBlob: async pathname => {
      assert.equal(pathname, originalPathname);
      getCalls += 1;
      return missingBlobGetResult();
    },
  });

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

  await assert.rejects(
    () =>
      processCompletedImageUpload({
        attachmentId,
        blobPathname: originalPathname,
        blobUrl: "https://blob.example/missing.png",
        contentType: "image/png",
      }),
    /Uploaded image blob was not found/,
  );

  const attachment = await getImageAttachment(attachmentId);
  assert.equal(attachment?.status, "uploading");
  assert.equal(attachment?.originalBlobPathname, null);
  assert.equal(getCalls, 1);
  assert.equal(deleteCalls, 0);
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
      imageUrls: ["https://evil.example/api/attachments/images/att_abcdefghijklmnop.webp"],
      ownerWalletAddress: "0x00000000000000000000000000000000000000AA",
    }),
    "imageUrls must reference approved RateLoop-hosted uploads.",
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
