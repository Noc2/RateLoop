import { NextRequest } from "next/server";
import { POST } from "./route";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

const env = process.env as Record<string, string | undefined>;
const originalAgentBytes = env.RATELOOP_MCP_IMAGE_UPLOAD_DAILY_BYTES;
const originalAgentLimit = env.RATELOOP_MCP_IMAGE_UPLOAD_DAILY_LIMIT;
const originalAgents = env.RATELOOP_MCP_AGENTS;
const originalBlobToken = env.BLOB_READ_WRITE_TOKEN;
const originalDatabaseUrl = env.DATABASE_URL;
const originalImageDir = env.RATELOOP_LOCAL_IMAGE_ATTACHMENT_DIR;
const originalModerationMode = env.RATELOOP_IMAGE_MODERATION_MODE;
const originalOpenAiKey = env.OPENAI_API_KEY;

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

function uploadRequest(attachmentId: string, payloadOverrides: Record<string, unknown> = {}) {
  const formData = new FormData();
  const file = new File([ONE_PIXEL_PNG], "mockup.png", { type: "image/png" });
  formData.set("file", file);
  formData.set(
    "clientPayload",
    JSON.stringify({
      address: "0x00000000000000000000000000000000000000aa",
      attachmentId,
      filename: "mockup.png",
      mimeType: "image/png",
      ...payloadOverrides,
      sha256: createHash("sha256").update(ONE_PIXEL_PNG).digest("hex"),
      sizeBytes: ONE_PIXEL_PNG.length,
    }),
  );

  return new NextRequest("https://rateloop.ai/api/attachments/images/upload", {
    body: formData,
    headers: new Headers({
      authorization: "Bearer secret-token",
    }),
    method: "POST",
  });
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  env.DATABASE_URL = "memory:";
  env.RATELOOP_MCP_AGENTS = JSON.stringify([
    {
      dailyBudgetAtomic: "5000000",
      id: "upload-agent",
      perAskLimitAtomic: "1000000",
      scopes: ["rateloop:ask"],
      token: "secret-token",
      walletAddress: "0x00000000000000000000000000000000000000aa",
    },
  ]);
  env.RATELOOP_MCP_IMAGE_UPLOAD_DAILY_LIMIT = "1";
  env.RATELOOP_MCP_IMAGE_UPLOAD_DAILY_BYTES = String(10 * 1024 * 1024);
  env.RATELOOP_IMAGE_MODERATION_MODE = "disabled";
  delete env.BLOB_READ_WRITE_TOKEN;
  delete env.OPENAI_API_KEY;
});

after(() => {
  __setDatabaseResourcesForTests(null);
  restoreEnv("BLOB_READ_WRITE_TOKEN", originalBlobToken);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("OPENAI_API_KEY", originalOpenAiKey);
  restoreEnv("RATELOOP_IMAGE_MODERATION_MODE", originalModerationMode);
  restoreEnv("RATELOOP_LOCAL_IMAGE_ATTACHMENT_DIR", originalImageDir);
  restoreEnv("RATELOOP_MCP_AGENTS", originalAgents);
  restoreEnv("RATELOOP_MCP_IMAGE_UPLOAD_DAILY_BYTES", originalAgentBytes);
  restoreEnv("RATELOOP_MCP_IMAGE_UPLOAD_DAILY_LIMIT", originalAgentLimit);
});

test("MCP image uploads cannot rotate attachment ids around the agent daily quota", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "rateloop-upload-route-"));

  try {
    env.RATELOOP_LOCAL_IMAGE_ATTACHMENT_DIR = tempDir;

    const first = await POST(uploadRequest("att_routeuploadimage01"));
    assert.equal(first.status, 200);
    assert.equal((await first.json()).status, "approved");

    const second = await POST(uploadRequest("att_routeuploadimage02"));
    assert.equal(second.status, 429);
    assert.deepEqual(await second.json(), { error: "Daily image upload quota exceeded." });

    const rows = await dbClient.execute(
      "SELECT subject_kind, subject_id, image_count FROM image_upload_daily_quotas ORDER BY subject_kind",
    );
    assert.deepEqual(
      rows.rows.map(row => ({
        imageCount: Number(row.image_count),
        subjectId: row.subject_id,
        subjectKind: row.subject_kind,
      })),
      [
        { imageCount: 1, subjectId: "upload-agent", subjectKind: "agent" },
        { imageCount: 1, subjectId: "0x00000000000000000000000000000000000000aa", subjectKind: "wallet" },
      ],
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("duplicate image attachment ids do not consume upload quota", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "rateloop-upload-route-"));

  try {
    env.RATELOOP_LOCAL_IMAGE_ATTACHMENT_DIR = tempDir;

    const first = await POST(uploadRequest("att_routeduplicate01"));
    assert.equal(first.status, 200);
    assert.equal((await first.json()).status, "approved");

    const duplicate = await POST(uploadRequest("att_routeduplicate01"));
    assert.equal(duplicate.status, 400);
    assert.deepEqual(await duplicate.json(), { error: "Image attachment already exists." });

    const rows = await dbClient.execute(
      "SELECT subject_kind, subject_id, image_count FROM image_upload_daily_quotas ORDER BY subject_kind",
    );
    assert.deepEqual(
      rows.rows.map(row => ({
        imageCount: Number(row.image_count),
        subjectId: row.subject_id,
        subjectKind: row.subject_kind,
      })),
      [
        { imageCount: 1, subjectId: "upload-agent", subjectKind: "agent" },
        { imageCount: 1, subjectId: "0x00000000000000000000000000000000000000aa", subjectKind: "wallet" },
      ],
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("image upload applies the pending gated attachment migration before insert", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "rateloop-upload-route-"));

  try {
    env.RATELOOP_LOCAL_IMAGE_ATTACHMENT_DIR = tempDir;
    await dbClient.execute("ALTER TABLE question_image_attachments DROP COLUMN requires_gated_access");

    const response = await POST(uploadRequest("att_missinggatedcol01", { requiresGatedAccess: true }));
    const body = (await response.json()) as { status?: string };

    assert.equal(response.status, 200);
    assert.equal(body.status, "approved");

    const rows = await dbClient.execute(
      "SELECT requires_gated_access FROM question_image_attachments WHERE id = 'att_missinggatedcol01'",
    );
    assert.equal(rows.rows[0]?.requires_gated_access, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("image upload route rejects oversized multipart bodies before parsing", async () => {
  const response = await POST(
    new NextRequest("https://rateloop.ai/api/attachments/images/upload", {
      body: "oversized-placeholder",
      headers: new Headers({
        "content-length": String(10 * 1024 * 1024 + 128 * 1024 + 1),
        "content-type": "multipart/form-data; boundary=rateloop",
      }),
      method: "POST",
    }),
  );

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "Upload is too large." });
});
