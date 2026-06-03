import { NextRequest, NextResponse } from "next/server";
import {
  CONTENT_FEEDBACK_CHALLENGE_TITLE,
  CREATE_CONTENT_FEEDBACK_ACTION,
  READ_CONTENT_FEEDBACK_ACTION,
  hashContentFeedbackPayload,
  hashContentFeedbackReadPayload,
} from "~~/lib/auth/contentFeedbackChallenge";
import { issueSignedActionChallenge } from "~~/lib/auth/signedActions";
import { getPrimaryServerTargetNetwork } from "~~/lib/env/server";
import {
  ContentFeedbackVoterEligibilityError,
  assertContentFeedbackVoterEligibility,
  buildContentFeedbackChallengePayload,
  normalizeContentFeedbackInput,
  normalizeContentFeedbackReadInput,
  resolveContentFeedbackRoundContext,
} from "~~/lib/feedback/contentFeedback";
import { createContentFeedbackNonce } from "~~/lib/feedback/feedbackHash";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { checkRateLimit } from "~~/utils/rateLimit";

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

export async function POST(request: NextRequest) {
  const preParseLimited = await checkRateLimit(request, RATE_LIMIT, {
    allowOnStoreUnavailable: false,
    extraKeyParts: ["preparse"],
  });
  if (preParseLimited) return preParseLimited;

  try {
    const parsedBody = await parseJsonBody(request);
    if (!isJsonObjectBody(parsedBody)) return jsonBodyErrorResponse(parsedBody, "Invalid JSON body");
    const body = parsedBody as {
      address?: string;
      contentId?: unknown;
      feedbackType?: unknown;
      body?: unknown;
      sourceUrl?: unknown;
      intent?: "read";
    };
    // WS-6 (2026-05-21 repo audit): fail-closed when the rate-limit store is unavailable.
    // The downstream `issueSignedActionChallenge` writes to the same store anyway, so an
    // outage isn't recoverable here — surfacing the 503 loudly is preferable to silently
    // letting unbounded challenge-creation traffic through during the outage.
    const limited = await checkRateLimit(request, RATE_LIMIT, {
      allowOnStoreUnavailable: false,
      extraKeyParts: [typeof body.address === "string" ? body.address : undefined, body.intent ?? "create"],
    });
    if (limited) return limited;

    if (body.intent === "read") {
      const normalized = normalizeContentFeedbackReadInput({
        address: body.address,
        contentId: body.contentId,
      });
      if (!normalized.ok) {
        return NextResponse.json({ error: normalized.error }, { status: 400 });
      }
      if (!normalized.payload.normalizedAddress) {
        return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
      }

      const challenge = await issueSignedActionChallenge({
        title: CONTENT_FEEDBACK_CHALLENGE_TITLE,
        action: READ_CONTENT_FEEDBACK_ACTION,
        walletAddress: normalized.payload.normalizedAddress,
        payloadHash: hashContentFeedbackReadPayload(normalized.payload),
      });

      return NextResponse.json(challenge);
    }

    const normalized = normalizeContentFeedbackInput(body);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }
    const targetNetwork = getPrimaryServerTargetNetwork();
    if (!targetNetwork) {
      return NextResponse.json({ error: "Feedback chain is not configured" }, { status: 503 });
    }

    const context = await resolveContentFeedbackRoundContext(normalized.payload.contentId, targetNetwork.id);
    const roundId = context.openRoundId;
    if (!roundId || context.currentRoundId !== roundId) {
      return NextResponse.json({ error: "Feedback is only open while voting is active" }, { status: 409 });
    }

    try {
      await assertContentFeedbackVoterEligibility({
        contentId: normalized.payload.contentId,
        roundId,
        address: normalized.payload.normalizedAddress,
        chainId: targetNetwork.id,
      });
    } catch (error) {
      if (error instanceof ContentFeedbackVoterEligibilityError) {
        return NextResponse.json({ error: "Vote on this question before saving feedback" }, { status: 403 });
      }
      throw error;
    }

    const challengePayload = buildContentFeedbackChallengePayload(normalized.payload, {
      chainId: targetNetwork.id,
      roundId,
      clientNonce: createContentFeedbackNonce(),
    });

    const challenge = await issueSignedActionChallenge({
      title: CONTENT_FEEDBACK_CHALLENGE_TITLE,
      action: CREATE_CONTENT_FEEDBACK_ACTION,
      walletAddress: normalized.payload.normalizedAddress,
      payloadHash: hashContentFeedbackPayload(challengePayload),
    });

    return NextResponse.json({
      ...challenge,
      chainId: challengePayload.chainId,
      roundId: challengePayload.roundId,
      feedbackType: normalized.payload.feedbackType,
      body: normalized.payload.body,
      sourceUrl: normalized.payload.sourceUrl,
      clientNonce: challengePayload.clientNonce,
      feedbackHash: challengePayload.feedbackHash,
    });
  } catch (error) {
    console.error("Error creating feedback challenge:", error);
    return NextResponse.json({ error: "Failed to create feedback challenge" }, { status: 500 });
  }
}
