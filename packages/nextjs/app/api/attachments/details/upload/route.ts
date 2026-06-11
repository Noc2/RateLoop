import { NextRequest, NextResponse } from "next/server";
import { createQuestionDetailsFromText } from "~~/lib/attachments/questionDetails";
import {
  UPLOAD_QUESTION_DETAILS_ACTION,
  buildQuestionDetailsUploadChallengeMessage,
  hashQuestionDetailsUploadChallengePayload,
  normalizeQuestionDetailsUploadChallengeInput,
} from "~~/lib/auth/questionDetailsChallenge";
import { verifySignedActionChallenge } from "~~/lib/auth/signedRouteHelpers";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { MCP_SCOPES, authenticateMcpRequest } from "~~/lib/mcp/auth";
import { checkRateLimit } from "~~/utils/rateLimit";

type UploadClientPayload = Record<string, unknown> & {
  challengeId?: string;
  clientRequestId?: string;
  signature?: `0x${string}`;
  text?: string;
};

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBearerToken(request: Request) {
  return request.headers.get("authorization")?.trim() ? request.headers.get("authorization") : null;
}

async function authorizeUploadRequest(request: NextRequest, payload: UploadClientPayload) {
  const normalized = normalizeQuestionDetailsUploadChallengeInput(payload);
  if (!normalized.ok) {
    throw new Error(normalized.error);
  }

  const bearerToken = getBearerToken(request);
  if (bearerToken) {
    const agent = await authenticateMcpRequest(request, MCP_SCOPES.ask);
    if (agent.walletAddress && agent.walletAddress.toLowerCase() !== normalized.payload.normalizedAddress) {
      throw new Error("Details wallet does not match the authenticated agent wallet.");
    }

    return {
      identity: {
        kind: "agent" as const,
        agentId: agent.id,
        ownerWalletAddress: agent.walletAddress?.toLowerCase() ?? normalized.payload.normalizedAddress,
      },
      normalized,
    };
  }

  if (!payload.challengeId || !payload.signature) {
    throw new Error("Signed details challenge is required.");
  }

  const payloadHash = hashQuestionDetailsUploadChallengePayload(normalized.payload);
  const challengeFailure = await verifySignedActionChallenge({
    challengeId: payload.challengeId,
    action: UPLOAD_QUESTION_DETAILS_ACTION,
    walletAddress: normalized.payload.normalizedAddress,
    payloadHash,
    signature: payload.signature,
    buildMessage: ({ nonce, expiresAt }) =>
      buildQuestionDetailsUploadChallengeMessage({
        payload: normalized.payload,
        payloadHash,
        nonce,
        expiresAt,
      }),
  });
  if (challengeFailure) {
    throw new Error("Invalid signed details challenge.");
  }

  return {
    identity: {
      kind: "wallet" as const,
      ownerWalletAddress: normalized.payload.normalizedAddress,
    },
    normalized,
  };
}

async function checkAuthorizedUploadRateLimit(
  request: NextRequest,
  authorization: Awaited<ReturnType<typeof authorizeUploadRequest>>,
) {
  const walletLimited = await checkRateLimit(request, RATE_LIMIT, {
    extraKeyParts: [authorization.normalized.payload.normalizedAddress],
  });
  if (walletLimited) return walletLimited;

  if (authorization.identity.kind === "agent") {
    return checkRateLimit(request, RATE_LIMIT, {
      extraKeyParts: [`agent:${authorization.identity.agentId}`],
    });
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, RATE_LIMIT);
    if (limited) return limited;

    const body = await parseJsonBody(request);
    if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);
    const payload = body as UploadClientPayload;
    if (typeof payload.text !== "string") {
      return NextResponse.json({ error: "Details text is required." }, { status: 400 });
    }

    const authorization = await authorizeUploadRequest(request, payload);
    const authorizedLimited = await checkAuthorizedUploadRateLimit(request, authorization);
    if (authorizedLimited) return authorizedLimited;

    const normalized = authorization.normalized.payload;
    const result = await createQuestionDetailsFromText({
      clientRequestId: typeof payload.clientRequestId === "string" ? payload.clientRequestId : null,
      detailsId: normalized.detailsId,
      requestUrl: request.url,
      requiresGatedAccess: normalized.requiresGatedAccess,
      sha256: normalized.sha256,
      sizeBytes: normalized.sizeBytes,
      text: payload.text,
      uploader: authorization.identity,
    });

    return NextResponse.json(result, { status: result.status === "approved" ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Details upload failed." },
      { status: error instanceof Error && error.message.includes("too large") ? 413 : 400 },
    );
  }
}
