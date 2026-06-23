import { AdvisoryVoteRecorderAbi, RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import type { Address, Hex, PublicClient } from "viem";
import { zeroHash } from "viem";

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

export type RoundVotePostconditionWaitOptions = {
  onEvent?: (event: string, extra?: Record<string, unknown>) => void;
  pollingIntervalMs: number;
  shouldStop?: () => boolean;
  slowMs?: number;
  timeoutMs?: number;
};

const ROUND_VOTE_POSTCONDITION_TIMEOUT_MS = 20_000;
const ROUND_VOTE_POSTCONDITION_SLOW_MS = 4_000;

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
  options: RoundVotePostconditionWaitOptions,
) {
  return waitForRoundVotePostcondition(() => hasRoundVoteCommitPostcondition(params), "vote-postcondition", options);
}

export async function waitForRoundOpenPostcondition(
  params: {
    client: ReadContractClient;
    contentId: bigint;
    votingEngineAddress: Address;
  },
  options: RoundVotePostconditionWaitOptions,
) {
  return waitForRoundVotePostcondition(() => hasRoundOpenPostcondition(params), "open-round-postcondition", options);
}

async function waitForRoundVotePostcondition(
  checkPostcondition: () => Promise<boolean>,
  eventPrefix: string,
  options: RoundVotePostconditionWaitOptions,
) {
  const timeoutMs = options.timeoutMs ?? ROUND_VOTE_POSTCONDITION_TIMEOUT_MS;
  const slowMs = options.slowMs ?? ROUND_VOTE_POSTCONDITION_SLOW_MS;
  const startedAt = Date.now();
  let pollCount = 0;
  let slowLogged = false;

  options.onEvent?.(`${eventPrefix}-wait-start`);

  for (;;) {
    if (options.shouldStop?.()) {
      return false;
    }

    pollCount += 1;
    try {
      if (await checkPostcondition()) {
        options.onEvent?.(`${eventPrefix}-wait-complete`, { pollCount });
        return true;
      }
    } catch (error) {
      options.onEvent?.(`${eventPrefix}-poll-error`, {
        message: error instanceof Error ? error.message : "Unknown error",
        pollCount,
      });
    }

    const elapsedMs = Date.now() - startedAt;
    if (!slowLogged && elapsedMs >= slowMs) {
      slowLogged = true;
      options.onEvent?.(`${eventPrefix}-wait-slow`, { pollCount });
    }
    if (elapsedMs >= timeoutMs) {
      options.onEvent?.(`${eventPrefix}-wait-timeout`, { pollCount });
      return false;
    }

    await delay(Math.max(200, Math.min(options.pollingIntervalMs, timeoutMs - elapsedMs)));
  }
}
