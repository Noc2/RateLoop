import { TokenlessFeedbackBonusAbi } from "@rateloop/contracts/tokenless";
import {
  type Address,
  type Hash,
  type Hex,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  isHash,
  keccak256,
  parseAbiParameters,
} from "viem";
import { baseSepolia } from "viem/chains";
import type { PublicFeedbackBonusEntitlement } from "~~/lib/tokenless/feedbackBonusRecipientClaims";
import { tokenlessPayoutCommitment } from "~~/lib/tokenless/rater/material";
import type { TokenlessRaterRoundSecrets } from "~~/lib/tokenless/rater/types";

const FEEDBACK_KEY_PARAMETERS = parseAbiParameters("uint256 poolId,address voteKey");

export type FeedbackBonusClaimAuthorization = {
  chainId: number;
  contractAddress: Address;
  poolId: bigint;
  voteKey: Address;
  payoutAddress: Address;
  payoutSalt: Hex;
  relayerAddress: Address;
  amountAtomic: bigint;
  transactionData: Hex;
  feedbackKey: Hex;
};

export type FeedbackBonusClaimTransactionEvidence = {
  transactionHash: Hash;
  transactionFrom: Address;
  transactionTo: Address | null;
  transactionData: Hex;
  receiptStatus: "success" | "reverted";
  logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[];
};

function invalid(message: string): never {
  throw new Error(message);
}

function exactAddress(value: string, label: string) {
  if (!isAddress(value)) invalid(`${label} is invalid.`);
  return getAddress(value);
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

export function assertFeedbackBonusEntitlementForRecovery(
  entitlement: PublicFeedbackBonusEntitlement,
  secrets: TokenlessRaterRoundSecrets,
) {
  if (entitlement.schemaVersion !== "rateloop.feedback-bonus-entitlement.v1") {
    invalid("RateLoop returned an unsupported Feedback Bonus entitlement.");
  }
  if (typeof entitlement.awarded !== "boolean" || typeof entitlement.claimed !== "boolean") {
    invalid("The Feedback Bonus claim status is invalid.");
  }
  if (entitlement.chainId !== baseSepolia.id) invalid("This Feedback Bonus is on an unsupported chain.");
  if (!/^[1-9][0-9]*$/u.test(entitlement.poolId)) invalid("The Feedback Bonus pool ID is invalid.");
  if (entitlement.roundId !== secrets.reveal.roundId.toString(10)) {
    invalid("This recovery package belongs to a different public review round.");
  }
  const voteKey = exactAddress(entitlement.voteKey, "Feedback vote key");
  if (voteKey !== getAddress(secrets.reveal.voteKey)) {
    invalid("This recovery package does not control the registered feedback vote key.");
  }
  if (!isHash(entitlement.responseHash) || !sameHex(entitlement.responseHash, secrets.reveal.responseHash)) {
    invalid("This recovery package does not match the registered feedback response.");
  }
  if (!isHash(entitlement.payoutCommitment)) invalid("The Feedback Bonus payout commitment is invalid.");
  const payoutCommitment = tokenlessPayoutCommitment(secrets.reveal.payoutAddress, secrets.reveal.salt);
  if (!sameHex(entitlement.payoutCommitment, payoutCommitment)) {
    invalid("This recovery package cannot open the Feedback Bonus payout commitment.");
  }
  if (!/^(0|[1-9][0-9]*)$/u.test(entitlement.awardAmountAtomic)) {
    invalid("The Feedback Bonus award amount is invalid.");
  }
  const awardAmount = BigInt(entitlement.awardAmountAtomic);
  if (
    (entitlement.awarded ? awardAmount === 0n : awardAmount !== 0n) ||
    (entitlement.claimed && !entitlement.awarded)
  ) {
    invalid("The Feedback Bonus award state is inconsistent.");
  }
  return {
    contractAddress: exactAddress(entitlement.contractAddress, "Feedback Bonus contract"),
    poolId: BigInt(entitlement.poolId),
    voteKey,
    payoutAddress: getAddress(secrets.reveal.payoutAddress),
    payoutSalt: secrets.reveal.salt,
    awardAmount,
  };
}

export function buildFeedbackBonusClaimAuthorization(input: {
  entitlement: PublicFeedbackBonusEntitlement;
  secrets: TokenlessRaterRoundSecrets;
  relayerAddress: string;
}): FeedbackBonusClaimAuthorization {
  const bound = assertFeedbackBonusEntitlementForRecovery(input.entitlement, input.secrets);
  if (!input.entitlement.awarded || input.entitlement.claimed || bound.awardAmount === 0n) {
    invalid("This Feedback Bonus is not claimable.");
  }
  const relayerAddress = exactAddress(input.relayerAddress, "Connected relayer wallet");
  return {
    chainId: input.entitlement.chainId,
    contractAddress: bound.contractAddress,
    poolId: bound.poolId,
    voteKey: bound.voteKey,
    payoutAddress: bound.payoutAddress,
    payoutSalt: bound.payoutSalt,
    relayerAddress,
    amountAtomic: bound.awardAmount,
    transactionData: encodeFunctionData({
      abi: TokenlessFeedbackBonusAbi,
      functionName: "claimAward",
      args: [bound.poolId, bound.voteKey, bound.payoutAddress, bound.payoutSalt],
    }),
    feedbackKey: keccak256(encodeAbiParameters(FEEDBACK_KEY_PARAMETERS, [bound.poolId, bound.voteKey])),
  };
}

export function verifyFeedbackBonusClaimEvidence(input: {
  authorization: FeedbackBonusClaimAuthorization;
  evidence: FeedbackBonusClaimTransactionEvidence;
}) {
  const { authorization, evidence } = input;
  if (
    evidence.receiptStatus !== "success" ||
    getAddress(evidence.transactionFrom) !== authorization.relayerAddress ||
    !evidence.transactionTo ||
    getAddress(evidence.transactionTo) !== authorization.contractAddress ||
    !sameHex(evidence.transactionData, authorization.transactionData) ||
    !isHash(evidence.transactionHash)
  ) {
    invalid("The confirmed transaction is not the exact authorized Feedback Bonus claim.");
  }
  const matchingClaims = evidence.logs.filter(log => {
    if (getAddress(log.address) !== authorization.contractAddress) return false;
    try {
      const decoded = decodeEventLog({
        abi: TokenlessFeedbackBonusAbi,
        eventName: "FeedbackAwardClaimed",
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const args = decoded.args as { poolId: bigint; feedbackKey: Hex; payoutAddress: Address; amount: bigint };
      return (
        args.poolId === authorization.poolId &&
        sameHex(args.feedbackKey, authorization.feedbackKey) &&
        getAddress(args.payoutAddress) === authorization.payoutAddress &&
        args.amount === authorization.amountAtomic
      );
    } catch {
      return false;
    }
  });
  if (matchingClaims.length !== 1) invalid("The exact FeedbackAwardClaimed event was not confirmed.");
  return {
    transactionHash: evidence.transactionHash.toLowerCase() as Hash,
    claimedAmountAtomic: authorization.amountAtomic,
  };
}
