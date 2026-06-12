import { NextRequest, NextResponse } from "next/server";
import {
  CREATE_CONTENT_FEEDBACK_ACTION,
  buildContentFeedbackChallengeMessage,
  hashContentFeedbackPayload,
} from "~~/lib/auth/contentFeedbackChallenge";
import { verifySignedActionChallenge } from "~~/lib/auth/signedRouteHelpers";
import {
  ContentFeedbackDeploymentUnavailableError,
  ContentFeedbackDuplicateError,
  ContentFeedbackPublicationMissingError,
  ContentFeedbackStorageUnavailableError,
  ContentFeedbackVoterEligibilityError,
  type PreparedContentFeedbackInput,
  addContentFeedback,
  assertContentFeedbackPublishedOnchain,
  assertContentFeedbackVoterEligibility,
  buildPreparedContentFeedbackInput,
  getExistingActiveContentFeedbackForAuthor,
  listContentFeedback,
  normalizeContentFeedbackCommitKey,
  normalizeContentFeedbackInput,
  normalizeContentFeedbackListInput,
  normalizeContentFeedbackTxHash,
  resolveContentFeedbackDeploymentScope,
  resolveContentFeedbackRoundContext,
} from "~~/lib/feedback/contentFeedback";
import { normalizeContentFeedbackHashMetadata } from "~~/lib/feedback/feedbackHash";
import { isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";
import { checkRateLimit } from "~~/utils/rateLimit";

const READ_RATE_LIMIT = { limit: 60, windowMs: 60_000 };
const WRITE_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

export async function GET(request: NextRequest) {
  const contentIdParam = request.nextUrl.searchParams.get("contentId");
  const address = request.nextUrl.searchParams.get("address");
  const limited = await checkRateLimit(request, READ_RATE_LIMIT, {
    allowOnStoreUnavailable: true,
    extraKeyParts: [typeof address === "string" ? address : undefined, contentIdParam ?? undefined],
  });
  if (limited) return limited;

  try {
    const normalized = normalizeContentFeedbackListInput({
      address,
      contentId: contentIdParam,
    });
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const requestedViewerAddress = normalized.payload.normalizedAddress;
    const deployment = resolveContentFeedbackDeploymentScope();
    if (!deployment) {
      return NextResponse.json({ error: "Feedback deployment is not configured" }, { status: 503 });
    }
    const context = await resolveContentFeedbackRoundContext(normalized.payload.contentId);
    const result = await listContentFeedback({
      deploymentKey: deployment.deploymentKey,
      contentId: normalized.payload.contentId,
      context,
      awarderAddress: requestedViewerAddress,
      viewerAddress: requestedViewerAddress,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ContentFeedbackStorageUnavailableError) {
      return NextResponse.json({ error: "Feedback storage is not ready yet" }, { status: 503 });
    }

    console.error("Error fetching feedback:", error);
    return NextResponse.json({ error: "Failed to fetch feedback" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const preParseLimited = await checkRateLimit(request, WRITE_RATE_LIMIT, {
    allowOnStoreUnavailable: true,
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
      chainId?: unknown;
      roundId?: unknown;
      clientNonce?: unknown;
      commitKey?: unknown;
      feedbackHash?: unknown;
      publicationTxHash?: unknown;
      signature?: `0x${string}`;
      challengeId?: string;
    };
    const limited = await checkRateLimit(request, WRITE_RATE_LIMIT, {
      allowOnStoreUnavailable: true,
      extraKeyParts: [typeof body.address === "string" ? body.address : undefined],
    });
    if (limited) return limited;

    if (!body.signature || !body.challengeId) {
      return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });
    }

    const normalized = normalizeContentFeedbackInput(body);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const payload = normalized.payload;
    const metadata = normalizeContentFeedbackHashMetadata({
      chainId: body.chainId,
      roundId: body.roundId,
      clientNonce: body.clientNonce,
      feedbackHash: body.feedbackHash,
    });
    if (!metadata.ok) {
      return NextResponse.json({ error: metadata.error }, { status: 400 });
    }
    const deployment = resolveContentFeedbackDeploymentScope(metadata.metadata.chainId);
    if (!deployment) {
      return NextResponse.json({ error: "Feedback deployment is not configured" }, { status: 503 });
    }
    const commitKey = normalizeContentFeedbackCommitKey(body.commitKey);
    if (!commitKey) {
      return NextResponse.json({ error: "Missing or invalid feedback commit key" }, { status: 400 });
    }
    const publicationTxHash = normalizeContentFeedbackTxHash(body.publicationTxHash);
    if (!publicationTxHash) {
      return NextResponse.json({ error: "Missing or invalid feedback publication transaction" }, { status: 400 });
    }

    let preparedPayload: PreparedContentFeedbackInput;
    try {
      preparedPayload = buildPreparedContentFeedbackInput(payload, {
        ...metadata.metadata,
        commitKey,
        deployment,
        publicationTxHash,
        payloadSignature: body.signature,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "CONTENT_FEEDBACK_HASH_MISMATCH") {
        return NextResponse.json({ error: "Feedback hash does not match the signed payload" }, { status: 400 });
      }
      throw error;
    }
    const payloadHash = hashContentFeedbackPayload(preparedPayload);
    const challengeFailure = await verifySignedActionChallenge({
      challengeId: String(body.challengeId),
      action: CREATE_CONTENT_FEEDBACK_ACTION,
      walletAddress: payload.normalizedAddress,
      payloadHash,
      signature: body.signature,
      buildMessage: ({ nonce, expiresAt }) =>
        buildContentFeedbackChallengeMessage({
          address: payload.normalizedAddress,
          payloadHash,
          nonce,
          expiresAt,
        }),
    });
    if (challengeFailure) {
      return challengeFailure;
    }

    const context = await resolveContentFeedbackRoundContext(payload.contentId, preparedPayload.chainId);
    try {
      await assertContentFeedbackVoterEligibility({
        contentId: payload.contentId,
        roundId: preparedPayload.roundId,
        address: payload.normalizedAddress,
        chainId: preparedPayload.chainId,
      });
    } catch (error) {
      if (error instanceof ContentFeedbackVoterEligibilityError) {
        if (error.message === "CONTENT_FEEDBACK_IDENTITY_BANNED") {
          return NextResponse.json({ error: "Rater identity is not eligible to save feedback" }, { status: 403 });
        }
        return NextResponse.json({ error: "Vote on this question before saving feedback" }, { status: 403 });
      }
      throw error;
    }
    try {
      await assertContentFeedbackPublishedOnchain({
        contentId: payload.contentId,
        roundId: preparedPayload.roundId,
        address: payload.normalizedAddress,
        chainId: preparedPayload.chainId,
        commitKey: preparedPayload.commitKey,
        feedbackHash: preparedPayload.feedbackHash,
      });
    } catch (error) {
      if (error instanceof ContentFeedbackPublicationMissingError) {
        return NextResponse.json({ error: "Feedback has not been published on-chain yet" }, { status: 409 });
      }
      throw error;
    }

    try {
      const item = await addContentFeedback(preparedPayload, context);
      return NextResponse.json({ ok: true, item });
    } catch (error) {
      if (error instanceof ContentFeedbackDuplicateError) {
        const existingItem = await getExistingActiveContentFeedbackForAuthor({
          deploymentKey: preparedPayload.deploymentKey,
          contentId: preparedPayload.contentId,
          roundId: preparedPayload.roundId,
          authorAddress: preparedPayload.normalizedAddress,
          context,
        });
        if (existingItem?.feedbackHash?.toLowerCase() === preparedPayload.feedbackHash) {
          return NextResponse.json({ ok: true, item: existingItem, duplicate: true });
        }
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ContentFeedbackDeploymentUnavailableError) {
      return NextResponse.json({ error: "Feedback deployment is not configured" }, { status: 503 });
    }
    if (error instanceof ContentFeedbackStorageUnavailableError) {
      return NextResponse.json({ error: "Feedback storage is not ready yet" }, { status: 503 });
    }
    if (error instanceof ContentFeedbackDuplicateError) {
      return NextResponse.json({ error: "You already saved feedback for this round" }, { status: 409 });
    }

    console.error("Error creating feedback:", error);
    return NextResponse.json({ error: "Failed to create feedback" }, { status: 500 });
  }
}
