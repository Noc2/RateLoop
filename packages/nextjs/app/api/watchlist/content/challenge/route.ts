import { NextRequest, NextResponse } from "next/server";
import { createSignedCollectionChallengeResponse } from "~~/lib/auth/signedCollectionRoute";
import {
  READ_WATCHLIST_ACTION,
  UNWATCH_CONTENT_ACTION,
  WATCHLIST_CHALLENGE_TITLE,
  WATCH_CONTENT_ACTION,
  hashWatchlistChallengePayload,
  hashWatchlistReadPayload,
  normalizeWatchlistChallengeInput,
  normalizeWatchlistReadInput,
} from "~~/lib/auth/watchlistChallenge";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { checkRateLimit } from "~~/utils/rateLimit";

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

export async function POST(request: NextRequest) {
  const preParseLimited = await checkRateLimit(request, RATE_LIMIT, {
    extraKeyParts: ["preparse"],
  });
  if (preParseLimited) return preParseLimited;

  try {
    const body = await parseJsonBody(request);
    if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body, "Invalid JSON body");
    const challengeBody = body as {
      address?: string;
      contentId?: string | number | bigint;
      action?: "watch" | "unwatch";
      intent?: "read";
    };
    const limited = await checkRateLimit(request, RATE_LIMIT, {
      extraKeyParts: [
        typeof challengeBody.address === "string" ? challengeBody.address : undefined,
        challengeBody.intent ?? challengeBody.action,
      ],
    });
    if (limited) return limited;

    return createSignedCollectionChallengeResponse(challengeBody, {
      title: WATCHLIST_CHALLENGE_TITLE,
      readAction: READ_WATCHLIST_ACTION,
      getWriteAction: challengeBody =>
        challengeBody.action === "unwatch" ? UNWATCH_CONTENT_ACTION : WATCH_CONTENT_ACTION,
      isReadRequest: challengeBody => challengeBody.intent === "read",
      normalizeReadInput: normalizeWatchlistReadInput,
      hashReadPayload: hashWatchlistReadPayload,
      normalizeWriteInput: normalizeWatchlistChallengeInput,
      hashWritePayload: hashWatchlistChallengePayload,
    });
  } catch (error) {
    console.error("Error creating watchlist challenge:", error);
    return NextResponse.json({ error: "Failed to create challenge" }, { status: 500 });
  }
}
