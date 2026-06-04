import {
  createContextDocumentFromBuffer,
  getContextDocument,
  getContextDocumentUrl,
} from "~~/lib/attachments/contextDocuments";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testMemory";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, beforeEach, test } from "node:test";

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

  const document = await getContextDocument("doc_testcontextdocument01");
  assert.equal(document?.normalizedText, "# Plan\n\nShip the narrow version first.");
  assert.equal(document?.mimeType, "text/markdown");
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
