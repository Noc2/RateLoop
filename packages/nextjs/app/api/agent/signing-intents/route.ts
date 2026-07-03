import { NextRequest } from "next/server";
import { AGENT_APP_BASE_URL_REQUIRED_MESSAGE, resolveAgentAppBaseUrl } from "~~/lib/agent/appBaseUrl";
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
import { createAgentSigningIntent } from "~~/lib/agent/signingIntents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SIGNING_INTENTS_ROUTE_PATH = "/api/agent/signing-intents";

export async function POST(request: NextRequest) {
  return handlePublicAgentRoute({
    handler: async () => {
      const appBaseUrl = resolveAgentAppBaseUrl(request.url, SIGNING_INTENTS_ROUTE_PATH);
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
        : Object.fromEntries(Object.entries(body).filter(([key]) => key !== "ttlMs"));

      const ttl = parseOptionalPositiveTtlMs((body as { ttlMs?: unknown }).ttlMs);
      if (!ttl.ok) {
        return agentRouteErrorResponse(ttl.message, 400);
      }

      return createAgentSigningIntent({
        appBaseUrl,
        requestBody,
        ttlMs: ttl.ttlMs,
      });
    },
    rateLimit: AGENT_WRITE_RATE_LIMIT,
    request,
  });
}
