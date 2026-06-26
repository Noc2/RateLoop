import { NextRequest, NextResponse } from "next/server";
import {
  type PrivateAccountReadScope,
  READ_PRIVATE_ACCOUNT_ACTION,
  buildPrivateAccountReadChallengeMessage,
  hashPrivateAccountReadPayload,
  normalizePrivateAccountReadInput,
} from "~~/lib/auth/privateAccountAccess";
import {
  SIGNED_READ_SESSION_COOKIE_NAMES,
  setSignedReadSessionCookie,
  verifySignedReadSession,
} from "~~/lib/auth/signedReadSessions";
import { verifySignedActionChallenge } from "~~/lib/auth/signedRouteHelpers";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { checkRateLimit } from "~~/utils/rateLimit";

const READ_RATE_LIMIT = { limit: 60, windowMs: 60_000 };
const WRITE_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

async function hasPrivateReadSession(
  request: NextRequest,
  walletAddress: `0x${string}`,
  scope: PrivateAccountReadScope,
) {
  return verifySignedReadSession(
    request.cookies.get(SIGNED_READ_SESSION_COOKIE_NAMES[scope])?.value,
    walletAddress,
    scope,
  );
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const limited = await checkRateLimit(request, READ_RATE_LIMIT, {
    allowOnStoreUnavailable: true,
    extraKeyParts: [typeof address === "string" ? address : undefined],
  });
  if (limited) return limited;

  const scope = request.nextUrl.searchParams.get("scope");
  const normalized = normalizePrivateAccountReadInput({
    address: typeof address === "string" ? address : undefined,
    scope: typeof scope === "string" ? scope : undefined,
  });
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  try {
    const hasSession = await hasPrivateReadSession(
      request,
      normalized.payload.normalizedAddress,
      normalized.payload.scope,
    );
    return NextResponse.json({ hasSession });
  } catch (error) {
    console.error("Error checking private account session:", error);
    return NextResponse.json({ error: "Failed to check private account session" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const preParseLimited = await checkRateLimit(request, WRITE_RATE_LIMIT, {
    extraKeyParts: ["preparse"],
  });
  if (preParseLimited) return preParseLimited;

  const body = await parseJsonBody(request);
  if (!isJsonObjectBody(body)) {
    return jsonBodyErrorResponse(body, "Invalid JSON body");
  }

  const limited = await checkRateLimit(request, WRITE_RATE_LIMIT, {
    extraKeyParts: [typeof body.address === "string" ? body.address : undefined],
  });
  if (limited) return limited;

  const typedBody = body as Record<string, unknown> & {
    signature?: `0x${string}`;
    challengeId?: string;
  };

  if (!typedBody.signature || !typedBody.challengeId) {
    return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });
  }

  try {
    const normalized = normalizePrivateAccountReadInput(typedBody);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const payloadHash = hashPrivateAccountReadPayload(normalized.payload);
    const challengeFailure = await verifySignedActionChallenge({
      challengeId: String(typedBody.challengeId),
      action: READ_PRIVATE_ACCOUNT_ACTION,
      walletAddress: normalized.payload.normalizedAddress,
      payloadHash,
      signature: typedBody.signature,
      buildMessage: ({ nonce, expiresAt }) =>
        buildPrivateAccountReadChallengeMessage({
          address: normalized.payload.normalizedAddress,
          payloadHash,
          scope: normalized.payload.scope,
          nonce,
          expiresAt,
        }),
    });
    if (challengeFailure) return challengeFailure;

    const response = NextResponse.json({ ok: true, hasSession: true });
    await setSignedReadSessionCookie(response, normalized.payload.normalizedAddress, normalized.payload.scope);
    return response;
  } catch (error) {
    console.error("Error creating private account session:", error);
    return NextResponse.json({ error: "Failed to create private account session" }, { status: 500 });
  }
}
