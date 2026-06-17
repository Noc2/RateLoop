import { NextRequest, NextResponse } from "next/server";
import {
  QUESTION_DETAILS_UPLOAD_CHALLENGE_TITLE,
  UPLOAD_QUESTION_DETAILS_ACTION,
  hashQuestionDetailsUploadChallengePayload,
  normalizeQuestionDetailsUploadChallengeInput,
} from "~~/lib/auth/questionDetailsChallenge";
import { issueSignedActionChallenge } from "~~/lib/auth/signedActions";
import { apiErrorEnvelope, isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { checkRateLimit } from "~~/utils/rateLimit";

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request);
  if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);

  const normalized = normalizeQuestionDetailsUploadChallengeInput(body);
  if (!normalized.ok) {
    const error = apiErrorEnvelope({
      code: "invalid_request",
      message: normalized.error,
      recoverWith: "fix_request_body",
      retryable: false,
      status: 400,
    });
    return NextResponse.json(error, { status: error.status });
  }

  const limited = await checkRateLimit(request, RATE_LIMIT, {
    extraKeyParts: [typeof body.address === "string" ? body.address : undefined],
  });
  if (limited) return limited;

  const challenge = await issueSignedActionChallenge({
    title: QUESTION_DETAILS_UPLOAD_CHALLENGE_TITLE,
    action: UPLOAD_QUESTION_DETAILS_ACTION,
    walletAddress: normalized.payload.normalizedAddress,
    payloadHash: hashQuestionDetailsUploadChallengePayload(normalized.payload),
  });

  return NextResponse.json(challenge);
}
