const QUESTION_DETAILS_PATH_PATTERN = /^\/api\/attachments\/details\/det_[A-Za-z0-9_-]{16,80}$/;
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

export function resolveQuestionDetailsFetchUrl(detailsUrl: string, currentOrigin = getBrowserOrigin()) {
  const normalizedCurrentOrigin = normalizeOrigin(currentOrigin);
  if (!normalizedCurrentOrigin || !RATELOOP_PRODUCTION_ORIGINS.has(normalizedCurrentOrigin)) {
    return detailsUrl;
  }

  try {
    const parsed = new URL(detailsUrl);
    const hasAllowedSearch =
      !parsed.search ||
      (parsed.searchParams.size === 1 && WALLET_ADDRESS_PATTERN.test(parsed.searchParams.get("address") ?? ""));
    if (
      parsed.username ||
      parsed.password ||
      !hasAllowedSearch ||
      parsed.hash ||
      !RATELOOP_PRODUCTION_ORIGINS.has(parsed.origin) ||
      !QUESTION_DETAILS_PATH_PATTERN.test(parsed.pathname)
    ) {
      return detailsUrl;
    }

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return detailsUrl;
  }
}
