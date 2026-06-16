import { NextRequest } from "next/server";
import { AgentAskHandoffError, createAgentAskHandoff } from "~~/lib/agent/handoffs";
import {
  AGENT_WRITE_RATE_LIMIT,
  handlePublicAgentRoute,
  isJsonObjectBody,
  jsonBodyErrorResponse,
  parseJsonBody,
} from "~~/lib/agent/http";
import { ImageUploadQuotaError } from "~~/lib/attachments/imageAttachments";
import { resolveRateLimitSubject } from "~~/utils/rateLimit";

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

      try {
        return await createAgentAskHandoff({
          generatedImages: (body as { generatedImages?: unknown }).generatedImages,
          origin,
          rateLimitSubjectId: resolveRateLimitSubject(request),
          requestBody,
          ttlMs: readTtlMs((body as { ttlMs?: unknown }).ttlMs),
        });
      } catch (error) {
        if (error instanceof ImageUploadQuotaError) {
          throw new AgentAskHandoffError(error.message, error.status);
        }
        throw error;
      }
    },
    rateLimit: AGENT_WRITE_RATE_LIMIT,
    request,
  });
}
