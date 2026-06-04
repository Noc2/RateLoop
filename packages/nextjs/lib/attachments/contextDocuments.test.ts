import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, beforeEach, test } from "node:test";
import {
  attachContextDocumentToContent,
  createContextDocumentFromBuffer,
  getContextDocument,
  getContextDocumentSubmissionValidationError,
  getContextDocumentUrl,
  parseContextDocumentIdFromContextUrl,
} from "~~/lib/attachments/contextDocuments";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testMemory";

const env = process.env as Record<string, string | undefined>;
const originalAppUrl = env.APP_URL;
const originalDatabaseUrl = env.DATABASE_URL;
const originalModerationMode = env.RATELOOP_CONTEXT_DOCUMENT_MODERATION_MODE;
const originalOpenAiKey = env.OPENAI_API_KEY;

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  env.APP_URL = "https://www.rateloop.ai";
  env.DATABASE_URL = "memory:";
  env.RATELOOP_CONTEXT_DOCUMENT_MODERATION_MODE = "disabled";
  delete env.OPENAI_API_KEY;
});

after(() => {
  __setDatabaseResourcesForTests(null);
  restoreEnv("APP_URL", originalAppUrl);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("OPENAI_API_KEY", originalOpenAiKey);
  restoreEnv("RATELOOP_CONTEXT_DOCUMENT_MODERATION_MODE", originalModerationMode);
});

test("createContextDocumentFromBuffer stores approved normalized text", async () => {
  const buffer = Buffer.from("\uFEFF# Plan\r\n\r\nShip the narrow version first.\r\n", "utf8");
  const result = await createContextDocumentFromBuffer({
    buffer,
    documentId: "doc_testcontextdocument01",
    filename: "plan.md",
    mimeType: "text/plain",
    requestUrl: "https://rateloop.ai/api/attachments/documents/upload",
    sha256: sha256(buffer),
    sizeBytes: buffer.byteLength,
    uploader: {
      kind: "wallet",
      ownerWalletAddress: "0x00000000000000000000000000000000000000aa",
    },
  });

  assert.equal(result.status, "approved");
  assert.equal(result.contextUrl, "https://www.rateloop.ai/context/documents/doc_testcontextdocument01");
  assert.equal(result.filename, "plan.md");

  const document = await getContextDocument("doc_testcontextdocument01");
  assert.equal(document?.originalFilename, "plan.md");
  assert.equal(document?.normalizedText, "# Plan\n\nShip the narrow version first.");
  assert.equal(document?.mimeType, "text/markdown");
});

test("createContextDocumentFromBuffer stores a sanitized display filename", async () => {
  const buffer = Buffer.from("Public written context with a tricky filename.", "utf8");
  const result = await createContextDocumentFromBuffer({
    buffer,
    documentId: "doc_testcontextdocument07",
    filename: "../\u202Esecret\u0007/report.md",
    mimeType: "text/markdown",
    requestUrl: "https://rateloop.ai/api/attachments/documents/upload",
    sha256: sha256(buffer),
    sizeBytes: buffer.byteLength,
    uploader: {
      kind: "wallet",
      ownerWalletAddress: "0x00000000000000000000000000000000000000aa",
    },
  });

  assert.equal(result.status, "approved");
  assert.equal(result.filename, "secret report.md");

  const document = await getContextDocument("doc_testcontextdocument07");
  assert.equal(document?.originalFilename, "secret report.md");
});

test("createContextDocumentFromBuffer rejects binary-like control characters", async () => {
  const buffer = Buffer.from("hello\u0000world", "utf8");
  const result = await createContextDocumentFromBuffer({
    buffer,
    documentId: "doc_testcontextdocument02",
    filename: "notes.txt",
    mimeType: "text/plain",
    requestUrl: "https://rateloop.ai/api/attachments/documents/upload",
    sha256: sha256(buffer),
    sizeBytes: buffer.byteLength,
    uploader: {
      kind: "wallet",
      ownerWalletAddress: "0x00000000000000000000000000000000000000aa",
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.contextUrl, null);
  assert.match(result.error ?? "", /control characters/i);
});

test("getContextDocumentUrl uses configured app origin", () => {
  assert.equal(
    getContextDocumentUrl("https://localhost:3000/api/attachments/documents/upload", "doc_testcontextdocument03"),
    "https://www.rateloop.ai/context/documents/doc_testcontextdocument03",
  );
});

test("parseContextDocumentIdFromContextUrl rejects lookalike origins", () => {
  assert.equal(
    parseContextDocumentIdFromContextUrl("https://www.rateloop.ai/context/documents/doc_testcontextdocument04"),
    "doc_testcontextdocument04",
  );
  assert.equal(
    parseContextDocumentIdFromContextUrl("https://example.com/context/documents/doc_testcontextdocument04"),
    null,
  );
});

test("getContextDocumentSubmissionValidationError requires approved owner", async () => {
  const buffer = Buffer.from("This is public supporting context.", "utf8");
  const contextUrl = "https://www.rateloop.ai/context/documents/doc_testcontextdocument05";
  await createContextDocumentFromBuffer({
    buffer,
    documentId: "doc_testcontextdocument05",
    filename: "context.txt",
    mimeType: "text/plain",
    requestUrl: "https://rateloop.ai/api/attachments/documents/upload",
    sha256: sha256(buffer),
    sizeBytes: buffer.byteLength,
    uploader: {
      kind: "wallet",
      ownerWalletAddress: "0x00000000000000000000000000000000000000aa",
    },
  });

  assert.equal(
    await getContextDocumentSubmissionValidationError({
      contextUrl,
      ownerWalletAddress: "0x00000000000000000000000000000000000000AA",
    }),
    null,
  );
  assert.match(
    (await getContextDocumentSubmissionValidationError({
      contextUrl,
      ownerWalletAddress: "0x00000000000000000000000000000000000000bb",
    })) ?? "",
    /submitting wallet or agent/i,
  );
  assert.equal(
    await getContextDocumentSubmissionValidationError({
      contextUrl: "https://example.com/research",
      ownerWalletAddress: "0x00000000000000000000000000000000000000bb",
    }),
    null,
  );
});

test("attachContextDocumentToContent records the submitted content id", async () => {
  const buffer = Buffer.from("Post-submit document bookkeeping.", "utf8");
  const contextUrl = "https://www.rateloop.ai/context/documents/doc_testcontextdocument06";
  await createContextDocumentFromBuffer({
    buffer,
    documentId: "doc_testcontextdocument06",
    filename: "bookkeeping.md",
    mimeType: "text/markdown",
    requestUrl: "https://rateloop.ai/api/attachments/documents/upload",
    sha256: sha256(buffer),
    sizeBytes: buffer.byteLength,
    uploader: {
      kind: "wallet",
      ownerWalletAddress: "0x00000000000000000000000000000000000000aa",
    },
  });

  await attachContextDocumentToContent({
    contentId: "42",
    contextUrl,
    ownerWalletAddress: "0x00000000000000000000000000000000000000aa",
  });

  const document = await getContextDocument("doc_testcontextdocument06");
  assert.equal(document?.contentId, "42");
});
