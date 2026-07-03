import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, db } from "~~/lib/db";
import { questionImageAttachments } from "~~/lib/db/schema";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";

const env = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = env.DATABASE_URL;
const originalSweepSecret = env.RATELOOP_IMAGE_ATTACHMENT_SWEEP_SECRET;
const originalCronSecret = env.CRON_SECRET;

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

function cronRequest(token = "cron-secret") {
  return new NextRequest("https://rateloop.ai/api/attachments/images/sweep?limit=10", {
    headers: new Headers({
      authorization: `Bearer ${token}`,
    }),
    method: "GET",
  });
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  env.DATABASE_URL = "memory:";
  env.RATELOOP_IMAGE_ATTACHMENT_SWEEP_SECRET = "sweep-secret";
  delete env.CRON_SECRET;
});

after(() => {
  __setDatabaseResourcesForTests(null);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("RATELOOP_IMAGE_ATTACHMENT_SWEEP_SECRET", originalSweepSecret);
  restoreEnv("CRON_SECRET", originalCronSecret);
});

test("image attachment sweep route rejects unconfigured and unauthorized requests", async () => {
  delete env.RATELOOP_IMAGE_ATTACHMENT_SWEEP_SECRET;
  delete env.CRON_SECRET;

  const missing = await POST(sweepRequest("sweep-secret"));
  assert.equal(missing.status, 503);
  assert.deepEqual(await missing.json(), { error: "Image attachment sweep is not configured." });

  env.RATELOOP_IMAGE_ATTACHMENT_SWEEP_SECRET = "sweep-secret";
  const response = await POST(sweepRequest("wrong-secret"));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized." });
});

test("image attachment sweep route accepts Vercel cron GET bearer auth", async () => {
  delete env.RATELOOP_IMAGE_ATTACHMENT_SWEEP_SECRET;
  env.CRON_SECRET = "cron-secret";

  const response = await GET(cronRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: 0, scanned: 0 });
});

test("image attachment sweep route rejects malformed limits", async () => {
  const response = await POST(
    new NextRequest("https://rateloop.ai/api/attachments/images/sweep?limit=10junk", {
      headers: new Headers({
        authorization: "Bearer sweep-secret",
      }),
      method: "POST",
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "limit must be a positive integer." });
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

test("Vercel cron schedules attachment sweep routes", () => {
  const vercelConfig = JSON.parse(readFileSync(new URL("../../../../../vercel.json", import.meta.url), "utf8")) as {
    crons?: Array<{ path?: string; schedule?: string }>;
  };
  const sweepCrons = (vercelConfig.crons ?? []).filter(cron => cron.path?.includes("/api/attachments/"));

  assert.deepEqual(sweepCrons, [
    {
      path: "/api/attachments/images/sweep",
      schedule: "31 * * * *",
    },
    {
      path: "/api/attachments/details/sweep",
      schedule: "43 3 * * *",
    },
  ]);
});
