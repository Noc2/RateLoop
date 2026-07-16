import { TokenlessFeedbackBonusAbi } from "@rateloop/contracts/tokenless";
import "server-only";
import { type Address, type Hex, getAddress, isAddress, isHash } from "viem";
import { dbPool } from "~~/lib/db";
import { loadTokenlessChainConfig } from "~~/lib/tokenless/chain/config";
import {
  type TokenlessChainRuntime,
  assertLiveTokenlessDeployment,
  getTokenlessChainRuntime,
} from "~~/lib/tokenless/chain/runtime";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

export type FeedbackBonusRecipientCandidate = {
  roundId: string;
  chainId: number;
  contractAddress: Address;
  poolId: string;
  feedbackId: string;
  responseHash: Hex;
  voteKey: Address;
  payoutCommitment: Hex;
};

type OnchainFeedback = {
  voteKey: Address;
  responseHash: Hex;
  payoutCommitment: Hex;
  awardAmount: bigint;
  awarded: boolean;
  claimed: boolean;
};

export type PublicFeedbackBonusEntitlement = FeedbackBonusRecipientCandidate & {
  schemaVersion: "rateloop.feedback-bonus-entitlement.v1";
  awardAmountAtomic: string;
  awarded: boolean;
  claimed: boolean;
};

export type FeedbackBonusRecipientClaimDependencies = {
  expectedChainId: number;
  expectedContractAddress: Address;
  listCandidates(input: { roundId: string; voteKey: Address }): Promise<FeedbackBonusRecipientCandidate[]>;
  readFeedback(input: { poolId: bigint; voteKey: Address }): Promise<OnchainFeedback>;
};

function invalid(message: string, code = "feedback_bonus_entitlement_invalid"): never {
  throw new TokenlessServiceError(message, 409, code);
}

function exactRoundId(value: string) {
  if (!/^[1-9][0-9]*$/u.test(value)) invalid("A valid public review round is required.");
  return value;
}

function exactVoteKey(value: string) {
  if (!isAddress(value)) invalid("A valid local feedback vote key is required.");
  return getAddress(value);
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Returns only public entitlement evidence. Payout addresses, salts, recovery
 * packages, and recovery secrets never enter this service.
 */
export function createFeedbackBonusRecipientEntitlementService(dependencies: FeedbackBonusRecipientClaimDependencies) {
  const expectedContractAddress = getAddress(dependencies.expectedContractAddress);
  return async function listFeedbackBonusRecipientEntitlements(input: { roundId: string; voteKey: string }) {
    const roundId = exactRoundId(input.roundId);
    const voteKey = exactVoteKey(input.voteKey);
    const candidates = await dependencies.listCandidates({ roundId, voteKey });
    return Promise.all(
      candidates.map(async candidate => {
        if (
          candidate.roundId !== roundId ||
          candidate.chainId !== dependencies.expectedChainId ||
          getAddress(candidate.contractAddress) !== expectedContractAddress ||
          getAddress(candidate.voteKey) !== voteKey ||
          !/^[1-9][0-9]*$/u.test(candidate.poolId) ||
          !isHash(candidate.responseHash) ||
          !isHash(candidate.payoutCommitment)
        ) {
          invalid("Stored Feedback Bonus recipient evidence does not match the active public deployment.");
        }
        const feedback = await dependencies.readFeedback({ poolId: BigInt(candidate.poolId), voteKey });
        if (
          getAddress(feedback.voteKey) !== voteKey ||
          !sameHex(feedback.responseHash, candidate.responseHash) ||
          !sameHex(feedback.payoutCommitment, candidate.payoutCommitment) ||
          feedback.awardAmount < 0n ||
          (feedback.awarded ? feedback.awardAmount === 0n : feedback.awardAmount !== 0n) ||
          (feedback.claimed && !feedback.awarded)
        ) {
          invalid("Live Feedback Bonus evidence does not match the registered public response.");
        }
        return {
          ...candidate,
          schemaVersion: "rateloop.feedback-bonus-entitlement.v1",
          contractAddress: expectedContractAddress,
          voteKey,
          awardAmountAtomic: feedback.awardAmount.toString(),
          awarded: feedback.awarded,
          claimed: feedback.claimed,
        } satisfies PublicFeedbackBonusEntitlement;
      }),
    );
  };
}

function text(row: Row, key: string) {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

async function listLiveCandidates(input: { roundId: string; voteKey: Address }) {
  const result = await dbPool.query(
    `SELECT response.round_id,pool.chain_id,pool.contract_address,pool.pool_id,
            feedback.feedback_id,feedback.response_hash,feedback.vote_key,feedback.payout_commitment
     FROM tokenless_feedback_bonus_feedback feedback
     JOIN tokenless_feedback_bonus_pools pool
       ON pool.workspace_id=feedback.workspace_id AND pool.opportunity_id=feedback.opportunity_id
     JOIN tokenless_public_rater_responses response
       ON feedback.body_reference=('rateloop.feedback-body.v1:public_rater_response:' || response.response_id)
      AND response.vote_key=feedback.vote_key
      AND response.response_hash=feedback.response_hash
     WHERE response.round_id=$1 AND feedback.vote_key=$2 AND feedback.eligibility_status='eligible'
     ORDER BY pool.pool_id ASC`,
    [input.roundId, input.voteKey.toLowerCase()],
  );
  return (result.rows as Row[]).map(row => {
    const contractAddress = text(row, "contract_address");
    const responseHash = text(row, "response_hash");
    const voteKey = text(row, "vote_key");
    const payoutCommitment = text(row, "payout_commitment");
    if (!contractAddress || !isAddress(contractAddress) || !responseHash || !isHash(responseHash)) {
      invalid("Stored public Feedback Bonus evidence is malformed.");
    }
    if (!voteKey || !isAddress(voteKey) || !payoutCommitment || !isHash(payoutCommitment)) {
      invalid("Stored public Feedback Bonus recipient evidence is malformed.");
    }
    return {
      roundId: text(row, "round_id")!,
      chainId: Number(row.chain_id),
      contractAddress: getAddress(contractAddress),
      poolId: text(row, "pool_id")!,
      feedbackId: text(row, "feedback_id")!,
      responseHash,
      voteKey: getAddress(voteKey),
      payoutCommitment,
    } satisfies FeedbackBonusRecipientCandidate;
  });
}

/** Lazy production composition: local public-response binding plus live chain state. */
export async function listFeedbackBonusRecipientEntitlements(input: { roundId: string; voteKey: string }) {
  const config = loadTokenlessChainConfig();
  const runtime: TokenlessChainRuntime = getTokenlessChainRuntime(config);
  await assertLiveTokenlessDeployment(config, runtime);
  return createFeedbackBonusRecipientEntitlementService({
    expectedChainId: config.chainId,
    expectedContractAddress: config.feedbackBonusAddress,
    listCandidates: listLiveCandidates,
    async readFeedback({ poolId, voteKey }) {
      return runtime.publicClient.readContract({
        abi: TokenlessFeedbackBonusAbi,
        address: config.feedbackBonusAddress,
        functionName: "getFeedback",
        args: [poolId, voteKey],
      });
    },
  })(input);
}
