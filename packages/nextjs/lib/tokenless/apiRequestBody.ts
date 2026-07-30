import "server-only";
import {
  BoundedRequestBodyError,
  readBoundedJsonRequestBody,
  readBoundedRequestBytes,
  readBoundedRequestText,
} from "~~/lib/tokenless/boundedRequestBody";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const API_JSON_REQUEST_BODY_MAX_BYTES = 64 * 1_024;
export const API_OAUTH_FORM_BODY_MAX_BYTES = API_JSON_REQUEST_BODY_MAX_BYTES;
// Leaves room for multipart boundaries plus a handful of short metadata fields without weakening
// each route's downstream file-byte check.
export const API_MULTIPART_ENVELOPE_MAX_BYTES = 64 * 1_024;

export function multipartFormBodyLimit(fileLimitBytes: number) {
  if (!Number.isSafeInteger(fileLimitBytes) || fileLimitBytes < 0) {
    throw new RangeError("fileLimitBytes must be a non-negative safe integer.");
  }
  const limit = fileLimitBytes + API_MULTIPART_ENVELOPE_MAX_BYTES;
  if (!Number.isSafeInteger(limit)) {
    throw new RangeError("Multipart body limit must be a safe integer.");
  }
  return limit;
}

type RequestBodySource = Pick<Request, "body" | "headers">;

function bodyError(error: BoundedRequestBodyError, limitBytes: number): never {
  if (error.reason === "invalid_content_length") {
    throw new TokenlessServiceError("Content-Length is invalid.", 400, "invalid_content_length");
  }
  if (error.reason === "body_too_large") {
    throw new TokenlessServiceError(
      `Request body exceeds ${Math.floor(limitBytes / 1_024)} KiB.`,
      413,
      "request_too_large",
    );
  }
  throw new TokenlessServiceError("Request body must be valid JSON.", 400, "invalid_json");
}

export function rethrowApiRequestBodyBoundaryError(error: unknown): void {
  if (
    error instanceof TokenlessServiceError &&
    (error.code === "invalid_content_length" || error.code === "request_too_large")
  ) {
    throw error;
  }
}

export function apiRequestBodyFallback<Value>(error: unknown, fallback: Value): Value {
  rethrowApiRequestBodyBoundaryError(error);
  return fallback;
}

export async function readApiJsonRequestBody(
  request: RequestBodySource,
  limitBytes: number = API_JSON_REQUEST_BODY_MAX_BYTES,
): Promise<unknown> {
  try {
    return await readBoundedJsonRequestBody(request, limitBytes);
  } catch (error) {
    if (error instanceof BoundedRequestBodyError) {
      bodyError(error, limitBytes);
    }
    throw error;
  }
}

export async function readApiRequestText(request: RequestBodySource, limitBytes: number): Promise<string> {
  try {
    return await readBoundedRequestText(request, limitBytes);
  } catch (error) {
    if (error instanceof BoundedRequestBodyError) {
      bodyError(error, limitBytes);
    }
    throw error;
  }
}

export async function readApiRequestBytes(request: RequestBodySource, limitBytes: number): Promise<Uint8Array> {
  try {
    return await readBoundedRequestBytes(request, limitBytes);
  } catch (error) {
    if (error instanceof BoundedRequestBodyError) {
      bodyError(error, limitBytes);
    }
    throw error;
  }
}

export async function readApiFormDataRequestBody(request: RequestBodySource, limitBytes: number): Promise<FormData> {
  const bytes = await readApiRequestBytes(request, limitBytes);
  const contentType = request.headers.get("content-type")?.trim() ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/x-www-form-urlencoded" && mediaType !== "multipart/form-data") {
    throw new TokenlessServiceError("Request body must be form data.", 415, "invalid_form_data_content_type");
  }
  try {
    const boundedRequest = new Request("http://localhost/internal-form-parser", {
      method: "POST",
      headers: { "content-type": contentType },
      body: bytes,
    });
    return await boundedRequest.formData();
  } catch {
    throw new TokenlessServiceError("Request body must be valid form data.", 400, "invalid_form_data");
  }
}
