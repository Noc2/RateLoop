import { AdvisoryVoteRecorderAbi, RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import type { Address, Hex, PublicClient } from "viem";
import { zeroHash } from "viem";
import {
  type TransactionPostconditionWaitOptions,
  waitForTransactionPostcondition,
} from "~~/lib/transactions/postcondition";

type ReadContractClient = Pick<PublicClient, "readContract">;

export type RoundVoteCommitPostconditionParams = {
  advisoryVoteRecorderAddress?: Address;
  client: ReadContractClient;
  commitHash: Hex;
  contentId: bigint;
  isAdvisoryVote: boolean;
  roundId: bigint;
  voter: Address;
  votingEngineAddress: Address;
};

function normalizeHex(value: string) {
  return value.toLowerCase();
}

function isNonZeroHex(value: unknown): value is Hex {
  return typeof value === "string" && value.startsWith("0x") && normalizeHex(value) !== zeroHash;
}

export async function hasRoundVoteCommitPostcondition(params: RoundVoteCommitPostconditionParams) {
  if (params.isAdvisoryVote) {
    if (!params.advisoryVoteRecorderAddress) return false;

    const advisoryCommitKey = (await params.client.readContract({
      address: params.advisoryVoteRecorderAddress,
      abi: AdvisoryVoteRecorderAbi,
      functionName: "advisoryCommitKeyByRater",
      args: [params.contentId, params.roundId, params.voter],
    } as never)) as Hex;
    if (!isNonZeroHex(advisoryCommitKey)) return false;

    const advisoryCommitCore = (await params.client.readContract({
      address: params.advisoryVoteRecorderAddress,
      abi: AdvisoryVoteRecorderAbi,
      functionName: "advisoryCommitCore",
      args: [advisoryCommitKey],
    } as never)) as readonly unknown[];
    return normalizeHex(String(advisoryCommitCore[3] ?? "")) === normalizeHex(params.commitHash);
  }

  const voterCommitKey = (await params.client.readContract({
    address: params.votingEngineAddress,
    abi: RoundVotingEngineAbi,
    functionName: "voterCommitKey",
    args: [params.contentId, params.roundId, params.voter],
  } as never)) as readonly [Hex, Hex];
  return normalizeHex(voterCommitKey[0] ?? zeroHash) === normalizeHex(params.commitHash);
}

export async function hasRoundOpenPostcondition(params: {
  client: ReadContractClient;
  contentId: bigint;
  votingEngineAddress: Address;
}) {
  const currentRoundId = (await params.client.readContract({
    address: params.votingEngineAddress,
    abi: RoundVotingEngineAbi,
    functionName: "currentRoundId",
    args: [params.contentId],
  } as never)) as bigint;
  return currentRoundId > 0n;
}

export async function waitForRoundVoteCommitPostcondition(
  params: RoundVoteCommitPostconditionParams,
  options: TransactionPostconditionWaitOptions,
) {
  return waitForTransactionPostcondition(() => hasRoundVoteCommitPostcondition(params), "vote-postcondition", options);
}

export async function waitForRoundOpenPostcondition(
  params: {
    client: ReadContractClient;
    contentId: bigint;
    votingEngineAddress: Address;
  },
  options: TransactionPostconditionWaitOptions,
) {
  return waitForTransactionPostcondition(() => hasRoundOpenPostcondition(params), "open-round-postcondition", options);
}
