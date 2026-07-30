import assert from "node:assert/strict";
import test from "node:test";
import {
  API_JSON_REQUEST_BODY_MAX_BYTES,
  API_OAUTH_FORM_BODY_MAX_BYTES,
  apiRequestBodyFallback,
  multipartFormBodyLimit,
  readApiFormDataRequestBody,
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

test("bounded form parsing supports URL-encoded and multipart bodies", async () => {
  const urlEncoded = request("decision=approve&user_code=ABCD", "32");
  urlEncoded.headers.set("content-type", "application/x-www-form-urlencoded");
  const fields = await readApiFormDataRequestBody(urlEncoded, API_OAUTH_FORM_BODY_MAX_BYTES);
  assert.equal(fields.get("decision"), "approve");
  assert.equal(fields.get("user_code"), "ABCD");

  const boundary = "rateloop-test-boundary";
  const multipartBody = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="clientRequestId"',
    "",
    "request-123",
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="sample.txt"',
    "Content-Type: text/plain",
    "",
    "sample",
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const multipart = request(multipartBody);
  multipart.headers.set("content-type", `multipart/form-data; boundary=${boundary}`);
  const upload = await readApiFormDataRequestBody(multipart, multipartFormBodyLimit(64));
  assert.equal(upload.get("clientRequestId"), "request-123");
  const file = upload.get("file");
  assert.ok(file instanceof File);
  assert.equal(file.name, "sample.txt");
  assert.equal(await file.text(), "sample");
});

test("bounded form parsing rejects unsupported and malformed form bodies", async () => {
  await serviceError(readApiFormDataRequestBody(request("field=value"), 64), 415, "invalid_form_data_content_type");

  const malformed = request("not-a-multipart-body");
  malformed.headers.set("content-type", "multipart/form-data; boundary=missing");
  await serviceError(readApiFormDataRequestBody(malformed, 64), 400, "invalid_form_data");

  const streamedOverflow = request(`field=${"x".repeat(API_OAUTH_FORM_BODY_MAX_BYTES - 5)}`);
  streamedOverflow.headers.set("content-type", "application/x-www-form-urlencoded");
  assert.equal(
    new TextEncoder().encode(`field=${"x".repeat(API_OAUTH_FORM_BODY_MAX_BYTES - 5)}`).byteLength,
    API_OAUTH_FORM_BODY_MAX_BYTES + 1,
  );
  await serviceError(
    readApiFormDataRequestBody(streamedOverflow, API_OAUTH_FORM_BODY_MAX_BYTES),
    413,
    "request_too_large",
  );
});
