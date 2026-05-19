"use client";

export interface RoundClaimableRewardItem {
  contentId: bigint;
  roundId: bigint;
  reward: bigint;
  claimType: "reward" | "refund" | "participation_reward";
}

type ClaimHex = `0x${string}`;

interface ClaimLookupBaseParams {
  contentId: bigint;
  roundId: bigint;
  connectedAddress: ClaimHex;
  voter?: string | null;
  commitKey?: string | null;
}

export interface ClaimStateLookup {
  contract: "distributor" | "engine";
  functionName:
    | "rewardCommitClaimed"
    | "rewardClaimed"
    | "cancelledRoundRefundClaimed"
    | "participationRewardCommitClaimed"
    | "participationRewardClaimed"
    | "participationRewardCommitPaid"
    | "participationRewardPaid";
  args: readonly [bigint, bigint, ClaimHex];
}

export interface FrontendRoundFeeClaimableRewardItem {
  contentId: bigint;
  roundId: bigint;
  frontend: `0x${string}`;
  reward: bigint;
  claimType: "frontend_round_fee";
}

export interface FrontendRegistryClaimableRewardItem {
  frontend: `0x${string}`;
  reward: bigint;
  claimType: "frontend_registry_fee";
}

export interface QuestionRewardPayoutWeight {
  domain: number;
  rewardPoolId: bigint;
  contentId: bigint;
  roundId: bigint;
  commitKey: `0x${string}`;
  identityKey: `0x${string}`;
  account: `0x${string}`;
  baseWeight: bigint;
  independenceBps: number;
  effectiveWeight: bigint;
  reasonHash: `0x${string}`;
}

export interface QuestionRewardPoolClaimableRewardItem {
  rewardPoolId: bigint;
  contentId: bigint;
  roundId: bigint;
  reward: bigint;
  asset: "LREP" | "USDC";
  title: string;
  payoutWeight?: QuestionRewardPayoutWeight;
  payoutProof?: `0x${string}`[];
  claimType: "question_reward";
}

export interface QuestionBundleRewardClaimableRewardItem {
  bundleId: bigint;
  roundSetIndex: bigint;
  reward: bigint;
  asset: "LREP" | "USDC";
  title: string;
  claimType: "question_bundle_reward";
}

export type ClaimableRewardItem =
  | RoundClaimableRewardItem
  | FrontendRoundFeeClaimableRewardItem
  | FrontendRegistryClaimableRewardItem
  | QuestionRewardPoolClaimableRewardItem
  | QuestionBundleRewardClaimableRewardItem;

interface VoterParticipationRewardClaimCandidate {
  contentId: bigint;
  roundId: bigint;
  stake: bigint;
  rateBps: bigint;
  totalReward: bigint;
  alreadyPaid: bigint;
  reservedReward: bigint;
  rewardPool: `0x${string}` | null;
  alreadyClaimed: boolean;
}

interface LastClaimAwarePoolShareParams {
  claimantWeight: bigint;
  totalWeight: bigint;
  pool: bigint;
  totalClaimants: bigint;
  claimedCount: bigint;
  claimedAmount: bigint;
}

function normalizeClaimAddress(value: string | null | undefined): ClaimHex | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) ? (value.toLowerCase() as ClaimHex) : null;
}

function normalizeCommitKey(value: string | null | undefined): ClaimHex | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value) ? (value.toLowerCase() as ClaimHex) : null;
}

function claimAccount(params: Pick<ClaimLookupBaseParams, "connectedAddress" | "voter">) {
  return normalizeClaimAddress(params.voter) ?? params.connectedAddress;
}

export function buildRoundClaimStateLookup(params: ClaimLookupBaseParams & { settled: boolean }): ClaimStateLookup {
  if (params.settled) {
    const commitKey = normalizeCommitKey(params.commitKey);
    if (commitKey) {
      return {
        contract: "distributor",
        functionName: "rewardCommitClaimed",
        args: [params.contentId, params.roundId, commitKey],
      };
    }
    return {
      contract: "distributor",
      functionName: "rewardClaimed",
      args: [params.contentId, params.roundId, claimAccount(params)],
    };
  }

  return {
    contract: "engine",
    functionName: "cancelledRoundRefundClaimed",
    args: [params.contentId, params.roundId, claimAccount(params)],
  };
}

export function buildParticipationClaimStateLookups(params: ClaimLookupBaseParams) {
  const commitKey = normalizeCommitKey(params.commitKey);
  if (commitKey) {
    return {
      claimed: {
        contract: "distributor" as const,
        functionName: "participationRewardCommitClaimed" as const,
        args: [params.contentId, params.roundId, commitKey] as const,
      },
      paid: {
        contract: "distributor" as const,
        functionName: "participationRewardCommitPaid" as const,
        args: [params.contentId, params.roundId, commitKey] as const,
      },
    };
  }

  const account = claimAccount(params);
  return {
    claimed: {
      contract: "distributor" as const,
      functionName: "participationRewardClaimed" as const,
      args: [params.contentId, params.roundId, account] as const,
    },
    paid: {
      contract: "distributor" as const,
      functionName: "participationRewardPaid" as const,
      args: [params.contentId, params.roundId, account] as const,
    },
  };
}

export function calculateLastClaimAwarePoolShare({
  claimantWeight,
  totalWeight,
  pool,
  totalClaimants,
  claimedCount,
  claimedAmount,
}: LastClaimAwarePoolShareParams) {
  if (
    claimantWeight <= 0n ||
    totalWeight <= 0n ||
    pool <= 0n ||
    totalClaimants <= 0n ||
    claimedCount >= totalClaimants ||
    claimedAmount > pool
  ) {
    return 0n;
  }

  return claimedCount + 1n === totalClaimants ? pool - claimedAmount : (claimantWeight * pool) / totalWeight;
}

export function buildVoterParticipationClaimableRewards(candidates: readonly VoterParticipationRewardClaimCandidate[]) {
  return candidates.flatMap(candidate => {
    const { contentId, roundId, stake, rateBps, totalReward, alreadyPaid, reservedReward, rewardPool, alreadyClaimed } =
      candidate;

    if (alreadyClaimed || !rewardPool || stake <= 0n || rateBps <= 0n || totalReward <= 0n) {
      return [];
    }

    const fullReward = (stake * rateBps) / 10000n;
    if (fullReward <= 0n) {
      return [];
    }

    const currentlyClaimable = reservedReward < totalReward ? (fullReward * reservedReward) / totalReward : fullReward;
    const claimableReward = currentlyClaimable > alreadyPaid ? currentlyClaimable - alreadyPaid : 0n;
    if (claimableReward <= 0n) {
      return [];
    }

    return [
      {
        contentId,
        roundId,
        reward: claimableReward,
        claimType: "participation_reward" as const,
      } satisfies ClaimableRewardItem,
    ];
  });
}

export function getClaimableRoundKey(item: ClaimableRewardItem) {
  if (item.claimType === "question_reward") {
    return `question-reward:${item.rewardPoolId.toString()}-${item.roundId.toString()}`;
  }
  if (item.claimType === "question_bundle_reward") {
    return `question-bundle-reward:${item.bundleId.toString()}-${item.roundSetIndex.toString()}`;
  }
  return "roundId" in item ? `${item.contentId.toString()}-${item.roundId.toString()}` : null;
}

function claimExecutionPriority(item: ClaimableRewardItem) {
  switch (item.claimType) {
    case "refund":
      return 0;
    case "reward":
      return 1;
    case "participation_reward":
      return 2;
    case "question_reward":
      return 3;
    case "question_bundle_reward":
      return 4;
    case "frontend_round_fee":
      return 5;
    case "frontend_registry_fee":
      return 6;
  }
}

export function sortClaimableRewardItems(items: readonly ClaimableRewardItem[]) {
  return [...items].sort((left, right) => {
    const priorityDelta = claimExecutionPriority(left) - claimExecutionPriority(right);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    if ("contentId" in left && "contentId" in right && left.contentId !== right.contentId) {
      return left.contentId < right.contentId ? -1 : 1;
    }

    if ("roundId" in left && "roundId" in right && left.roundId !== right.roundId) {
      return left.roundId < right.roundId ? -1 : 1;
    }

    if ("frontend" in left && "frontend" in right && left.frontend !== right.frontend) {
      return left.frontend.localeCompare(right.frontend);
    }

    return 0;
  });
}

export function getQuestionRewardClaimArgs(item: QuestionRewardPoolClaimableRewardItem) {
  if (item.payoutWeight && item.payoutProof) {
    return [item.rewardPoolId, item.roundId, item.payoutWeight, item.payoutProof] as const;
  }

  return [item.rewardPoolId, item.roundId] as const;
}
