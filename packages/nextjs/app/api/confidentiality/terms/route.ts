import { NextRequest, NextResponse } from "next/server";
import {
  ensureSignedActionChallengeTable,
  mapSignedActionError,
  verifyAndConsumeSignedActionChallenge,
} from "~~/lib/auth/signedActions";
import { GATED_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME, verifySignedReadSession } from "~~/lib/auth/signedReadSessions";
import { createSignedReadResponse } from "~~/lib/auth/signedRouteHelpers";
import {
  CONFIDENTIALITY_TERMS_ACTION,
  buildConfidentialityTermsChallengeMessage,
  hasConfidentialityTermsAcceptance,
  hashConfidentialityTermsPayload,
  normalizeConfidentialityTermsInput,
  recordConfidentialityTermsAcceptance,
} from "~~/lib/confidentiality/context";
import { db } from "~~/lib/db";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { checkRateLimit } from "~~/utils/rateLimit";

const READ_RATE_LIMIT = { limit: 60, windowMs: 60_000 };
const WRITE_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

export async function GET(request: NextRequest) {
  const contentId = request.nextUrl.searchParams.get("contentId");
  const address = request.nextUrl.searchParams.get("address");
  const limited = await checkRateLimit(request, READ_RATE_LIMIT, {
    extraKeyParts: [address ?? undefined, contentId ?? undefined],
  });
  if (limited) return limited;

  const normalized = normalizeConfidentialityTermsInput({
    address: address ?? undefined,
    contentId: contentId ?? undefined,
  });
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  const hasSession = await verifySignedReadSession(
    request.cookies.get(GATED_CONTEXT_SIGNED_READ_SESSION_COOKIE_NAME)?.value,
    normalized.payload.normalizedAddress,
    "gated_context",
  );
  if (!hasSession) {
    return NextResponse.json({ error: "Signed read required" }, { status: 401 });
  }

  const accepted = await hasConfidentialityTermsAcceptance({
    contentId: normalized.payload.contentId,
    walletAddress: normalized.payload.normalizedAddress,
  });
  return NextResponse.json({
    accepted,
    termsDocHash: normalized.payload.termsDocHash,
    termsUri: normalized.payload.termsUri,
    termsVersion: normalized.payload.termsVersion,
  });
}

export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(request, WRITE_RATE_LIMIT);
  if (limited) return limited;

  try {
    const parsedBody = await parseJsonBody(request);
    if (!isJsonObjectBody(parsedBody)) return jsonBodyErrorResponse(parsedBody, "Invalid JSON body");
    const body = parsedBody as Record<string, unknown> & {
      challengeId?: string;
      signature?: `0x${string}`;
    };
    if (!body.challengeId || !body.signature) {
      return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });
    }

    const normalized = normalizeConfidentialityTermsInput(body);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const payload = normalized.payload;
    const payloadHash = hashConfidentialityTermsPayload(payload);
    let nonce = "";
    await ensureSignedActionChallengeTable();
    try {
      await db.transaction(async tx => {
        const challenge = await verifyAndConsumeSignedActionChallenge(tx, {
          action: CONFIDENTIALITY_TERMS_ACTION,
          buildMessage: ({ nonce: challengeNonce, expiresAt }) =>
            buildConfidentialityTermsChallengeMessage({
              address: payload.normalizedAddress,
              expiresAt,
              nonce: challengeNonce,
              payloadHash,
            }),
          challengeId: String(body.challengeId),
          payloadHash,
          signature: body.signature as `0x${string}`,
          walletAddress: payload.normalizedAddress,
        });
        nonce = challenge.nonce;
      });
    } catch (error) {
      const mapped = mapSignedActionError(error);
      if (mapped) {
        return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      }
      throw error;
    }

    await recordConfidentialityTermsAcceptance({
      nonce,
      payload,
      signature: body.signature as `0x${string}`,
    });

    return createSignedReadResponse(payload.normalizedAddress, "gated_context", {
      accepted: true,
      termsDocHash: payload.termsDocHash,
      termsUri: payload.termsUri,
      termsVersion: payload.termsVersion,
    });
  } catch (error) {
    console.error("Error accepting confidentiality terms:", error);
    return NextResponse.json({ error: "Failed to accept confidentiality terms" }, { status: 500 });
  }
}
