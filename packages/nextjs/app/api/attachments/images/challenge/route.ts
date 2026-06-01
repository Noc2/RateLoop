import { NextRequest, NextResponse } from "next/server";
import {
  getImageAttachmentUploadMode,
  isImageAttachmentBlobStorageConfigured,
} from "~~/lib/attachments/imageAttachments";
import {
  IMAGE_UPLOAD_CHALLENGE_TITLE,
  UPLOAD_IMAGE_ACTION,
  hashImageUploadChallengePayload,
  normalizeImageUploadChallengeInput,
} from "~~/lib/auth/imageUploadChallenge";
import { issueSignedActionChallenge } from "~~/lib/auth/signedActions";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { checkRateLimit } from "~~/utils/rateLimit";

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };
const BLOB_STORAGE_CONFIGURATION_ERROR =
  "Image uploads are not configured. Set BLOB_READ_WRITE_TOKEN in the deployment environment.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request);
  if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);

  const normalized = normalizeImageUploadChallengeInput(body);
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  const uploadMode = getImageAttachmentUploadMode();
  if (uploadMode === "blob" && !isImageAttachmentBlobStorageConfigured()) {
    return NextResponse.json({ error: BLOB_STORAGE_CONFIGURATION_ERROR }, { status: 503 });
  }

  const limited = await checkRateLimit(request, RATE_LIMIT, {
    extraKeyParts: [typeof body.address === "string" ? body.address : undefined],
  });
  if (limited) return limited;

  const challenge = await issueSignedActionChallenge({
    title: IMAGE_UPLOAD_CHALLENGE_TITLE,
    action: UPLOAD_IMAGE_ACTION,
    walletAddress: normalized.payload.normalizedAddress,
    payloadHash: hashImageUploadChallengePayload(normalized.payload),
  });

  return NextResponse.json({
    ...challenge,
    uploadMode,
  });
}
