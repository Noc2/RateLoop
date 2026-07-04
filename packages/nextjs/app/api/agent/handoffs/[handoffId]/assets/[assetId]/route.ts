import { NextRequest, NextResponse } from "next/server";
import { AgentAskHandoffError, buildAgentAskHandoffResponse, recoverAgentAskHandoffAsset } from "~~/lib/agent/handoffs";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { checkRateLimit } from "~~/utils/rateLimit";

const RATE_LIMIT = { limit: 30, windowMs: 60_000 };
const MAX_BODY_BYTES = 16 * 1024;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const status = error instanceof AgentAskHandoffError ? error.status : 400;
  const message = error instanceof Error ? error.message : "Failed to recover handoff image.";
  return NextResponse.json({ error: message, message, status }, { status });
}

function readAction(value: unknown): "remove" | "retry" {
  if (value === "remove" || value === "retry") return value;
  throw new AgentAskHandoffError("action must be retry or remove.");
}

function readToken(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new AgentAskHandoffError("token is required.");
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ assetId: string; handoffId: string }> },
) {
  const { assetId, handoffId } = await context.params;
  const limited = await checkRateLimit(request, RATE_LIMIT, { extraKeyParts: [handoffId] });
  if (limited) return limited;

  const body = await parseJsonBody(request, { maxBytes: MAX_BODY_BYTES });
  if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);

  try {
    const recovered = await recoverAgentAskHandoffAsset({
      action: readAction(body.action),
      assetId,
      handoffId,
      token: readToken(body.token),
    });
    return NextResponse.json(
      buildAgentAskHandoffResponse({
        assets: recovered.assets,
        handoff: recovered.handoff,
        includeImageData: Boolean(body.includeImageData),
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
