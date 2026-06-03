import type { Account, Chain, PublicClient, WalletClient } from "viem";
import type { Logger } from "./logger.js";

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

function emptyResult(): FeedbackRevealKeeperResult {
  return {
    jobsLeased: 0,
    revealed: 0,
    failures: 0,
    alreadyRevealed: 0,
  };
}

export async function leaseFeedbackRevealJobs(
  _settings: FeedbackRevealKeeperSettings,
): Promise<FeedbackRevealCandidate[]> {
  return [];
}

export async function revealQueuedFeedback(
  _publicClient: Pick<PublicClient, "readContract" | "waitForTransactionReceipt">,
  _walletClient: WalletClient,
  _chain: Chain,
  _account: Account,
  _logger: Logger,
  _settings: FeedbackRevealKeeperSettings,
): Promise<FeedbackRevealKeeperResult> {
  return emptyResult();
}
