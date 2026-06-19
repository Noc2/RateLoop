import { buildSignedActionMessage, hashSignedActionPayload } from "~~/lib/auth/signedActions";
import { getServerTargetNetworkById } from "~~/lib/env/server";
import { resolveContentDeploymentScope } from "~~/lib/protocolDeployment";
import {
  type WatchlistDeploymentScope,
  isValidWalletAddress,
  normalizeContentId,
  normalizeWalletAddress,
} from "~~/lib/watchlist/contentWatch";

export const WATCH_CONTENT_ACTION = "watch-content";
export const UNWATCH_CONTENT_ACTION = "unwatch-content";
export const READ_WATCHLIST_ACTION = "watchlist:read";
export const WATCHLIST_CHALLENGE_TITLE = "RateLoop watchlist authorization";

interface WatchlistChallengeInput {
  address?: string;
  contentId?: string | number | bigint;
  chainId?: string | number | bigint;
}

export interface NormalizedWatchlistChallengePayload {
  normalizedAddress: `0x${string}`;
  contentId: string;
  deployment: WatchlistDeploymentScope;
}

interface NormalizedWatchlistReadPayload {
  normalizedAddress: `0x${string}`;
  deployment: WatchlistDeploymentScope;
}

function normalizeWatchlistChainId(value: WatchlistChallengeInput["chainId"]): number | null {
  const raw =
    typeof value === "number" || typeof value === "bigint"
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (!/^\d+$/.test(raw)) return null;
  const chainId = Number(raw);
  return Number.isSafeInteger(chainId) && chainId > 0 ? chainId : null;
}

function resolveWatchlistDeploymentScope(value: WatchlistChallengeInput["chainId"]) {
  const chainId = normalizeWatchlistChainId(value);
  if (chainId === null || !getServerTargetNetworkById(chainId)) {
    return null;
  }
  return resolveContentDeploymentScope(chainId);
}

export function normalizeWatchlistChallengeInput(
  input: WatchlistChallengeInput,
): { ok: true; payload: NormalizedWatchlistChallengePayload } | { ok: false; error: string } {
  if (!input.address || !isValidWalletAddress(input.address)) {
    return { ok: false, error: "Invalid wallet address" };
  }

  const contentId = normalizeContentId(input.contentId);
  if (!contentId) {
    return { ok: false, error: "Missing or invalid contentId" };
  }
  const deployment = resolveWatchlistDeploymentScope(input.chainId);
  if (!deployment) {
    return { ok: false, error: "Missing or unsupported chainId" };
  }

  return {
    ok: true,
    payload: {
      normalizedAddress: normalizeWalletAddress(input.address),
      contentId,
      deployment,
    },
  };
}

export function hashWatchlistChallengePayload(payload: NormalizedWatchlistChallengePayload): string {
  return hashSignedActionPayload([
    `chainId:${payload.deployment.chainId}`,
    `deploymentKey:${payload.deployment.deploymentKey}`,
    `contentRegistry:${payload.deployment.contentRegistryAddress}`,
    `contentId:${payload.contentId}`,
  ]);
}

export function normalizeWatchlistReadInput(
  input: Pick<WatchlistChallengeInput, "address" | "chainId">,
): { ok: true; payload: NormalizedWatchlistReadPayload } | { ok: false; error: string } {
  if (!input.address || !isValidWalletAddress(input.address)) {
    return { ok: false, error: "Invalid wallet address" };
  }
  const deployment = resolveWatchlistDeploymentScope(input.chainId);
  if (!deployment) {
    return { ok: false, error: "Missing or unsupported chainId" };
  }

  return {
    ok: true,
    payload: {
      normalizedAddress: normalizeWalletAddress(input.address),
      deployment,
    },
  };
}

export function hashWatchlistReadPayload(payload: NormalizedWatchlistReadPayload): string {
  return hashSignedActionPayload([
    payload.normalizedAddress,
    `chainId:${payload.deployment.chainId}`,
    `deploymentKey:${payload.deployment.deploymentKey}`,
    `contentRegistry:${payload.deployment.contentRegistryAddress}`,
  ]);
}

export function buildWatchlistChallengeMessage(params: {
  action: typeof WATCH_CONTENT_ACTION | typeof UNWATCH_CONTENT_ACTION;
  address: `0x${string}`;
  payloadHash: string;
  nonce: string;
  expiresAt: Date;
}): string {
  return buildSignedActionMessage({
    title: WATCHLIST_CHALLENGE_TITLE,
    action: params.action,
    address: params.address,
    payloadHash: params.payloadHash,
    nonce: params.nonce,
    expiresAt: params.expiresAt,
  });
}

export function buildWatchlistReadChallengeMessage(params: {
  address: `0x${string}`;
  payloadHash: string;
  nonce: string;
  expiresAt: Date;
}): string {
  return buildSignedActionMessage({
    title: WATCHLIST_CHALLENGE_TITLE,
    action: READ_WATCHLIST_ACTION,
    address: params.address,
    payloadHash: params.payloadHash,
    nonce: params.nonce,
    expiresAt: params.expiresAt,
  });
}
