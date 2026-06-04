import { NextRequest } from "next/server";
import { POST } from "./route";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, db } from "~~/lib/db";
import { questionContextDocuments } from "~~/lib/db/schema";
import { createMemoryDatabaseResources } from "~~/lib/db/testMemory";

const env = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = env.DATABASE_URL;
const originalSweepSecret = env.RATELOOP_CONTEXT_DOCUMENT_SWEEP_SECRET;

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

function sweepRequest(token = "sweep-secret") {
  return new NextRequest("https://rateloop.ai/api/attachments/documents/sweep?limit=10", {
    headers: new Headers({
      authorization: `Bearer ${token}`,
    }),
    method: "POST",
  });
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  env.DATABASE_URL = "memory:";
  env.RATELOOP_CONTEXT_DOCUMENT_SWEEP_SECRET = "sweep-secret";
});

after(() => {
  __setDatabaseResourcesForTests(null);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("RATELOOP_CONTEXT_DOCUMENT_SWEEP_SECRET", originalSweepSecret);
});

test("context document sweep route requires its secret", async () => {
  const response = await POST(sweepRequest("wrong-secret"));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized." });
});

test("context document sweep route deletes expired unattached uploads", async () => {
  const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await db.insert(questionContextDocuments).values({
    id: "doc_sweeprouteold01",
    uploaderKind: "wallet",
    ownerWalletAddress: "0x00000000000000000000000000000000000000aa",
    originalFilename: "old.md",
    mimeType: "text/markdown",
    sizeBytes: 1024,
    sha256: "a".repeat(64),
    normalizedText: "Expired context.",
    status: "approved",
    moderationStatus: "approved",
    createdAt: oldDate,
    updatedAt: oldDate,
  });

  const response = await POST(sweepRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: 1, scanned: 1 });
});
