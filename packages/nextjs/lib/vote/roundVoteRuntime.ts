import { parseRound, parseVotingConfig } from "../contracts/roundVotingEngine";
import { deriveCommitVoteRuntimeNowMs } from "./tlockCommitTiming";
import { RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import { type PublicClient } from "viem";

const roundCommitPreviewAbi = [
  {
    type: "function",
    name: "previewCommitRoundId",
    stateMutability: "view",
    inputs: [{ name: "contentId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "previewCommitReferenceRatingBps",
    stateMutability: "view",
    inputs: [{ name: "contentId", type: "uint256" }],
    outputs: [{ name: "", type: "uint16" }],
  },
] as const;

function isRoundClosed(params: {
  parsedConfig: ReturnType<typeof parseVotingConfig>;
  parsedRound: NonNullable<ReturnType<typeof parseRound>>;
  runtimeTimestampSeconds: number;
}) {
  const revealQuorum = Math.max(params.parsedConfig.minVoters, 3);
  return (
    params.parsedRound.thresholdReachedAt > 0n ||
    Number(params.parsedRound.revealedCount) >= revealQuorum ||
    params.parsedRound.voteCount >= BigInt(params.parsedConfig.maxVoters) ||
    params.runtimeTimestampSeconds >= Number(params.parsedRound.startTime) + params.parsedConfig.maxDuration
  );
}

export async function resolveRoundVoteRuntime(params: {
  publicClient: PublicClient;
  votingEngineAddress: `0x${string}`;
  contentId: bigint;
  fallbackEpochDuration: number;
}) {
  const latestBlock = await params.publicClient.getBlock({ blockTag: "latest" });
  let pendingTimestampSeconds = Number(latestBlock.timestamp);
  let canReadPendingBlock = false;
  try {
    const pendingBlock = await params.publicClient.getBlock({ blockTag: "pending" });
    pendingTimestampSeconds = Number(pendingBlock.timestamp);
    canReadPendingBlock = true;
  } catch {
    pendingTimestampSeconds = Number(latestBlock.timestamp);
  }

  const snapshotBlockNumber = latestBlock.number;
  const runtimeTimestampSeconds = Math.max(Number(latestBlock.timestamp), pendingTimestampSeconds);
  const previewBlock = canReadPendingBlock ? { blockTag: "pending" as const } : { blockNumber: snapshotBlockNumber };

  const [roundId, roundReferenceRatingBps] = await Promise.all([
    params.publicClient.readContract({
      address: params.votingEngineAddress,
      abi: roundCommitPreviewAbi,
      functionName: "previewCommitRoundId",
      args: [params.contentId],
      ...previewBlock,
    }),
    params.publicClient.readContract({
      address: params.votingEngineAddress,
      abi: roundCommitPreviewAbi,
      functionName: "previewCommitReferenceRatingBps",
      args: [params.contentId],
      ...previewBlock,
    }),
  ]);

  let roundStartTimeSeconds: number | null = null;
  let baseTotalStake = 0n;
  let baseVoteCount = 0n;
  let epochDuration = params.fallbackEpochDuration;
  let resolvedRoundId = roundId;
  let resolvedRoundReferenceRatingBps = roundReferenceRatingBps as number;
  if (roundId > 0n) {
    const [round, roundConfig] = await Promise.all([
      params.publicClient.readContract({
        address: params.votingEngineAddress,
        abi: RoundVotingEngineAbi,
        functionName: "rounds",
        args: [params.contentId, roundId],
        ...previewBlock,
      }),
      params.publicClient.readContract({
        address: params.votingEngineAddress,
        abi: RoundVotingEngineAbi,
        functionName: "roundConfigSnapshot",
        args: [params.contentId, roundId],
        ...previewBlock,
      }),
    ]);
    const parsedRound = parseRound(round);
    const parsedConfig = parseVotingConfig(roundConfig);

    if (parsedRound?.state === 0 && parsedRound.startTime > 0n) {
      if (isRoundClosed({ parsedConfig, parsedRound, runtimeTimestampSeconds })) {
        throw new Error("RoundNotOpen");
      }

      baseTotalStake = parsedRound.totalStake;
      baseVoteCount = parsedRound.voteCount;
      epochDuration = parsedConfig.epochDuration;
      roundStartTimeSeconds = Number(parsedRound.startTime);
    } else {
      const currentRoundId = await params.publicClient.readContract({
        address: params.votingEngineAddress,
        abi: RoundVotingEngineAbi,
        functionName: "currentRoundId",
        args: [params.contentId],
        ...previewBlock,
      });

      if (currentRoundId > 0n && currentRoundId !== roundId) {
        const [currentRound, currentRoundConfig] = await Promise.all([
          params.publicClient.readContract({
            address: params.votingEngineAddress,
            abi: RoundVotingEngineAbi,
            functionName: "rounds",
            args: [params.contentId, currentRoundId],
            ...previewBlock,
          }),
          params.publicClient.readContract({
            address: params.votingEngineAddress,
            abi: RoundVotingEngineAbi,
            functionName: "roundConfigSnapshot",
            args: [params.contentId, currentRoundId],
            ...previewBlock,
          }),
        ]);
        const parsedCurrentRound = parseRound(currentRound);
        const parsedCurrentConfig = parseVotingConfig(currentRoundConfig);

        if (
          parsedCurrentRound?.state === 0 &&
          parsedCurrentRound.startTime > 0n &&
          !isRoundClosed({
            parsedConfig: parsedCurrentConfig,
            parsedRound: parsedCurrentRound,
            runtimeTimestampSeconds,
          })
        ) {
          baseTotalStake = parsedCurrentRound.totalStake;
          baseVoteCount = parsedCurrentRound.voteCount;
          epochDuration = parsedCurrentConfig.epochDuration;
          resolvedRoundId = currentRoundId;
          // `commitVote` binds to the current round id. If preview already advanced to
          // the next unopened slot, the best available public reference is the live
          // preview reference, which matches the just-opened round's snapshot.
          resolvedRoundReferenceRatingBps = roundReferenceRatingBps as number;
          roundStartTimeSeconds = Number(parsedCurrentRound.startTime);
        }
      }
    }
  }

  const runtimeNowMs = deriveCommitVoteRuntimeNowMs({
    latestBlockTimestampSeconds: runtimeTimestampSeconds,
    epochDurationSeconds: epochDuration,
    roundStartTimeSeconds,
  });

  return {
    epochDuration,
    baseTotalStake,
    baseVoteCount,
    now: () => runtimeNowMs,
    requiresOpenRound: roundStartTimeSeconds == null,
    roundStartTimeSeconds,
    roundId: resolvedRoundId,
    roundReferenceRatingBps: resolvedRoundReferenceRatingBps,
  };
}
