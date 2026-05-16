import { LoopReputationAbi } from "@rateloop/contracts";
import { AdvisoryVoteRecorderAbi, RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import type { Abi, Hex } from "viem";

type EvmAddress = `0x${string}`;

export type RoundVoteCallKind = "approve" | "commitVote" | "commitVoteWithPermit" | "recordAdvisoryVote";

export type RoundVoteContractCall = {
  abi: Abi;
  address: EvmAddress;
  args: readonly unknown[];
  functionName: string;
  kind: RoundVoteCallKind;
  value?: bigint;
};

type CommitVoteArgs = readonly [
  contentId: bigint,
  roundContext: bigint,
  targetRound: bigint,
  drandChainHash: Hex,
  commitHash: Hex,
  ciphertext: Hex,
  stakeWei: bigint,
  frontend: EvmAddress,
];

type AdvisoryVoteArgs = readonly [
  contentId: bigint,
  roundContext: bigint,
  targetRound: bigint,
  drandChainHash: Hex,
  commitHash: Hex,
  ciphertext: Hex,
];

type CommitVoteWithPermitArgs = readonly [...CommitVoteArgs, permitDeadline: bigint, v: number, r: Hex, s: Hex];

type RoundVoteTransactionPlan = {
  advisoryVoteArgs: AdvisoryVoteArgs;
  calls: RoundVoteContractCall[];
  commitVoteArgs: CommitVoteArgs;
  isAdvisoryVote: boolean;
  needsApproval: boolean;
  stakeWei: bigint;
};

export function buildRoundVoteTransactionPlan(params: {
  advisoryVoteRecorderAddress?: EvmAddress;
  ciphertext: Hex;
  commitHash: Hex;
  contentId: bigint;
  currentAllowance: bigint;
  drandChainHash: Hex;
  frontend: EvmAddress;
  lrepAddress: EvmAddress;
  roundContext: bigint;
  stakeWei: bigint;
  targetRound: bigint;
  votingEngineAddress: EvmAddress;
}): RoundVoteTransactionPlan {
  const advisoryVoteArgs = [
    params.contentId,
    params.roundContext,
    params.targetRound,
    params.drandChainHash,
    params.commitHash,
    params.ciphertext,
  ] as const;
  const commitVoteArgs = [...advisoryVoteArgs, params.stakeWei, params.frontend] as const satisfies CommitVoteArgs;

  if (params.stakeWei === 0n) {
    if (!params.advisoryVoteRecorderAddress) {
      throw new Error("Zero-stake advisory voting is unavailable right now.");
    }

    return {
      advisoryVoteArgs,
      calls: [
        {
          abi: AdvisoryVoteRecorderAbi as Abi,
          address: params.advisoryVoteRecorderAddress,
          args: advisoryVoteArgs,
          functionName: "recordAdvisoryVote",
          kind: "recordAdvisoryVote",
        },
      ],
      commitVoteArgs,
      isAdvisoryVote: true,
      needsApproval: false,
      stakeWei: params.stakeWei,
    };
  }

  const needsApproval = params.currentAllowance < params.stakeWei;
  const calls: RoundVoteContractCall[] = [];
  if (needsApproval) {
    calls.push({
      abi: LoopReputationAbi as Abi,
      address: params.lrepAddress,
      args: [params.votingEngineAddress, params.stakeWei] as const,
      functionName: "approve",
      kind: "approve",
    });
  }

  calls.push({
    abi: RoundVotingEngineAbi as Abi,
    address: params.votingEngineAddress,
    args: commitVoteArgs,
    functionName: "commitVote",
    kind: "commitVote",
  });

  return {
    advisoryVoteArgs,
    calls,
    commitVoteArgs,
    isAdvisoryVote: false,
    needsApproval,
    stakeWei: params.stakeWei,
  };
}

export function buildCommitVoteWithPermitCall(
  plan: RoundVoteTransactionPlan,
  params: {
    deadline: bigint;
    r: Hex;
    s: Hex;
    v: number;
    votingEngineAddress: EvmAddress;
  },
): RoundVoteContractCall {
  if (plan.isAdvisoryVote || plan.stakeWei === 0n) {
    throw new Error("Permit commits are only available for staked votes.");
  }

  const args = [
    ...plan.commitVoteArgs,
    params.deadline,
    params.v,
    params.r,
    params.s,
  ] as const satisfies CommitVoteWithPermitArgs;
  return {
    abi: RoundVotingEngineAbi as Abi,
    address: params.votingEngineAddress,
    args,
    functionName: "commitVoteWithPermit",
    kind: "commitVoteWithPermit",
  };
}
