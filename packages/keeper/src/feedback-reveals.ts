import { FeedbackRegistryAbi } from "@rateloop/contracts/abis";
import {
  type Account,
  type Chain,
  type PublicClient,
  type WalletClient,
  zeroAddress,
  zeroHash,
} from "viem";
import type { Logger } from "./logger.js";
import { getRevertReason } from "./revert-utils.js";

export interface FeedbackRevealKeeperSettings {
  enabled: boolean;
  apiBaseUrl: string | null;
  secret: string | null;
  batchSize: number;
  leaseSeconds: number;
  chainId: number;
  feedbackRegistry: `0x${string}`;
  maxGasPerTx: number;
}

export interface FeedbackRevealCandidate {
  id: number;
  contentId: string;
  roundId: string;
  chainId: number;
  authorAddress: `0x${string}`;
  feedbackType: string;
  body: string;
  sourceUrl: string | null;
  feedbackHash: `0x${string}`;
  commitKey: `0x${string}`;
  clientNonce: `0x${string}`;
  attempt: number;
}

export interface FeedbackRevealKeeperResult {
  jobsLeased: number;
  revealed: number;
  failures: number;
  alreadyRevealed: number;
}

interface PendingRevealsResponse {
  ok?: boolean;
  items?: FeedbackRevealCandidate[];
  error?: string;
}

type FeedbackRecordResult =
  | readonly [`0x${string}`, `0x${string}`, bigint | number, bigint | number, `0x${string}`]
  | {
      feedbackHash?: `0x${string}`;
      author?: `0x${string}`;
      committedAt?: bigint | number;
      revealedAt?: bigint | number;
      votingEngineSnapshot?: `0x${string}`;
    };
type FeedbackRecordTuple = Extract<FeedbackRecordResult, readonly unknown[]>;

const HEX_BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

function emptyResult(): FeedbackRevealKeeperResult {
  return {
    jobsLeased: 0,
    revealed: 0,
    failures: 0,
    alreadyRevealed: 0,
  };
}

function buildKeeperApiUrl(settings: FeedbackRevealKeeperSettings, pathname: string) {
  if (!settings.apiBaseUrl) {
    throw new Error("Feedback reveal API base URL is not configured");
  }

  const baseUrl = new URL(settings.apiBaseUrl);
  const targetUrl = new URL(pathname, "http://rateloop.local");
  const basePath = baseUrl.pathname.replace(/\/$/, "");

  baseUrl.pathname = `${basePath}${targetUrl.pathname}`;
  baseUrl.search = targetUrl.search;
  baseUrl.hash = "";
  return baseUrl;
}

async function fetchKeeperJson<T>(
  settings: FeedbackRevealKeeperSettings,
  pathname: string,
  init: RequestInit = {},
): Promise<T> {
  if (!settings.secret) {
    throw new Error("Feedback reveal API secret is not configured");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${settings.secret}`);
  headers.set("Content-Type", "application/json");

  const response = await fetch(buildKeeperApiUrl(settings, pathname), {
    ...init,
    headers,
  });
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(body?.error || `Feedback reveal API request failed with ${response.status}`);
  }

  return body as T;
}

export async function leaseFeedbackRevealJobs(
  settings: FeedbackRevealKeeperSettings,
): Promise<FeedbackRevealCandidate[]> {
  const path = `/api/feedback/keeper/pending-reveals?limit=${settings.batchSize}&leaseSeconds=${settings.leaseSeconds}&chainId=${settings.chainId}`;
  const response = await fetchKeeperJson<PendingRevealsResponse>(settings, path, { method: "POST" });
  return Array.isArray(response.items) ? response.items.filter(isValidFeedbackRevealCandidate) : [];
}

async function reportFeedbackRevealResult(
  settings: FeedbackRevealKeeperSettings,
  body:
    | { id: number; status: "revealed"; txHash?: `0x${string}` | null }
    | { id: number; status: "failed"; error: string; retryable: boolean; txHash?: `0x${string}` | null },
): Promise<void> {
  await fetchKeeperJson(settings, "/api/feedback/keeper/reveal-results", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function isValidBytes32(value: unknown): value is `0x${string}` {
  return typeof value === "string" && HEX_BYTES32_RE.test(value);
}

function isPositiveIntegerString(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d*$/.test(value);
}

function isValidFeedbackRevealCandidate(value: unknown): value is FeedbackRevealCandidate {
  if (!value || typeof value !== "object") return false;
  const item = value as FeedbackRevealCandidate;
  return (
    Number.isSafeInteger(item.id) &&
    item.id > 0 &&
    isPositiveIntegerString(item.contentId) &&
    isPositiveIntegerString(item.roundId) &&
    Number.isSafeInteger(item.chainId) &&
    item.chainId > 0 &&
    typeof item.feedbackType === "string" &&
    item.feedbackType.length > 0 &&
    typeof item.body === "string" &&
    item.body.length > 0 &&
    (item.sourceUrl === null || typeof item.sourceUrl === "string") &&
    isValidBytes32(item.feedbackHash) &&
    isValidBytes32(item.commitKey) &&
    isValidBytes32(item.clientNonce)
  );
}

function isFeedbackRecordTuple(record: FeedbackRecordResult): record is FeedbackRecordTuple {
  return Array.isArray(record);
}

function readRecordFeedbackHash(record: FeedbackRecordResult): `0x${string}` {
  if (isFeedbackRecordTuple(record)) return record[0];
  return record.feedbackHash ?? zeroHash;
}

function readRecordAuthor(record: FeedbackRecordResult): `0x${string}` {
  if (isFeedbackRecordTuple(record)) return record[1];
  return record.author ?? zeroAddress;
}

function readRecordRevealedAt(record: FeedbackRecordResult): bigint {
  const value = isFeedbackRecordTuple(record) ? record[3] : record.revealedAt;
  try {
    return BigInt(value ?? 0);
  } catch {
    return 0n;
  }
}

function classifyFeedbackRevealError(error: unknown): { message: string; retryable: boolean; alreadyRevealed: boolean } {
  const message = getRevertReason(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("feedback already revealed")) {
    return { message, retryable: false, alreadyRevealed: true };
  }

  const retryable =
    normalized.includes("round not terminal") ||
    normalized.includes("vote not revealed") ||
    normalized.includes("http request failed") ||
    normalized.includes("fetch failed") ||
    normalized.includes("timeout") ||
    normalized.includes("network");

  return { message, retryable, alreadyRevealed: false };
}

async function writeContractAndConfirm(params: {
  publicClient: Pick<PublicClient, "waitForTransactionReceipt">;
  walletClient: WalletClient;
  maxGasPerTx: number;
  request: Parameters<WalletClient["writeContract"]>[0];
}): Promise<`0x${string}`> {
  if (!params.request.gas && params.maxGasPerTx > 0) {
    params.request.gas = BigInt(params.maxGasPerTx);
  }

  const hash = await params.walletClient.writeContract(params.request);
  const receipt = await params.publicClient.waitForTransactionReceipt({ hash });
  if (receipt?.status === "reverted") {
    throw new Error(`Transaction ${hash} reverted on-chain`);
  }

  return hash;
}

async function processFeedbackRevealCandidate(params: {
  publicClient: Pick<PublicClient, "readContract" | "waitForTransactionReceipt">;
  walletClient: WalletClient;
  chain: Chain;
  account: Account;
  logger: Logger;
  settings: FeedbackRevealKeeperSettings;
  candidate: FeedbackRevealCandidate;
}): Promise<"revealed" | "already-revealed" | "failed"> {
  const { candidate, settings } = params;
  if (candidate.chainId !== settings.chainId) {
    await reportFeedbackRevealResult(settings, {
      id: candidate.id,
      status: "failed",
      error: `Feedback reveal job chain ${candidate.chainId} does not match keeper chain ${settings.chainId}`,
      retryable: false,
    });
    return "failed";
  }

  try {
    const record = (await params.publicClient.readContract({
      address: settings.feedbackRegistry,
      abi: FeedbackRegistryAbi,
      functionName: "feedbackByCommitKey",
      args: [BigInt(candidate.contentId), BigInt(candidate.roundId), candidate.commitKey],
    })) as FeedbackRecordResult;
    const onchainFeedbackHash = readRecordFeedbackHash(record).toLowerCase();
    const author = readRecordAuthor(record);
    const revealedAt = readRecordRevealedAt(record);

    if (revealedAt > 0n) {
      await reportFeedbackRevealResult(settings, { id: candidate.id, status: "revealed" });
      return "already-revealed";
    }
    if (onchainFeedbackHash === zeroHash) {
      await reportFeedbackRevealResult(settings, {
        id: candidate.id,
        status: "failed",
        error: "Feedback hash was not committed on-chain",
        retryable: false,
      });
      return "failed";
    }
    if (onchainFeedbackHash !== candidate.feedbackHash.toLowerCase()) {
      await reportFeedbackRevealResult(settings, {
        id: candidate.id,
        status: "failed",
        error: "Stored feedback hash does not match on-chain commit",
        retryable: false,
      });
      return "failed";
    }
    if (author.toLowerCase() !== candidate.authorAddress.toLowerCase()) {
      await reportFeedbackRevealResult(settings, {
        id: candidate.id,
        status: "failed",
        error: "Stored feedback author does not match on-chain commit",
        retryable: false,
      });
      return "failed";
    }

    const txHash = await writeContractAndConfirm({
      publicClient: params.publicClient,
      walletClient: params.walletClient,
      maxGasPerTx: settings.maxGasPerTx,
      request: {
        account: params.account,
        address: settings.feedbackRegistry,
        abi: FeedbackRegistryAbi,
        chain: params.chain,
        functionName: "revealFeedback",
        args: [
          BigInt(candidate.contentId),
          BigInt(candidate.roundId),
          candidate.commitKey,
          candidate.feedbackType,
          candidate.body,
          candidate.sourceUrl ?? "",
          candidate.clientNonce,
        ],
      },
    });

    await reportFeedbackRevealResult(settings, { id: candidate.id, status: "revealed", txHash });
    return "revealed";
  } catch (error) {
    const classification = classifyFeedbackRevealError(error);
    if (classification.alreadyRevealed) {
      await reportFeedbackRevealResult(settings, { id: candidate.id, status: "revealed" });
      return "already-revealed";
    }

    await reportFeedbackRevealResult(settings, {
      id: candidate.id,
      status: "failed",
      error: classification.message,
      retryable: classification.retryable,
    });
    params.logger.warn("Feedback reveal failed", {
      contentId: candidate.contentId,
      error: classification.message,
      feedbackId: candidate.id,
      retryable: classification.retryable,
      roundId: candidate.roundId,
    });
    return "failed";
  }
}

export async function revealQueuedFeedback(
  publicClient: Pick<PublicClient, "readContract" | "waitForTransactionReceipt">,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
  settings: FeedbackRevealKeeperSettings,
): Promise<FeedbackRevealKeeperResult> {
  if (!settings.enabled) {
    return emptyResult();
  }

  const candidates = await leaseFeedbackRevealJobs(settings);
  const result = emptyResult();
  result.jobsLeased = candidates.length;

  for (const candidate of candidates) {
    const outcome = await processFeedbackRevealCandidate({
      publicClient,
      walletClient,
      chain,
      account,
      logger,
      settings,
      candidate,
    });
    if (outcome === "revealed") result.revealed++;
    if (outcome === "already-revealed") result.alreadyRevealed++;
    if (outcome === "failed") result.failures++;
  }

  return result;
}
