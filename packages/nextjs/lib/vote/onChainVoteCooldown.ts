import { getVoteCooldownRemainingSeconds } from "./cooldown";
import { AdvisoryVoteRecorderAbi, RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import { type Address, type Hex, zeroAddress } from "viem";
import { type PublicClient } from "viem";

interface VoteCooldownTimestampSnapshot {
  voterLastVote: bigint;
  identityHolderLastVote: bigint;
  identityLastVote: bigint;
}

interface AdvisoryVoteCooldownTimestampSnapshot {
  voterLastAdvisory: bigint;
  identityHolderLastAdvisory: bigint;
  identityLastAdvisory: bigint;
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

export function resolveLatestAdvisoryCommittedSeconds(
  snapshot: AdvisoryVoteCooldownTimestampSnapshot,
  voter: Address,
  identityHolder?: Address | null,
) {
  let lastAdvisory = snapshot.voterLastAdvisory;
  if (
    identityHolder &&
    identityHolder !== zeroAddress &&
    identityHolder.toLowerCase() !== voter.toLowerCase() &&
    snapshot.identityHolderLastAdvisory > lastAdvisory
  ) {
    lastAdvisory = snapshot.identityHolderLastAdvisory;
  }
  if (snapshot.identityLastAdvisory > lastAdvisory) {
    lastAdvisory = snapshot.identityLastAdvisory;
  }
  return lastAdvisory > 0n ? lastAdvisory : null;
}

export function getAdvisoryOnChainCooldownRemainingSeconds(
  snapshot: AdvisoryVoteCooldownTimestampSnapshot,
  nowSeconds: number,
  voter: Address,
  identityHolder?: Address | null,
) {
  const committedSeconds = resolveLatestAdvisoryCommittedSeconds(snapshot, voter, identityHolder);
  if (committedSeconds === null) return 0;
  return getVoteCooldownRemainingSeconds(committedSeconds, nowSeconds);
}

export function getEffectiveVoteCooldownRemainingSeconds(engineRemaining: number, advisoryRemaining: number) {
  return Math.max(engineRemaining, advisoryRemaining);
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

async function readOnChainVoteCooldownRemainingSeconds(params: {
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

async function readAdvisoryOnChainCooldownRemainingSeconds(params: {
  advisoryVoteRecorderAddress: Address;
  contentId: bigint;
  identityHolder?: Address | null;
  identityKey?: Hex | null;
  nowSeconds: number;
  publicClient: PublicClient;
  voter: Address;
}) {
  const [voterLastAdvisory, identityLastAdvisory] = await Promise.all([
    params.publicClient.readContract({
      abi: AdvisoryVoteRecorderAbi,
      address: params.advisoryVoteRecorderAddress,
      functionName: "lastAdvisoryVoteTimestamp",
      args: [params.contentId, params.voter],
    }),
    params.identityKey
      ? params.publicClient.readContract({
          abi: AdvisoryVoteRecorderAbi,
          address: params.advisoryVoteRecorderAddress,
          functionName: "lastAdvisoryVoteTimestampByIdentity",
          args: [params.contentId, params.identityKey],
        })
      : Promise.resolve(0n),
  ]);

  let identityHolderLastAdvisory = 0n;
  if (
    params.identityHolder &&
    params.identityHolder !== zeroAddress &&
    params.identityHolder.toLowerCase() !== params.voter.toLowerCase()
  ) {
    identityHolderLastAdvisory = await params.publicClient.readContract({
      abi: AdvisoryVoteRecorderAbi,
      address: params.advisoryVoteRecorderAddress,
      functionName: "lastAdvisoryVoteTimestamp",
      args: [params.contentId, params.identityHolder],
    });
  }

  return getAdvisoryOnChainCooldownRemainingSeconds(
    { voterLastAdvisory, identityHolderLastAdvisory, identityLastAdvisory },
    params.nowSeconds,
    params.voter,
    params.identityHolder,
  );
}

export async function readEffectiveOnChainVoteCooldownRemainingSeconds(params: {
  advisoryVoteRecorderAddress?: Address | null;
  contentId: bigint;
  identityHolder?: Address | null;
  identityKey?: Hex | null;
  includeAdvisoryCooldown?: boolean;
  nowSeconds: number;
  publicClient: PublicClient;
  voter: Address;
  votingEngineAddress: Address;
}) {
  const engineRemaining = await readOnChainVoteCooldownRemainingSeconds({
    contentId: params.contentId,
    identityHolder: params.identityHolder,
    identityKey: params.identityKey,
    nowSeconds: params.nowSeconds,
    publicClient: params.publicClient,
    voter: params.voter,
    votingEngineAddress: params.votingEngineAddress,
  });

  if (!params.includeAdvisoryCooldown || !params.advisoryVoteRecorderAddress) {
    return engineRemaining;
  }

  const advisoryRemaining = await readAdvisoryOnChainCooldownRemainingSeconds({
    advisoryVoteRecorderAddress: params.advisoryVoteRecorderAddress,
    contentId: params.contentId,
    identityHolder: params.identityHolder,
    identityKey: params.identityKey,
    nowSeconds: params.nowSeconds,
    publicClient: params.publicClient,
    voter: params.voter,
  });

  return getEffectiveVoteCooldownRemainingSeconds(engineRemaining, advisoryRemaining);
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
