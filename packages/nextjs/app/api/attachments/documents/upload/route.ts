import { NextRequest, NextResponse } from "next/server";
import { createContextDocumentFromBuffer } from "~~/lib/attachments/contextDocuments";
import {
  UPLOAD_CONTEXT_DOCUMENT_ACTION,
  buildContextDocumentUploadChallengeMessage,
  hashContextDocumentUploadChallengePayload,
  normalizeContextDocumentUploadChallengeInput,
} from "~~/lib/auth/contextDocumentUploadChallenge";
import { getMaxContextDocumentUploadSizeBytes } from "~~/lib/auth/contextDocumentUploadChallenge.shared";
import { verifySignedActionChallenge } from "~~/lib/auth/signedRouteHelpers";
import { MCP_SCOPES, authenticateMcpRequest } from "~~/lib/mcp/auth";
import { checkRateLimit } from "~~/utils/rateLimit";

type UploadClientPayload = Record<string, unknown> & {
  challengeId?: string;
  clientRequestId?: string;
  signature?: `0x${string}`;
};

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };
const UPLOAD_METADATA_MAX_BYTES = 64 * 1024;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseClientPayload(value: string | null): UploadClientPayload {
  if (!value) {
    throw new Error("Upload metadata is required.");
  }

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Upload metadata must be an object.");
    }
    return parsed as UploadClientPayload;
  } catch (error) {
    if (error instanceof Error && error.message !== "Unexpected end of JSON input") {
      throw error;
    }
    throw new Error("Upload metadata must be valid JSON.");
  }
}

function getBearerToken(request: Request) {
  return request.headers.get("authorization")?.trim() ? request.headers.get("authorization") : null;
}

function uploadTooLargeResponse() {
  return NextResponse.json({ error: "Upload is too large." }, { status: 413 });
}

function rejectOversizedUploadBody(request: NextRequest) {
  const contentLength = request.headers.get("content-length");
  if (!contentLength || !/^\d+$/.test(contentLength)) return null;

  const maximumBodyBytes = getMaxContextDocumentUploadSizeBytes() + UPLOAD_METADATA_MAX_BYTES;
  return Number(contentLength) > maximumBodyBytes ? uploadTooLargeResponse() : null;
}

async function authorizeUploadRequest(request: NextRequest, payload: UploadClientPayload) {
  const normalized = normalizeContextDocumentUploadChallengeInput(payload);
  if (!normalized.ok) {
    throw new Error(normalized.error);
  }

  const bearerToken = getBearerToken(request);
  if (bearerToken) {
    const agent = await authenticateMcpRequest(request, MCP_SCOPES.ask);
    if (agent.walletAddress && agent.walletAddress.toLowerCase() !== normalized.payload.normalizedAddress) {
      throw new Error("Upload wallet does not match the authenticated agent wallet.");
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
    throw new Error("Signed upload challenge is required.");
  }

  const payloadHash = hashContextDocumentUploadChallengePayload(normalized.payload);
  const challengeFailure = await verifySignedActionChallenge({
    challengeId: payload.challengeId,
    action: UPLOAD_CONTEXT_DOCUMENT_ACTION,
    walletAddress: normalized.payload.normalizedAddress,
    payloadHash,
    signature: payload.signature,
    buildMessage: ({ nonce, expiresAt }) =>
      buildContextDocumentUploadChallengeMessage({
        payload: normalized.payload,
        payloadHash,
        nonce,
        expiresAt,
      }),
  });
  if (challengeFailure) {
    throw new Error("Invalid signed upload challenge.");
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

    const oversizedBody = rejectOversizedUploadBody(request);
    if (oversizedBody) return oversizedBody;

    const formData = await request.formData();
    const clientPayload = formData.get("clientPayload");
    const file = formData.get("document");

    if (typeof clientPayload !== "string" || !(file instanceof File)) {
      return NextResponse.json({ error: "Document upload metadata is invalid." }, { status: 400 });
    }

    const payload = parseClientPayload(clientPayload);
    const authorization = await authorizeUploadRequest(request, payload);
    const authorizedLimited = await checkAuthorizedUploadRateLimit(request, authorization);
    if (authorizedLimited) return authorizedLimited;

    const normalized = authorization.normalized.payload;
    if (file.size !== normalized.sizeBytes) {
      throw new Error("Uploaded document size does not match the signed metadata.");
    }

    const result = await createContextDocumentFromBuffer({
      buffer: Buffer.from(await file.arrayBuffer()),
      clientRequestId: typeof payload.clientRequestId === "string" ? payload.clientRequestId : null,
      documentId: normalized.documentId,
      filename: normalized.filename,
      mimeType: normalized.mimeType,
      requestUrl: request.url,
      sha256: normalized.sha256,
      sizeBytes: normalized.sizeBytes,
      uploader: authorization.identity,
    });

    return NextResponse.json(result, { status: result.status === "approved" ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed." },
      { status: error instanceof Error && error.message.includes("too large") ? 413 : 400 },
    );
  }
}
