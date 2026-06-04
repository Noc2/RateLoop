import "server-only";
import {
  getMaxContextDocumentUploadSizeBytes,
  normalizeContextDocumentMimeType,
} from "~~/lib/auth/contextDocumentUploadChallenge.shared";
import { buildSignedActionMessage, hashSignedActionPayload } from "~~/lib/auth/signedActions";
import { isValidWalletAddress, normalizeWalletAddress } from "~~/lib/watchlist/contentWatch";

export const CONTEXT_DOCUMENT_UPLOAD_CHALLENGE_TITLE = "RateLoop document context upload";
export const UPLOAD_CONTEXT_DOCUMENT_ACTION = "attachments:upload_context_document";

type ContextDocumentUploadChallengePayload = {
  documentId: string;
  filename: string;
  mimeType: string;
  normalizedAddress: `0x${string}`;
  sha256: string;
  sizeBytes: number;
};

type NormalizedResult<TPayload> = { ok: true; payload: TPayload } | { ok: false; error: string };

const DOCUMENT_ID_PATTERN = /^doc_[A-Za-z0-9_-]{16,80}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function normalizeContextDocumentUploadChallengeInput(
  body: Record<string, unknown>,
): NormalizedResult<ContextDocumentUploadChallengePayload> {
  const address = typeof body.address === "string" ? body.address.trim() : "";
  if (!address || !isValidWalletAddress(address)) {
    return { ok: false, error: "Invalid wallet address." };
  }

  const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
  if (!DOCUMENT_ID_PATTERN.test(documentId)) {
    return { ok: false, error: "Invalid document id." };
  }

  const filename = typeof body.filename === "string" ? body.filename.trim().slice(0, 180) : "";
  if (!filename) {
    return { ok: false, error: "Filename is required." };
  }

  const mimeType = normalizeContextDocumentMimeType(filename, typeof body.mimeType === "string" ? body.mimeType : "");
  if (!mimeType) {
    return { ok: false, error: "Upload a TXT or Markdown document." };
  }

  const sizeBytes = typeof body.sizeBytes === "number" ? body.sizeBytes : Number(body.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > getMaxContextDocumentUploadSizeBytes()) {
    return { ok: false, error: "Document is too large." };
  }

  const sha256 = typeof body.sha256 === "string" ? body.sha256.trim().toLowerCase() : "";
  if (!SHA256_PATTERN.test(sha256)) {
    return { ok: false, error: "Invalid document hash." };
  }

  return {
    ok: true,
    payload: {
      documentId,
      filename,
      mimeType,
      normalizedAddress: normalizeWalletAddress(address),
      sha256,
      sizeBytes,
    },
  };
}

export function hashContextDocumentUploadChallengePayload(payload: ContextDocumentUploadChallengePayload) {
  return hashSignedActionPayload([
    payload.normalizedAddress,
    payload.documentId,
    payload.filename,
    payload.mimeType,
    String(payload.sizeBytes),
    payload.sha256,
  ]);
}

export function buildContextDocumentUploadChallengeMessage(params: {
  payload: ContextDocumentUploadChallengePayload;
  payloadHash: string;
  nonce: string;
  expiresAt: Date;
}) {
  return buildSignedActionMessage({
    title: CONTEXT_DOCUMENT_UPLOAD_CHALLENGE_TITLE,
    action: UPLOAD_CONTEXT_DOCUMENT_ACTION,
    address: params.payload.normalizedAddress,
    payloadHash: params.payloadHash,
    nonce: params.nonce,
    expiresAt: params.expiresAt,
  });
}
