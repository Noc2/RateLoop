import "server-only";
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
  request: Request,
  limitBytes: number = MAX_JSON_REQUEST_BODY_BYTES,
): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new TokenlessServiceError("Content-Length is invalid.", 400, "invalid_content_length");
    }
    if (length > limitBytes) tooLarge(limitBytes);
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > limitBytes) tooLarge(limitBytes);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new JsonRequestBodyError();
  }
}
