import { createHmac, timingSafeEqual } from "node:crypto";
import "server-only";

export const PUBLIC_QUESTION_MEDIA_PREVIEW_MAX_TTL_MS = 24 * 60 * 60 * 1_000;
export const PUBLIC_QUESTION_MEDIA_PREVIEW_CAPABILITY_PATTERN = /^pqp1_([0-9a-z]{6,12})_([A-Za-z0-9_-]{43})$/;
const ASSET_ID_PATTERN = /^pqm_[A-Za-z0-9_-]{24,80}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

let previewKeyOverride: Uint8Array | null = null;

function previewCapabilityKey() {
  if (previewKeyOverride) return Buffer.from(previewKeyOverride);
  if (process.env.NEXT_PUBLIC_TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET) {
    throw new Error("NEXT_PUBLIC_TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET is forbidden.");
  }
  const encoded = process.env.TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET?.trim() ?? "";
  const key = /^[0-9a-fA-F]{64}$/.test(encoded)
    ? Buffer.from(encoded, "hex")
    : /^[A-Za-z0-9_-]{43}$/.test(encoded)
      ? Buffer.from(encoded, "base64url")
      : null;
  if (!key || key.byteLength !== 32) {
    throw new Error("TOKENLESS_PUBLIC_MEDIA_PREVIEW_SECRET must encode exactly 32 bytes.");
  }
  return key;
}

function payload(input: { assetId: string; digest: string; expiresAtSeconds: number }) {
  return ["tokenless-public-media-preview-v1", input.assetId, input.digest, String(input.expiresAtSeconds)].join("\0");
}

export function issuePublicQuestionMediaPreviewCapability(input: { assetId: string; digest: string; expiresAt: Date }) {
  if (!ASSET_ID_PATTERN.test(input.assetId) || !DIGEST_PATTERN.test(input.digest)) {
    throw new Error("Public-media preview binding is invalid.");
  }
  const expiresAtSeconds = Math.floor(input.expiresAt.getTime() / 1_000);
  if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= 0) {
    throw new Error("Public-media preview expiry is invalid.");
  }
  const signature = createHmac("sha256", previewCapabilityKey())
    .update(payload({ ...input, expiresAtSeconds }))
    .digest("base64url");
  return `pqp1_${expiresAtSeconds.toString(36)}_${signature}`;
}

export function validatePublicQuestionMediaPreviewCapability(input: {
  assetId: string;
  capability: string;
  digest: string;
  now?: Date;
}) {
  if (!ASSET_ID_PATTERN.test(input.assetId) || !DIGEST_PATTERN.test(input.digest)) return null;
  const match = PUBLIC_QUESTION_MEDIA_PREVIEW_CAPABILITY_PATTERN.exec(input.capability);
  if (!match) return null;
  const expiresAtSeconds = Number.parseInt(match[1]!, 36);
  const now = input.now ?? new Date();
  if (
    !Number.isSafeInteger(expiresAtSeconds) ||
    expiresAtSeconds * 1_000 <= now.getTime() ||
    expiresAtSeconds * 1_000 > now.getTime() + PUBLIC_QUESTION_MEDIA_PREVIEW_MAX_TTL_MS + 60_000
  ) {
    return null;
  }
  const expected = createHmac("sha256", previewCapabilityKey())
    .update(payload({ ...input, expiresAtSeconds }))
    .digest();
  const supplied = Buffer.from(match[2]!, "base64url");
  if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) return null;
  return { expiresAt: new Date(expiresAtSeconds * 1_000) };
}

export function __setPublicQuestionMediaPreviewKeyForTests(value: Uint8Array | null) {
  if (value && value.byteLength !== 32) throw new Error("The public-media preview test key must contain 32 bytes.");
  previewKeyOverride = value ? new Uint8Array(value) : null;
}
