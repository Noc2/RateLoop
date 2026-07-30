import assert from "node:assert/strict";
import test from "node:test";
import {
  API_JSON_REQUEST_BODY_MAX_BYTES,
  apiRequestBodyFallback,
  readApiJsonRequestBody,
  readApiRequestBytes,
  readApiRequestText,
} from "~~/lib/tokenless/apiRequestBody";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

function request(body: string, contentLength?: string) {
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
    headers: new Headers(contentLength === undefined ? undefined : { "content-length": contentLength }),
  };
}

async function serviceError(operation: Promise<unknown>, expectedStatus: number, expectedCode: string) {
  await assert.rejects(
    operation,
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.status === expectedStatus && error.code === expectedCode,
  );
}

test("API JSON bodies use one exact 64 KiB streaming boundary", async () => {
  const exact = JSON.stringify({ value: "x".repeat(API_JSON_REQUEST_BODY_MAX_BYTES - 12) });
  assert.equal(new TextEncoder().encode(exact).byteLength, API_JSON_REQUEST_BODY_MAX_BYTES);
  assert.deepEqual(await readApiJsonRequestBody(request(exact)), {
    value: "x".repeat(API_JSON_REQUEST_BODY_MAX_BYTES - 12),
  });

  const over = `${exact} `;
  await serviceError(readApiJsonRequestBody(request(over)), 413, "request_too_large");
  await serviceError(
    readApiJsonRequestBody(request("{}", String(API_JSON_REQUEST_BODY_MAX_BYTES + 1))),
    413,
    "request_too_large",
  );
});

test("API body readers reject malformed declarations and invalid encodings consistently", async () => {
  await serviceError(readApiRequestBytes(request("{}", "invalid"), 64), 400, "invalid_content_length");
  await serviceError(readApiJsonRequestBody(request("{")), 400, "invalid_json");

  const invalidUtf8 = {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([0xc3, 0x28]));
        controller.close();
      },
    }),
    headers: new Headers(),
  };
  await serviceError(readApiRequestText(invalidUtf8, 64), 400, "invalid_json");
});

test("invalid-JSON fallbacks preserve boundary failures", () => {
  const boundary = new TokenlessServiceError("too large", 413, "request_too_large");
  assert.throws(
    () => apiRequestBodyFallback(boundary, null),
    (error: unknown) => error === boundary,
  );
  assert.equal(apiRequestBodyFallback(new Error("invalid JSON"), null), null);
});
