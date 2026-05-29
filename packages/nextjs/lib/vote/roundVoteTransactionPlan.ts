import { LoopReputationAbi } from "@rateloop/contracts";
import { AdvisoryVoteRecorderAbi, RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import type { Abi, Hex } from "viem";

type EvmAddress = `0x${string}`;

export type RoundVoteCallKind = "approve" | "commitVote" | "commitVoteWithPermit" | "openRound" | "recordAdvisoryVote";

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

type RoundVoteTransactionPlan = {
  advisoryVoteArgs: AdvisoryVoteArgs;
  calls: RoundVoteContractCall[];
  commitVoteArgs: CommitVoteArgs;
  isAdvisoryVote: boolean;
  needsApproval: boolean;
  stakeWei: bigint;
};

export type RoundVotePermitSignature = {
  deadline: bigint;
  r: Hex;
  s: Hex;
  v: number;
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
  permitSignature?: RoundVotePermitSignature;
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
  if (needsApproval && !params.permitSignature) {
    calls.push({
      abi: LoopReputationAbi as Abi,
      address: params.lrepAddress,
      args: [params.votingEngineAddress, params.stakeWei] as const,
      functionName: "approve",
      kind: "approve",
    });
  }

  if (needsApproval && params.permitSignature) {
    calls.push({
      abi: RoundVotingEngineAbi as Abi,
      address: params.votingEngineAddress,
      args: [
        ...commitVoteArgs,
        params.permitSignature.deadline,
        params.permitSignature.v,
        params.permitSignature.r,
        params.permitSignature.s,
      ] as const,
      functionName: "commitVoteWithPermit",
      kind: "commitVoteWithPermit",
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
