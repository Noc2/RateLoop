import { requestImageUploadClientToken } from "./imageAttachmentBlobUpload";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("image upload client token request surfaces route error messages", async () => {
  globalThis.fetch = (async (input, init) => {
    assert.equal(input, "/api/attachments/images/upload");
    assert.equal(init?.method, "POST");

    return Response.json(
      { error: "Image uploads are not configured. Set BLOB_READ_WRITE_TOKEN in the deployment environment." },
      { status: 503 },
    );
  }) as typeof fetch;

  await assert.rejects(
    requestImageUploadClientToken({
      clientPayload: "{}",
      multipart: false,
      pathname: "question-attachments/att_123/original.png",
    }),
    /Set BLOB_READ_WRITE_TOKEN/,
  );
});

test("image upload client token request sends the Vercel Blob token event", async () => {
  globalThis.fetch = (async (_input, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), {
      type: "blob.generate-client-token",
      payload: {
        clientPayload: '{"attachmentId":"att_123"}',
        multipart: true,
        pathname: "question-attachments/att_123/original.png",
      },
    });

    return Response.json({ clientToken: "vercel_blob_client_store_secret" });
  }) as typeof fetch;

  const token = await requestImageUploadClientToken({
    clientPayload: JSON.stringify({ attachmentId: "att_123" }),
    multipart: true,
    pathname: "question-attachments/att_123/original.png",
  });

  assert.equal(token, "vercel_blob_client_store_secret");
});
