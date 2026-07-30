import assert from "node:assert/strict";
import test from "node:test";
import {
  BoundedRequestBodyError,
  readBoundedJsonRequestBody,
  readBoundedRequestBytes,
  readBoundedRequestText,
} from "~~/lib/tokenless/boundedRequestBody";

const encoder = new TextEncoder();

function streamedRequest(chunks: Uint8Array[], headers: HeadersInit = {}) {
  let index = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
  return {
    request: { body, headers: new Headers(headers) },
    wasCancelled: () => cancelled,
  };
}

test("bounded byte reads accept the exact byte limit across streamed chunks", async () => {
  const input = streamedRequest([encoder.encode("ab"), encoder.encode("cd")]);
  assert.equal(new TextDecoder().decode(await readBoundedRequestBytes(input.request, 4)), "abcd");
  assert.equal(input.wasCancelled(), false);
});

test("bounded byte reads cancel an omitted-length stream as soon as limit plus one arrives", async () => {
  const input = streamedRequest([encoder.encode("ab"), encoder.encode("cd"), encoder.encode("e")]);
  await assert.rejects(
    () => readBoundedRequestBytes(input.request, 4),
    (error: unknown) => error instanceof BoundedRequestBodyError && error.reason === "body_too_large",
  );
  assert.equal(input.wasCancelled(), true);
});

test("bounded byte reads reject malformed Content-Length before consuming the stream", async () => {
  for (const declared of ["-1", "+1", "1.5", "1e2", "not-a-number", "9007199254740992"]) {
    const input = streamedRequest([encoder.encode("a")], { "content-length": declared });
    await assert.rejects(
      () => readBoundedRequestBytes(input.request, 4),
      (error: unknown) => error instanceof BoundedRequestBodyError && error.reason === "invalid_content_length",
    );
    assert.equal(input.wasCancelled(), false);
  }
});

test("bounded text and JSON reads reject non-UTF-8 bytes without replacement", async () => {
  const text = streamedRequest([new Uint8Array([0xc3, 0x28])]);
  await assert.rejects(
    () => readBoundedRequestText(text.request, 2),
    (error: unknown) => error instanceof BoundedRequestBodyError && error.reason === "invalid_utf8",
  );

  const json = streamedRequest([new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xc3, 0x28, 0x7d])]);
  await assert.rejects(
    () => readBoundedJsonRequestBody(json.request, 8),
    (error: unknown) => error instanceof BoundedRequestBodyError && error.reason === "invalid_json",
  );
});
