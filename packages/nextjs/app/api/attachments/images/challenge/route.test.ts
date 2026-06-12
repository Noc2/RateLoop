import { NextRequest } from "next/server";
import { POST } from "./route";
import assert from "node:assert/strict";
import { after, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalBlobToken = env.BLOB_READ_WRITE_TOKEN;
const originalNodeEnv = env.NODE_ENV;

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

function challengeRequest() {
  return new NextRequest("https://rateloop.ai/api/attachments/images/challenge", {
    body: JSON.stringify({
      address: "0x00000000000000000000000000000000000000aa",
      attachmentId: "att_missingblobtoken01",
      filename: "mockup.png",
      mimeType: "image/png",
      sha256: "a".repeat(64),
      sizeBytes: 1024,
    }),
    headers: new Headers({ "Content-Type": "application/json" }),
    method: "POST",
  });
}

after(() => {
  restoreEnv("BLOB_READ_WRITE_TOKEN", originalBlobToken);
  restoreEnv("NODE_ENV", originalNodeEnv);
});

test("image upload challenge reports missing production Blob configuration before signing", async () => {
  env.NODE_ENV = "production";
  delete env.BLOB_READ_WRITE_TOKEN;

  const response = await POST(challengeRequest());

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Image uploads are not configured. Set BLOB_READ_WRITE_TOKEN in the deployment environment.",
  });
});

test("image upload challenge reports invalid production Blob configuration before signing", async () => {
  env.NODE_ENV = "production";
  env.BLOB_READ_WRITE_TOKEN = "not-a-vercel-blob-token";

  const response = await POST(challengeRequest());

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Image uploads are misconfigured. Set BLOB_READ_WRITE_TOKEN to a Vercel Blob read-write token.",
  });
});
