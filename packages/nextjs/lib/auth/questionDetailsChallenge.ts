import "server-only";
import { MAX_QUESTION_DETAILS_TEXT_BYTES } from "~~/lib/attachments/questionDetails.shared";
import { buildSignedActionMessage, hashSignedActionPayload } from "~~/lib/auth/signedActions";
import { isValidWalletAddress, normalizeWalletAddress } from "~~/lib/watchlist/contentWatch";

export const QUESTION_DETAILS_UPLOAD_CHALLENGE_TITLE = "RateLoop question details upload";
export const UPLOAD_QUESTION_DETAILS_ACTION = "attachments:upload_question_details";

type QuestionDetailsUploadChallengePayload = {
  detailsId: string;
  normalizedAddress: `0x${string}`;
  requiresGatedAccess: boolean;
  sha256: string;
  sizeBytes: number;
};

type NormalizedResult<TPayload> = { ok: true; payload: TPayload } | { ok: false; error: string };

const DETAILS_ID_PATTERN = /^det_[A-Za-z0-9_-]{16,80}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function normalizeQuestionDetailsUploadChallengeInput(
  body: Record<string, unknown>,
): NormalizedResult<QuestionDetailsUploadChallengePayload> {
  const address = typeof body.address === "string" ? body.address.trim() : "";
  if (!address || !isValidWalletAddress(address)) {
    return { ok: false, error: "Invalid wallet address." };
  }

  const detailsId = typeof body.detailsId === "string" ? body.detailsId.trim() : "";
  if (!DETAILS_ID_PATTERN.test(detailsId)) {
    return { ok: false, error: "Invalid details id." };
  }

  const sizeBytes = typeof body.sizeBytes === "number" ? body.sizeBytes : Number(body.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_QUESTION_DETAILS_TEXT_BYTES) {
    return { ok: false, error: "Details are too large." };
  }

  const sha256 = typeof body.sha256 === "string" ? body.sha256.trim().toLowerCase() : "";
  if (!SHA256_PATTERN.test(sha256)) {
    return { ok: false, error: "Invalid details hash." };
  }

  return {
    ok: true,
    payload: {
      detailsId,
      normalizedAddress: normalizeWalletAddress(address),
      requiresGatedAccess: body.requiresGatedAccess === true,
      sha256,
      sizeBytes,
    },
  };
}

export function hashQuestionDetailsUploadChallengePayload(payload: QuestionDetailsUploadChallengePayload) {
  const fields = [payload.normalizedAddress, payload.detailsId, String(payload.sizeBytes), payload.sha256];
  if (payload.requiresGatedAccess) fields.push("requires_gated_access");
  return hashSignedActionPayload(fields);
}

export function buildQuestionDetailsUploadChallengeMessage(params: {
  payload: QuestionDetailsUploadChallengePayload;
  payloadHash: string;
  nonce: string;
  expiresAt: Date;
}) {
  return buildSignedActionMessage({
    title: QUESTION_DETAILS_UPLOAD_CHALLENGE_TITLE,
    action: UPLOAD_QUESTION_DETAILS_ACTION,
    address: params.payload.normalizedAddress,
    payloadHash: params.payloadHash,
    nonce: params.nonce,
    expiresAt: params.expiresAt,
  });
}
