import assert from "node:assert/strict";
import test from "node:test";
import { VERCEL_BLOB_OPERATION_TIMEOUT_MS, createPrivateBlobStorage } from "~~/lib/tokenless/privateBlobStorage";

function blobResult(body: string) {
  return {
    blob: {
      cacheControl: "private, no-store",
      contentDisposition: "attachment",
      contentType: "application/octet-stream",
      downloadUrl: "https://blob.example/download",
      etag: "etag_fixture",
      pathname: "fixture",
      size: body.length,
      uploadedAt: new Date(0),
      url: "https://blob.example/fixture",
    },
    headers: new Headers(),
    statusCode: 200 as const,
    stream: new Blob([body]).stream(),
  };
}

test("private Blob reads, writes, and deletes all receive bounded abort signals", async () => {
  const signals: AbortSignal[] = [];
  const storage = createPrivateBlobStorage({
    loadApi: async () => ({
      async del(_reference, options) {
        signals.push(options.abortSignal);
      },
      async get(_reference, options) {
        signals.push(options.abortSignal);
        return blobResult("fixture");
      },
      async put(_pathname, _body, options) {
        signals.push(options.abortSignal);
        return { url: "https://blob.example/stored" };
      },
    }),
  });

  await storage.delete("https://blob.example/old");
  assert.deepEqual(await storage.get("https://blob.example/fixture"), new TextEncoder().encode("fixture"));
  assert.equal(
    await storage.put("fixture", new Uint8Array([1]), "application/octet-stream"),
    "https://blob.example/stored",
  );

  assert.equal(signals.length, 3);
  assert.equal(new Set(signals).size, 3, "each provider operation receives its own deadline");
  assert.ok(signals.every(signal => !signal.aborted));
  assert.equal(VERCEL_BLOB_OPERATION_TIMEOUT_MS, 30_000);
});

test("a stalled Blob provider is aborted at the configured deadline", async () => {
  const storage = createPrivateBlobStorage({
    loadApi: async () => ({
      del: async (_reference, options) =>
        new Promise<void>((_resolve, reject) => {
          options.abortSignal.addEventListener("abort", () => reject(options.abortSignal.reason), { once: true });
        }),
      get: async () => null,
      put: async () => ({ url: "https://blob.example/unused" }),
    }),
    timeoutMs: 10,
  });

  await assert.rejects(storage.delete("https://blob.example/stalled"), error => {
    assert.ok(error instanceof DOMException);
    assert.equal(error.name, "TimeoutError");
    return true;
  });
});

test("invalid Blob deadlines fail closed before an operation starts", () => {
  assert.throws(() => createPrivateBlobStorage({ timeoutMs: 0 }), /positive integer/u);
  assert.throws(() => createPrivateBlobStorage({ timeoutMs: Number.POSITIVE_INFINITY }), /positive integer/u);
});
