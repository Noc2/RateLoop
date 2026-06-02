import { NextRequest } from "next/server";
import { POST } from "./route";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, db } from "~~/lib/db";
import { questionImageAttachments } from "~~/lib/db/schema";
import { createMemoryDatabaseResources } from "~~/lib/db/testMemory";

const env = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = env.DATABASE_URL;
const originalSweepSecret = env.RATELOOP_IMAGE_ATTACHMENT_SWEEP_SECRET;

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

function sweepRequest(token = "sweep-secret") {
  return new NextRequest("https://rateloop.ai/api/attachments/images/sweep?limit=10", {
    headers: new Headers({
      authorization: `Bearer ${token}`,
    }),
    method: "POST",
  });
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  env.DATABASE_URL = "memory:";
  env.RATELOOP_IMAGE_ATTACHMENT_SWEEP_SECRET = "sweep-secret";
});

after(() => {
  __setDatabaseResourcesForTests(null);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("RATELOOP_IMAGE_ATTACHMENT_SWEEP_SECRET", originalSweepSecret);
});

test("image attachment sweep route requires its secret", async () => {
  const response = await POST(sweepRequest("wrong-secret"));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized." });
});

test("image attachment sweep route deletes expired unattached uploads", async () => {
  const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await db.insert(questionImageAttachments).values({
    id: "att_sweeprouteold01",
    uploaderKind: "wallet",
    ownerWalletAddress: "0x00000000000000000000000000000000000000aa",
    originalFilename: "old.png",
    mimeType: "image/webp",
    sizeBytes: 1024,
    status: "approved",
    moderationStatus: "approved",
    createdAt: oldDate,
    updatedAt: oldDate,
  });

  const response = await POST(sweepRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: 1, scanned: 1 });
});
