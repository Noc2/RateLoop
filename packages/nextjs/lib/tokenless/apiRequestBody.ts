import "server-only";
import {
  BoundedRequestBodyError,
  readBoundedJsonRequestBody,
  readBoundedRequestBytes,
  readBoundedRequestText,
} from "~~/lib/tokenless/boundedRequestBody";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const API_JSON_REQUEST_BODY_MAX_BYTES = 64 * 1_024;

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
