import { publicEnv } from "~~/utils/env/public";

const HOSTED_GATED_ATTACHMENT_PATH_PATTERN =
  /^\/api\/attachments\/(?:images\/att_[A-Za-z0-9_-]{16,80}\.webp|details\/det_[A-Za-z0-9_-]{16,80})$/;
const RATELOOP_PRODUCTION_ORIGINS = new Set(["https://rateloop.ai", "https://www.rateloop.ai"]);
const WALLET_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function normalizeOrigin(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function getBrowserOrigin() {
  if (typeof window === "undefined") return null;
  return normalizeOrigin(window.location.origin);
}

function getConfiguredAppOrigin() {
  return publicEnv.configuredAppOrigin;
}

function isRelativePathUrl(value: string) {
  return value.startsWith("/") && !value.startsWith("//");
}

function isTrustedHostedAttachmentOrigin(origin: string, currentOrigin: string | null) {
  return RATELOOP_PRODUCTION_ORIGINS.has(origin) || origin === currentOrigin || origin === getConfiguredAppOrigin();
}

function shouldUseSameOriginPath(origin: string, currentOrigin: string | null) {
  return (
    Boolean(currentOrigin) &&
    (origin === currentOrigin ||
      (RATELOOP_PRODUCTION_ORIGINS.has(origin) && RATELOOP_PRODUCTION_ORIGINS.has(currentOrigin as string)))
  );
}

export function appendGatedContextAddress(
  url: string,
  walletAddress?: string,
  currentOrigin: string | null = getBrowserOrigin(),
) {
  const normalizedWalletAddress = walletAddress?.trim();
  if (!normalizedWalletAddress || !WALLET_ADDRESS_PATTERN.test(normalizedWalletAddress)) return url;

  const relativePathUrl = isRelativePathUrl(url);
  try {
    const parsed = new URL(url, "https://rateloop.local");
    if (parsed.username || parsed.password) return url;
    if (!HOSTED_GATED_ATTACHMENT_PATH_PATTERN.test(parsed.pathname)) return url;

    const normalizedCurrentOrigin = normalizeOrigin(currentOrigin);
    if (!relativePathUrl && !isTrustedHostedAttachmentOrigin(parsed.origin, normalizedCurrentOrigin)) return url;

    parsed.searchParams.set("address", normalizedWalletAddress);
    const sameOriginPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (relativePathUrl || shouldUseSameOriginPath(parsed.origin, normalizedCurrentOrigin)) {
      return sameOriginPath;
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

export function appendOptionalGatedContextAddress(
  url: string | null | undefined,
  walletAddress?: string,
  currentOrigin?: string | null,
) {
  return url ? appendGatedContextAddress(url, walletAddress, currentOrigin) : url;
}
