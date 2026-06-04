import { NextRequest } from "next/server";
import { POST } from "./route";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testMemory";

const env = process.env as Record<string, string | undefined>;
const originalAgents = env.RATELOOP_MCP_AGENTS;
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

function uploadRequest(params: { content: string; documentId: string; filename?: string; mimeType?: string }) {
  const buffer = Buffer.from(params.content, "utf8");
  const filename = params.filename ?? "context.md";
  const mimeType = params.mimeType ?? "text/markdown";
  const formData = new FormData();
  const file = new File([buffer], filename, { type: mimeType });
  formData.set("document", file);
  formData.set(
    "clientPayload",
    JSON.stringify({
      address: "0x00000000000000000000000000000000000000aa",
      documentId: params.documentId,
      filename,
      mimeType,
      sha256: sha256(buffer),
      sizeBytes: buffer.byteLength,
    }),
  );

  return new NextRequest("https://rateloop.ai/api/attachments/documents/upload", {
    body: formData,
    headers: new Headers({
      authorization: "Bearer secret-token",
    }),
    method: "POST",
  });
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  env.APP_URL = "https://www.rateloop.ai";
  env.DATABASE_URL = "memory:";
  env.RATELOOP_CONTEXT_DOCUMENT_MODERATION_MODE = "disabled";
  env.RATELOOP_MCP_AGENTS = JSON.stringify([
    {
      dailyBudgetAtomic: "5000000",
      id: "document-agent",
      perAskLimitAtomic: "1000000",
      scopes: ["rateloop:ask"],
      token: "secret-token",
      walletAddress: "0x00000000000000000000000000000000000000aa",
    },
  ]);
  delete env.OPENAI_API_KEY;
});

after(() => {
  __setDatabaseResourcesForTests(null);
  restoreEnv("APP_URL", originalAppUrl);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("OPENAI_API_KEY", originalOpenAiKey);
  restoreEnv("RATELOOP_CONTEXT_DOCUMENT_MODERATION_MODE", originalModerationMode);
  restoreEnv("RATELOOP_MCP_AGENTS", originalAgents);
});

test("document upload accepts managed agent markdown context", async () => {
  const response = await POST(
    uploadRequest({
      content: "# Business plan\n\nKeep the first launch focused.",
      documentId: "doc_routecontextdocument01",
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    contextUrl: "https://www.rateloop.ai/context/documents/doc_routecontextdocument01",
    documentId: "doc_routecontextdocument01",
    error: null,
    filename: "context.md",
    moderationStatus: "approved",
    nextAction: "Use contextUrl as the question context source.",
    preview: "# Business plan\n\nKeep the first launch focused.",
    status: "approved",
  });

  const rows = await dbClient.execute("SELECT id, normalized_text FROM question_context_documents");
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0]?.id, "doc_routecontextdocument01");
});

test("document upload returns the sanitized display filename", async () => {
  const response = await POST(
    uploadRequest({
      content: "Launch memo context.",
      documentId: "doc_routecontextdocument03",
      filename: "folder\\\u202Ememo\u0001/final.txt",
      mimeType: "text/plain",
    }),
  );

  assert.equal(response.status, 200);
  const json = (await response.json()) as { filename?: string };
  assert.equal(json.filename, "folder memo final.txt");

  const rows = await dbClient.execute("SELECT original_filename FROM question_context_documents");
  assert.equal(rows.rows[0]?.original_filename, "folder memo final.txt");
});

test("document upload rejects unsupported file extensions", async () => {
  const response = await POST(
    uploadRequest({
      content: "%PDF-nope",
      documentId: "doc_routecontextdocument02",
      filename: "context.pdf",
      mimeType: "application/pdf",
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Upload a TXT or Markdown document." });
});
