import { TokenlessFeedbackBonusAbi } from "@rateloop/contracts/tokenless";
import "server-only";
import {
  type Address,
  type Hash,
  type Hex,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  isAddress,
  isHash,
} from "viem";
import { loadTokenlessChainConfig } from "~~/lib/tokenless/chain/config";
import {
  type TokenlessChainRuntime,
  assertLiveTokenlessDeployment,
  getTokenlessChainRuntime,
} from "~~/lib/tokenless/chain/runtime";
import type { FeedbackBonusAwardReceipt, PreparedFeedbackBonusAward } from "~~/lib/tokenless/feedbackBonusAwards";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type OnchainPool = {
  awarder: Address;
  depositedAmount: bigint;
  awardedAmount: bigint;
  feedbackDeadline: bigint;
  awardDeadline: bigint;
  refunded: boolean;
};

type OnchainFeedback = {
  voteKey: Address;
  responseHash: Hex;
  payoutCommitment: Hex;
  awardAmount: bigint;
  awarded: boolean;
  claimed: boolean;
};

export type FeedbackBonusHumanWalletAuthorization = {
  chainId: number;
  contractAddress: Address;
  awarderAddress: Address;
  transactionData: Hex;
};

export type FeedbackBonusAwardTransactionEvidence = {
  transactionHash: Hash;
  transactionFrom: Address;
  transactionTo: Address | null;
  transactionData: Hex;
  receiptStatus: "success" | "reverted";
  confirmedAt: Date;
  logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[];
};

function invalid(message: string, code = "feedback_bonus_chain_mismatch"): never {
  throw new TokenlessServiceError(message, 409, code);
}

function exactPoolId(value: string) {
  if (!/^[1-9][0-9]*$/u.test(value)) invalid("Stored Feedback Bonus pool ID is invalid.");
  return BigInt(value);
}

function exactAtomic(value: string) {
  if (!/^[1-9][0-9]*$/u.test(value)) invalid("Stored Feedback Bonus award amount is invalid.");
  return BigInt(value);
}

function exactAddress(value: string, label: string) {
  if (!isAddress(value)) invalid(`${label} is invalid.`);
  return getAddress(value);
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

export function buildFeedbackBonusHumanWalletAuthorization(input: {
  prepared: PreparedFeedbackBonusAward;
  chainId: number;
  configuredContractAddress: Address;
  now: Date;
  pool: OnchainPool;
  feedback: OnchainFeedback;
  mode?: "prepare" | "confirm";
}): FeedbackBonusHumanWalletAuthorization {
  if (input.prepared.pool.chainId !== String(input.chainId)) {
    invalid("Feedback Bonus pool chain does not match the active deployment.");
  }
  const contractAddress = exactAddress(input.prepared.pool.contractAddress, "Stored Feedback Bonus contract");
  if (contractAddress !== getAddress(input.configuredContractAddress)) {
    invalid("Feedback Bonus pool contract does not match the active deployment.");
  }
  const poolId = exactPoolId(input.prepared.pool.poolId);
  const voteKey = exactAddress(input.prepared.voteKey, "Stored feedback vote key");
  const awarderWallet = exactAddress(input.prepared.awarderWallet, "Stored Feedback Bonus awarder wallet");
  const amount = exactAtomic(input.prepared.amountAtomic);
  const nowSeconds = BigInt(Math.floor(input.now.getTime() / 1_000));
  const confirming = input.mode === "confirm";
  if (
    !confirming &&
    (input.pool.refunded ||
      nowSeconds <= input.pool.feedbackDeadline ||
      nowSeconds > input.pool.awardDeadline ||
      amount > input.pool.depositedAmount - input.pool.awardedAmount)
  ) {
    invalid("The on-chain Feedback Bonus pool is not open for this award.", "feedback_bonus_award_window_closed");
  }
  if (getAddress(input.pool.awarder) !== awarderWallet) {
    invalid("The on-chain Feedback Bonus awarder does not match the frozen human wallet.");
  }
  if (
    getAddress(input.feedback.voteKey) !== voteKey ||
    !sameHex(input.feedback.responseHash, input.prepared.responseHash) ||
    !sameHex(input.feedback.payoutCommitment, input.prepared.payoutCommitment) ||
    (confirming
      ? !input.feedback.awarded || input.feedback.awardAmount !== amount
      : input.feedback.awarded || input.feedback.claimed || input.feedback.awardAmount !== 0n)
  ) {
    invalid("The selected feedback does not match its immutable on-chain registration.");
  }
  return {
    chainId: input.chainId,
    contractAddress,
    awarderAddress: awarderWallet,
    transactionData: encodeFunctionData({
      abi: TokenlessFeedbackBonusAbi,
      functionName: "award",
      args: [poolId, voteKey, amount],
    }),
  };
}

export function verifyFeedbackBonusHumanWalletEvidence(input: {
  prepared: PreparedFeedbackBonusAward;
  authorization: FeedbackBonusHumanWalletAuthorization;
  evidence: FeedbackBonusAwardTransactionEvidence;
}): FeedbackBonusAwardReceipt {
  if (
    input.evidence.receiptStatus !== "success" ||
    getAddress(input.evidence.transactionFrom) !== input.authorization.awarderAddress ||
    input.evidence.transactionTo === null ||
    getAddress(input.evidence.transactionTo) !== input.authorization.contractAddress ||
    !sameHex(input.evidence.transactionData, input.authorization.transactionData)
  ) {
    invalid(
      "The transaction is not the exact award authorized by the designated human wallet.",
      "feedback_bonus_award_transaction_invalid",
    );
  }
  const poolId = exactPoolId(input.prepared.pool.poolId);
  const voteKey = exactAddress(input.prepared.voteKey, "Stored feedback vote key");
  const amount = exactAtomic(input.prepared.amountAtomic);
  const matchingEvents = input.evidence.logs.filter(log => {
    if (getAddress(log.address) !== input.authorization.contractAddress) return false;
    try {
      const decoded = decodeEventLog({
        abi: TokenlessFeedbackBonusAbi,
        eventName: "FeedbackAwarded",
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const args = decoded.args as {
        poolId: bigint;
        responseHash: Hex;
        voteKey: Address;
        payoutCommitment: Hex;
        amount: bigint;
      };
      return (
        args.poolId === poolId &&
        getAddress(args.voteKey) === voteKey &&
        sameHex(args.responseHash, input.prepared.responseHash) &&
        sameHex(args.payoutCommitment, input.prepared.payoutCommitment) &&
        args.amount === amount
      );
    } catch {
      return false;
    }
  });
  if (matchingEvents.length !== 1) {
    invalid("The exact Feedback Bonus award event was not confirmed.", "feedback_bonus_award_event_missing");
  }
  if (!isHash(input.evidence.transactionHash) || !Number.isFinite(input.evidence.confirmedAt.getTime())) {
    invalid("The Feedback Bonus transaction receipt is malformed.", "feedback_bonus_award_receipt_invalid");
  }
  return { transactionHash: input.evidence.transactionHash.toLowerCase(), confirmedAt: input.evidence.confirmedAt };
}

export function createLiveFeedbackBonusHumanWalletExecution(input?: {
  runtime?: TokenlessChainRuntime;
  now?: () => Date;
}) {
  const config = loadTokenlessChainConfig();
  const runtime = input?.runtime ?? getTokenlessChainRuntime(config);
  async function exactAuthorization(prepared: PreparedFeedbackBonusAward, mode: "prepare" | "confirm") {
    await assertLiveTokenlessDeployment(config, runtime);
    const poolId = exactPoolId(prepared.pool.poolId);
    const voteKey = exactAddress(prepared.voteKey, "Stored feedback vote key");
    const [pool, feedback] = await Promise.all([
      runtime.publicClient.readContract({
        abi: TokenlessFeedbackBonusAbi,
        address: config.feedbackBonusAddress,
        functionName: "getPool",
        args: [poolId],
      }),
      runtime.publicClient.readContract({
        abi: TokenlessFeedbackBonusAbi,
        address: config.feedbackBonusAddress,
        functionName: "getFeedback",
        args: [poolId, voteKey],
      }),
    ]);
    return buildFeedbackBonusHumanWalletAuthorization({
      prepared,
      chainId: config.chainId,
      configuredContractAddress: config.feedbackBonusAddress,
      now: input?.now?.() ?? new Date(),
      pool,
      feedback,
      mode,
    });
  }

  return {
    prepareHumanAward: (prepared: PreparedFeedbackBonusAward) => exactAuthorization(prepared, "prepare"),

    async confirmHumanAward(input: { award: PreparedFeedbackBonusAward; transactionHash: string }) {
      if (!isHash(input.transactionHash)) {
        invalid("A valid Feedback Bonus transaction hash is required.", "feedback_bonus_award_receipt_invalid");
      }
      const authorization = await exactAuthorization(input.award, "confirm");
      const hash = input.transactionHash as Hash;
      const [transaction, receipt] = await Promise.all([
        runtime.publicClient.getTransaction({ hash }),
        runtime.publicClient.waitForTransactionReceipt({ hash, confirmations: 1 }),
      ]);
      const block = await runtime.publicClient.getBlock({ blockHash: receipt.blockHash });
      return verifyFeedbackBonusHumanWalletEvidence({
        prepared: input.award,
        authorization,
        evidence: {
          transactionHash: hash,
          transactionFrom: transaction.from,
          transactionTo: transaction.to,
          transactionData: transaction.input,
          receiptStatus: receipt.status,
          confirmedAt: new Date(Number(block.timestamp) * 1_000),
          logs: receipt.logs,
        },
      });
    },
  };
}
