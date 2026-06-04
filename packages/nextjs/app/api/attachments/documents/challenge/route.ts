import { NextRequest, NextResponse } from "next/server";
import {
  CONTEXT_DOCUMENT_UPLOAD_CHALLENGE_TITLE,
  UPLOAD_CONTEXT_DOCUMENT_ACTION,
  hashContextDocumentUploadChallengePayload,
  normalizeContextDocumentUploadChallengeInput,
} from "~~/lib/auth/contextDocumentUploadChallenge";
import { issueSignedActionChallenge } from "~~/lib/auth/signedActions";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { checkRateLimit } from "~~/utils/rateLimit";

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request);
  if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);

  const normalized = normalizeContextDocumentUploadChallengeInput(body);
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  const limited = await checkRateLimit(request, RATE_LIMIT, {
    extraKeyParts: [typeof body.address === "string" ? body.address : undefined],
  });
  if (limited) return limited;

  const challenge = await issueSignedActionChallenge({
    title: CONTEXT_DOCUMENT_UPLOAD_CHALLENGE_TITLE,
    action: UPLOAD_CONTEXT_DOCUMENT_ACTION,
    walletAddress: normalized.payload.normalizedAddress,
    payloadHash: hashContextDocumentUploadChallengePayload(normalized.payload),
  });

  return NextResponse.json(challenge);
}
