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
const CONFIDENTIALITY_TERMS_STORAGE_MIGRATION_PATH = "packages/nextjs/drizzle/0005_confidentiality.sql";
const CONFIDENTIALITY_TERMS_STORAGE_TABLES = [
  "confidentiality_terms_acceptances",
  "signed_action_challenges",
  "signed_read_sessions",
] as const;

function isConfidentialityTermsStorageUnavailableError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object") return false;

  const maybeError = error as { cause?: unknown; code?: unknown; message?: unknown };
  const message = typeof maybeError.message === "string" ? maybeError.message : "";
  const code = typeof maybeError.code === "string" ? maybeError.code : "";
  const mentionsTermsStorage = CONFIDENTIALITY_TERMS_STORAGE_TABLES.some(table => message.includes(table));

  if ((code === "42P01" || code === "42703") && mentionsTermsStorage) return true;
  if (
    mentionsTermsStorage &&
    ((message.includes("relation") && message.includes("does not exist")) ||
      (message.includes("column") && message.includes("does not exist")))
  ) {
    return true;
  }

  return depth < 3 && maybeError.cause !== undefined
    ? isConfidentialityTermsStorageUnavailableError(maybeError.cause, depth + 1)
    : false;
}

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

  const accepted = await hasConfidentialityTermsAcceptance({
    contentId: normalized.payload.contentId,
    walletAddress: normalized.payload.normalizedAddress,
  });
  return NextResponse.json({
    accepted,
    hasSession,
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
              termsDocHash: payload.termsDocHash,
              termsUri: payload.termsUri,
              termsVersion: payload.termsVersion,
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
    if (isConfidentialityTermsStorageUnavailableError(error)) {
      console.warn(
        "Confidentiality terms storage unavailable. Apply pending database migrations before accepting terms.",
      );
      return NextResponse.json(
        {
          code: "service_unavailable",
          error: "Confidentiality terms storage is not ready yet",
          message: `Apply pending database migrations, including ${CONFIDENTIALITY_TERMS_STORAGE_MIGRATION_PATH}, before accepting confidential context terms.`,
          retryable: true,
        },
        { status: 503 },
      );
    }

    console.error("Error accepting confidentiality terms:", error);
    return NextResponse.json({ error: "Failed to accept confidentiality terms" }, { status: 500 });
  }
}
