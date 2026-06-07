const DEFAULT_SUBMISSION_SAFETY_MARGIN_SECONDS = 30;

export const WORLD_ID_PROOF_EXPIRED_MESSAGE =
  "This World ID proof expired before the on-chain attestation could be submitted. Try again and approve the wallet transaction promptly.";

type RpContextWithExpiry = {
  expires_at?: unknown;
};

function parseUnixSeconds(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

export function getWorldIdRequestPollingTimeoutMs(
  rpContext: RpContextWithExpiry,
  nowMs = Date.now(),
  safetyMarginSeconds = DEFAULT_SUBMISSION_SAFETY_MARGIN_SECONDS,
): number | undefined {
  const expiresAt = parseUnixSeconds(rpContext.expires_at);
  if (!expiresAt) return undefined;

  return Math.max(0, expiresAt * 1000 - nowMs - safetyMarginSeconds * 1000);
}

export function assertWorldIdProofHasSubmissionWindow(
  expiresAtMin: number,
  nowMs = Date.now(),
  safetyMarginSeconds = DEFAULT_SUBMISSION_SAFETY_MARGIN_SECONDS,
) {
  if (!Number.isSafeInteger(expiresAtMin) || expiresAtMin <= 0) {
    throw new Error(WORLD_ID_PROOF_EXPIRED_MESSAGE);
  }

  if (expiresAtMin * 1000 - nowMs <= safetyMarginSeconds * 1000) {
    throw new Error(WORLD_ID_PROOF_EXPIRED_MESSAGE);
  }
}

export function isWorldIdProofExpiredError(error: unknown) {
  if (typeof error === "string") return error === WORLD_ID_PROOF_EXPIRED_MESSAGE;
  return error instanceof Error && error.message === WORLD_ID_PROOF_EXPIRED_MESSAGE;
}
