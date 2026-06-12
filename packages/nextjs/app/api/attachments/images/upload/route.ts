import { NextRequest, NextResponse } from "next/server";
import { type HandleUploadBody, handleUpload } from "@vercel/blob/client";
import {
  ImageUploadQuotaError,
  createPendingImageAttachment,
  deleteUploadingImageAttachment,
  getAttachmentImageUrl,
  getImageAttachment,
  getImageAttachmentBlobStorageConfigurationError,
  getImageAttachmentUploadMode,
  processCompletedImageUpload,
  processCompletedLocalImageUpload,
  reserveImageUploadDailyQuotas,
} from "~~/lib/attachments/imageAttachments";
import { PendingGatedAttachmentsMigrationError, isDatabaseQueryError } from "~~/lib/attachments/uploadErrors";
import {
  UPLOAD_IMAGE_ACTION,
  buildImageUploadChallengeMessage,
  hashImageUploadChallengePayload,
  normalizeImageUploadChallengeInput,
} from "~~/lib/auth/imageUploadChallenge";
import { getMaxImageUploadSizeBytes, isSupportedImageUploadMimeType } from "~~/lib/auth/imageUploadChallenge.shared";
import { verifySignedActionChallenge } from "~~/lib/auth/signedRouteHelpers";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { MCP_SCOPES, authenticateMcpRequest } from "~~/lib/mcp/auth";
import { checkRateLimit } from "~~/utils/rateLimit";

type UploadClientPayload = Record<string, unknown> & {
  challengeId?: string;
  clientRequestId?: string;
  signature?: `0x${string}`;
};

type TokenPayload = {
  agentId?: string | null;
  attachmentId: string;
  clientRequestId?: string | null;
  ownerWalletAddress?: `0x${string}` | string | null;
};

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };
const TOKEN_TTL_MS = 10 * 60 * 1000;
const UPLOAD_METADATA_MAX_BYTES = 128 * 1024;
const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];

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

function parseTokenPayload(value: string | null | undefined): TokenPayload {
  if (!value) {
    throw new Error("Upload token payload is missing.");
  }
  const parsed = JSON.parse(value) as TokenPayload;
  if (!parsed.attachmentId) {
    throw new Error("Upload token payload is invalid.");
  }
  return parsed;
}

function uploadTooLargeResponse() {
  return NextResponse.json({ error: "Upload is too large." }, { status: 413 });
}

function rejectOversizedUploadBody(request: NextRequest) {
  const contentLength = request.headers.get("content-length");
  if (!contentLength || !/^\d+$/.test(contentLength)) return null;

  const maximumBodyBytes = request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")
    ? getMaxImageUploadSizeBytes() + UPLOAD_METADATA_MAX_BYTES
    : UPLOAD_METADATA_MAX_BYTES;
  return Number(contentLength) > maximumBodyBytes ? uploadTooLargeResponse() : null;
}

function getBearerToken(request: Request) {
  return request.headers.get("authorization")?.trim() ? request.headers.get("authorization") : null;
}

async function authorizeUploadRequest(request: NextRequest, payload: UploadClientPayload) {
  const normalized = normalizeImageUploadChallengeInput(payload);
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

  const payloadHash = hashImageUploadChallengePayload(normalized.payload);
  const challengeFailure = await verifySignedActionChallenge({
    challengeId: payload.challengeId,
    action: UPLOAD_IMAGE_ACTION,
    walletAddress: normalized.payload.normalizedAddress,
    payloadHash,
    signature: payload.signature,
    buildMessage: ({ nonce, expiresAt }) =>
      buildImageUploadChallengeMessage({
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

async function reserveAuthorizedUploadQuota(authorization: Awaited<ReturnType<typeof authorizeUploadRequest>>) {
  const normalized = authorization.normalized.payload;
  await reserveImageUploadDailyQuotas({
    sizeBytes: normalized.sizeBytes,
    subjects: [
      ...(authorization.identity.kind === "agent"
        ? [{ subjectId: authorization.identity.agentId, subjectKind: "agent" as const }]
        : []),
      { subjectId: normalized.normalizedAddress, subjectKind: "wallet" },
    ],
  });
}

function getUploadErrorStatus(error: unknown) {
  if (error instanceof PendingGatedAttachmentsMigrationError) return error.status;
  if (isDatabaseQueryError(error)) return 500;
  return error instanceof ImageUploadQuotaError ? error.status : 400;
}

function getUploadErrorMessage(error: unknown) {
  if (error instanceof PendingGatedAttachmentsMigrationError) return error.message;
  if (isDatabaseQueryError(error)) {
    console.error("[image-upload] Database query failed", error);
    return "Upload failed.";
  }
  return error instanceof Error ? error.message : "Upload failed.";
}

async function handleLocalUpload(request: NextRequest): Promise<NextResponse> {
  if (getImageAttachmentUploadMode() !== "local") {
    return NextResponse.json({ error: "Direct local image uploads are not enabled." }, { status: 400 });
  }

  try {
    const formData = await request.formData();
    const clientPayload = formData.get("clientPayload");
    const file = formData.get("file");

    if (typeof clientPayload !== "string" || !(file instanceof File)) {
      return NextResponse.json({ error: "Local image upload metadata is invalid." }, { status: 400 });
    }

    const payload = parseClientPayload(clientPayload);
    const authorization = await authorizeUploadRequest(request, payload);
    const authorizedLimited = await checkAuthorizedUploadRateLimit(request, authorization);
    if (authorizedLimited) return authorizedLimited;
    const normalized = authorization.normalized.payload;
    const fileContentType = file.type.trim().toLowerCase();
    if (fileContentType !== normalized.mimeType || file.size !== normalized.sizeBytes) {
      throw new Error("Uploaded image does not match the signed upload metadata.");
    }

    await createPendingImageAttachment({
      attachmentId: normalized.attachmentId,
      clientRequestId: typeof payload.clientRequestId === "string" ? payload.clientRequestId : null,
      filename: normalized.filename,
      mimeType: normalized.mimeType,
      requiresGatedAccess: normalized.requiresGatedAccess,
      sha256: normalized.sha256,
      sizeBytes: normalized.sizeBytes,
      uploader: authorization.identity,
    });
    try {
      await reserveAuthorizedUploadQuota(authorization);
    } catch (error) {
      await deleteUploadingImageAttachment(normalized.attachmentId).catch(() => undefined);
      throw error;
    }

    await processCompletedLocalImageUpload({
      attachmentId: normalized.attachmentId,
      buffer: Buffer.from(await file.arrayBuffer()),
      contentType: normalized.mimeType,
    });

    const attachment = await getImageAttachment(normalized.attachmentId);
    return NextResponse.json({
      attachmentId: normalized.attachmentId,
      imageUrl:
        attachment?.status === "approved"
          ? getAttachmentImageUrl(request.url, normalized.attachmentId, attachment.sha256)
          : null,
      status: attachment?.status ?? "processing",
    });
  } catch (error) {
    return NextResponse.json({ error: getUploadErrorMessage(error) }, { status: getUploadErrorStatus(error) });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const limited = await checkRateLimit(request, RATE_LIMIT);
    if (limited) return limited;

    const oversizedBody = rejectOversizedUploadBody(request);
    if (oversizedBody) return oversizedBody;

    if (request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
      return handleLocalUpload(request);
    }

    if (getImageAttachmentUploadMode() === "local") {
      return NextResponse.json(
        { error: "Local image uploads are enabled. Refresh the page and try the upload again." },
        { status: 400 },
      );
    }
    const blobStorageConfigurationError = getImageAttachmentBlobStorageConfigurationError();
    if (blobStorageConfigurationError) {
      return NextResponse.json({ error: blobStorageConfigurationError }, { status: 503 });
    }

    const body = await parseJsonBody(request, { maxBytes: UPLOAD_METADATA_MAX_BYTES });
    if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);

    const jsonResponse = await handleUpload({
      body: body as unknown as HandleUploadBody,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const payload = parseClientPayload(clientPayload);
        const authorization = await authorizeUploadRequest(request, payload);
        const authorizedLimited = await checkAuthorizedUploadRateLimit(request, authorization);
        if (authorizedLimited) {
          throw new Error("Upload rate limit exceeded.");
        }

        await createPendingImageAttachment({
          attachmentId: authorization.normalized.payload.attachmentId,
          clientRequestId: typeof payload.clientRequestId === "string" ? payload.clientRequestId : null,
          filename: authorization.normalized.payload.filename,
          mimeType: authorization.normalized.payload.mimeType,
          requiresGatedAccess: authorization.normalized.payload.requiresGatedAccess,
          sha256: authorization.normalized.payload.sha256,
          sizeBytes: authorization.normalized.payload.sizeBytes,
          uploader: authorization.identity,
        });
        try {
          await reserveAuthorizedUploadQuota(authorization);
        } catch (error) {
          await deleteUploadingImageAttachment(authorization.normalized.payload.attachmentId).catch(() => undefined);
          throw error;
        }

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: getMaxImageUploadSizeBytes(),
          validUntil: Date.now() + TOKEN_TTL_MS,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            agentId: authorization.identity.kind === "agent" ? authorization.identity.agentId : null,
            attachmentId: authorization.normalized.payload.attachmentId,
            clientRequestId: typeof payload.clientRequestId === "string" ? payload.clientRequestId : null,
            ownerWalletAddress: authorization.identity.ownerWalletAddress,
          } satisfies TokenPayload),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = parseTokenPayload(tokenPayload);
        if (!isSupportedImageUploadMimeType(blob.contentType)) {
          throw new Error("Unsupported uploaded image type.");
        }

        await processCompletedImageUpload({
          attachmentId: payload.attachmentId,
          blobPathname: blob.pathname,
          blobUrl: blob.url,
          contentType: blob.contentType,
        });
      },
    });

    const uploadBody = body as unknown as HandleUploadBody;
    const uploadPayload = uploadBody.payload;
    const parsedPayload =
      uploadPayload && typeof uploadPayload === "object" && "clientPayload" in uploadPayload
        ? parseClientPayload(typeof uploadPayload.clientPayload === "string" ? uploadPayload.clientPayload : null)
        : null;
    return NextResponse.json({
      ...jsonResponse,
      attachmentId: parsedPayload?.attachmentId,
      imageUrl: null,
      status: "uploading",
    });
  } catch (error) {
    return NextResponse.json({ error: getUploadErrorMessage(error) }, { status: getUploadErrorStatus(error) });
  }
}
