import { RATE_CHAIN_ID_PARAM, RATE_DEPLOYMENT_KEY_PARAM } from "../../constants/routes";
import { VOTE_SHARE_RATING_VERSION_PARAM } from "../social/contentShare";

interface VoteLocationUpdate {
  contentId?: bigint | null;
  chainId?: number | null;
  deploymentKey?: string | null;
  categoryHash?: string | null;
}

interface VoteSearchParamsLike {
  entries(): IterableIterator<[string, string]>;
}

interface VoteSearchParamsReader {
  get(name: string): string | null;
}

function normalizeVoteLocationChainId(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeVoteLocationDeploymentKey(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeSearchParams(searchParams: URLSearchParams) {
  const normalizedParams = new URLSearchParams();
  const entries = Array.from(searchParams.entries()).sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey),
  );

  for (const [key, value] of entries) {
    normalizedParams.append(key, value);
  }

  return normalizedParams.toString();
}

function setContentScopeSearchParams(url: URL, update: VoteLocationUpdate) {
  if (typeof update.chainId === "number" && Number.isSafeInteger(update.chainId) && update.chainId > 0) {
    url.searchParams.set(RATE_CHAIN_ID_PARAM, update.chainId.toString());
  } else {
    url.searchParams.delete(RATE_CHAIN_ID_PARAM);
  }

  const deploymentKey = update.deploymentKey?.trim();
  if (deploymentKey) {
    url.searchParams.set(RATE_DEPLOYMENT_KEY_PARAM, deploymentKey);
  } else {
    url.searchParams.delete(RATE_DEPLOYMENT_KEY_PARAM);
  }
}

export function buildVoteLocation(currentUrl: string, update: VoteLocationUpdate) {
  const url = new URL(currentUrl);

  if (update.contentId !== undefined) {
    url.searchParams.delete(VOTE_SHARE_RATING_VERSION_PARAM);

    if (update.contentId === null) {
      url.searchParams.delete("content");
      url.searchParams.delete(RATE_CHAIN_ID_PARAM);
      url.searchParams.delete(RATE_DEPLOYMENT_KEY_PARAM);
    } else {
      url.searchParams.set("content", update.contentId.toString());
      setContentScopeSearchParams(url, update);
    }
  } else if (update.chainId !== undefined || update.deploymentKey !== undefined) {
    setContentScopeSearchParams(url, update);
  }

  if (update.categoryHash !== undefined) {
    url.hash = update.categoryHash ? `#${update.categoryHash}` : "";
  }

  return url.toString();
}

export function buildVoteContentPinKey(pathname: string, searchParams: VoteSearchParamsLike) {
  const params = new URLSearchParams(Array.from(searchParams.entries()));
  if (!params.has("content")) return null;
  // Keep share-version params so shared URLs are not mistaken for internal scroll-sync pins.

  const query = normalizeSearchParams(params);
  return query ? `${pathname}?${query}` : pathname;
}

export function buildVoteContentPinKeyFromUrl(currentUrl: string) {
  const url = new URL(currentUrl);
  return buildVoteContentPinKey(url.pathname, url.searchParams);
}

export function readVoteLocationScope(searchParams: VoteSearchParamsReader | null | undefined) {
  const chainId = normalizeVoteLocationChainId(searchParams?.get(RATE_CHAIN_ID_PARAM));
  const deploymentKey = normalizeVoteLocationDeploymentKey(searchParams?.get(RATE_DEPLOYMENT_KEY_PARAM));
  if (chainId === null && deploymentKey === null) return null;
  return { chainId, deploymentKey };
}
