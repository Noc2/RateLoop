import { NextRequest, NextResponse } from "next/server";
import { issueSignedActionChallenge } from "~~/lib/auth/signedActions";
import {
  CONFIDENTIALITY_TERMS_ACTION,
  CONFIDENTIALITY_TERMS_CHALLENGE_TITLE,
  buildConfidentialityTermsMessageLines,
  buildServerConfidentialityTermsPayload,
  hashConfidentialityTermsPayload,
} from "~~/lib/confidentiality/context";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { checkRateLimit } from "~~/utils/rateLimit";

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(request, RATE_LIMIT);
  if (limited) return limited;

  try {
    const body = await parseJsonBody(request);
    if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body, "Invalid JSON body");

    const serverPayload = await buildServerConfidentialityTermsPayload(body);
    if (!serverPayload.ok) {
      return NextResponse.json({ error: serverPayload.error }, { status: serverPayload.status });
    }

    const challenge = await issueSignedActionChallenge({
      action: CONFIDENTIALITY_TERMS_ACTION,
      messageLines: buildConfidentialityTermsMessageLines({
        termsDocHash: serverPayload.payload.termsDocHash,
        termsUri: serverPayload.payload.termsUri,
        termsVersion: serverPayload.payload.termsVersion,
      }),
      payloadHash: hashConfidentialityTermsPayload(serverPayload.payload),
      title: CONFIDENTIALITY_TERMS_CHALLENGE_TITLE,
      walletAddress: serverPayload.payload.normalizedAddress,
    });

    return NextResponse.json({
      ...challenge,
      termsDocHash: serverPayload.payload.termsDocHash,
      termsUri: serverPayload.payload.termsUri,
      termsVersion: serverPayload.payload.termsVersion,
    });
  } catch (error) {
    console.error("Error creating confidentiality terms challenge:", error);
    return NextResponse.json({ error: "Failed to create challenge" }, { status: 500 });
  }
}
