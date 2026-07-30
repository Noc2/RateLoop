import "server-only";

export type BoundedRequestBodyFailure = "invalid_content_length" | "body_too_large" | "invalid_utf8" | "invalid_json";

export class BoundedRequestBodyError extends Error {
  constructor(
    readonly reason: BoundedRequestBodyFailure,
    message: string,
  ) {
    super(message);
    this.name = "BoundedRequestBodyError";
  }
}

type RequestBodySource = Pick<Request, "body" | "headers">;

function assertLimit(limitBytes: number) {
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 0) {
    throw new RangeError("limitBytes must be a non-negative safe integer.");
  }
}

function declaredContentLength(headers: Headers, limitBytes: number) {
  const declared = headers.get("content-length");
  if (declared === null) return;
  if (!/^[0-9]+$/u.test(declared)) {
    throw new BoundedRequestBodyError("invalid_content_length", "Content-Length is invalid.");
  }
  const parsed = Number(declared);
  if (!Number.isSafeInteger(parsed)) {
    throw new BoundedRequestBodyError("invalid_content_length", "Content-Length is invalid.");
  }
  if (parsed > limitBytes) {
    throw new BoundedRequestBodyError("body_too_large", "Request body exceeds its byte limit.");
  }
}

/**
 * Reads a request stream without ever buffering more than `limitBytes`.
 *
 * `Content-Length` is only an early rejection optimization: streamed bytes remain authoritative,
 * because transfer encoding and intermediary behavior can omit or invalidate that declaration.
 */
export async function readBoundedRequestBytes(request: RequestBodySource, limitBytes: number): Promise<Uint8Array> {
  assertLimit(limitBytes);
  declaredContentLength(request.headers, limitBytes);
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > limitBytes) {
        try {
          await reader.cancel();
        } catch {
          // The bounded rejection remains authoritative even when stream cancellation fails.
        }
        throw new BoundedRequestBodyError("body_too_large", "Request body exceeds its byte limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readBoundedRequestText(request: RequestBodySource, limitBytes: number): Promise<string> {
  const bytes = await readBoundedRequestBytes(request, limitBytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new BoundedRequestBodyError("invalid_utf8", "Request body must be valid UTF-8.");
  }
}

export async function readBoundedJsonRequestBody(request: RequestBodySource, limitBytes: number): Promise<unknown> {
  let text: string;
  try {
    text = await readBoundedRequestText(request, limitBytes);
  } catch (error) {
    if (error instanceof BoundedRequestBodyError && error.reason === "invalid_utf8") {
      throw new BoundedRequestBodyError("invalid_json", "Request body must be valid UTF-8 JSON.");
    }
    throw error;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BoundedRequestBodyError("invalid_json", "Request body must be valid JSON.");
  }
}
