import { NextRequest } from "next/server";
import { createAgentAskHandoff } from "~~/lib/agent/handoffs";
import {
  AGENT_WRITE_RATE_LIMIT,
  handlePublicAgentRoute,
  isJsonObjectBody,
  jsonBodyErrorResponse,
  parseJsonBody,
} from "~~/lib/agent/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function readTtlMs(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function POST(request: NextRequest) {
  const origin = new URL(request.url).origin;

  return handlePublicAgentRoute({
    handler: async () => {
      const body = await parseJsonBody(request, { maxBytes: 16 * 1024 * 1024 });
      if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);

      const hasWrappedRequest = "request" in body;
      const requestBody = hasWrappedRequest
        ? (body as { request?: unknown }).request
        : Object.fromEntries(Object.entries(body).filter(([key]) => key !== "generatedImages" && key !== "ttlMs"));

      return createAgentAskHandoff({
        generatedImages: (body as { generatedImages?: unknown }).generatedImages,
        origin,
        requestBody,
        ttlMs: readTtlMs((body as { ttlMs?: unknown }).ttlMs),
      });
    },
    rateLimit: AGENT_WRITE_RATE_LIMIT,
    request,
  });
}
