import { NextRequest, NextResponse } from "next/server";

export type JsonObjectBody = Record<string, unknown>;

const DEFAULT_JSON_BODY_MAX_BYTES = 128 * 1024;
export const JSON_BODY_TOO_LARGE = Symbol("json_body_too_large");

async function readRequestTextWithLimit(request: NextRequest, maxBytes: number) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    return JSON_BODY_TOO_LARGE;
  }

  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      return JSON_BODY_TOO_LARGE;
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

export function isJsonObjectBody(body: unknown): body is JsonObjectBody {
  return Boolean(body) && typeof body === "object" && !Array.isArray(body);
}

export function jsonBodyErrorResponse(body: unknown, message = "Request body must be valid JSON.") {
  if (body === JSON_BODY_TOO_LARGE) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function parseJsonBody(request: NextRequest, options: { maxBytes?: number } = {}) {
  const text = await readRequestTextWithLimit(request, options.maxBytes ?? DEFAULT_JSON_BODY_MAX_BYTES);
  if (text === JSON_BODY_TOO_LARGE) return JSON_BODY_TOO_LARGE;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
