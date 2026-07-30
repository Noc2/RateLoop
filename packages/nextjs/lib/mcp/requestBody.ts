import "server-only";
import { BoundedRequestBodyError, readBoundedJsonRequestBody } from "~~/lib/tokenless/boundedRequestBody";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

/** Every machine-facing JSON endpoint accepts the same 64 KiB body as the MCP transport. */
export const MAX_JSON_REQUEST_BODY_BYTES = 64 * 1_024;

/**
 * Raised only when the capped body is not valid UTF-8 JSON, so each route keeps its own 400
 * vocabulary while sharing one size cap.
 */
export class JsonRequestBodyError extends Error {
  constructor() {
    super("Request body must be valid JSON.");
    this.name = "JsonRequestBodyError";
  }
}

function tooLarge(limitBytes: number): never {
  throw new TokenlessServiceError(
    `Request body exceeds ${Math.floor(limitBytes / 1_024)} KiB.`,
    413,
    "request_too_large",
  );
}

/**
 * Reads a JSON request body with an explicit `Content-Length` pre-check and a hard byte cap, so an
 * unauthenticated or low-trust caller cannot make the runtime buffer an unbounded payload.
 */
export async function readJsonRequestBody(
  request: Pick<Request, "body" | "headers">,
  limitBytes: number = MAX_JSON_REQUEST_BODY_BYTES,
): Promise<unknown> {
  try {
    return await readBoundedJsonRequestBody(request, limitBytes);
  } catch (error) {
    if (error instanceof BoundedRequestBodyError) {
      if (error.reason === "invalid_content_length") {
        throw new TokenlessServiceError("Content-Length is invalid.", 400, "invalid_content_length");
      }
      if (error.reason === "body_too_large") {
        tooLarge(limitBytes);
      }
      throw new JsonRequestBodyError();
    }
    throw error;
  }
}
