import { NextRequest, NextResponse } from "next/server";
import {
  PRIVATE_ACCOUNT_ACCESS_CHALLENGE_TITLE,
  READ_PRIVATE_ACCOUNT_ACTION,
  buildPrivateAccountReadChallengeMessageLines,
  hashPrivateAccountReadPayload,
  normalizePrivateAccountReadInput,
} from "~~/lib/auth/privateAccountAccess";
import { issueSignedActionChallenge } from "~~/lib/auth/signedActions";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { checkRateLimit } from "~~/utils/rateLimit";

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

export async function POST(request: NextRequest) {
  const preParseLimited = await checkRateLimit(request, RATE_LIMIT, {
    extraKeyParts: ["preparse"],
  });
  if (preParseLimited) return preParseLimited;

  const body = await parseJsonBody(request);
  if (!isJsonObjectBody(body)) {
    return jsonBodyErrorResponse(body, "Invalid JSON body");
  }

  const limited = await checkRateLimit(request, RATE_LIMIT, {
    extraKeyParts: [typeof body.address === "string" ? body.address : undefined],
  });
  if (limited) return limited;

  try {
    const normalized = normalizePrivateAccountReadInput(body);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const challenge = await issueSignedActionChallenge({
      title: PRIVATE_ACCOUNT_ACCESS_CHALLENGE_TITLE,
      action: READ_PRIVATE_ACCOUNT_ACTION,
      walletAddress: normalized.payload.normalizedAddress,
      payloadHash: hashPrivateAccountReadPayload(normalized.payload),
      messageLines: buildPrivateAccountReadChallengeMessageLines(normalized.payload.scope),
    });
    return NextResponse.json(challenge);
  } catch (error) {
    console.error("Error creating private account session challenge:", error);
    return NextResponse.json({ error: "Failed to create private account session challenge" }, { status: 500 });
  }
}
