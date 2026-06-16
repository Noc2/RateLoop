import { NextRequest, NextResponse } from "next/server";
import {
  AgentAskHandoffError,
  buildAgentAskHandoffResponse,
  buildAgentAskHandoffValidationImageUrls,
  listAgentAskHandoffAssets,
  loadAgentAskHandoffByToken,
  readHandoffTokenFromHeaders,
  updateAgentAskHandoffDraft,
} from "~~/lib/agent/handoffs";
import {
  AGENT_READ_RATE_LIMIT,
  AGENT_WRITE_RATE_LIMIT,
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
      return buildAgentAskHandoffResponse({ assets, handoff, includeImageData: true });
    },
    rateLimit: AGENT_READ_RATE_LIMIT,
    request,
  });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ handoffId: string }> }) {
  const { handoffId } = await context.params;

  return handlePublicAgentRoute({
    handler: async () => {
      const body = await parseJsonBody(request, { maxBytes: 1024 * 1024 });
      if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);

      const token = readToken((body as { token?: unknown }).token);
      const requestBody = readRequestBodyDraft((body as { requestBody?: unknown }).requestBody);
      const handoff = await loadAgentAskHandoffByToken({ handoffId, token });
      const assets = await listAgentAskHandoffAssets(handoff.id);
      await updateAgentAskHandoffDraft({
        handoff,
        requestBody,
        validationImageUrls: buildAgentAskHandoffValidationImageUrls({
          assets,
          origin: new URL(request.url).origin,
        }),
      });

      const updatedHandoff = await loadAgentAskHandoffByToken({ handoffId, token });
      const updatedAssets = await listAgentAskHandoffAssets(updatedHandoff.id);
      return buildAgentAskHandoffResponse({ assets: updatedAssets, handoff: updatedHandoff, includeImageData: true });
    },
    rateLimit: AGENT_WRITE_RATE_LIMIT,
    request,
  });
}
