import { NextRequest } from "next/server";
import { AGENT_APP_BASE_URL_REQUIRED_MESSAGE, resolveAgentAppBaseUrl } from "~~/lib/agent/appBaseUrl";
import {
  AgentAskHandoffError,
  buildAgentAskHandoffResponse,
  buildAgentAskHandoffValidationImageUrls,
  listAgentAskHandoffAssets,
  loadAgentAskHandoffByToken,
  readHandoffTokenFromHeaders,
  restoreAgentAskHandoffOriginalDraft,
  updateAgentAskHandoffDraft,
} from "~~/lib/agent/handoffs";
import {
  AGENT_JSON_BODY_MAX_BYTES,
  AGENT_READ_RATE_LIMIT,
  AGENT_WRITE_RATE_LIMIT,
  agentRouteErrorResponse,
  handlePublicAgentRoute,
  isJsonObjectBody,
  jsonBodyErrorResponse,
  parseJsonBody,
} from "~~/lib/agent/http";

type JsonObject = Record<string, unknown>;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readToken(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new AgentAskHandoffError("token is required.");
}

function readRequestBodyDraft(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentAskHandoffError("requestBody must be a JSON object.");
  }
  return value as JsonObject;
}

function readIncludeImageData(value: unknown) {
  return value === true || value === "true";
}

export async function GET(request: NextRequest, context: { params: Promise<{ handoffId: string }> }) {
  const { handoffId } = await context.params;

  return handlePublicAgentRoute({
    handler: async () => {
      const token = readHandoffTokenFromHeaders(request.headers);
      if (!token) {
        throw new AgentAskHandoffError("handoff token is required.");
      }

      const handoff = await loadAgentAskHandoffByToken({ handoffId, token });
      const assets = await listAgentAskHandoffAssets(handoff.id);
      return buildAgentAskHandoffResponse({
        assets,
        handoff,
        includeImageData: readIncludeImageData(request.nextUrl.searchParams.get("includeImageData")),
      });
    },
    rateLimit: AGENT_READ_RATE_LIMIT,
    request,
  });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ handoffId: string }> }) {
  const { handoffId } = await context.params;

  return handlePublicAgentRoute({
    handler: async () => {
      const appBaseUrl = resolveAgentAppBaseUrl(request.url, `/api/agent/handoffs/${handoffId}`);
      if (!appBaseUrl) {
        return agentRouteErrorResponse(AGENT_APP_BASE_URL_REQUIRED_MESSAGE, 503, {
          recoverWith: "configure_app_url",
        });
      }

      const body = await parseJsonBody(request, { maxBytes: AGENT_JSON_BODY_MAX_BYTES });
      if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);

      const token = readToken((body as { token?: unknown }).token);
      const includeImageData = readIncludeImageData((body as { includeImageData?: unknown }).includeImageData);
      const shouldRestoreOriginal = (body as { restoreOriginal?: unknown }).restoreOriginal === true;
      const requestBody = shouldRestoreOriginal
        ? null
        : readRequestBodyDraft((body as { requestBody?: unknown }).requestBody);
      const handoff = await loadAgentAskHandoffByToken({ handoffId, token });
      const assets = await listAgentAskHandoffAssets(handoff.id);
      const validationImageUrls = buildAgentAskHandoffValidationImageUrls({
        appBaseUrl,
        assets,
      });
      if (shouldRestoreOriginal) {
        await restoreAgentAskHandoffOriginalDraft({
          handoff,
          token,
          validationImageUrls,
        });
      } else {
        await updateAgentAskHandoffDraft({
          handoff,
          requestBody,
          token,
          validationImageUrls,
        });
      }

      const updatedHandoff = await loadAgentAskHandoffByToken({ handoffId, token });
      const updatedAssets = await listAgentAskHandoffAssets(updatedHandoff.id);
      return buildAgentAskHandoffResponse({ assets: updatedAssets, handoff: updatedHandoff, includeImageData });
    },
    rateLimit: AGENT_WRITE_RATE_LIMIT,
    request,
  });
}
