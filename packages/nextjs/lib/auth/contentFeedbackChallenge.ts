import { buildSignedActionMessage, hashSignedActionPayload } from "~~/lib/auth/signedActions";
import type { ContentFeedbackChallengePayload } from "~~/lib/feedback/contentFeedback";

export const CREATE_CONTENT_FEEDBACK_ACTION = "content-feedback:create";
export const CONTENT_FEEDBACK_CHALLENGE_TITLE = "RateLoop feedback authorization";

export function hashContentFeedbackPayload(payload: ContentFeedbackChallengePayload): string {
  return hashSignedActionPayload([
    `chainId:${payload.chainId}`,
    `deploymentKey:${payload.deploymentKey}`,
    `contentRegistry:${payload.contentRegistryAddress}`,
    `feedbackRegistry:${payload.feedbackRegistryAddress}`,
    `contentId:${payload.contentId}`,
    `roundId:${payload.roundId}`,
    `author:${payload.normalizedAddress}`,
    `feedbackType:${payload.feedbackType}`,
    `body:${payload.body}`,
    `sourceUrl:${payload.sourceUrl ?? ""}`,
    `clientNonce:${payload.clientNonce}`,
    `feedbackHash:${payload.feedbackHash}`,
  ]);
}

export function buildContentFeedbackChallengeMessage(params: {
  address: `0x${string}`;
  payloadHash: string;
  nonce: string;
  expiresAt: Date;
}): string {
  return buildSignedActionMessage({
    title: CONTENT_FEEDBACK_CHALLENGE_TITLE,
    action: CREATE_CONTENT_FEEDBACK_ACTION,
    address: params.address,
    payloadHash: params.payloadHash,
    nonce: params.nonce,
    expiresAt: params.expiresAt,
  });
}
