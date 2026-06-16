import { NextRequest } from "next/server";
import {
  AGENT_JSON_BODY_MAX_BYTES,
  AGENT_WRITE_RATE_LIMIT,
  handlePublicAgentRoute,
  isJsonObjectBody,
  jsonBodyErrorResponse,
  parseJsonBody,
} from "~~/lib/agent/http";
import { createAgentSigningIntent } from "~~/lib/agent/signingIntents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readTtlMs(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function POST(request: NextRequest) {
  const origin = new URL(request.url).origin;

  return handlePublicAgentRoute({
    handler: async () => {
      const body = await parseJsonBody(request, { maxBytes: AGENT_JSON_BODY_MAX_BYTES });
      if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);

      const hasWrappedRequest = "request" in body;
      const requestBody = hasWrappedRequest
        ? (body as { request?: unknown }).request
        : Object.fromEntries(Object.entries(body).filter(([key]) => key !== "ttlMs"));

      return createAgentSigningIntent({
        origin,
        requestBody,
        ttlMs: readTtlMs((body as { ttlMs?: unknown }).ttlMs),
      });
    },
    rateLimit: AGENT_WRITE_RATE_LIMIT,
    request,
  });
}
