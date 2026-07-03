import { NextRequest } from "next/server";
import { AGENT_APP_BASE_URL_REQUIRED_MESSAGE, resolveAgentAppBaseUrl } from "~~/lib/agent/appBaseUrl";
import { AgentAskHandoffError, createAgentAskHandoff } from "~~/lib/agent/handoffs";
import {
  AGENT_JSON_BODY_MAX_BYTES,
  AGENT_WRITE_RATE_LIMIT,
  agentRouteErrorResponse,
  handlePublicAgentRoute,
  isJsonObjectBody,
  jsonBodyErrorResponse,
  parseJsonBody,
} from "~~/lib/agent/http";
import { parseOptionalPositiveTtlMs } from "~~/lib/agent/requestTtl";
import { ImageUploadQuotaError } from "~~/lib/attachments/imageAttachments";
import { resolveRateLimitSubject } from "~~/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const HANDOFFS_ROUTE_PATH = "/api/agent/handoffs";

export async function POST(request: NextRequest) {
  return handlePublicAgentRoute({
    handler: async () => {
      const appBaseUrl = resolveAgentAppBaseUrl(request.url, HANDOFFS_ROUTE_PATH);
      if (!appBaseUrl) {
        return agentRouteErrorResponse(AGENT_APP_BASE_URL_REQUIRED_MESSAGE, 503, {
          recoverWith: "configure_app_url",
        });
      }

      const body = await parseJsonBody(request, { maxBytes: AGENT_JSON_BODY_MAX_BYTES });
      if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);

      const hasWrappedRequest = "request" in body;
      const requestBody = hasWrappedRequest
        ? (body as { request?: unknown }).request
        : Object.fromEntries(
            Object.entries(body).filter(
              ([key]) => key !== "generatedImages" && key !== "generatedImageUploads" && key !== "ttlMs",
            ),
          );

      try {
        const ttl = parseOptionalPositiveTtlMs((body as { ttlMs?: unknown }).ttlMs);
        if (!ttl.ok) {
          return agentRouteErrorResponse(ttl.message, 400);
        }
        return await createAgentAskHandoff({
          appBaseUrl,
          generatedImageUploads: (body as { generatedImageUploads?: unknown }).generatedImageUploads,
          generatedImages: (body as { generatedImages?: unknown }).generatedImages,
          rateLimitSubjectId: resolveRateLimitSubject(request),
          requestBody,
          ttlMs: ttl.ttlMs,
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
