import { NextRequest, NextResponse } from "next/server";
import { del as deleteBlob, get as getBlob } from "@vercel/blob";
import { type HandleUploadBody, handleUpload } from "@vercel/blob/client";
import {
  AgentAskHandoffError,
  loadAgentAskHandoffAssetUploadTarget,
  stageAgentAskHandoffAssetUpload,
  updateAgentAskHandoffAsset,
} from "~~/lib/agent/handoffs";
import { getImageAttachmentBlobStorageConfigurationError } from "~~/lib/attachments/imageAttachments";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { checkRateLimit } from "~~/utils/rateLimit";

type ClientPayload = {
  filename?: string;
  mimeType?: string;
  sha256?: string;
  sizeBytes?: number;
  token?: string;
};

type UploadTokenPayload = {
  assetId: string;
  handoffId: string;
};

const RATE_LIMIT = { limit: 30, windowMs: 60_000 };
const TOKEN_TTL_MS = 10 * 60 * 1000;
const UPLOAD_METADATA_MAX_BYTES = 128 * 1024;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function parseClientPayload(value: string | null | undefined): ClientPayload {
  if (!value) {
    throw new AgentAskHandoffError("Upload metadata is required.");
  }
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AgentAskHandoffError("Upload metadata must be a JSON object.");
  }
  return parsed as ClientPayload;
}

function parseUploadTokenPayload(value: string | null | undefined): UploadTokenPayload {
  if (!value) {
    throw new AgentAskHandoffError("Upload token payload is missing.", 500);
  }
  const parsed = JSON.parse(value) as UploadTokenPayload;
  if (!parsed.handoffId || !parsed.assetId) {
    throw new AgentAskHandoffError("Upload token payload is invalid.", 500);
  }
  return parsed;
}

function readRequiredString(value: unknown, fieldName: string) {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new AgentAskHandoffError(`${fieldName} is required.`);
}

function assertPayloadMatchesAsset(
  payload: ClientPayload,
  asset: Awaited<ReturnType<typeof loadAgentAskHandoffAssetUploadTarget>>["asset"],
) {
  if (payload.filename && payload.filename !== asset.originalFilename) {
    throw new AgentAskHandoffError("Upload filename does not match the staged handoff image.");
  }
  if (payload.mimeType && payload.mimeType.toLowerCase() !== asset.mimeType) {
    throw new AgentAskHandoffError("Upload MIME type does not match the staged handoff image.");
  }
  if (payload.sha256 && payload.sha256.toLowerCase() !== asset.sha256) {
    throw new AgentAskHandoffError("Upload SHA-256 does not match the staged handoff image.");
  }
  if (payload.sizeBytes !== undefined && Number(payload.sizeBytes) !== asset.sizeBytes) {
    throw new AgentAskHandoffError("Upload size does not match the staged handoff image.");
  }
}

function errorResponse(error: unknown) {
  const status = error instanceof AgentAskHandoffError ? error.status : 400;
  const message = error instanceof Error ? error.message : "Image upload failed.";
  return NextResponse.json({ error: message, message, status }, { status });
}

async function readUploadedBlobBuffer(pathname: string) {
  const result = await getBlob(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new AgentAskHandoffError("Uploaded handoff image blob was not found.", 500);
  }
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ assetId: string; handoffId: string }> },
): Promise<NextResponse> {
  const { assetId, handoffId } = await context.params;
  const limited = await checkRateLimit(request, RATE_LIMIT, { extraKeyParts: [handoffId] });
  if (limited) return limited;

  const blobStorageConfigurationError = getImageAttachmentBlobStorageConfigurationError();
  if (blobStorageConfigurationError) {
    return NextResponse.json({ error: blobStorageConfigurationError }, { status: 503 });
  }

  const body = await parseJsonBody(request, { maxBytes: UPLOAD_METADATA_MAX_BYTES });
  if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);

  try {
    const jsonResponse = await handleUpload({
      body: body as unknown as HandleUploadBody,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const payload = parseClientPayload(clientPayload);
        const token = readRequiredString(payload.token, "token");
        const { asset } = await loadAgentAskHandoffAssetUploadTarget({ assetId, handoffId, token });
        assertPayloadMatchesAsset(payload, asset);

        return {
          allowedContentTypes: [asset.mimeType],
          maximumSizeInBytes: asset.sizeBytes,
          validUntil: Date.now() + TOKEN_TTL_MS,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ assetId: asset.id, handoffId } satisfies UploadTokenPayload),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = parseUploadTokenPayload(tokenPayload);
        try {
          const buffer = await readUploadedBlobBuffer(blob.pathname);
          await stageAgentAskHandoffAssetUpload({
            assetId: payload.assetId,
            buffer,
            contentType: blob.contentType,
            handoffId: payload.handoffId,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Image upload failed.";
          await updateAgentAskHandoffAsset({ assetId: payload.assetId, error: message, status: "failed" });
          throw error;
        } finally {
          await deleteBlob(blob.pathname).catch(() => undefined);
        }
      },
    });

    return NextResponse.json({
      ...jsonResponse,
      assetId,
      status: "uploading",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
