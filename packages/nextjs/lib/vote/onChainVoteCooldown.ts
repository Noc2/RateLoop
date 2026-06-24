import { VOTE_COOLDOWN_SECONDS, getVoteCooldownRemainingSeconds } from "./cooldown";
import { RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import { type Address, type Hex, zeroAddress } from "viem";
import { type PublicClient } from "viem";

export interface VoteCooldownTimestampSnapshot {
  voterLastVote: bigint;
  identityHolderLastVote: bigint;
  identityLastVote: bigint;
}

export function resolveLatestVoteCommittedSeconds(
  snapshot: VoteCooldownTimestampSnapshot,
  voter: Address,
  identityHolder?: Address | null,
) {
  let lastVote = snapshot.voterLastVote;
  if (
    identityHolder &&
    identityHolder !== zeroAddress &&
    identityHolder.toLowerCase() !== voter.toLowerCase() &&
    snapshot.identityHolderLastVote > lastVote
  ) {
    lastVote = snapshot.identityHolderLastVote;
  }
  if (snapshot.identityLastVote > lastVote) {
    lastVote = snapshot.identityLastVote;
  }
  return lastVote > 0n ? lastVote : null;
}

export function getOnChainVoteCooldownRemainingSeconds(
  snapshot: VoteCooldownTimestampSnapshot,
  nowSeconds: number,
  voter: Address,
  identityHolder?: Address | null,
) {
  const committedSeconds = resolveLatestVoteCommittedSeconds(snapshot, voter, identityHolder);
  if (committedSeconds === null) return 0;
  return getVoteCooldownRemainingSeconds(committedSeconds, nowSeconds);
}

export function buildVoteCooldownTimestampReadArgs(params: {
  contentId: bigint;
  voter: Address;
  identityHolder?: Address | null;
  identityKey?: Hex | null;
}) {
  return [
    params.contentId,
    params.voter,
    params.identityHolder && params.identityHolder !== zeroAddress ? params.identityHolder : zeroAddress,
    params.identityKey ?? "0x" + "0".repeat(64),
  ] as const;
}

export async function readOnChainVoteCooldownRemainingSeconds(params: {
  contentId: bigint;
  identityHolder?: Address | null;
  identityKey?: Hex | null;
  nowSeconds: number;
  publicClient: PublicClient;
  voter: Address;
  votingEngineAddress: Address;
}) {
  const [voterLastVote, identityHolderLastVote, identityLastVote] = await params.publicClient.readContract({
    abi: RoundVotingEngineAbi,
    address: params.votingEngineAddress,
    functionName: "voteCooldownTimestamps",
    args: buildVoteCooldownTimestampReadArgs({
      contentId: params.contentId,
      voter: params.voter,
      identityHolder: params.identityHolder,
      identityKey: params.identityKey,
    }),
  });

  return getOnChainVoteCooldownRemainingSeconds(
    { voterLastVote, identityHolderLastVote, identityLastVote },
    params.nowSeconds,
    params.voter,
    params.identityHolder,
  );
}

export async function readOnChainVoteCooldownsByContentId(params: {
  contentIds: readonly bigint[];
  identityHolder?: Address | null;
  identityKey?: Hex | null;
  nowSeconds: number;
  publicClient: PublicClient;
  voter: Address;
  votingEngineAddress: Address;
}) {
  let cooldowns = new Map<string, number>();

  for (const contentId of params.contentIds) {
    const remainingSeconds = await readOnChainVoteCooldownRemainingSeconds({
      contentId,
      identityHolder: params.identityHolder,
      identityKey: params.identityKey,
      nowSeconds: params.nowSeconds,
      publicClient: params.publicClient,
      voter: params.voter,
      votingEngineAddress: params.votingEngineAddress,
    });
    cooldowns = mergeVoteCooldownRemainingByContentId(cooldowns, contentId, remainingSeconds);
  }

  return cooldowns;
}

export function maxVoteCooldownRemainingSeconds(current: number, next: number) {
  return Math.max(current, next);
}

export function mergeVoteCooldownRemainingByContentId(
  current: Map<string, number>,
  contentId: bigint,
  remainingSeconds: number,
) {
  if (remainingSeconds <= 0) return current;

  const key = contentId.toString();
  const previous = current.get(key) ?? 0;
  if (remainingSeconds <= previous) return current;

  const next = new Map(current);
  next.set(key, remainingSeconds);
  return next;
}

export { VOTE_COOLDOWN_SECONDS };
